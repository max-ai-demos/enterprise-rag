"""Re-ingest all ready documents with the new chunk size.

Run from apps/agent/:
    python reingest_all.py
"""
import sys
import os
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text
from app.db.database import SessionLocal, create_chunks_table
from app.db.repository import DocumentRepository, ChunkRepository
from app.rag.ingestion import ingest_document, delete_document_vectors

DATA_DIR = Path(__file__).parent.parent.parent / "data"

create_chunks_table()

db = SessionLocal()
try:
    doc_repo = DocumentRepository(db)
    rows = db.execute(
        text("SELECT id, filename, file_path, file_type FROM documents WHERE status = 'ready'")
    ).fetchall()

    print(f"Found {len(rows)} ready documents (data dir: {DATA_DIR})")
    for doc_id, filename, rel_path, file_type in rows:
        abs_path = DATA_DIR / rel_path if rel_path else None
        if not abs_path or not abs_path.exists():
            print(f"  SKIP {filename} — not found at {abs_path}")
            continue
        print(f"  Re-ingesting {filename} ({file_type}) ...", end="", flush=True)
        delete_document_vectors(doc_id, db)
        count = ingest_document(doc_id, str(abs_path), file_type, db)
        doc_repo.update_status(doc_id, "ready", chunk_count=count)
        print(f" {count} chunks")

    print("Done.")
finally:
    db.close()
