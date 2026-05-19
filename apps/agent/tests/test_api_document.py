# apps/agent/tests/test_api_document.py
import io
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
    # Initialize database
    db = tmp_path / "test.db"
    sql = (Path(__file__).parent.parent.parent.parent / "scripts" / "init.sql").read_text()
    con = sqlite3.connect(db)
    con.executescript(sql)
    con.commit()
    con.close()
    # Import after env setup so settings loads correctly
    import importlib
    import app.infrastructure.config as config_mod
    importlib.reload(config_mod)
    from main import app
    return TestClient(app)


def test_upload_document(client, monkeypatch):
    monkeypatch.setattr("app.api.document.ingest_document", lambda *a, **k: 5)
    resp = client.post(
        "/documents/upload",
        files={"file": ("test.txt", io.BytesIO(b"Hello world content"), "text/plain")},
        data={"user_id": "test-user"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["filename"] == "test.txt"
    assert body["status"] == "processing"


def test_list_documents(client):
    resp = client.get("/documents?user_id=test-user")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_list_demo_documents(client):
    resp = client.get("/documents/demo")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
