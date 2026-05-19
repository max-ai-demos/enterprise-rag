# Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python FastAPI RAG agent that accepts document uploads, indexes them with hybrid retrieval, and answers questions with plain JSON responses and source citations.

**Architecture:** FastAPI serves three endpoint groups (documents, chat, history). LlamaIndex orchestrates the RAG pipeline: ingestion → hybrid retrieval (BM25 + vector) → LLM reranking → confidence check → GPT-4o (non-streaming). All state lives in a shared SQLite database and ChromaDB vector store under `data/`.

**Tech Stack:** Python 3.11, FastAPI, LlamaIndex 0.10+, ChromaDB, SQLAlchemy (sync), OpenAI GPT-4o, pymupdf (PyMuPDF), python-docx, openpyxl

---

## File Map

```
enterprise-rag/
  data/                              ← created by init script
  scripts/
    init.sql                         ← CREATE TABLE statements
    init_db.py                       ← run init.sql + seed 5 users
    seed_demo.py                     ← register + ingest data/demo/ files (run after Task 4)
  apps/agent/
    main.py                          ← FastAPI app, routers, CORS
    requirements.txt
    .env.example
    app/
      infrastructure/
        config.py                    ← pydantic-settings, reads .env
        file_storage.py              ← save/delete files under data/uploads/
      db/
        database.py                  ← SQLAlchemy engine + session factory
        models.py                    ← ORM models for documents, sessions, messages
        repository.py                ← CRUD functions (no ORM logic in routes)
      rag/
        ingestion.py                 ← parse file → chunks → embed → ChromaDB + DB
        query_rewriter.py            ← rewrite query using last 3 turns
        hybrid_retriever.py          ← BM25 + vector, RRF fusion → top 15
        reranker.py                  ← LLMRerank top 15 → top 5
        confidence.py                ← check top score, return "not found" if low
        prompt.py                    ← system prompt + context builder
        pipeline.py                  ← orchestrate steps 1–6, return JSON
        memory.py                    ← Mem0 get/add (no-op when MEM0_ENABLED=false)
      api/
        document.py                  ← POST /documents/upload, GET, DELETE
        chat.py                      ← POST /chat/message (JSON response)
        history.py                   ← GET /sessions, GET /sessions/{id}/messages
    tests/
      conftest.py                    ← fixtures: tmp db, sample files
      test_ingestion.py
      test_pipeline.py
      test_api_document.py
      test_api_chat.py
```

---

## Task 1: Project scaffold and dependencies

**Files:**
- Create: `apps/agent/requirements.txt`
- Create: `apps/agent/.env.example`
- Create: `apps/agent/main.py`
- Create: `apps/agent/app/infrastructure/config.py`

- [ ] **Step 1.1: Create requirements.txt**

```
# apps/agent/requirements.txt
fastapi==0.115.0
uvicorn[standard]==0.30.0
python-multipart==0.0.9
pydantic-settings==2.3.0
sqlalchemy==2.0.30
pymupdf==1.24.0
python-docx==1.1.2
openpyxl==3.1.4
llama-index-core==0.10.68
llama-index-llms-openai==0.1.31
llama-index-embeddings-openai==0.1.13
llama-index-vector-stores-chroma==0.1.10
llama-index-retrievers-bm25==0.3.0
chromadb==0.5.5
mem0ai==1.1.7
bcrypt==4.1.3
pytest==8.2.0
pytest-asyncio==0.23.7
httpx==0.27.0
```

- [ ] **Step 1.2: Create .env.example**

```bash
# apps/agent/.env.example
OPENAI_API_KEY=sk-...
DATABASE_PATH=../../data/enterprise_rag.db
UPLOAD_DIR=../../data/uploads
DEMO_DIR=../../data/demo
CHROMA_DIR=../../data/chroma_db
MEM0_ENABLED=false
MEM0_API_KEY=
RERANK_SCORE_THRESHOLD=0.3
```

- [ ] **Step 1.3: Create config.py**

```python
# apps/agent/app/infrastructure/config.py
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    openai_api_key: str
    database_path: str = "../../data/enterprise_rag.db"
    upload_dir: str = "../../data/uploads"
    demo_dir: str = "../../data/demo"
    chroma_dir: str = "../../data/chroma_db"
    mem0_enabled: bool = False
    mem0_api_key: str = ""
    rerank_score_threshold: float = 0.3

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    def resolved_database_path(self) -> Path:
        return Path(self.database_path).resolve()

    def resolved_upload_dir(self) -> Path:
        p = Path(self.upload_dir).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p

    def resolved_chroma_dir(self) -> Path:
        p = Path(self.chroma_dir).resolve()
        p.mkdir(parents=True, exist_ok=True)
        return p

settings = Settings()
```

- [ ] **Step 1.4: Create main.py skeleton**

```python
# apps/agent/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import document, chat, history

app = FastAPI(title="Enterprise RAG Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(document.router, prefix="/documents", tags=["documents"])
app.include_router(chat.router, prefix="/chat", tags=["chat"])
app.include_router(history.router, prefix="/sessions", tags=["history"])

@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 1.5: Install dependencies**

```bash
cd apps/agent
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

- [ ] **Step 1.6: Verify server starts**

```bash
cd apps/agent
cp .env.example .env
# edit .env: set OPENAI_API_KEY
uvicorn main:app --reload --port 8000
# Expected: INFO: Application startup complete.
```

- [ ] **Step 1.7: Commit**

```bash
git add apps/agent/
git commit -m "feat(agent): project scaffold and dependencies"
```

---

## Task 2: Database schema and init script

**Files:**
- Create: `scripts/init.sql`
- Create: `scripts/init_db.py`

- [ ] **Step 2.1: Create init.sql**

```sql
-- scripts/init.sql
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  filename    TEXT NOT NULL,
  file_path   TEXT NOT NULL,
  file_type   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  is_demo     INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER DEFAULT 0,
  file_size   INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  title      TEXT,
  mode       TEXT NOT NULL DEFAULT 'upload',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  sources    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_demo ON documents(is_demo);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
```

- [ ] **Step 2.2: Create init_db.py**

```python
# scripts/init_db.py
import sqlite3
import uuid
import bcrypt
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "enterprise_rag.db"
SQL_PATH = Path(__file__).parent / "init.sql"

USERS = [
    ("admin",  "Admin@2026",  "admin"),
    ("demo1",  "Demo@2026",   "user"),
    ("demo2",  "Demo@2026",   "user"),
    ("demo3",  "Demo@2026",   "user"),
    ("demo4",  "Demo@2026",   "user"),
]

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def main():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.executescript(SQL_PATH.read_text())
    for username, password, role in USERS:
        exists = con.execute(
            "SELECT 1 FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not exists:
            con.execute(
                "INSERT INTO users (id, username, password_hash, role) VALUES (?,?,?,?)",
                (str(uuid.uuid4()), username, hash_password(password), role),
            )
            print(f"Created user: {username}")
        else:
            print(f"User already exists: {username}")
    con.commit()
    con.close()
    print(f"Database ready at {DB_PATH}")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2.3: Run init script**

```bash
cd enterprise-rag
python scripts/init_db.py
# Expected:
# Created user: admin
# Created user: demo1
# ...
# Database ready at .../data/enterprise_rag.db
```

- [ ] **Step 2.4: Verify schema**

```bash
sqlite3 data/enterprise_rag.db ".tables"
# Expected: chat_sessions  documents  messages  users

