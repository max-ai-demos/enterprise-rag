# apps/agent/app/api/history.py
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.db.repository import SessionRepository, MessageRepository

router = APIRouter()


@router.get("")
def list_sessions(user_id: str, db: Session = Depends(get_db)):
    repo = SessionRepository(db)
    sessions = repo.list_for_user(user_id)
    return [
        {
            "session_id": s.id,
            "title": s.title or "新对话",
            "mode": s.mode,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        }
        for s in sessions
    ]


@router.get("/{session_id}/messages")
def get_messages(session_id: str, user_id: str, db: Session = Depends(get_db)):
    sess_repo = SessionRepository(db)
    session = sess_repo.get_by_id(session_id)
    if not session:
        raise HTTPException(404, "Session not found")
    if session.user_id != user_id:
        raise HTTPException(403, "Not your session")

    msg_repo = MessageRepository(db)
    messages = msg_repo.list_for_session(session_id)
    return [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "sources": json.loads(m.sources) if m.sources else [],
            "created_at": m.created_at.isoformat() if m.created_at else None,
        }
        for m in messages
    ]
