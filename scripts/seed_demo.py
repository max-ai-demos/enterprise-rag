#!/usr/bin/env python3
# scripts/seed_demo.py
# Run: cd apps/agent && .venv/bin/python ../../scripts/seed_demo.py
import sys
import os
import uuid
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "apps" / "agent"))
os.chdir(ROOT / "apps" / "agent")  # pydantic-settings finds .env here

from app.rag.ingestion import ingest_document
from app.db.database import SessionLocal
from app.db.repository import DocumentRepository

DEMO_DIR = ROOT / "data" / "demo"
SUPPORTED = {"pdf", "docx", "xlsx", "txt"}


def main():
    if not DEMO_DIR.exists():
        print(f"Demo dir not found: {DEMO_DIR}")
        print("Create data/demo/ and add PDF/DOCX/XLSX/TXT files.")
        return

    db = SessionLocal()
    repo = DocumentRepository(db)
    try:
        files = sorted(
            f for f in DEMO_DIR.iterdir()
            if f.suffix[1:].lower() in SUPPORTED
        )
        if not files:
            print("No supported files in data/demo/")
            return

        from app.db.models import Document
        for f in files:
            file_type = f.suffix[1:].lower()
            rel_path = f"demo/{f.name}"

            existing = db.query(Document).filter(Document.file_path == rel_path).first()

            if existing and existing.status == "ready":
                print(f"Skip (ready): {f.name}")
                continue

            if existing:
                doc_id = existing.id
            else:
                doc = repo.create(
                    user_id=None,
                    filename=f.name,
                    file_path=rel_path,
                    file_type=file_type,
                    is_demo=True,
                )
                doc_id = doc.id
                print(f"Registered: {f.name}")

            try:
                count = ingest_document(doc_id, str(f), file_type)
                repo.update_status(doc_id, "ready", count)
                print(f"  ✓ {f.name} → {count} chunks")
            except Exception as e:
                repo.update_status(doc_id, "failed")
                print(f"  ✗ {f.name}: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