sqlite3 data/enterprise_rag.db "SELECT username, role FROM users;"
# Expected:
# admin|admin
# demo1|user
# ...
```

- [ ] **Step 2.5: Commit**

```bash
git add scripts/
git commit -m "feat: database schema and seed script with 5 users"
```

---

## Task 3: Database ORM models and repository

**Files:**
- Create: `apps/agent/app/db/database.py`
- Create: `apps/agent/app/db/models.py`
- Create: `apps/agent/app/db/repository.py`
- Create: `apps/agent/tests/conftest.py`

- [ ] **Step 3.1: Write failing test**

```python
# apps/agent/tests/conftest.py
import pytest
import sqlite3
import uuid
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.models import Base

@pytest.fixture
def db_session(tmp_path):
    db_path = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
```

```python
# apps/agent/tests/test_repository.py
from app.db.repository import DocumentRepository, SessionRepository, MessageRepository
from app.db.models import Document, ChatSession, Message

def test_create_and_get_document(db_session):
    repo = DocumentRepository(db_session)
    doc = repo.create(
        user_id="user1",
        filename="test.pdf",
        file_path="uploads/user1/test.pdf",
        file_type="pdf",
        file_size=1024,
    )
    assert doc.id is not None
    fetched = repo.get_by_id(doc.id)
    assert fetched.filename == "test.pdf"

def test_list_documents_for_user(db_session):
    repo = DocumentRepository(db_session)
    repo.create(user_id="user1", filename="a.pdf", file_path="x", file_type="pdf")
    repo.create(user_id="user2", filename="b.pdf", file_path="y", file_type="pdf")
    docs = repo.list_for_user("user1")
    assert len(docs) == 1
    assert docs[0].filename == "a.pdf"

def test_list_demo_documents(db_session):
    repo = DocumentRepository(db_session)
    repo.create(user_id=None, filename="demo.pdf", file_path="demo/demo.pdf",
                file_type="pdf", is_demo=True)
    demos = repo.list_demo()
    assert len(demos) == 1
```

- [ ] **Step 3.2: Run to confirm failure**

```bash
cd apps/agent
pytest tests/test_repository.py -v
# Expected: ImportError or ModuleNotFoundError
```

- [ ] **Step 3.3: Create database.py**

```python
# apps/agent/app/db/database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.infrastructure.config import settings

