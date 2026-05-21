# apps/agent/tests/test_api_document.py
import io
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_url = f"sqlite:///{tmp_path}/test.db"
    monkeypatch.setenv("DATABASE_URL", db_url)
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path / "uploads"))
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
