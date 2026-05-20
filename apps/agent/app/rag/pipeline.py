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
    except Exception as e:
        logger.debug("Collection not found for %s: %s", document_id, e)
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


def _build_sources(reranked: list[dict]) -> list[dict]:
    """Extract source metadata from reranked chunks, deduplicating by location."""
    sources = []
    seen: set[str] = set()
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
                except Exception as e:
                    logger.debug("Could not parse bbox %r: %s", bbox_raw, e)
        if meta.get("paragraph_idx") is not None:
            source["paragraph_idx"] = int(meta["paragraph_idx"])
        if meta.get("sheet_name"):
            source["sheet_name"] = meta["sheet_name"]
            source["row_start"] = int(meta.get("row_start", 1))
        # Deduplicate by document + location key
        loc_key = f"{source['document_id']}:{source.get('page_num', source.get('paragraph_idx', source.get('row_start', '')))}"
        if loc_key not in seen:
            seen.add(loc_key)
            sources.append(source)
    return sources


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
    {"answer": str, "sources": [...], "session_id": str}
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
    sources = _build_sources(reranked)

    # Step 6: Build prompt and call OpenAI
    messages = build_messages(query, reranked, history)

    try:
        response = _get_openai().chat.completions.create(
            model="gpt-4o",
            messages=messages,
            stream=False,
            max_tokens=2048,
            temperature=0.3,
        )
        answer = response.choices[0].message.content or ""
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

    messages = build_messages(query, reranked, history)

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
        yield {"type": "end", "answer": full_answer}
    except Exception as e:
        logger.error(f"Streaming failed: {e}")
        yield {"type": "error", "message": "AI 服务暂时不可用，请稍后重试。"}
