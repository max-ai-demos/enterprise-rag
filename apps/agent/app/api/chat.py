# apps/agent/app/api/chat.py
import json
import logging
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.db.repository import DocumentRepository, SessionRepository, MessageRepository
from app.rag.pipeline import rag_answer

router = APIRouter()
logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    query: str
    user_id: str
    session_id: str | None = None
    document_ids: list[str] | None = None
    mode: str = "upload"  # "upload" | "demo"


@router.post("/message")
def chat_message(req: ChatRequest, db: Session = Depends(get_db)):
    doc_repo = DocumentRepository(db)
    sess_repo = SessionRepository(db)
    msg_repo = MessageRepository(db)

    # Resolve document IDs
    if req.document_ids:
        doc_ids = req.document_ids
    elif req.mode == "demo":
        doc_ids = [d.id for d in doc_repo.list_demo() if d.status == "ready"]
    else:
        doc_ids = [d.id for d in doc_repo.list_for_user(req.user_id) if d.status == "ready"]

    # Build doc_id → metadata map
    all_docs = (
        doc_repo.list_demo() if req.mode == "demo"
        else doc_repo.list_for_user(req.user_id)
    )
    doc_meta = {d.id: {"filename": d.filename, "file_type": d.file_type} for d in all_docs}

    # Get or create session
    session_id = req.session_id
    if not session_id:
        session = sess_repo.create(user_id=req.user_id, mode=req.mode)
        session_id = session.id
    else:
        session = sess_repo.get_by_id(session_id)
        if not session:
            session = sess_repo.create(user_id=req.user_id, mode=req.mode)
            session_id = session.id

    # Get conversation history
    recent_msgs = msg_repo.get_recent(session_id, limit=6)
    history = [{"role": m.role, "content": m.content} for m in recent_msgs]

    # Save user message
    msg_repo.create(session_id=session_id, role="user", content=req.query)
    sess_repo.update_title(session_id, req.query)

    # Run RAG pipeline
    result = rag_answer(
        query=req.query,
        user_id=req.user_id,
        session_id=session_id,
        document_ids=doc_ids,
        history=history,
        document_metadata=doc_meta,
    )

    # Persist assistant message
    msg_repo.create(
        session_id=session_id,
        role="assistant",
        content=result["answer"],
        sources=json.dumps(result["sources"]),
    )
    sess_repo.touch(session_id)

    return result
