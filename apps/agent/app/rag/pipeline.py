# apps/agent/app/rag/pipeline.py
import asyncio
import json
import logging
import re
import time
from typing import AsyncGenerator, Generator, Optional
from sqlalchemy.orm import Session
from openai import AsyncOpenAI, OpenAI
from app.infrastructure.config import settings
from app.rag.query_rewriter import generate_multi_queries
from app.rag.hybrid_retriever import HybridRetriever
from app.rag.reranker import rerank
from app.rag.score_fusion import apply_score_fusion
from app.rag.confidence import is_confident, NOT_FOUND_MESSAGE
from app.rag.prompt import build_messages
from app.rag.memory import get_memories, add_memory

logger = logging.getLogger(__name__)


class _CircuitBreaker:
    """Protect OpenAI calls: opens after 5 consecutive failures, resets after 60s."""
    def __init__(self, threshold: int = 5, timeout: float = 60.0):
        self._threshold = threshold
        self._timeout = timeout
        self._failures = 0
        self._opened_at: float | None = None

    def is_open(self) -> bool:
        if self._opened_at and time.time() - self._opened_at > self._timeout:
            self._failures = 0
            self._opened_at = None
        return self._opened_at is not None

    def success(self) -> None:
        self._failures = 0
        self._opened_at = None

    def failure(self) -> None:
        self._failures += 1
        if self._failures >= self._threshold:
            self._opened_at = time.time()
            logger.warning("[circuit_breaker] OPEN — OpenAI calls suspended for 60s")


_cb = _CircuitBreaker()

_openai_client: Optional[OpenAI] = None
_async_openai_client: Optional[AsyncOpenAI] = None


def _get_openai() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        _openai_client = OpenAI(api_key=settings.openai_api_key)
    return _openai_client


def _get_async_openai() -> AsyncOpenAI:
    global _async_openai_client
    if _async_openai_client is None:
        _async_openai_client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _async_openai_client


def _sanitize_markdown(text: Optional[str], streaming: bool = False) -> str:
    """
    Fix common Markdown artifacts in LLM output.

    Streaming mode: ONLY apply transforms that are safe on partial token chunks.
    Any regex that operates on multi-character patterns spanning token boundaries
    must be deferred to non-streaming (full-text) post-processing.

    Safe in streaming mode:
      - Convert `* item` bullet to `- item` (line-start pattern, safe per-line)

    Unsafe in streaming mode (deferred):
      - Lone `*` escaping: `**bold**` split as `**bo` + `ld**` — regex sees lone `*`
      - Math conversion: `$...$` can span tokens
    """
    if not text:
        return ""
    try:
        s = text
        # Safe: convert `* ` at line start to `- ` (LLM often outputs wrong bullet style)
        s = re.sub(r"(?m)^\* ", "- ", s)

        if not streaming:
            # Non-streaming only: operate on complete text where all patterns are visible
            s = re.sub(r"(?<!\*)\*(?=-)", "", s)             # stray `*` before `-`
            s = re.sub(r"\*\*([^*\n]+)\*-\s", r"**\1** - ", s)  # fix `**word* -`
            # Math: inline $...$ → \( \)
            s = re.sub(r"\$([^\$\n]+)\$", r"\\( \1 \\)", s)
            # Math: block $$...$$ → \[ \]
            s = re.sub(r"\$\$([\s\S]+?)\$\$", r"\\[ \1 \\]", s)
        return s
    except Exception:
        return text or ""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _retrieve_across_documents(
    query: str, document_ids: list[str], db: Session, top_k: int = 15
) -> list[dict]:
    all_results = []
    for doc_id in document_ids:
        retriever = HybridRetriever(db=db, document_id=doc_id)
        results = retriever.retrieve(query, top_k=top_k)
        for r in results:
            r["metadata"]["document_id"] = doc_id
        all_results.extend(results)
    all_results.sort(key=lambda x: x["score"], reverse=True)
    return all_results[:top_k]


def _retrieve_multi_query(
    queries: list[str], document_ids: list[str], db: Session, top_k: int = 10
) -> list[dict]:
    seen: set[str] = set()
    merged: list[dict] = []
    for q in queries:
        for chunk in _retrieve_across_documents(q, document_ids, db, top_k=top_k):
            key = chunk["text"][:80]
            if key not in seen:
                seen.add(key)
                merged.append(chunk)
    merged.sort(key=lambda x: x["score"], reverse=True)
    return merged[:top_k * 2]


