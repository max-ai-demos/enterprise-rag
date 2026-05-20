# RAG Enhancement Plan: Summarization + Streaming + Better Chunking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add document summarization, SSE streaming Q&A output, and larger/smarter chunking to make the RAG agent genuinely useful for enterprise knowledge retrieval.

**Architecture:** Three independent improvements sharing the same FastAPI agent and MySQL DB: (1) on-demand summarization with Map-Reduce for long docs, cached in a new DB column; (2) streaming Q&A via SSE so the frontend shows tokens as they arrive; (3) improved chunking (512→1500 chars) with DOCX table support, plus a re-index script for existing documents.

**Tech Stack:** FastAPI, SQLAlchemy/MySQL, ChromaDB, OpenAI (gpt-4o + gpt-4o-mini), python-docx, Next.js fetch + ReadableStream

---

## File Map

**New files:**
- `apps/agent/app/rag/summarizer.py` — summarization logic (Map-Reduce)
- `apps/agent/tests/test_summarizer.py` — unit tests for summarizer
- `apps/agent/tests/test_streaming.py` — unit tests for streaming pipeline
- `scripts/reindex.py` — re-ingest all existing documents with new chunk size

**Modified files:**
- `apps/agent/app/db/models.py` — add `summary`, `summary_status` columns to Document
- `apps/agent/app/db/repository.py` — add `update_summary`, `update_summary_status` methods
- `apps/agent/app/api/document.py` — add `POST /{id}/summary`, `GET /{id}/summary`
- `apps/agent/app/rag/pipeline.py` — add `rag_answer_stream` generator + extract `_build_sources` helper
- `apps/agent/app/api/chat.py` — add `POST /chat/stream` SSE endpoint
- `apps/agent/app/rag/ingestion.py` — increase CHUNK_SIZE to 1500, add DOCX table parsing
- `apps/web/src/components/ChatPanel.tsx` — replace fetch with SSE streaming
- `apps/web/src/components/ViewerPanel.tsx` — add "总结" button + summary drawer

---

## Task 1: DB — Add Summary Columns + Repository Methods

**Files:**
- Modify: `apps/agent/app/db/models.py`
- Modify: `apps/agent/app/db/repository.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/agent/tests/test_repository.py — add at the end of the file

def test_update_summary(db_session):
    import uuid
    from app.db.models import Document
    doc = Document(
        id=str(uuid.uuid4()),
        user_id=None,
        filename="test.pdf",
        file_path="demo/test.pdf",
        file_type="pdf",
    )
    db_session.add(doc)
    db_session.commit()

    from app.db.repository import DocumentRepository
    repo = DocumentRepository(db_session)
    repo.update_summary(doc.id, "这是一份摘要。")
    db_session.refresh(doc)
    assert doc.summary == "这是一份摘要。"
    assert doc.summary_status == "ready"


def test_update_summary_status(db_session):
    import uuid
    from app.db.models import Document
    from app.db.repository import DocumentRepository
    doc = Document(
        id=str(uuid.uuid4()),
        filename="test.pdf",
        file_path="demo/test.pdf",
        file_type="pdf",
    )
    db_session.add(doc)
    db_session.commit()
    repo = DocumentRepository(db_session)
    repo.update_summary_status(doc.id, "pending")
    db_session.refresh(doc)
    assert doc.summary_status == "pending"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/agent && .venv/bin/pytest tests/test_repository.py::test_update_summary tests/test_repository.py::test_update_summary_status -v
```

Expected: `FAILED` — `AttributeError: 'Document' object has no attribute 'summary'`

- [ ] **Step 3: Add columns to Document model**

In `apps/agent/app/db/models.py`, add two columns to `Document`:

```python
# apps/agent/app/db/models.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = "users"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    username = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), default="user")
    is_active = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Document(Base):
    __tablename__ = "documents"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    filename = Column(String(500), nullable=False)
    file_path = Column(String(1000), nullable=False)
    file_type = Column(String(20), nullable=False)
    status = Column(String(50), default="pending")
    is_demo = Column(Integer, default=0)
    chunk_count = Column(Integer, default=0)
    file_size = Column(Integer)
    summary = Column(Text, nullable=True)
    summary_status = Column(String(20), default="none")  # none | pending | ready | failed
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class ChatSession(Base):
    __tablename__ = "chat_sessions"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    title = Column(String(255))
    mode = Column(String(20), default="upload")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Message(Base):
    __tablename__ = "messages"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    session_id = Column(String(36), ForeignKey("chat_sessions.id"), nullable=False)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    sources = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
```

- [ ] **Step 4: Add `update_summary` and `update_summary_status` to DocumentRepository**

