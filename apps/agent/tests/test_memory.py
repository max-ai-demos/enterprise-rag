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