def _enrich_metadata(chunks: list[dict], document_metadata: dict[str, dict]) -> None:
    for chunk in chunks:
        doc_id = chunk["metadata"].get("document_id", "")
        if doc_id in document_metadata:
            chunk["metadata"].update(document_metadata[doc_id])


def _apply_rerank_and_fusion(query: str, chunks: list[dict], top_n: int = 5) -> list[dict]:
    reranked = rerank(query, chunks, top_n=top_n)
    return apply_score_fusion(reranked, alpha=settings.reranker_alpha)


def _fetch_web_results(query: str) -> list[dict]:
    """Fetch Tavily web results. Returns [] if unavailable or disabled."""
    from app.infrastructure.web_search import get_tavily_client, WebSearchError
    client = get_tavily_client()
    if not client.is_available():
        return []
    try:
        results = client.search(query)
        logger.info(f"[RAG] Web search returned {len(results)} results")
        return results
    except WebSearchError as e:
        logger.warning(f"[RAG] Web search skipped: {e}")
        return []


async def _fetch_web_results_async(query: str) -> list[dict]:
    from app.infrastructure.web_search import get_tavily_client, WebSearchError
    client = get_tavily_client()
    if not client.is_available():
        return []
    try:
        results = await client.search_async(query)
        logger.info(f"[RAG] Web search (async) returned {len(results)} results")
        return results
    except WebSearchError as e:
        logger.warning(f"[RAG] Web search skipped: {e}")
        return []


def _validate_citations(answer: str, sources: list[dict]) -> str:
    """Strip [来源N] references where N exceeds the actual source count."""
    n = len(sources)
    if n == 0:
        return re.sub(r'\[来源\d+\]', '', answer)
    def _replace(m: re.Match) -> str:
        return m.group(0) if 1 <= int(m.group(1)) <= n else ''
    return re.sub(r'\[来源(\d+)\]', _replace, answer)