In `apps/agent/app/db/repository.py`, add two methods to `DocumentRepository` (after `update_status`):

```python
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
```

- [ ] **Step 5: Apply column migration to MySQL**

```bash
cd apps/agent && .venv/bin/python - <<'EOF'
from app.db.database import engine
from sqlalchemy import text, inspect

insp = inspect(engine)
cols = [c['name'] for c in insp.get_columns('documents')]

with engine.connect() as conn:
    if 'summary' not in cols:
        conn.execute(text("ALTER TABLE documents ADD COLUMN summary LONGTEXT"))
        print("Added summary column")
    if 'summary_status' not in cols:
        conn.execute(text("ALTER TABLE documents ADD COLUMN summary_status VARCHAR(20) DEFAULT 'none'"))
        print("Added summary_status column")
    conn.commit()
print("Migration done. Columns:", [c['name'] for c in inspect(engine).get_columns('documents')])
EOF
```

Expected output: `Migration done. Columns: [..., 'summary', 'summary_status']`

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd apps/agent && .venv/bin/pytest tests/test_repository.py::test_update_summary tests/test_repository.py::test_update_summary_status -v
```

Expected: `2 passed`

- [ ] **Step 7: Commit**

```bash
git add apps/agent/app/db/models.py apps/agent/app/db/repository.py apps/agent/tests/test_repository.py
git commit -m "feat: add summary columns to Document model and repository methods"
```

---

## Task 2: Summarization Backend

**Files:**
- Create: `apps/agent/app/rag/summarizer.py`
- Create: `apps/agent/tests/test_summarizer.py`
- Modify: `apps/agent/app/api/document.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/agent/tests/test_summarizer.py
import pytest
from unittest.mock import patch, MagicMock


def test_summarize_short_document():
    """Short document → single LLM call."""
    mock_response = MagicMock()
    mock_response.choices[0].message.content = "这是文档摘要。"

    with patch("app.rag.summarizer.OpenAI") as MockOpenAI:
        mock_client = MockOpenAI.return_value
        mock_client.chat.completions.create.return_value = mock_response

        from app.rag.summarizer import summarize_document
        result = summarize_document("短文档内容，不超过6000字。")

    assert result == "这是文档摘要。"
    mock_client.chat.completions.create.assert_called_once()
    call_kwargs = mock_client.chat.completions.create.call_args
    assert call_kwargs.kwargs["model"] == "gpt-4o"


