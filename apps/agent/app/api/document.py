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


def _run_ingestion(doc_id: str, file_path: str, file_type: str, db_path: str):
    """Background ingestion task — opens its own DB session."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
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
        str(settings.resolved_database_path()),
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