def _build_sources(reranked: list[dict]) -> list[dict]:
    sources = []
    seen: set[str] = set()
    for chunk in reranked:
        meta = chunk["metadata"]
        source_type = meta.get("source_type", "document")

        if source_type == "web":
            key = f"web:{meta.get('url', '')}"
            if key not in seen:
                seen.add(key)
                sources.append({
                    "source_type": "web",
                    "filename": meta.get("title", meta.get("url", "")),
                    "url": meta.get("url", ""),
                    "score": round(chunk["score"], 4),
                    "chunk_text": chunk["text"][:200],
                })
            continue

        source = {
            "document_id": meta.get("document_id", ""),
            "filename": meta.get("filename", ""),
            "file_type": meta.get("file_type", ""),
            "chunk_text": chunk["text"][:200],
            "score": round(chunk["score"], 4),
            "source_type": "document",
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
        if meta.get("slide_num") is not None:
            source["slide_num"] = int(meta["slide_num"])

        loc_key = (
            f"{source['document_id']}:"
            f"{source.get('page_num', source.get('paragraph_idx', source.get('slide_num', source.get('row_start', ''))))}"
        )
        if loc_key not in seen:
            seen.add(loc_key)
            sources.append(source)
    return sources


# ---------------------------------------------------------------------------
# Sync pipeline (current default)
# ---------------------------------------------------------------------------

def rag_answer(
    query: str,
    user_id: str,
    session_id: str,
    document_ids: list[str],
    history: list[dict],
    document_metadata: dict[str, dict],
    db: Session,
    use_web_search: bool = False,
) -> dict:
    """Main RAG pipeline (sync). Returns {"answer", "sources", "session_id", "timings"}."""
    timings: dict[str, float] = {}

    t0 = time.perf_counter()
    queries = generate_multi_queries(query, history)
    timings["query_rewrite_s"] = round(time.perf_counter() - t0, 3)
    logger.info(f"[RAG] Multi-queries: {queries}")

    t1 = time.perf_counter()
    raw_chunks = _retrieve_multi_query(queries, document_ids, db)
    timings["retrieve_s"] = round(time.perf_counter() - t1, 3)

    web_chunks: list[dict] = []
    if use_web_search or settings.web_search_enabled:
        t_ws = time.perf_counter()
        web_chunks = _fetch_web_results(query)
        timings["web_search_s"] = round(time.perf_counter() - t_ws, 3)

    all_chunks = raw_chunks + web_chunks
    if not all_chunks:
        return {"answer": "没有可查询的文档内容。", "sources": [], "session_id": session_id, "timings": timings}

    _enrich_metadata(raw_chunks, document_metadata)

    t2 = time.perf_counter()
    reranked = _apply_rerank_and_fusion(queries[0], all_chunks, top_n=5)
    timings["rerank_s"] = round(time.perf_counter() - t2, 3)

    if not is_confident(reranked):
        return {"answer": NOT_FOUND_MESSAGE, "sources": [], "session_id": session_id, "timings": timings}

    sources = _build_sources(reranked)
    user_facts = get_memories(user_id, query)
    messages = build_messages(query, reranked, history, user_facts=user_facts)

    if _cb.is_open():
        return {"answer": "抱歉，AI 服务暂时不可用，请稍后重试。", "sources": [], "session_id": session_id, "timings": timings}

    t3 = time.perf_counter()
    try:
        response = _get_openai().chat.completions.create(
            model="gpt-4o",
            messages=messages,
            stream=False,
            max_tokens=2048,
            temperature=0.3,
        )
        answer = _sanitize_markdown(response.choices[0].message.content or "")
        answer = _validate_citations(answer, sources)
        _cb.success()
    except Exception as e:
        _cb.failure()
        logger.error(f"OpenAI completion failed: {e}")
        return {"answer": "抱歉，AI 服务暂时不可用，请稍后重试。", "sources": [], "session_id": session_id, "timings": timings}
    timings["llm_s"] = round(time.perf_counter() - t3, 3)
    timings["total_s"] = round(time.perf_counter() - t0, 3)

    add_memory(user_id, query, answer)
    return {"answer": answer, "sources": sources, "session_id": session_id, "timings": timings}


def rag_answer_stream(
    query: str,
    user_id: str,
    session_id: str,
    document_ids: list[str],
    history: list[dict],
    document_metadata: dict[str, dict],
    db: Session,
    use_web_search: bool = False,
) -> Generator[dict, None, None]:
    """Streaming RAG pipeline (sync generator).

    Yields: sources → delta* → end  |  error
    """
    timings: dict[str, float] = {}
    t0 = time.perf_counter()

    queries = generate_multi_queries(query, history)
    timings["query_rewrite_s"] = round(time.perf_counter() - t0, 3)
    logger.info(f"[RAG] Multi-queries (stream): {queries}")

    t1 = time.perf_counter()
    raw_chunks = _retrieve_multi_query(queries, document_ids, db)
    timings["retrieve_s"] = round(time.perf_counter() - t1, 3)

    web_chunks: list[dict] = []
    if use_web_search or settings.web_search_enabled:
        t_ws = time.perf_counter()
        web_chunks = _fetch_web_results(query)
        timings["web_search_s"] = round(time.perf_counter() - t_ws, 3)

    all_chunks = raw_chunks + web_chunks
    if not all_chunks:
        yield {"type": "error", "message": "没有可查询的文档内容。"}
        return

    _enrich_metadata(raw_chunks, document_metadata)

    t2 = time.perf_counter()
    reranked = _apply_rerank_and_fusion(queries[0], all_chunks, top_n=5)
    timings["rerank_s"] = round(time.perf_counter() - t2, 3)

    if not is_confident(reranked):
        yield {"type": "error", "message": NOT_FOUND_MESSAGE}
        return

    sources = _build_sources(reranked)
    yield {"type": "sources", "sources": sources, "session_id": session_id, "timings": timings}

    if _cb.is_open():
        yield {"type": "error", "message": "AI 服务暂时不可用，请稍后重试。"}
        return

    user_facts = get_memories(user_id, query)
    messages = build_messages(query, reranked, history, user_facts=user_facts)

    try:
        full_answer = ""
        t3 = time.perf_counter()
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
                sanitized = _sanitize_markdown(delta, streaming=True)
                full_answer += sanitized
                yield {"type": "delta", "content": sanitized}
        timings["llm_stream_s"] = round(time.perf_counter() - t3, 3)
        timings["total_s"] = round(time.perf_counter() - t0, 3)
        _cb.success()
        full_answer = _validate_citations(full_answer, sources)
        add_memory(user_id, query, full_answer)
        yield {"type": "end", "answer": full_answer, "timings": timings}
    except Exception as e:
        _cb.failure()
        logger.error(f"Streaming failed: {e}")
        yield {"type": "error", "message": "AI 服务暂时不可用，请稍后重试。"}


# ---------------------------------------------------------------------------
# Async pipeline — 高并发部署时的升级路径
#
# 激活方式：
#   在 chat.py 的 chat_stream_async endpoint 中已默认使用此函数。
#   如需将 /stream 也切换为 async，将 chat.py 中的 event_stream() 改为
#   async def event_stream() 并使用 rag_answer_stream_async()。
# ---------------------------------------------------------------------------

async def rag_answer_stream_async(
    query: str,
    user_id: str,
    session_id: str,
    document_ids: list[str],
    history: list[dict],
    document_metadata: dict[str, dict],
    db: Session,
    use_web_search: bool = False,
) -> AsyncGenerator[dict, None]:
    """Async streaming RAG pipeline. Uses AsyncOpenAI for true non-blocking token streaming.

    Drop-in replacement for rag_answer_stream in async FastAPI endpoints.
    """
    timings: dict[str, float] = {}
    t0 = time.perf_counter()

    queries = await asyncio.to_thread(generate_multi_queries, query, history)
    timings["query_rewrite_s"] = round(time.perf_counter() - t0, 3)
    logger.info(f"[RAG] Multi-queries (async stream): {queries}")

    t1 = time.perf_counter()
    raw_chunks = await asyncio.to_thread(_retrieve_multi_query, queries, document_ids, db)
    timings["retrieve_s"] = round(time.perf_counter() - t1, 3)

    web_chunks: list[dict] = []
    if use_web_search or settings.web_search_enabled:
        t_ws = time.perf_counter()
        web_chunks = await _fetch_web_results_async(query)
        timings["web_search_s"] = round(time.perf_counter() - t_ws, 3)

    all_chunks = raw_chunks + web_chunks
    if not all_chunks:
        yield {"type": "error", "message": "没有可查询的文档内容。"}
        return

    _enrich_metadata(raw_chunks, document_metadata)

    t2 = time.perf_counter()
    reranked = await asyncio.to_thread(_apply_rerank_and_fusion, queries[0], all_chunks, 5)
    timings["rerank_s"] = round(time.perf_counter() - t2, 3)

    if not is_confident(reranked):
        yield {"type": "error", "message": NOT_FOUND_MESSAGE}
        return

    sources = _build_sources(reranked)
    yield {"type": "sources", "sources": sources, "session_id": session_id, "timings": timings}

    if _cb.is_open():
        yield {"type": "error", "message": "AI 服务暂时不可用，请稍后重试。"}
        return

    user_facts = await asyncio.to_thread(get_memories, user_id, query)
    messages = build_messages(query, reranked, history, user_facts=user_facts)

    try:
        full_answer = ""
        t3 = time.perf_counter()
        stream = await _get_async_openai().chat.completions.create(
            model="gpt-4o",
            messages=messages,
            stream=True,
            max_tokens=2048,
            temperature=0.3,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta.content or ""
            if delta:
                sanitized = _sanitize_markdown(delta, streaming=True)
                full_answer += sanitized
                yield {"type": "delta", "content": sanitized}
        timings["llm_stream_s"] = round(time.perf_counter() - t3, 3)
        timings["total_s"] = round(time.perf_counter() - t0, 3)
        _cb.success()
        full_answer = _validate_citations(full_answer, sources)
        add_memory(user_id, query, full_answer)
        yield {"type": "end", "answer": full_answer, "timings": timings}
    except Exception as e:
        _cb.failure()
        logger.error(f"Async streaming failed: {e}")
        yield {"type": "error", "message": "AI 服务暂时不可用，请稍后重试。"}
