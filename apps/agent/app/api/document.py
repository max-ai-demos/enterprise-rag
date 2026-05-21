# apps/agent/app/api/document.py
import logging
from fastapi import APIRouter, UploadFile, File, Form, Request, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.db.repository import DocumentRepository
from app.infrastructure.file_storage import save_upload, delete_file
from app.rag.ingestion import ingest_document, delete_document_vectors

router = APIRouter()
logger = logging.getLogger(__name__)

ALLOWED_TYPES = {"pdf", "docx", "xlsx", "txt"}

def _ext_to_type(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower()


def _run_ingestion(doc_id: str, file_path: str, file_type: str, database_url: str):
    """Background ingestion task — opens its own DB session."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(database_url, pool_pre_ping=True)
    Session = sessionmaker(bind=engine)
    with Session() as session:
        repo = DocumentRepository(session)
        try:
            count = ingest_document(doc_id, file_path, file_type)
            repo.update_status(doc_id, "ready", count)
        except Exception as e:
            logger.error(f"Ingestion failed for {doc_id}: {e}")
            repo.update_status(doc_id, "failed")


@router.post("/upload")
async def upload_document(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Form(None),
    db: Session = Depends(get_db),
):
    # Accept user_id from header (proxy) or form field (direct calls)
    if not user_id:
        user_id = request.headers.get("x-user-id")
    if not user_id:
        raise HTTPException(400, "user_id is required")
    file_type = _ext_to_type(file.filename or "")
    if file_type not in ALLOWED_TYPES:
        raise HTTPException(400, f"Unsupported file type: {file_type}")

    content = await file.read()
    file_path, file_size = save_upload(content, file.filename, user_id)

    repo = DocumentRepository(db)
    doc = repo.create(
        user_id=user_id,
        filename=file.filename,
        file_path=file_path,
        file_type=file_type,
        file_size=file_size,
    )

    from app.infrastructure.config import settings
    background_tasks.add_task(
        _run_ingestion,
        doc.id,
        str(settings.resolved_upload_dir().parent / file_path),
        file_type,
        settings.database_url,
    )

    return {"document_id": doc.id, "filename": doc.filename, "status": "processing"}


@router.get("")
def list_documents(user_id: str, db: Session = Depends(get_db)):
    repo = DocumentRepository(db)
    docs = repo.list_for_user(user_id)
    return [
        {
            "document_id": d.id,
            "filename": d.filename,
            "file_type": d.file_type,
            "status": d.status,
            "chunk_count": d.chunk_count,
            "file_size": d.file_size,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in docs
    ]


@router.get("/demo")
def list_demo_documents(db: Session = Depends(get_db)):
    repo = DocumentRepository(db)
    docs = repo.list_demo()
    return [
        {
            "document_id": d.id,
            "filename": d.filename,
            "file_type": d.file_type,
            "status": d.status,
            "chunk_count": d.chunk_count,
        }
        for d in docs
    ]


@router.post("/{document_id}/summary")
def generate_summary(document_id: str, db: Session = Depends(get_db)):
    """Generate (or return cached) document summary."""
    from app.rag.summarizer import get_document_full_text, summarize_document
    from app.infrastructure.config import settings as cfg

    repo = DocumentRepository(db)
    doc = repo.get_by_id(document_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    # Return cached summary if already generated
    if doc.summary_status == "ready" and doc.summary:
        return {"document_id": document_id, "summary": doc.summary, "cached": True}

    full_path = cfg.resolved_upload_dir().parent / doc.file_path
    if not full_path.exists():
        raise HTTPException(404, "File not found on disk")

    repo.update_summary_status(document_id, "pending")
    try:
        full_text = get_document_full_text(str(full_path), doc.file_type)
        summary = summarize_document(full_text)
        repo.update_summary(document_id, summary)
        return {"document_id": document_id, "summary": summary, "cached": False}
    except Exception as e:
        repo.update_summary_status(document_id, "failed")
        logger.error(f"Summarization failed for {document_id}: {e}")
        raise HTTPException(500, f"Summarization failed: {e}")


@router.post("/{document_id}/summary/stream")
def generate_summary_stream(document_id: str, db: Session = Depends(get_db)):
    """Streaming summary via SSE. Yields progress then text deltas."""
    import json
    from fastapi.responses import StreamingResponse
    from app.rag.summarizer import get_document_full_text, summarize_document_stream
    from app.infrastructure.config import settings as cfg

    repo = DocumentRepository(db)
    doc = repo.get_by_id(document_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    if doc.summary_status == "ready" and doc.summary:
        cached = doc.summary
        def _cached():
            yield f"data: {json.dumps({'type': 'delta', 'content': cached})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'cached': True})}\n\n"
        return StreamingResponse(_cached(), media_type="text/event-stream")

    full_path = cfg.resolved_upload_dir().parent / doc.file_path
    if not full_path.exists():
        raise HTTPException(404, "File not found on disk")

    file_path_str = str(full_path)
    file_type = doc.file_type
    database_url = cfg.database_url

    def _generate():
        full_text = get_document_full_text(file_path_str, file_type)
        final_summary = ""
        for event in summarize_document_stream(full_text):
            if event["type"] == "done":
                final_summary = event.get("summary", "")
            yield f"data: {json.dumps(event)}\n\n"
        if final_summary:
            from sqlalchemy import create_engine
            from sqlalchemy.orm import sessionmaker
            engine = create_engine(database_url, pool_pre_ping=True)
            Session_ = sessionmaker(bind=engine)
            with Session_() as session:
                DocumentRepository(session).update_summary(document_id, final_summary)

    return StreamingResponse(_generate(), media_type="text/event-stream")


@router.get("/{document_id}/summary")
def get_summary(document_id: str, db: Session = Depends(get_db)):
    """Get cached summary. Returns 404 if not yet generated."""
    repo = DocumentRepository(db)
    doc = repo.get_by_id(document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    if not doc.summary:
        raise HTTPException(404, "No summary available. POST /documents/{id}/summary to generate.")
    return {
        "document_id": document_id,
        "summary": doc.summary,
        "summary_status": doc.summary_status,
    }


@router.delete("/{document_id}")
def delete_document(document_id: str, user_id: str, db: Session = Depends(get_db)):
    repo = DocumentRepository(db)
    doc = repo.get_by_id(document_id)
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.user_id != user_id:
        raise HTTPException(403, "Not your document")
    delete_file(doc.file_path)
    delete_document_vectors(document_id)
    repo.delete(document_id)
    return {"deleted": True}


@router.get("/file/{document_id}")
def serve_file(document_id: str, db: Session = Depends(get_db)):
    from app.infrastructure.config import settings as cfg
    repo = DocumentRepository(db)
    doc = repo.get_by_id(document_id)
    if not doc:
        raise HTTPException(404, "Not found")
    full_path = cfg.resolved_upload_dir().parent / doc.file_path
    if not full_path.exists():
        raise HTTPException(404, "File not on disk")
    return FileResponse(str(full_path), filename=doc.filename)
