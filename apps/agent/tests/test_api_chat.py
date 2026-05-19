# apps/agent/tests/test_api_chat.py
import sqlite3
import pytest
from pathlib import Path
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
    monkeypatch.setenv("CHROMA_DIR", str(tmp_path / "chroma"))
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    db = tmp_path / "test.db"
    sql = (Path(__file__).parent.parent.parent.parent / "scripts" / "init.sql").read_text()
    con = sqlite3.connect(db)
    con.executescript(sql)
    con.commit()
    con.close()
    import importlib
    import app.infrastructure.config as config_mod
    importlib.reload(config_mod)
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