def test_summarize_long_document():
    """Long document → map-reduce: multiple mini calls + one final call."""
    mock_response = MagicMock()
    mock_response.choices[0].message.content = "片段摘要。"

    final_response = MagicMock()
    final_response.choices[0].message.content = "最终汇总摘要。"

    call_count = {"n": 0}

    def side_effect(**kwargs):
        call_count["n"] += 1
        if kwargs["model"] == "gpt-4o-mini":
            return mock_response
        return final_response

    with patch("app.rag.summarizer.OpenAI") as MockOpenAI:
        mock_client = MockOpenAI.return_value
        mock_client.chat.completions.create.side_effect = lambda **kw: side_effect(**kw)

        from app.rag.summarizer import summarize_document, MAX_CHARS_PER_CALL
        long_text = "内容。" * (MAX_CHARS_PER_CALL // 3 + 1)  # 2 chunks
        result = summarize_document(long_text)

    assert result == "最终汇总摘要。"
    # Should have called gpt-4o-mini twice (2 chunks) + gpt-4o once (reduce)
    assert call_count["n"] == 3


def test_get_document_full_text_txt(tmp_path):
    """Extract full text from a TXT file."""
    txt_file = tmp_path / "test.txt"
    txt_file.write_text("第一段。\n第二段。", encoding="utf-8")

    from app.rag.summarizer import get_document_full_text
    text = get_document_full_text(str(txt_file), "txt")
    assert "第一段" in text
    assert "第二段" in text
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/agent && .venv/bin/pytest tests/test_summarizer.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.rag.summarizer'`

- [ ] **Step 3: Create `apps/agent/app/rag/summarizer.py`**

```python
# apps/agent/app/rag/summarizer.py
import logging
from openai import OpenAI
from app.infrastructure.config import settings

logger = logging.getLogger(__name__)

MAX_CHARS_PER_CALL = 12000  # ~3000 tokens, safe context window slice

_DIRECT_PROMPT = """你是企业知识库助手。请对以下文档内容生成简洁、结构化的中文摘要。

要求：
1. 摘要长度：200-400字
2. 先写一句总述，再分点列出关键信息
3. 保留重要数字、日期、名称等关键信息
4. 使用客观、专业的语言

文档内容：
{content}

摘要："""

_MAP_PROMPT = """请对以下文档片段生成简短摘要（100字以内）：

{content}

摘要："""

_REDUCE_PROMPT = """以下是一份长文档各片段的摘要，请整合成一份完整摘要（200-400字）：

{summaries}

完整摘要："""


def _client() -> OpenAI:
    return OpenAI(api_key=settings.openai_api_key)


def summarize_document(full_text: str) -> str:
    """Summarize document text. Uses Map-Reduce for long documents."""
    if not full_text.strip():
        return ""

    if len(full_text) <= MAX_CHARS_PER_CALL:
        resp = _client().chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": _DIRECT_PROMPT.format(content=full_text)}],
            max_tokens=800,
            temperature=0.3,
        )
        return resp.choices[0].message.content or ""

    # Map: summarize each chunk with a cheap model
    chunks = [full_text[i:i + MAX_CHARS_PER_CALL] for i in range(0, len(full_text), MAX_CHARS_PER_CALL)]
    partial = []
    for chunk in chunks:
        resp = _client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": _MAP_PROMPT.format(content=chunk)}],
            max_tokens=300,
            temperature=0.3,
        )
        partial.append(resp.choices[0].message.content or "")

    # Reduce: merge partial summaries
    combined = "\n\n".join(f"[第{i+1}部分]\n{s}" for i, s in enumerate(partial))
    resp = _client().chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": _REDUCE_PROMPT.format(summaries=combined)}],
        max_tokens=800,
        temperature=0.3,
    )
    return resp.choices[0].message.content or ""


def get_document_full_text(file_path: str, file_type: str) -> str:
    """Extract full text from a document file for summarization."""
    from app.rag.ingestion import parse_document
    chunks = parse_document(file_path, file_type)
    return "\n\n".join(c["text"] for c in chunks)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/agent && .venv/bin/pytest tests/test_summarizer.py -v
```

Expected: `3 passed`

- [ ] **Step 5: Add summary endpoints to `apps/agent/app/api/document.py`**

Add the following two routes at the end of `apps/agent/app/api/document.py`:

```python
@router.post("/{document_id}/summary")
def generate_summary(document_id: str, db: Session = Depends(get_db)):
    """Generate (or return cached) document summary."""
    from app.rag.summarizer import get_document_full_text, summarize_document
    from app.infrastructure.config import settings as cfg

    repo = DocumentRepository(db)
    doc = repo.get_by_id(document_id)
    if not doc:
        raise HTTPException(404, "Document not found")

    # Return cached summary if available
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
```

- [ ] **Step 6: Verify endpoints start without error**

```bash
cd apps/agent && OPENAI_API_KEY=test .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8099 &
sleep 2
curl -s http://localhost:8099/documents/nonexistent/summary | python3 -m json.tool
kill %1
```

Expected: `{"detail": "Document not found"}`

- [ ] **Step 7: Commit**

```bash
git add apps/agent/app/rag/summarizer.py apps/agent/tests/test_summarizer.py apps/agent/app/api/document.py
git commit -m "feat: add document summarization API with Map-Reduce for long documents"
```

---

## Task 3: Streaming Q&A Backend (SSE)

**Files:**
- Modify: `apps/agent/app/rag/pipeline.py`
- Modify: `apps/agent/app/api/chat.py`
- Create: `apps/agent/tests/test_streaming.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/agent/tests/test_streaming.py
import pytest
from unittest.mock import patch, MagicMock


def _make_stream_chunk(content: str):
    chunk = MagicMock()
    chunk.choices[0].delta.content = content
    return chunk


def test_rag_answer_stream_yields_events():
    """Stream should yield sources event then delta events then end event."""
    # Mock retrieval
    fake_chunks = [{
        "id": "doc1_0",
        "text": "合同付款期限为30天。",
        "score": 0.9,
        "metadata": {
            "document_id": "doc1",
            "file_type": "pdf",
            "page_num": "1",
            "bbox": "[10,20,100,50]",
            "filename": "contract.pdf",
        }
    }]

    with patch("app.rag.pipeline._retrieve_across_documents", return_value=fake_chunks), \
         patch("app.rag.pipeline.rewrite_query", return_value="付款期限"), \
         patch("app.rag.pipeline.get_memories", return_value=[]), \
         patch("app.rag.pipeline.rerank", return_value=fake_chunks), \
         patch("app.rag.pipeline.is_confident", return_value=True), \
         patch("app.rag.pipeline.add_memory"), \
         patch("app.rag.pipeline._get_openai") as mock_openai_fn:

        mock_client = mock_openai_fn.return_value
        mock_client.chat.completions.create.return_value = iter([
            _make_stream_chunk("付款"),
            _make_stream_chunk("期限"),
            _make_stream_chunk("30天"),
        ])

        from app.rag.pipeline import rag_answer_stream
        events = list(rag_answer_stream(
            query="付款期限是多少天？",
            user_id="u1",
            session_id="s1",
            document_ids=["doc1"],
            history=[],
            document_metadata={"doc1": {"filename": "contract.pdf", "file_type": "pdf"}},
        ))

    types = [e["type"] for e in events]
    assert types[0] == "sources"
    assert all(t == "delta" for t in types[1:-1])
    assert types[-1] == "end"

    sources_event = events[0]
    assert len(sources_event["sources"]) == 1
    assert sources_event["sources"][0]["filename"] == "contract.pdf"

    end_event = events[-1]
    assert end_event["answer"] == "付款期限30天"


def test_rag_answer_stream_no_docs():
    """Empty document list should yield error event."""
    with patch("app.rag.pipeline._retrieve_across_documents", return_value=[]), \
         patch("app.rag.pipeline.rewrite_query", return_value="q"), \
         patch("app.rag.pipeline.get_memories", return_value=[]):

        from app.rag.pipeline import rag_answer_stream
        events = list(rag_answer_stream(
            query="q", user_id="u1", session_id="s1",
            document_ids=[], history=[], document_metadata={},
        ))

    assert len(events) == 1
    assert events[0]["type"] == "error"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/agent && .venv/bin/pytest tests/test_streaming.py -v
```

Expected: `ImportError` or `AttributeError: module has no attribute 'rag_answer_stream'`

- [ ] **Step 3: Refactor `pipeline.py` — extract `_build_sources` and add `rag_answer_stream`**

Replace the full content of `apps/agent/app/rag/pipeline.py`:

```python
# apps/agent/app/rag/pipeline.py
import json
import logging
from typing import Generator
import chromadb
from openai import OpenAI
from app.infrastructure.config import settings
from app.rag.ingestion import _get_chroma_collection
from app.rag.query_rewriter import rewrite_query
from app.rag.hybrid_retriever import HybridRetriever
from app.rag.reranker import rerank
from app.rag.confidence import is_confident, NOT_FOUND_MESSAGE
from app.rag.prompt import build_messages
from app.rag.memory import get_memories, add_memory

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


def _build_sources(reranked: list[dict]) -> list[dict]:
    """Extract source metadata from reranked chunks."""
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
    return sources


def rag_answer(
    query: str,
    user_id: str,
    session_id: str,
    document_ids: list[str],
    history: list[dict],
    document_metadata: dict[str, dict],
) -> dict:
    """Synchronous RAG pipeline (kept for backward compatibility)."""
    rewritten = rewrite_query(query, history)
    mem0_memories = get_memories(user_id, rewritten)

    raw_chunks = _retrieve_across_documents(rewritten, document_ids)
    if not raw_chunks:
        return {"answer": "没有可查询的文档内容。", "sources": [], "session_id": session_id}

    for chunk in raw_chunks:
        doc_id = chunk["metadata"].get("document_id", "")
        if doc_id in document_metadata:
            chunk["metadata"].update(document_metadata[doc_id])

    reranked = rerank(rewritten, raw_chunks, top_n=5)

    if not is_confident(reranked):
        return {"answer": NOT_FOUND_MESSAGE, "sources": [], "session_id": session_id}

    sources = _build_sources(reranked)
    messages = build_messages(query, reranked, history, mem0_memories=mem0_memories or None)

    try:
        response = _get_openai().chat.completions.create(
            model="gpt-4o",
            messages=messages,
            stream=False,
            max_tokens=2048,
            temperature=0.3,
        )
        answer = response.choices[0].message.content or ""
        add_memory(user_id, query, answer)
    except Exception as e:
        logger.error(f"OpenAI completion failed: {e}")
        return {"answer": "抱歉，AI 服务暂时不可用，请稍后重试。", "sources": [], "session_id": session_id}

    return {"answer": answer, "sources": sources, "session_id": session_id}


def rag_answer_stream(
    query: str,
    user_id: str,
    session_id: str,
    document_ids: list[str],
    history: list[dict],
    document_metadata: dict[str, dict],
) -> Generator[dict, None, None]:
    """
    Streaming RAG pipeline. Yields dicts:
      {"type": "sources", "sources": [...], "session_id": str}
      {"type": "delta",   "content": str}
      {"type": "end",     "answer": str}
      {"type": "error",   "message": str}
    """
    rewritten = rewrite_query(query, history)
    mem0_memories = get_memories(user_id, rewritten)

    raw_chunks = _retrieve_across_documents(rewritten, document_ids)
    if not raw_chunks:
        yield {"type": "error", "message": "没有可查询的文档内容。"}
        return

    for chunk in raw_chunks:
        doc_id = chunk["metadata"].get("document_id", "")
        if doc_id in document_metadata:
            chunk["metadata"].update(document_metadata[doc_id])

    reranked = rerank(rewritten, raw_chunks, top_n=5)

    if not is_confident(reranked):
        yield {"type": "error", "message": NOT_FOUND_MESSAGE}
        return

    sources = _build_sources(reranked)
    yield {"type": "sources", "sources": sources, "session_id": session_id}

    messages = build_messages(query, reranked, history, mem0_memories=mem0_memories or None)

    try:
        full_answer = ""
        stream = _get_openai().chat.completions.create(
            model="gpt-4o",
            messages=messages,
            stream=True,
            max_tokens=2048,
            temperature=0.3,
        )
        for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                full_answer += delta
                yield {"type": "delta", "content": delta}
        add_memory(user_id, query, full_answer)
        yield {"type": "end", "answer": full_answer}
    except Exception as e:
        logger.error(f"Streaming failed: {e}")
        yield {"type": "error", "message": "AI 服务暂时不可用，请稍后重试。"}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/agent && .venv/bin/pytest tests/test_streaming.py -v
```

Expected: `2 passed`

- [ ] **Step 5: Add `/chat/stream` endpoint to `apps/agent/app/api/chat.py`**

Add the following import and route at the end of `apps/agent/app/api/chat.py`:

```python
# Add to imports at top:
from fastapi.responses import StreamingResponse
from app.rag.pipeline import rag_answer, rag_answer_stream

# Add at the end of the file:
@router.post("/stream")
def chat_stream(req: ChatRequest, db: Session = Depends(get_db)):
    """SSE streaming chat. Yields text/event-stream with JSON data lines."""
    doc_repo = DocumentRepository(db)
    sess_repo = SessionRepository(db)
    msg_repo = MessageRepository(db)

    if req.document_ids:
        doc_ids = req.document_ids
    elif req.mode == "demo":
        doc_ids = [d.id for d in doc_repo.list_demo() if d.status == "ready"]
    else:
        doc_ids = [d.id for d in doc_repo.list_for_user(req.user_id) if d.status == "ready"]

    all_docs = (doc_repo.list_demo() if req.mode == "demo" else doc_repo.list_for_user(req.user_id))
    doc_meta = {d.id: {"filename": d.filename, "file_type": d.file_type} for d in all_docs}

    session_id = req.session_id
    if not session_id:
        session = sess_repo.create(user_id=req.user_id, mode=req.mode)
        session_id = session.id
    else:
        session = sess_repo.get_by_id(session_id)
        if not session:
            session = sess_repo.create(user_id=req.user_id, mode=req.mode)
            session_id = session.id

    recent_msgs = msg_repo.get_recent(session_id, limit=6)
    history = [{"role": m.role, "content": m.content} for m in recent_msgs]

    msg_repo.create(session_id=session_id, role="user", content=req.query)
    sess_repo.update_title(session_id, req.query)

    def event_stream():
        full_answer = ""
        sources: list = []
        for event in rag_answer_stream(
            query=req.query,
            user_id=req.user_id,
            session_id=session_id,
            document_ids=doc_ids,
            history=history,
            document_metadata=doc_meta,
        ):
            if event["type"] == "sources":
                sources = event["sources"]
            if event["type"] == "end":
                full_answer = event["answer"]
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

        msg_repo.create(
            session_id=session_id,
            role="assistant",
            content=full_answer,
            sources=json.dumps(sources),
        )
        sess_repo.touch(session_id)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

- [ ] **Step 6: Verify the full test suite still passes**

```bash
cd apps/agent && .venv/bin/pytest tests/test_pipeline.py tests/test_streaming.py -v
```

Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add apps/agent/app/rag/pipeline.py apps/agent/app/api/chat.py apps/agent/tests/test_streaming.py
git commit -m "feat: add SSE streaming Q&A endpoint POST /chat/stream"
```

---

## Task 4: Better Chunking — Larger Chunks + DOCX Table Support

**Files:**
- Modify: `apps/agent/app/rag/ingestion.py`

- [ ] **Step 1: Write the failing test**

```python
# apps/agent/tests/test_ingestion.py — add at the end

def test_chunk_size_is_1500():
    from app.rag.ingestion import CHUNK_SIZE
    assert CHUNK_SIZE == 1500, f"Expected 1500, got {CHUNK_SIZE}"


def test_parse_docx_includes_tables(tmp_path):
    """DOCX parsing should extract table rows as chunks."""
    from docx import Document as DocxDocument
    from docx.oxml.ns import qn
    import lxml.etree as etree

    # Build a minimal DOCX with one paragraph and one table
    doc = DocxDocument()
    doc.add_paragraph("这是正文段落。")
    table = doc.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "产品名称"
    table.cell(0, 1).text = "单价"
    table.cell(1, 0).text = "笔记本电脑"
    table.cell(1, 1).text = "8000元"
    docx_path = tmp_path / "test.docx"
    doc.save(str(docx_path))

    from app.rag.ingestion import parse_document
    chunks = parse_document(str(docx_path), "docx")

    texts = [c["text"] for c in chunks]
    assert any("这是正文段落" in t for t in texts)
    assert any("产品名称" in t and "单价" in t for t in texts)
    assert any("笔记本电脑" in t and "8000元" in t for t in texts)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/agent && .venv/bin/pytest tests/test_ingestion.py::test_chunk_size_is_1500 tests/test_ingestion.py::test_parse_docx_includes_tables -v
```

Expected: `test_chunk_size_is_1500` FAILS with `Expected 1500, got 512`; `test_parse_docx_includes_tables` FAILS (table rows missing)

- [ ] **Step 3: Update `apps/agent/app/rag/ingestion.py`**

Replace the full content of `apps/agent/app/rag/ingestion.py`:

```python
# apps/agent/app/rag/ingestion.py
import logging
from pathlib import Path
from typing import Any
import chromadb
from llama_index.core import Settings as LlamaSettings
from llama_index.core.node_parser import SentenceSplitter
from llama_index.embeddings.openai import OpenAIEmbedding
from app.infrastructure.config import settings

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1500
CHUNK_OVERLAP = 150

_WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _setup_llama_settings():
    LlamaSettings.embed_model = OpenAIEmbedding(
        model="text-embedding-3-small",
        api_key=settings.openai_api_key,
    )


def _get_chroma_collection(document_id: str):
    client = chromadb.PersistentClient(path=str(settings.resolved_chroma_dir()))
    collection_name = f"doc_{document_id.replace('-', '_')}"
    return client, client.get_or_create_collection(collection_name)


def _parse_docx_blocks(file_path: str) -> list[dict]:
    """Extract paragraphs and table rows from DOCX in document order."""
    from docx import Document as DocxDocument
    from docx.table import Table as DocxTable

    doc = DocxDocument(file_path)
    blocks = []
    idx = 0

    for child in doc.element.body:
        tag = child.tag
        if tag == f"{_WORD_NS}p":
            text = "".join(child.itertext()).strip()
            if text:
                blocks.append({"text": text, "block_idx": idx, "is_table": False})
                idx += 1
        elif tag == f"{_WORD_NS}tbl":
            tbl = DocxTable(child, doc)
            for row in tbl.rows:
                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                if cells:
                    row_text = " | ".join(cells)
                    blocks.append({"text": row_text, "block_idx": idx, "is_table": True})
                    idx += 1
    return blocks


def parse_document(file_path: str, file_type: str) -> list[dict[str, Any]]:
    """Parse a document into chunks with position metadata."""
    chunks = []

    if file_type == "pdf":
        import fitz
        doc = fitz.open(file_path)
        chunk_index = 0
        splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
        for page_num in range(len(doc)):
            page = doc[page_num]
            page_w = page.rect.width
            page_h = page.rect.height
            blocks = page.get_text("blocks")
            for block in blocks:
                x0, y0, x1, y1, text, _block_no, block_type = block
                if block_type != 0 or not text.strip():
                    continue
                norm_bbox = [
                    round(x0 / page_w * 1000),
                    round(y0 / page_h * 1000),
                    round(x1 / page_w * 1000),
                    round(y1 / page_h * 1000),
                ]
                for sub in splitter.split_text(text.strip()):
                    if sub.strip():
                        chunks.append({
                            "text": sub.strip(),
                            "page_num": page_num + 1,
                            "page_idx": page_num + 1,
                            "bbox": norm_bbox,
                            "chunk_index": chunk_index,
                        })
                        chunk_index += 1

    elif file_type == "docx":
        splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
        chunk_index = 0
        for block in _parse_docx_blocks(file_path):
            for sub in splitter.split_text(block["text"]):
                if sub.strip():
                    chunks.append({
                        "text": sub.strip(),
                        "paragraph_idx": block["block_idx"],
                        "chunk_index": chunk_index,
                    })
                    chunk_index += 1

    elif file_type == "xlsx":
        from openpyxl import load_workbook
        wb = load_workbook(file_path, read_only=True, data_only=True)
        chunk_index = 0
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            for row_idx, row in enumerate(ws.iter_rows(values_only=True)):
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
                    "char_offset": 0,
                    "chunk_index": chunk_index,
                })

    return chunks


def ingest_document(document_id: str, file_path: str, file_type: str) -> int:
    """Parse, embed, and store. Returns chunk count."""
    _setup_llama_settings()
    chunks = parse_document(file_path, file_type)
    if not chunks:
        logger.warning(f"No chunks from {file_path}")
        return 0

    client, collection = _get_chroma_collection(document_id)

    ids = [f"{document_id}_{c['chunk_index']}" for c in chunks]
    texts = [c["text"] for c in chunks]
    metadatas = []
    for c in chunks:
        meta = {k: str(v) for k, v in c.items() if k != "text"}
        meta["document_id"] = document_id
        meta["file_type"] = file_type
        metadatas.append(meta)

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

    return len(chunks)


def delete_document_vectors(document_id: str):
    client = chromadb.PersistentClient(path=str(settings.resolved_chroma_dir()))
    collection_name = f"doc_{document_id.replace('-', '_')}"
    try:
        client.delete_collection(collection_name)
    except Exception:
        pass
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/agent && .venv/bin/pytest tests/test_ingestion.py -v
```

Expected: all pass, including the two new ones

- [ ] **Step 5: Commit**

```bash
git add apps/agent/app/rag/ingestion.py apps/agent/tests/test_ingestion.py
git commit -m "feat: increase chunk size to 1500 and add DOCX table parsing"
```

---

## Task 5: Frontend — Streaming Chat + Summary Panel

**Files:**
- Modify: `apps/web/src/components/ChatPanel.tsx`
- Modify: `apps/web/src/components/ViewerPanel.tsx`

- [ ] **Step 1: Read current ChatPanel.tsx to understand state shape**

```bash
grep -n "useState\|sendMessage\|fetch\|messages" apps/web/src/components/ChatPanel.tsx | head -40
```

Note the existing state variable names and message type before editing.

- [ ] **Step 2: Replace the fetch call in ChatPanel.tsx with streaming fetch**

Locate the `sendMessage` function and the `fetch('/api/agent/chat/message'` call inside it. Replace the entire `try` block that does the fetch with:

```typescript
      // Use streaming endpoint
      const streamRes = await fetch('/api/agent/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: userQuery,
          user_id: userId,
          session_id: activeSessionRef.current ?? undefined,
          mode,
        }),
      })
      if (!streamRes.ok) throw new Error('Stream request failed')

      const reader = streamRes.body!.getReader()
      const decoder = new TextDecoder()

      // Add placeholder assistant message
      setMessages(prev => [...prev, { role: 'assistant' as const, content: '', sources: [] }])

      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''  // keep incomplete line
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'sources') {
              if (!activeSessionRef.current && event.session_id) {
                activeSessionRef.current = event.session_id
                setActiveSessionId(event.session_id)
              }
              setMessages(prev => {
                const msgs = [...prev]
                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], sources: event.sources }
                return msgs
              })
            }
            if (event.type === 'delta') {
              setMessages(prev => {
                const msgs = [...prev]
                const last = msgs[msgs.length - 1]
                msgs[msgs.length - 1] = { ...last, content: last.content + event.content }
                return msgs
              })
            }
            if (event.type === 'error') {
              setMessages(prev => {
                const msgs = [...prev]
                msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content: event.message }
                return msgs
              })
            }
          } catch { /* skip malformed SSE line */ }
        }
      }
```

- [ ] **Step 3: Add Summary button and drawer to ViewerPanel.tsx**

In `apps/web/src/components/ViewerPanel.tsx`:

**3a.** Add state for summary at the top of the `ViewerPanel` component (after existing state declarations):

```typescript
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
```

**3b.** Add the `fetchSummary` function inside the component (after `handleDragLeave`):

```typescript
  async function fetchSummary() {
    if (!selectedDoc) return
    setShowSummary(true)
    if (summaryText) return  // already loaded for this doc
    setSummaryLoading(true)
    try {
      const res = await fetch(`/api/agent/documents/${selectedDoc.document_id}/summary`, {
        method: 'POST',
      })
      const data = await res.json()
      if (res.ok) setSummaryText(data.summary)
      else setSummaryText('生成摘要失败，请重试。')
    } catch {
      setSummaryText('网络错误，请重试。')
    } finally {
      setSummaryLoading(false)
    }
  }
```

**3c.** Reset summary state when selected doc changes — add an effect after the existing `useEffect` blocks:

```typescript
  useEffect(() => {
    setSummaryText(null)
    setShowSummary(false)
  }, [selectedId])
```

**3d.** Add "总结" button next to the "+ 上传" button in the tab bar (inside the `{mode === 'chat' && ...}` block):

```typescript
            <button
              onClick={fetchSummary}
              disabled={!selectedDoc || selectedDoc.status !== 'ready'}
              className="px-2 py-1 text-xs text-purple-600 hover:bg-purple-50 rounded whitespace-nowrap disabled:opacity-40 shrink-0"
            >
              总结
            </button>
```

**3e.** Add summary drawer panel below the tab bar (before the `{/* Upload progress bar */}` comment):

```typescript
      {showSummary && (
        <div className="border-b bg-purple-50 px-4 py-3 shrink-0 max-h-48 overflow-y-auto relative">
          <button
            onClick={() => setShowSummary(false)}
            className="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-xs"
          >
            ✕
          </button>
          <p className="text-xs font-semibold text-purple-700 mb-1">文档摘要</p>
          {summaryLoading ? (
            <p className="text-xs text-gray-500">生成中，请稍候…</p>
          ) : (
            <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{summaryText}</p>
          )}
        </div>
      )}
```

- [ ] **Step 4: Build to verify no TypeScript errors**

```bash
cd apps/web && npm run build 2>&1 | tail -20
```

Expected: build succeeds with no TypeScript errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ChatPanel.tsx apps/web/src/components/ViewerPanel.tsx
git commit -m "feat: SSE streaming in ChatPanel and summary drawer in ViewerPanel"
```

---

## Task 6: Re-index Existing Documents With New Chunk Size

**Files:**
- Create: `scripts/reindex.py`

- [ ] **Step 1: Create the re-index script**

```python
#!/usr/bin/env python3
# scripts/reindex.py
# Re-ingest all ready documents with the current chunk size.
# Run: cd apps/agent && .venv/bin/python ../../scripts/reindex.py
import sys
import os
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "apps" / "agent"))
os.chdir(ROOT / "apps" / "agent")

