#!/usr/bin/env python3
# scripts/reindex.py
# Re-ingest all ready documents with the current chunk size.
# Run: cd apps/agent && .venv/bin/python ../../scripts/reindex.py
import sys
import os
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "apps" / "agent"))
os.chdir(ROOT / "apps" / "agent")

from app.db.database import SessionLocal
from app.db.models import Document
from app.rag.ingestion import ingest_document, delete_document_vectors
from app.infrastructure.config import settings

def main():
    db = SessionLocal()
    try:
        docs = db.query(Document).filter(
            Document.status == "ready",
        ).all()

        if not docs:
            print("No ready documents to re-index.")
            return

        print(f"Re-indexing {len(docs)} documents with CHUNK_SIZE=1500...")
        upload_base = settings.resolved_upload_dir().parent

        for doc in docs:
            full_path = upload_base / doc.file_path
            if not full_path.exists():
                print(f"  x {doc.filename}: file not found at {full_path}")
                continue
            try:
                delete_document_vectors(doc.id)
                count = ingest_document(doc.id, str(full_path), doc.file_type)
                doc.chunk_count = count
                db.commit()
                print(f"  ok {doc.filename} -> {count} chunks")
            except Exception as e:
                print(f"  x {doc.filename}: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    main()