engine = create_engine(
    f"sqlite:///{settings.resolved_database_path()}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

- [ ] **Step 3.4: Create models.py**

```python
# apps/agent/app/db/models.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String, unique=True, nullable=False)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="user")
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Document(Base):
    __tablename__ = "documents"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    file_type = Column(String, nullable=False)
    status = Column(String, default="pending")
    is_demo = Column(Integer, default=0)
    chunk_count = Column(Integer, default=0)
    file_size = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    title = Column(String)
    mode = Column(String, default="upload")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Message(Base):
    __tablename__ = "messages"
    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String, ForeignKey("chat_sessions.id"), nullable=False)
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)
    sources = Column(Text)  # JSON string
    created_at = Column(DateTime, default=datetime.utcnow)
```

- [ ] **Step 3.5: Create repository.py**

```python
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
```

- [ ] **Step 3.6: Run tests**

```bash
cd apps/agent
pytest tests/test_repository.py -v
# Expected: 3 tests pass
```

- [ ] **Step 3.7: Commit**

```bash
git add apps/agent/app/db/ apps/agent/tests/
git commit -m "feat(agent): database ORM models and repository layer"
```

---

## Task 4: Document ingestion pipeline

> Reference: `xxx-ai-agent/app/infrastructure/datalab_client.py` → `_normalize_bbox()` for the 0-1000 normalization pattern
> Reference: `xxx-ai-frontend/src/features/documents/pdf-viewer/utils/highlightIndex.ts` → expects `bbox` values in 0-1000 range

**Files:**
- Create: `apps/agent/app/infrastructure/file_storage.py`
- Create: `apps/agent/app/rag/ingestion.py`
- Create: `apps/agent/tests/test_ingestion.py`

- [ ] **Step 4.1: Write failing test**

```python
# apps/agent/tests/test_ingestion.py
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock

def make_sample_pdf(path: Path):
    """Creates a test PDF using PyMuPDF (required dependency)."""
    import fitz  # pymupdf — already in requirements
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 100), "This is page one content about contracts and payment terms.")
    page.insert_text((72, 130), "The payment deadline is 30 days from invoice date.")
    doc.save(str(path))

def test_parse_pdf_returns_chunks_with_page_num(tmp_path):
    from app.rag.ingestion import parse_document
    pdf = tmp_path / "test.pdf"
    make_sample_pdf(pdf)
    chunks = parse_document(str(pdf), "pdf")
    assert len(chunks) > 0
    for chunk in chunks:
        assert "text" in chunk
        assert "page_num" in chunk
        assert "page_idx" in chunk
        assert "bbox" in chunk
        assert isinstance(chunk["bbox"], list) and len(chunk["bbox"]) == 4
        assert all(0 <= v <= 1000 for v in chunk["bbox"])
        assert "chunk_index" in chunk
        assert len(chunk["text"]) > 0

def test_parse_txt_returns_chunks(tmp_path):
    from app.rag.ingestion import parse_document
    txt = tmp_path / "test.txt"
    txt.write_text("Line one.\nLine two.\nLine three." * 20)
    chunks = parse_document(str(txt), "txt")
    assert len(chunks) > 0
    assert all("text" in c for c in chunks)
```

- [ ] **Step 4.2: Run to confirm failure**

```bash
pytest tests/test_ingestion.py -v
# Expected: ModuleNotFoundError
```

- [ ] **Step 4.3: Create file_storage.py**

```python
# apps/agent/app/infrastructure/file_storage.py
import shutil
import uuid
from pathlib import Path
from app.infrastructure.config import settings

def save_upload(file_bytes: bytes, filename: str, user_id: str) -> tuple[str, int]:
    """Save uploaded file. Returns (relative_path, file_size)."""
    upload_dir = settings.resolved_upload_dir() / user_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_id = str(uuid.uuid4())
    ext = Path(filename).suffix
    dest = upload_dir / f"{file_id}{ext}"
    dest.write_bytes(file_bytes)
    return str(dest.relative_to(settings.resolved_upload_dir().parent)), len(file_bytes)

def delete_file(file_path: str):
    """Delete file by relative path."""
    base = settings.resolved_upload_dir().parent
    full = base / file_path
    if full.exists():
        full.unlink()

def resolve_path(file_path: str) -> Path:
    """Resolve relative file_path to absolute."""
    base = settings.resolved_upload_dir().parent
    return base / file_path
```

- [ ] **Step 4.4: Create ingestion.py**

```python
# apps/agent/app/rag/ingestion.py
import logging
from pathlib import Path
from typing import Any
import chromadb
from llama_index.core import Settings as LlamaSettings
from llama_index.core.node_parser import SentenceSplitter
from llama_index.embeddings.openai import OpenAIEmbedding
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.core import StorageContext, VectorStoreIndex
from app.infrastructure.config import settings

logger = logging.getLogger(__name__)

CHUNK_SIZE = 512
CHUNK_OVERLAP = 64


def _setup_llama_settings():
    LlamaSettings.embed_model = OpenAIEmbedding(
        model="text-embedding-3-small",
        api_key=settings.openai_api_key,
    )
    LlamaSettings.node_parser = SentenceSplitter(
        chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP
    )


def _get_chroma_collection(document_id: str):
    client = chromadb.PersistentClient(path=str(settings.resolved_chroma_dir()))
    collection_name = f"doc_{document_id.replace('-', '_')}"
    return client, client.get_or_create_collection(collection_name)


def parse_document(file_path: str, file_type: str) -> list[dict[str, Any]]:
    """Parse a document into chunks with position metadata."""
    chunks = []

    if file_type == "pdf":
        # Reference: xxx-ai-agent/app/infrastructure/datalab_client.py → _normalize_bbox()
        # xxx-ai-agent uses Datalab/MinerU for extraction; here we use PyMuPDF directly
        import fitz  # pymupdf
        doc = fitz.open(file_path)
        chunk_index = 0
        splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
        for page_num in range(len(doc)):
            page = doc[page_num]
            page_w = page.rect.width
            page_h = page.rect.height
            blocks = page.get_text("blocks")  # (x0, y0, x1, y1, text, block_no, block_type)
            for block in blocks:
                x0, y0, x1, y1, text, _block_no, block_type = block
                if block_type != 0 or not text.strip():  # 0 = text block
                    continue
                # Normalize bbox to 0-1000 — xxx-ai-frontend highlightIndex convention
                norm_bbox = [
                    round(x0 / page_w * 1000),
                    round(y0 / page_h * 1000),
                    round(x1 / page_w * 1000),
                    round(y1 / page_h * 1000),
                ]
                sub_texts = splitter.split_text(text.strip())
                for sub in sub_texts:
                    if sub.strip():
                        chunks.append({
                            "text": sub.strip(),
                            "page_num": page_num + 1,   # 1-based
                            "page_idx": page_num + 1,   # 1-based, matches highlightIndex.index.page_idx
                            "bbox": norm_bbox,           # list → str(list) in ChromaDB metadata
                            "chunk_index": chunk_index,
                        })
                        chunk_index += 1

    elif file_type in ("docx",):
        from docx import Document as DocxDocument
        doc = DocxDocument(file_path)
        splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
        chunk_index = 0
        for para_idx, para in enumerate(doc.paragraphs):
            text = para.text.strip()
            if not text:
                continue
            sub_texts = splitter.split_text(text)
            for sub in sub_texts:
                if sub.strip():
                    chunks.append({
                        "text": sub.strip(),
                        "paragraph_idx": para_idx,
                        "chunk_index": chunk_index,
                    })
                    chunk_index += 1

    elif file_type in ("xlsx",):
        from openpyxl import load_workbook
        wb = load_workbook(file_path, read_only=True, data_only=True)
        chunk_index = 0
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows = list(ws.iter_rows(values_only=True))
            for row_idx, row in enumerate(rows):
                text = " | ".join(str(c) for c in row if c is not None)
                if text.strip():
                    chunks.append({
                        "text": text.strip(),
                        "sheet_name": sheet_name,
                        "row_start": row_idx + 1,
                        "row_end": row_idx + 1,
                        "chunk_index": chunk_index,
                    })
                    chunk_index += 1

    elif file_type == "txt":
        text = Path(file_path).read_text(encoding="utf-8", errors="ignore")
        splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
        for chunk_index, sub in enumerate(splitter.split_text(text)):
            if sub.strip():
                chunks.append({
                    "text": sub.strip(),
                    "char_offset": 0,  # simplified
                    "chunk_index": chunk_index,
                })

    return chunks


def ingest_document(document_id: str, file_path: str, file_type: str) -> int:
    """Parse, embed, and store a document. Returns chunk count."""
    _setup_llama_settings()
    chunks = parse_document(file_path, file_type)
    if not chunks:
        logger.warning(f"No chunks extracted from {file_path}")
        return 0

    client, collection = _get_chroma_collection(document_id)

    # Store in ChromaDB with metadata
    ids = [f"{document_id}_{c['chunk_index']}" for c in chunks]
    texts = [c["text"] for c in chunks]
    metadatas = [
        {k: str(v) for k, v in c.items() if k != "text"}
        | {"document_id": document_id, "file_type": file_type}
        for c in chunks
    ]

    # Embed and store in batches
    embed_model = LlamaSettings.embed_model
    batch_size = 100
    for i in range(0, len(texts), batch_size):
        batch_texts = texts[i:i + batch_size]
        batch_ids = ids[i:i + batch_size]
        batch_metas = metadatas[i:i + batch_size]
        embeddings = embed_model.get_text_embedding_batch(batch_texts)
        collection.upsert(
            ids=batch_ids,
            documents=batch_texts,
            embeddings=embeddings,
            metadatas=batch_metas,
        )

    logger.info(f"Ingested {len(chunks)} chunks for document {document_id}")
    return len(chunks)


def delete_document_vectors(document_id: str):
    """Remove all vectors for a document from ChromaDB."""
    client = chromadb.PersistentClient(path=str(settings.resolved_chroma_dir()))
    collection_name = f"doc_{document_id.replace('-', '_')}"
    try:
        client.delete_collection(collection_name)
    except Exception:
        pass
```

- [ ] **Step 4.5: Run tests**

```bash
pytest tests/test_ingestion.py -v
# Expected: 2 tests pass
# Note: requires OPENAI_API_KEY set in .env for embedding tests
# If no key available, mock the embed call - tests check parsing only
```

- [ ] **Step 4.6: Commit**

```bash
git add apps/agent/app/rag/ingestion.py apps/agent/app/infrastructure/file_storage.py apps/agent/tests/test_ingestion.py
git commit -m "feat(agent): document ingestion - parse PDF/DOCX/XLSX/TXT + embed to ChromaDB"
```

---

## Task 4b: Demo document seeding

**Files:**
- Create: `scripts/seed_demo.py`

> Run after Task 4 (needs ingest_document) and after `scripts/init_db.py`. Place demo files in `data/demo/` before running.

- [ ] **Step 4b.1: Create seed_demo.py**

```python
#!/usr/bin/env python3
# scripts/seed_demo.py
# Run: cd apps/agent && .venv/bin/python ../../scripts/seed_demo.py
import sys
import os
import sqlite3
import uuid
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "apps" / "agent"))
os.chdir(ROOT / "apps" / "agent")  # pydantic-settings finds .env here

from app.rag.ingestion import ingest_document

DB_PATH = ROOT / "data" / "enterprise_rag.db"
DEMO_DIR = ROOT / "data" / "demo"
SUPPORTED = {"pdf", "docx", "xlsx", "txt"}


def main():
    if not DEMO_DIR.exists():
        print(f"Demo dir not found: {DEMO_DIR}")
        print("Create data/demo/ and add PDF/DOCX/XLSX/TXT files.")
        return

    con = sqlite3.connect(DB_PATH)
    files = sorted(
        f for f in DEMO_DIR.iterdir()
        if f.suffix.lstrip(".").lower() in SUPPORTED
    )
    if not files:
        print("No supported files in data/demo/")
        return

    for f in files:
        file_type = f.suffix.lstrip(".").lower()
        rel_path = f"demo/{f.name}"

        row = con.execute(
            "SELECT id, status FROM documents WHERE file_path = ?", (rel_path,)
        ).fetchone()

        if row and row[1] == "ready":
            print(f"Skip (ready): {f.name}")
            continue

        if row:
            doc_id = row[0]
        else:
            doc_id = str(uuid.uuid4())
            con.execute(
                "INSERT INTO documents (id, user_id, filename, file_path, file_type, status, is_demo) "
                "VALUES (?, NULL, ?, ?, ?, 'pending', 1)",
                (doc_id, f.name, rel_path, file_type),
            )
            con.commit()
            print(f"Registered: {f.name}")

        try:
            count = ingest_document(doc_id, str(f), file_type)
            con.execute(
                "UPDATE documents SET status='ready', chunk_count=? WHERE id=?",
                (count, doc_id),
            )
            con.commit()
            print(f"  ✓ {f.name} → {count} chunks")
        except Exception as e:
            con.execute("UPDATE documents SET status='failed' WHERE id=?", (doc_id,))
            con.commit()
            print(f"  ✗ {f.name}: {e}")

    con.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 4b.2: Place demo files and run**

```bash
# Add at least one demo document to data/demo/
mkdir -p data/demo
# Copy your demo PDF/DOCX/XLSX files here, e.g.:
# cp ~/Downloads/enterprise-demo.pdf data/demo/

cd apps/agent
.venv/bin/python ../../scripts/seed_demo.py
# Expected per file:
# Registered: enterprise-demo.pdf
#   ✓ enterprise-demo.pdf → 42 chunks
```

- [ ] **Step 4b.3: Verify demo docs appear in API**

```bash
# Agent must be running
curl http://localhost:8000/documents/demo
# Expected: list of demo documents with status "ready"
```

- [ ] **Step 4b.4: Commit**

```bash
git add scripts/seed_demo.py
git commit -m "feat: demo document seed script"
```

---

## Task 5: Query rewriting

**Files:**
- Create: `apps/agent/app/rag/query_rewriter.py`

- [ ] **Step 5.1: Write failing test**

```python
# apps/agent/tests/test_pipeline.py
def test_query_rewriter_standalone_query():
    from app.rag.query_rewriter import rewrite_query
    history = []  # no history
    result = rewrite_query("What is the payment term?", history)
    # With no history, returns query unchanged
    assert "payment" in result.lower()

def test_query_rewriter_with_context(monkeypatch):
    from app.rag import query_rewriter

    def mock_complete(prompt):
        return "What is the payment deadline in the contract?"

    monkeypatch.setattr(query_rewriter, "_llm_complete", mock_complete)

    from app.rag.query_rewriter import rewrite_query
    history = [
        {"role": "user", "content": "Tell me about the contract"},
        {"role": "assistant", "content": "The contract covers payment terms and penalties."},
    ]
    result = rewrite_query("What is the deadline?", history)
    assert "payment" in result.lower() or "deadline" in result.lower()
```

- [ ] **Step 5.2: Run to confirm failure**

```bash
pytest tests/test_pipeline.py::test_query_rewriter_standalone_query -v
# Expected: ImportError
```

- [ ] **Step 5.3: Create query_rewriter.py**

```python
# apps/agent/app/rag/query_rewriter.py
from openai import OpenAI
from app.infrastructure.config import settings

_client = None

def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=settings.openai_api_key)
    return _client

