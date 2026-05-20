# apps/agent/tests/test_api_chat.py
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_url = f"sqlite:///{tmp_path}/test.db"
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("CHROMA_DIR", str(tmp_path / "chroma"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    import importlib
    import app.infrastructure.config as config_mod
    importlib.reload(config_mod)
    import app.db.database as db_mod
    importlib.reload(db_mod)
    from app.db.models import Base
    from app.db.database import engine
    Base.metadata.create_all(engine)
    from main import app
    return TestClient(app)


def test_chat_message_returns_json(client, monkeypatch):
    def mock_rag_answer(**kwargs):
        return {
            "answer": "Hello",
            "sources": [],
            "session_id": kwargs["session_id"],
        }
    monkeypatch.setattr("app.api.chat.rag_answer", mock_rag_answer)

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
