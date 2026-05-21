# apps/agent/app/db/repository.py
import json
import uuid
from typing import Optional
from sqlalchemy import text
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

    def update_summary(self, doc_id: str, summary: str):
        doc = self.get_by_id(doc_id)
        if doc:
            doc.summary = summary
            doc.summary_status = "ready"
            self.db.commit()

    def update_summary_status(self, doc_id: str, status: str):
        doc = self.get_by_id(doc_id)
        if doc:
            doc.summary_status = status
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


class ChunkRepository:
    def __init__(self, db: Session):
        self.db = db

    def upsert_batch(
        self,
        document_id: str,
        chunks: list[dict],
        embeddings: list[list[float]],
        file_type: str,
    ):
        sql = text("""
            INSERT INTO document_chunks
                (id, document_id, chunk_index, text, embedding,
                 page_num, page_idx, bbox, paragraph_idx, sheet_name, row_start, file_type)
            VALUES
                (:id, :document_id, :chunk_index, :text, STRING_TO_VECTOR(:embedding),
                 :page_num, :page_idx, :bbox, :paragraph_idx, :sheet_name, :row_start, :file_type)
            ON DUPLICATE KEY UPDATE
                text = VALUES(text),
                embedding = VALUES(embedding),
                page_num = VALUES(page_num),
                page_idx = VALUES(page_idx),
                bbox = VALUES(bbox),
                paragraph_idx = VALUES(paragraph_idx),
                sheet_name = VALUES(sheet_name),
                row_start = VALUES(row_start),
                file_type = VALUES(file_type)
        """)
        for chunk, embedding in zip(chunks, embeddings):
            self.db.execute(sql, {
                "id": f"{document_id}_{chunk['chunk_index']}",
                "document_id": document_id,
                "chunk_index": chunk["chunk_index"],
                "text": chunk["text"],
                "embedding": json.dumps(embedding),
                "page_num": chunk.get("page_num"),
                "page_idx": chunk.get("page_idx"),
                "bbox": json.dumps(chunk["bbox"]) if chunk.get("bbox") else None,
                "paragraph_idx": chunk.get("paragraph_idx"),
                "sheet_name": chunk.get("sheet_name"),
                "row_start": chunk.get("row_start"),
                "file_type": file_type,
            })
        self.db.commit()

    def get_all_for_document(self, document_id: str) -> list[dict]:
        """Fetch all chunks for a document including embeddings (used for BM25 + vector search)."""
        rows = self.db.execute(text("""
            SELECT id, chunk_index, text, page_num, page_idx, bbox,
                   paragraph_idx, sheet_name, row_start, file_type,
                   VECTOR_TO_STRING(embedding) AS embedding_str
            FROM document_chunks
            WHERE document_id = :doc_id
            ORDER BY chunk_index
        """), {"doc_id": document_id}).fetchall()

        result = []
        for row in rows:
            embedding = json.loads(row[10]) if row[10] else []
            result.append({
                "id": row[0],
                "text": row[2],
                "embedding": embedding,
                "metadata": {
                    "document_id": document_id,
                    "page_num": row[3],
                    "page_idx": row[4],
                    "bbox": row[5],
                    "paragraph_idx": row[6],
                    "sheet_name": row[7],
                    "row_start": row[8],
                    "file_type": row[9],
                },
            })
        return result

    def delete_by_document(self, document_id: str):
        self.db.execute(
            text("DELETE FROM document_chunks WHERE document_id = :doc_id"),
            {"doc_id": document_id},
        )
        self.db.commit()