def _llm_complete(prompt: str) -> str:
    response = _get_client().chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=150,
        temperature=0,
    )
    return response.choices[0].message.content.strip()

def rewrite_query(query: str, history: list[dict]) -> str:
    """Rewrite query to be self-contained using recent conversation history."""
    if not history:
        return query

    recent = history[-6:]  # last 3 turns
    history_text = "\n".join(
        f"{m['role'].capitalize()}: {m['content']}" for m in recent
    )
    prompt = f"""Given this conversation history:
{history_text}

Rewrite the following question to be fully self-contained and unambiguous,
preserving the user's intent. Output ONLY the rewritten question, nothing else.

Original question: {query}
Rewritten question:"""

    try:
        return _llm_complete(prompt)
    except Exception:
        return query  # fallback to original on error
```

- [ ] **Step 5.4: Run tests**

```bash
pytest tests/test_pipeline.py::test_query_rewriter_standalone_query -v
# Expected: PASS
```

- [ ] **Step 5.5: Commit**

```bash
git add apps/agent/app/rag/query_rewriter.py
git commit -m "feat(agent): query rewriting with conversation history context"
```

---

## Task 6: Hybrid retrieval

**Files:**
- Create: `apps/agent/app/rag/hybrid_retriever.py`

- [ ] **Step 6.1: Write failing test**

```python
# append to apps/agent/tests/test_pipeline.py

