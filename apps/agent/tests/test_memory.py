# apps/agent/tests/test_memory.py
# memory.py is a stub — Mem0 removed, history comes from MySQL messages table

def test_get_memories_returns_empty():
    from app.rag.memory import get_memories
    assert get_memories("user1", "payment deadline") == []


def test_add_memory_is_noop():
    from app.rag.memory import add_memory
    add_memory("user1", "query", "answer")  # must not raise


def test_get_memories_always_empty_regardless_of_args():
    from app.rag.memory import get_memories
    assert get_memories("any_user", "") == []
    assert get_memories("", "any_query") == []
