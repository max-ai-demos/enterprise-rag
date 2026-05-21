# apps/agent/app/api/chat.py
import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.db.repository import DocumentRepository, SessionRepository, MessageRepository
from app.rag.pipeline import rag_answer, rag_answer_stream, rag_answer_stream_async

router = APIRouter()
logger = logging.getLogger(__name__)


class ChatRequest(BaseModel):
    query: str
    user_id: str
    session_id: str | None = None
    document_ids: list[str] | None = None
    mode: str = "upload"           # "upload" | "demo"
    use_web_search: bool = False   # 需要 TAVILY_API_KEY 配置后生效


def _resolve_context(req: ChatRequest, db: Session):
    """Shared helper: resolve doc_ids, doc_meta, session_id, history."""
    doc_repo = DocumentRepository(db)
    sess_repo = SessionRepository(db)
    msg_repo = MessageRepository(db)

    if req.document_ids:
        doc_ids = req.document_ids
    elif req.mode == "demo":
        doc_ids = [d.id for d in doc_repo.list_demo() if d.status == "ready"]
    else:
        doc_ids = [d.id for d in doc_repo.list_for_user(req.user_id) if d.status == "ready"]

    all_docs = doc_repo.list_demo() if req.mode == "demo" else doc_repo.list_for_user(req.user_id)
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

    return doc_ids, doc_meta, session_id, history, msg_repo, sess_repo


@router.post("/message")
def chat_message(req: ChatRequest, db: Session = Depends(get_db)):
    doc_ids, doc_meta, session_id, history, msg_repo, sess_repo = _resolve_context(req, db)

    msg_repo.create(session_id=session_id, role="user", content=req.query)
    sess_repo.update_title(session_id, req.query)

    try:
        result = rag_answer(
            query=req.query,
            user_id=req.user_id,
            session_id=session_id,
            document_ids=doc_ids,
            history=history,
            document_metadata=doc_meta,
            db=db,
            use_web_search=req.use_web_search,
        )
    except Exception as e:
        logger.error("RAG pipeline failed: %s", e)
        raise HTTPException(500, "AI 服务暂时不可用，请稍后重试。")

    msg_repo.create(
        session_id=session_id,
        role="assistant",
        content=result["answer"],
        sources=json.dumps(result["sources"]),
    )
    sess_repo.touch(session_id)
    return result


@router.post("/stream")
def chat_stream(req: ChatRequest, db: Session = Depends(get_db)):
    """SSE streaming (sync generator). Default production path."""
    doc_ids, doc_meta, session_id, history, msg_repo, sess_repo = _resolve_context(req, db)

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
            db=db,
            use_web_search=req.use_web_search,
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


@router.post("/stream/async")
async def chat_stream_async(req: ChatRequest, db: Session = Depends(get_db)):
    """SSE streaming (async generator). 高并发场景下的升级路径。

    使用 AsyncOpenAI + asyncio.to_thread，适合部署在异步 ASGI 服务器下。
    与 /stream 行为完全一致，直接将前端请求地址改为此路径即可切换。
    """
    doc_ids, doc_meta, session_id, history, msg_repo, sess_repo = _resolve_context(req, db)

    msg_repo.create(session_id=session_id, role="user", content=req.query)
    sess_repo.update_title(session_id, req.query)

    async def event_stream():
        full_answer = ""
        sources: list = []
        async for event in rag_answer_stream_async(
            query=req.query,
            user_id=req.user_id,
            session_id=session_id,
            document_ids=doc_ids,
            history=history,
            document_metadata=doc_meta,
            db=db,
            use_web_search=req.use_web_search,
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