def test_hybrid_retriever_returns_results(tmp_path, monkeypatch):
    """Verify hybrid retriever merges vector + BM25 results and deduplicates."""
    import chromadb
    from app.rag.hybrid_retriever import HybridRetriever

    # Setup: create a test ChromaDB collection with sample docs
    client = chromadb.Client()
    col = client.create_collection("test_col")
    col.add(
        ids=["doc1_0", "doc1_1", "doc1_2"],
        documents=[
            "The payment deadline is 30 days from invoice.",
            "Late fees apply after the payment deadline passes.",
            "Contract termination requires 90 days notice.",
        ],
        embeddings=[[0.1]*1536, [0.2]*1536, [0.3]*1536],
        metadatas=[
            {"document_id": "doc1", "chunk_index": "0", "page_num": "1"},
            {"document_id": "doc1", "chunk_index": "1", "page_num": "1"},
            {"document_id": "doc1", "chunk_index": "2", "page_num": "2"},
        ],
    )

    # Mock the embed call
    monkeypatch.setattr(
        "app.rag.hybrid_retriever._embed_query",
        lambda q: [0.1] * 1536,
    )

    retriever = HybridRetriever(collection=col)
    results = retriever.retrieve("payment deadline", top_k=5)

    assert len(results) > 0
    assert all("text" in r and "score" in r and "metadata" in r for r in results)
    # No duplicates
    ids = [r["id"] for r in results]
    assert len(ids) == len(set(ids))
```

- [ ] **Step 6.2: Create hybrid_retriever.py**

```python
# apps/agent/app/rag/hybrid_retriever.py
import math
import re
from collections import defaultdict
from typing import Any
import chromadb
from llama_index.embeddings.openai import OpenAIEmbedding
from app.infrastructure.config import settings

_embed_model = None

def _get_embed_model() -> OpenAIEmbedding:
    global _embed_model
    if _embed_model is None:
        _embed_model = OpenAIEmbedding(
            model="text-embedding-3-small",
            api_key=settings.openai_api_key,
        )
    return _embed_model

def _embed_query(query: str) -> list[float]:
    return _get_embed_model().get_query_embedding(query)


def _tokenize(text: str) -> list[str]:
    return re.findall(r"\b\w+\b", text.lower())


def _bm25_scores(query: str, documents: list[str],
                 k1: float = 1.5, b: float = 0.75) -> list[float]:
    """Lightweight BM25 scoring over a list of documents."""
    query_terms = _tokenize(query)
    tokenized_docs = [_tokenize(d) for d in documents]
    avg_dl = sum(len(d) for d in tokenized_docs) / max(len(tokenized_docs), 1)
    N = len(tokenized_docs)

    scores = []
    for doc_tokens in tokenized_docs:
        score = 0.0
        dl = len(doc_tokens)
        for term in query_terms:
            tf = doc_tokens.count(term)
            df = sum(1 for d in tokenized_docs if term in d)
            if df == 0:
                continue
            idf = math.log((N - df + 0.5) / (df + 0.5) + 1)
            tf_norm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avg_dl))
            score += idf * tf_norm
        scores.append(score)
    return scores


def _reciprocal_rank_fusion(
    ranked_lists: list[list[str]], k: int = 60
) -> dict[str, float]:
    """Merge multiple ranked lists using Reciprocal Rank Fusion."""
    scores: dict[str, float] = defaultdict(float)
    for ranked in ranked_lists:
        for rank, doc_id in enumerate(ranked, start=1):
            scores[doc_id] += 1.0 / (k + rank)
    return scores


class HybridRetriever:
    def __init__(self, collection: chromadb.Collection):
        self.collection = collection

    def retrieve(self, query: str, top_k: int = 15) -> list[dict[str, Any]]:
        """Vector + BM25 hybrid retrieval with RRF fusion."""
        # Fetch all docs from collection for BM25
        all_results = self.collection.get(
            include=["documents", "metadatas", "embeddings"]
        )
        if not all_results["ids"]:
            return []

        ids = all_results["ids"]
        documents = all_results["documents"]
        metadatas = all_results["metadatas"]

        # --- Vector retrieval ---
        query_emb = _embed_query(query)
        vector_results = self.collection.query(
            query_embeddings=[query_emb],
            n_results=min(top_k, len(ids)),
            include=["distances", "metadatas", "documents"],
        )
        vector_ranked = vector_results["ids"][0]

        # --- BM25 retrieval ---
        bm25_scores = _bm25_scores(query, documents)
        bm25_ranked = [
            ids[i] for i in sorted(range(len(ids)),
                                   key=lambda x: bm25_scores[x], reverse=True)
        ][:top_k]

        # --- RRF fusion ---
        fused_scores = _reciprocal_rank_fusion([vector_ranked, bm25_ranked])
        top_ids = sorted(fused_scores, key=fused_scores.get, reverse=True)[:top_k]

        # Build result list
        id_to_doc = dict(zip(ids, documents))
        id_to_meta = dict(zip(ids, metadatas))
        results = []
        for doc_id in top_ids:
            if doc_id in id_to_doc:
                results.append({
                    "id": doc_id,
                    "text": id_to_doc[doc_id],
                    "score": fused_scores[doc_id],
                    "metadata": id_to_meta.get(doc_id, {}),
                })
        return results
```

- [ ] **Step 6.3: Run tests**

```bash
pytest tests/test_pipeline.py::test_hybrid_retriever_returns_results -v
# Expected: PASS
```

- [ ] **Step 6.4: Commit**

```bash
git add apps/agent/app/rag/hybrid_retriever.py
git commit -m "feat(agent): hybrid retrieval - BM25 + vector with RRF fusion"
```

---

## Task 7: Reranker and confidence check

**Files:**
- Create: `apps/agent/app/rag/reranker.py`
- Create: `apps/agent/app/rag/confidence.py`

- [ ] **Step 7.1: Create reranker.py**

```python
# apps/agent/app/rag/reranker.py
from openai import OpenAI
from app.infrastructure.config import settings

_client = None

def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=settings.openai_api_key)
    return _client

def rerank(query: str, chunks: list[dict], top_n: int = 5) -> list[dict]:
    """LLM-based reranking: score each chunk's relevance to the query."""
    if not chunks:
        return []
    if len(chunks) <= top_n:
        return chunks

    # Build scoring prompt
    chunk_texts = "\n\n".join(
        f"[{i}] {c['text'][:300]}" for i, c in enumerate(chunks)
    )
    prompt = f"""Rate how relevant each passage is to the question on a scale 0-10.
Return ONLY a JSON array of scores, one per passage, in order.
Example: [8, 3, 7, 1, 5]

Question: {query}

Passages:
{chunk_texts}

Scores:"""

    try:
        response = _get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=100,
            temperature=0,
        )
        import json
        scores_text = response.choices[0].message.content.strip()
        # Extract array from response
        import re
        match = re.search(r"\[[\d,\s\.]+\]", scores_text)
        if match:
            scores = json.loads(match.group())
            scored = list(zip(scores, chunks))
            scored.sort(key=lambda x: x[0], reverse=True)
            return [c for _, c in scored[:top_n]]
    except Exception:
        pass

    # Fallback: return top_n by original score
    return chunks[:top_n]