from app.db.database import SessionLocal
from app.db.models import Document
from app.rag.ingestion import ingest_document, delete_document_vectors
from app.infrastructure.config import settings

def main():
    db = SessionLocal()
    try:
        docs = db.query(Document).filter(
            Document.status == "ready",
        ).all()

        if not docs:
            print("No ready documents to re-index.")
            return

        print(f"Re-indexing {len(docs)} documents with CHUNK_SIZE=1500...")
        upload_base = settings.resolved_upload_dir().parent

        for doc in docs:
            full_path = upload_base / doc.file_path
            if not full_path.exists():
                print(f"  ✗ {doc.filename}: file not found at {full_path}")
                continue
            try:
                delete_document_vectors(doc.id)
                count = ingest_document(doc.id, str(full_path), doc.file_type)
                doc.chunk_count = count
                db.commit()
                print(f"  ✓ {doc.filename} → {count} chunks")
            except Exception as e:
                print(f"  ✗ {doc.filename}: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the re-index script**

```bash
ALL_PROXY= all_proxy= apps/agent/.venv/bin/python scripts/reindex.py 2>&1
```

Expected output:
```
Re-indexing N documents with CHUNK_SIZE=1500...
  ✓ source.pdf → XXX chunks
  ✓ source.docx → XX chunks
```

- [ ] **Step 3: Verify chunk counts updated in MySQL**

```bash
mysql -u root --password='Lyx2020.' enterprise_rag -e "SELECT filename, chunk_count, status FROM documents;" 2>/dev/null
```

Expected: `chunk_count` values are non-zero

- [ ] **Step 4: Commit**

```bash
git add scripts/reindex.py
git commit -m "chore: add reindex.py script to re-ingest documents with new chunk size"
```

---

## Self-Review

**Spec coverage:**
- ✅ Summarization: Tasks 1 + 2 implement DB + Map-Reduce backend + API
- ✅ Streaming Q&A: Task 3 implements `rag_answer_stream` + SSE endpoint
- ✅ Better chunking: Task 4 changes CHUNK_SIZE 512→1500 + DOCX tables
- ✅ Frontend streaming: Task 5 updates ChatPanel
- ✅ Frontend summary: Task 5 updates ViewerPanel
- ✅ Re-index: Task 6 provides migration script

**Placeholder scan:** No TBDs, all steps have real code.

**Type consistency:**
- `rag_answer_stream` → yields `dict` with `type` key — used consistently in `event_stream()` in chat.py
- `_build_sources` → returns `list[dict]` — used in both `rag_answer` and `rag_answer_stream`
- `update_summary(doc_id, summary)` → defined in Task 1, called in Task 2 ✅
- `update_summary_status(doc_id, status)` → defined in Task 1, called in Task 2 ✅
- `get_document_full_text` → defined in `summarizer.py` Task 2, not referenced elsewhere ✅
