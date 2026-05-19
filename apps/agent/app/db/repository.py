# apps/agent/app/db/repository.py
import uuid
from typing import Optional
from sqlalchemy.orm import Session
from app.db.models import Document, ChatSession, Message

class DocumentRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, *, user_id, filename, file_path, file_type,
               file_size=None, is_demo=False) -> Document:
        doc = Document(
            id=str(uuid.uuid4()),
            user_id=user_id,
            filename=filename,
            file_path=file_path,
            file_type=file_type,
            file_size=file_size,
            is_demo=1 if is_demo else 0,
            status="pending",
        )
        self.db.add(doc)
        self.db.commit()
        self.db.refresh(doc)
        return doc

    def get_by_id(self, doc_id: str) -> Optional[Document]:
        return self.db.query(Document).filter(Document.id == doc_id).first()

    def list_for_user(self, user_id: str) -> list[Document]:
        return self.db.query(Document).filter(
            Document.user_id == user_id, Document.is_demo == 0
        ).order_by(Document.created_at.desc()).all()

    def list_demo(self) -> list[Document]:
        return self.db.query(Document).filter(Document.is_demo == 1).all()

    def update_status(self, doc_id: str, status: str, chunk_count: int = 0):
        doc = self.get_by_id(doc_id)
        if doc:
            doc.status = status
            doc.chunk_count = chunk_count
            self.db.commit()

    def delete(self, doc_id: str):
        doc = self.get_by_id(doc_id)
        if doc:
            self.db.delete(doc)
            self.db.commit()


class SessionRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, *, user_id: str, mode: str = "upload") -> ChatSession:
        session = ChatSession(id=str(uuid.uuid4()), user_id=user_id, mode=mode)
        self.db.add(session)
        self.db.commit()
        self.db.refresh(session)
        return session

    def get_by_id(self, session_id: str) -> Optional[ChatSession]:
        return self.db.query(ChatSession).filter(ChatSession.id == session_id).first()

    def list_for_user(self, user_id: str) -> list[ChatSession]:
        return self.db.query(ChatSession).filter(
            ChatSession.user_id == user_id
        ).order_by(ChatSession.updated_at.desc()).all()

    def update_title(self, session_id: str, title: str):
        s = self.get_by_id(session_id)
        if s and not s.title:
            s.title = title[:30]
            self.db.commit()

    def touch(self, session_id: str):
        from datetime import datetime
        s = self.get_by_id(session_id)
        if s:
            s.updated_at = datetime.utcnow()
            self.db.commit()


class MessageRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, *, session_id: str, role: str,
               content: str, sources: Optional[str] = None) -> Message:
        msg = Message(
            id=str(uuid.uuid4()),
            session_id=session_id,
            role=role,
            content=content,
            sources=sources,
        )
        self.db.add(msg)
        self.db.commit()
        self.db.refresh(msg)
        return msg

    def list_for_session(self, session_id: str) -> list[Message]:
        return self.db.query(Message).filter(
            Message.session_id == session_id
        ).order_by(Message.created_at.asc()).all()

    def get_recent(self, session_id: str, limit: int = 6) -> list[Message]:
        msgs = self.list_for_session(session_id)
        return msgs[-limit:]
