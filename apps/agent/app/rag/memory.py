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