```

- [ ] **Step 7.2: Create confidence.py**

```python
# apps/agent/app/rag/confidence.py
from app.infrastructure.config import settings

NOT_FOUND_MESSAGE = "抱歉，在现有文档中未找到与该问题相关的内容。请尝试换一种方式提问，或上传包含相关信息的文档。"

def is_confident(chunks: list[dict]) -> bool:
    """Return True if top chunk score exceeds threshold."""
    if not chunks:
        return False
    top_score = chunks[0].get("score", 0)
    return top_score >= settings.rerank_score_threshold
```

- [ ] **Step 7.3: Write and run tests**

```python
# append to apps/agent/tests/test_pipeline.py

def test_confidence_check_passes():
    from app.rag.confidence import is_confident
    chunks = [{"text": "hello", "score": 0.9}]
    assert is_confident(chunks) is True

def test_confidence_check_fails_on_low_score():
    from app.rag.confidence import is_confident
    chunks = [{"text": "hello", "score": 0.1}]
    assert is_confident(chunks) is False

def test_confidence_check_fails_on_empty():
    from app.rag.confidence import is_confident
    assert is_confident([]) is False
```

```bash
pytest tests/test_pipeline.py -k "confidence" -v
# Expected: 3 tests pass
```

- [ ] **Step 7.4: Commit**

```bash
git add apps/agent/app/rag/reranker.py apps/agent/app/rag/confidence.py
git commit -m "feat(agent): LLM reranker and confidence threshold check"
```

---

## Task 8: Prompt builder and RAG pipeline

**Files:**
- Create: `apps/agent/app/rag/prompt.py`
- Create: `apps/agent/app/rag/pipeline.py`

- [ ] **Step 8.1: Create prompt.py**

```python
# apps/agent/app/rag/prompt.py

SYSTEM_PROMPT = """你是一个企业知识库问答助手。
请严格基于以下提供的文档内容回答用户问题。
规则：
1. 只使用文档中明确包含的信息
2. 如果文档中没有相关信息，直接说明"文档中未找到相关内容"
3. 回答时引用来源，格式：[来源N]
4. 不得推断、臆测或引用文档外的知识
"""

def build_context_block(chunks: list[dict]) -> str:
    """Format retrieved chunks as context for the prompt."""
    parts = []
    for i, chunk in enumerate(chunks, start=1):
        meta = chunk.get("metadata", {})
        source_label = _format_source_label(meta)
        parts.append(f"[来源{i}] {source_label}\n{chunk['text']}")
    return "\n\n".join(parts)


def _format_source_label(meta: dict) -> str:
    filename = meta.get("filename", "未知文件")
    file_type = meta.get("file_type", "")
    if file_type == "pdf":
        page = meta.get("page_num", "?")
        return f"{filename} 第{page}页"
    elif file_type == "docx":
        para = meta.get("paragraph_idx", "?")
        return f"{filename} 第{para}段"
    elif file_type == "xlsx":
        sheet = meta.get("sheet_name", "?")
        row = meta.get("row_start", "?")
        return f"{filename} {sheet}表第{row}行"
    return filename


