"""
RAG Reranker — Jina Reranker v2 (Cross-encoder, NOT LLM scoring)

Why NOT LLM-based reranking:
  - LLM scoring costs ~$0.005/query vs Jina $0.0001 (50x cheaper)
  - LLM adds 2-4s latency vs cross-encoder ~150ms
  - LLM has position bias (prefers earlier chunks in the prompt)
  - Cross-encoder is trained specifically for semantic similarity ranking

Jina Reranker v2:
  - Multilingual (supports Chinese + English mixed)
  - Free: 1M tokens/month
  - API: POST https://api.jina.ai/v1/rerank
  - Falls back to RRF-score order if API key not configured

Set JINA_API_KEY in .env to enable. Without it: graceful fallback.
"""
import logging
import time
import httpx
from app.infrastructure.config import settings

logger = logging.getLogger(__name__)

_JINA_URL = "https://api.jina.ai/v1/rerank"
_TIMEOUT = httpx.Timeout(12.0)

# Lightweight circuit breaker: 3 failures → 120s cooldown
_failures = 0
_opened_at: float | None = None
_THRESHOLD = 3
_COOLDOWN = 120.0


def _is_open() -> bool:
    global _failures, _opened_at
    if _opened_at and time.time() - _opened_at > _COOLDOWN:
        _failures = 0
        _opened_at = None
    return _opened_at is not None


def _on_failure() -> None:
    global _failures, _opened_at
    _failures += 1
    if _failures >= _THRESHOLD:
        _opened_at = time.time()
        logger.warning("[reranker_circuit] OPEN — Jina suspended for 120s")


def _on_success() -> None:
    global _failures, _opened_at
    _failures = 0
    _opened_at = None


def rerank(query: str, chunks: list[dict], top_n: int = 5) -> list[dict]:
    """
    Rerank chunks using Jina cross-encoder. Synchronous version for sync pipeline.
    Falls back to score-order if no API key.
    """
    if not chunks:
        return []
    if len(chunks) <= top_n and not settings.jina_api_key:
        return chunks

    if not settings.jina_api_key or _is_open():
        if _is_open():
            logger.debug("Reranker circuit open — using score-order fallback")
        else:
            logger.debug("No JINA_API_KEY — using score-order fallback")
        return sorted(chunks, key=lambda c: c.get("score", 0), reverse=True)[:top_n]

    texts = [c["text"][:512] for c in chunks]  # Jina max input per doc

    try:
        resp = httpx.post(
            _JINA_URL,
            headers={
                "Authorization": f"Bearer {settings.jina_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": "jina-reranker-v2-base-multilingual",
                "query": query,
                "documents": texts,
                "top_n": top_n,
            },
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        results = resp.json()["results"]

        reranked = [{**chunks[r["index"]], "score": r["relevance_score"]} for r in results]
        _on_success()
        logger.debug(
            "Reranked %d→%d chunks, top_score=%.3f",
            len(chunks), len(reranked),
            reranked[0]["score"] if reranked else 0,
        )
        return reranked

    except httpx.HTTPStatusError as exc:
        logger.warning("Jina reranker HTTP %d — falling back to score order", exc.response.status_code)
        _on_failure()
    except Exception:
        logger.warning("Jina reranker failed — falling back to score order", exc_info=True)
        _on_failure()

    return sorted(chunks, key=lambda c: c.get("score", 0), reverse=True)[:top_n]


async def rerank_async(query: str, chunks: list[dict], top_n: int = 5) -> list[dict]:
    """Async version for async pipeline (rag_answer_stream_async)."""
    if not chunks:
        return []
    if not settings.jina_api_key or _is_open():
        return sorted(chunks, key=lambda c: c.get("score", 0), reverse=True)[:top_n]

    texts = [c["text"][:512] for c in chunks]

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                _JINA_URL,
                headers={
                    "Authorization": f"Bearer {settings.jina_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "jina-reranker-v2-base-multilingual",
                    "query": query,
                    "documents": texts,
                    "top_n": top_n,
                },
            )
            resp.raise_for_status()
            results = resp.json()["results"]

        reranked = [{**chunks[r["index"]], "score": r["relevance_score"]} for r in results]
        _on_success()
        return reranked

    except Exception:
        logger.warning("Async Jina reranker failed — falling back", exc_info=True)
        _on_failure()

    return sorted(chunks, key=lambda c: c.get("score", 0), reverse=True)[:top_n]
