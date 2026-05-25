# apps/agent/app/db/models.py
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class Document(Base):
    __tablename__ = "documents"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), nullable=True)
    filename = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)
    file_type = Column(String(20), nullable=False)
    status = Column(String(50), default="pending")
    is_demo = Column(Integer, default=0)
    chunk_count = Column(Integer, default=0)
    file_size = Column(Integer)
    summary = Column(Text, nullable=True)
    summary_status = Column(String(20), default="none")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), nullable=False)
    title = Column(String(255))
    mode = Column(String(20), default="upload")
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

class Message(Base):
    __tablename__ = "messages"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("chat_sessions.id"), nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    sources = Column(Text)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