def build_messages(
    query: str,
    chunks: list[dict],
    history: list[dict],
    mem0_memories: list[str] | None = None,
) -> list[dict]:
    """Build the full message list for OpenAI chat completion."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Add Mem0 memories if available
    if mem0_memories:
        memory_text = "\n".join(f"- {m}" for m in mem0_memories)
        messages.append({
            "role": "system",
            "content": f"关于该用户的历史记忆：\n{memory_text}"
        })

    # Add document context
    context = build_context_block(chunks)
    messages.append({
        "role": "system",
        "content": f"以下是相关文档内容：\n\n{context}"
    })

    # Add conversation history (last 6 messages)
    for msg in history[-6:]:
        messages.append({"role": msg["role"], "content": msg["content"]})

    # Add current query
    messages.append({"role": "user", "content": query})
    return messages
```

- [ ] **Step 8.2: Create pipeline.py**

```python
# apps/agent/app/rag/pipeline.py
import json
import logging
import chromadb
from openai import OpenAI
from app.infrastructure.config import settings
from app.rag.ingestion import _get_chroma_collection
from app.rag.query_rewriter import rewrite_query
from app.rag.hybrid_retriever import HybridRetriever
from app.rag.reranker import rerank
from app.rag.confidence import is_confident, NOT_FOUND_MESSAGE
from app.rag.prompt import build_messages

logger = logging.getLogger(__name__)

_openai_client = None

def _get_openai() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI(api_key=settings.openai_api_key)
    return _openai_client


def _get_collection_for_document(document_id: str):
    client = chromadb.PersistentClient(path=str(settings.resolved_chroma_dir()))
    name = f"doc_{document_id.replace('-', '_')}"
    try:
        return client.get_collection(name)
    except Exception:
        return None


def _retrieve_across_documents(
    query: str, document_ids: list[str], top_k: int = 15
) -> list[dict]:
    """Retrieve from multiple document collections and merge results."""
    all_results = []
    for doc_id in document_ids:
        collection = _get_collection_for_document(doc_id)
        if collection is None:
            continue
        retriever = HybridRetriever(collection=collection)
        results = retriever.retrieve(query, top_k=top_k)
        for r in results:
            r["metadata"]["document_id"] = doc_id
        all_results.extend(results)

    all_results.sort(key=lambda x: x["score"], reverse=True)
    return all_results[:top_k]


def rag_answer(
    query: str,
    user_id: str,
    session_id: str,
    document_ids: list[str],
    history: list[dict],
    document_metadata: dict[str, dict],  # doc_id -> {filename, file_type}
) -> dict:
    """
    Main RAG pipeline. Returns:
    {
        "answer": str,
        "sources": [...],
        "session_id": str
    }
    """
    # Step 1: Query rewriting
    rewritten = rewrite_query(query, history)
    logger.info(f"[RAG] Rewritten query: {rewritten!r}")

    # Step 2: Hybrid retrieval
    raw_chunks = _retrieve_across_documents(rewritten, document_ids)
    if not raw_chunks:
        return {"answer": "没有可查询的文档内容。", "sources": [], "session_id": session_id}

    # Enrich chunks with filename from document_metadata
    for chunk in raw_chunks:
        doc_id = chunk["metadata"].get("document_id", "")
        if doc_id in document_metadata:
            chunk["metadata"].update(document_metadata[doc_id])

    # Step 3: Rerank
    reranked = rerank(rewritten, raw_chunks, top_n=5)

    # Step 4: Confidence check
    if not is_confident(reranked):
        return {"answer": NOT_FOUND_MESSAGE, "sources": [], "session_id": session_id}

    # Step 5: Build sources for response
    sources = []
    for chunk in reranked:
        meta = chunk["metadata"]
        source = {
            "document_id": meta.get("document_id", ""),
            "filename": meta.get("filename", ""),
            "file_type": meta.get("file_type", ""),
            "chunk_text": chunk["text"][:200],
            "score": round(chunk["score"], 4),
        }
        if meta.get("page_num"):
            source["page_num"] = int(meta["page_num"])
            source["page_idx"] = int(meta.get("page_idx", meta["page_num"]))
            # bbox stored as str([x0,y0,x1,y1]) by ingestion.py; parse back to list
            # Reference: xxx-ai-frontend/src/features/documents/pdf-viewer/utils/highlightIndex.ts
            bbox_raw = meta.get("bbox")
            if bbox_raw:
                try:
                    source["bbox"] = json.loads(bbox_raw)
                except Exception:
                    pass
        if meta.get("paragraph_idx") is not None:
            source["paragraph_idx"] = int(meta["paragraph_idx"])
        if meta.get("sheet_name"):
            source["sheet_name"] = meta["sheet_name"]
            source["row_start"] = int(meta.get("row_start", 1))
        sources.append(source)

    # Step 6: Build prompt and call OpenAI
    messages = build_messages(query, reranked, history)

    response = _get_openai().chat.completions.create(
        model="gpt-4o",
        messages=messages,
        stream=False,
        max_tokens=2048,
        temperature=0.3,
    )
    answer = response.choices[0].message.content or ""

    return {"answer": answer, "sources": sources, "session_id": session_id}
```

- [ ] **Step 8.3: Commit**

```bash
git add apps/agent/app/rag/
git commit -m "feat(agent): RAG pipeline - prompt builder and full orchestration"
```

---

## Task 9: Document API endpoints

**Files:**
- Create: `apps/agent/app/api/__init__.py`
- Create: `apps/agent/app/api/document.py`
- Create: `apps/agent/tests/test_api_document.py`

- [ ] **Step 9.1: Write failing test**

```python
# apps/agent/tests/test_api_document.py
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
import io

@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("CHROMA_DIR", str(tmp_path / "chroma"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    # Run init
    import sqlite3
    from pathlib import Path
    db = tmp_path / "test.db"
    sql = Path("scripts/init.sql").read_text()
    con = sqlite3.connect(db)
    con.executescript(sql)
    con.commit()
    con.close()
    from main import app
    return TestClient(app)

def test_upload_document(client, tmp_path, monkeypatch):
    monkeypatch.setattr("app.rag.ingestion.ingest_document", lambda *a, **k: 5)
    data = {
        "user_id": "test-user",
        "file": ("test.txt", io.BytesIO(b"Hello world content"), "text/plain"),
    }
    resp = client.post("/documents/upload", files={"file": data["file"]},
                       data={"user_id": data["user_id"]})
    assert resp.status_code == 200
    body = resp.json()
    assert body["filename"] == "test.txt"
    assert body["status"] in ("ready", "processing")

def test_list_documents(client):
    resp = client.get("/documents?user_id=test-user")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
```

- [ ] **Step 9.2: Create document.py**

```python
# apps/agent/app/api/document.py
import logging
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, BackgroundTasks
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
    """Background ingestion task."""
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
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user_id: str = Form(...),
    db: Session = Depends(get_db),
):
    file_type = _ext_to_type(file.filename)
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
    from fastapi.responses import FileResponse
    from app.infrastructure.config import settings as cfg
    repo = DocumentRepository(db)
    doc = repo.get_by_id(document_id)
    if not doc:
        raise HTTPException(404, "Not found")
    full_path = cfg.resolved_upload_dir().parent / doc.file_path
    if not full_path.exists():
        raise HTTPException(404, "File not on disk")
    return FileResponse(str(full_path), filename=doc.filename)
```

- [ ] **Step 9.3: Run tests**

```bash
pytest tests/test_api_document.py -v
# Expected: 2 tests pass
```

- [ ] **Step 9.4: Commit**

```bash
git add apps/agent/app/api/
git commit -m "feat(agent): document upload, list, and delete API endpoints"
```

---

## Task 10: Chat API (JSON response)

**Files:**
- Create: `apps/agent/app/api/chat.py`
- Create: `apps/agent/tests/test_api_chat.py`

- [ ] **Step 10.1: Create chat.py**

```python
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
    document_ids: list[str] | None = None  # None = all user docs + demo docs
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
```

- [ ] **Step 10.2: Write and run smoke test**

```python
# apps/agent/tests/test_api_chat.py
def test_chat_message_returns_json(client, monkeypatch):
    monkeypatch.setattr("app.api.chat.rag_answer", lambda **kwargs: {
        "answer": "Hello",
        "sources": [],
        "session_id": kwargs["session_id"],
    })

    resp = client.post("/chat/message", json={
        "query": "What is the payment term?",
        "user_id": "test-user",
        "mode": "upload",
    })
    assert resp.status_code == 200
    body = resp.json()
    assert body["answer"] == "Hello"
    assert isinstance(body["sources"], list)
    assert "session_id" in body
```

```bash
pytest tests/test_api_chat.py -v
# Expected: 1 test passes
```

- [ ] **Step 10.3: Commit**

```bash
git add apps/agent/app/api/chat.py apps/agent/tests/test_api_chat.py
git commit -m "feat(agent): JSON chat endpoint with session management"
```

---

## Task 11: History API

**Files:**
- Create: `apps/agent/app/api/history.py`

- [ ] **Step 11.1: Create history.py**

```python
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
```

- [ ] **Step 11.2: Verify all tests pass**

```bash
cd apps/agent
pytest tests/ -v
# Expected: all tests pass
```

- [ ] **Step 11.3: Smoke test the full server**

```bash
uvicorn main:app --reload --port 8000

# In another terminal:
curl http://localhost:8000/health
# Expected: {"status":"ok"}

curl http://localhost:8000/documents/demo
# Expected: [] (empty list, no demo docs yet)
```

- [ ] **Step 11.4: Final commit**

```bash
git add apps/agent/
git commit -m "feat(agent): history API and complete agent implementation"
```

---

## Task 12: Version tracking + `/health` endpoint

**Files:**
- Create: `apps/agent/pyproject.toml` (replaces requirements.txt for version tracking)
- Create: `apps/agent/app/version.py`
- Modify: `apps/agent/main.py` (add `/health` route)

> Pattern from: `smart-agriculture/apps/agent/app/version.py` and `app/api/routers/health.py`

- [ ] **Step 12.1: Create pyproject.toml**

```toml
# apps/agent/pyproject.toml
[project]
name = "enterprise-rag-agent"
version = "0.1.0"
description = "Enterprise RAG demo agent"
requires-python = ">=3.11"
dependencies = [
  "fastapi==0.115.0",
  "uvicorn[standard]==0.30.0",
  "python-multipart==0.0.9",
  "pydantic-settings==2.3.0",
  "sqlalchemy==2.0.30",
  "pymupdf==1.24.0",
  "python-docx==1.1.2",
  "openpyxl==3.1.4",
  "llama-index-core==0.10.68",
  "llama-index-llms-openai==0.1.31",
  "llama-index-embeddings-openai==0.1.13",
  "llama-index-vector-stores-chroma==0.1.10",
  "llama-index-retrievers-bm25==0.3.0",
  "chromadb==0.5.3",
  "mem0ai==1.1.7",
  "rank-bm25==0.2.2",
  "openai==1.35.0",
  "bcrypt==4.1.3",
]

[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"
```

Keep `requirements.txt` pointing to pyproject: add one line `# see pyproject.toml — use: pip install -e .`

- [ ] **Step 12.2: Create app/version.py**

```python
# apps/agent/app/version.py
from __future__ import annotations
import pathlib
import tomllib

def _read() -> str:
    try:
        p = pathlib.Path(__file__).parent.parent / "pyproject.toml"
        with open(p, "rb") as f:
            return tomllib.load(f)["project"]["version"]
    except Exception:
        return "unknown"

APP_VERSION = _read()
```

- [ ] **Step 12.3: Add /health to main.py**

```python
# apps/agent/main.py — add after existing imports + router includes:
from app.version import APP_VERSION

@app.get("/health")
def health():
    return {"status": "ok", "service": "enterprise-rag-agent", "version": APP_VERSION}
```

- [ ] **Step 12.4: Verify**

```bash
curl http://localhost:8000/health
# Expected: {"status":"ok","service":"enterprise-rag-agent","version":"0.1.0"}
```

- [ ] **Step 12.5: Commit**

```bash
git add apps/agent/pyproject.toml apps/agent/app/version.py apps/agent/main.py
git commit -m "feat(agent): health endpoint with version from pyproject.toml"
```

---

## Task 13: Mem0 memory integration (feature-flagged)

**Files:**
- Create: `apps/agent/app/rag/memory.py`
- Create: `apps/agent/tests/test_memory.py`
- Modify: `apps/agent/app/rag/pipeline.py` (add get/add_memory calls)

> Guard: all Mem0 calls are no-ops when `MEM0_ENABLED=false` or `MEM0_API_KEY` is empty.
> Key is read from Mac keychain by `start-local-agent.sh` (service "enterprise-rag", account "MEM0_API_KEY").

- [ ] **Step 13.1: Write failing tests**

```python
# apps/agent/tests/test_memory.py
def test_get_memories_returns_empty_when_disabled(monkeypatch):
    from app.rag import memory
    monkeypatch.setattr(memory.settings, "mem0_enabled", False)
    assert memory.get_memories("user1", "payment deadline") == []

def test_add_memory_is_noop_when_disabled(monkeypatch):
    from app.rag import memory
    monkeypatch.setattr(memory.settings, "mem0_enabled", False)
    memory.add_memory("user1", "query", "answer")  # must not raise

def test_get_memories_returns_empty_when_no_key(monkeypatch):
    from app.rag import memory
    monkeypatch.setattr(memory.settings, "mem0_enabled", True)
    monkeypatch.setattr(memory.settings, "mem0_api_key", "")
    assert memory.get_memories("user1", "query") == []
```

- [ ] **Step 13.2: Run to confirm failure**

```bash
cd apps/agent
pytest tests/test_memory.py -v
# Expected: ImportError (memory.py doesn't exist yet)
```

- [ ] **Step 13.3: Create memory.py**

```python
# apps/agent/app/rag/memory.py
from app.infrastructure.config import settings

_client = None


def _get_client():
    global _client
    if _client is None:
        from mem0 import MemoryClient
        _client = MemoryClient(api_key=settings.mem0_api_key)
    return _client


def get_memories(user_id: str, query: str) -> list[str]:
    """Return relevant memories for user. No-op if MEM0_ENABLED=false or key missing."""
    if not settings.mem0_enabled or not settings.mem0_api_key:
        return []
    try:
        results = _get_client().search(query, user_id=user_id, limit=5)
        return [r["memory"] for r in results]
    except Exception:
        return []


def add_memory(user_id: str, query: str, answer: str) -> None:
    """Persist Q&A turn to Mem0 for future sessions. No-op if MEM0_ENABLED=false."""
    if not settings.mem0_enabled or not settings.mem0_api_key:
        return
    try:
        _get_client().add(
            [
                {"role": "user", "content": query},
                {"role": "assistant", "content": answer},
            ],
            user_id=user_id,
        )
    except Exception:
        pass
```

- [ ] **Step 13.4: Run tests**

```bash
pytest tests/test_memory.py -v
# Expected: 3 tests pass
```

- [ ] **Step 13.5: Add Mem0 calls to pipeline.py**

In `apps/agent/app/rag/pipeline.py`, make three changes:

**a) Add import at top of file:**
```python
from app.rag.memory import get_memories, add_memory
```

**b) After `rewritten = rewrite_query(query, history)` line, add:**
```python
    # Fetch user memories (no-op if MEM0_ENABLED=false)
    mem0_memories = get_memories(user_id, rewritten)
```

**c) Update build_messages call:**
```python
    messages = build_messages(query, reranked, history, mem0_memories=mem0_memories or None)
```

**d) After `answer = response.choices[0].message.content or ""`, add:**
```python
    # Persist Q&A to Mem0 for future context (no-op if disabled)
    add_memory(user_id, query, answer)
```

- [ ] **Step 13.6: Verify no regression**

```bash
pytest tests/ -v
# Expected: all tests still pass
```

- [ ] **Step 13.7: Commit**

```bash
git add apps/agent/app/rag/memory.py apps/agent/tests/test_memory.py apps/agent/app/rag/pipeline.py
git commit -m "feat(agent): Mem0 memory integration (feature-flagged via MEM0_ENABLED)"
```

---

## Summary

After completing all tasks, the agent exposes:

| Endpoint | Description |
|---|---|
| `GET /health` | Health check + version |
| `POST /documents/upload` | Upload + background ingest |
| `GET /documents?user_id=` | List user documents |
| `GET /documents/demo` | List demo documents |
| `DELETE /documents/{id}?user_id=` | Delete document |
| `GET /documents/file/{id}` | Serve file bytes |
| `POST /chat/message` | JSON chat response with sources |
| `GET /sessions?user_id=` | List sessions |
| `GET /sessions/{id}/messages?user_id=` | Get message history |

**Start order:** `scripts/init_db.py` → `start-local-agent.sh` → `seed_demo.py` (once, after placing files in `data/demo/`)

**To run (dev):** `cd apps/agent && uvicorn main:app --reload --port 8001`
