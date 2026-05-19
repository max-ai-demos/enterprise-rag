#!/usr/bin/env python3
# scripts/seed_demo.py
# Run: cd apps/agent && .venv/bin/python ../../scripts/seed_demo.py
import sys
import os
import sqlite3
import uuid
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "apps" / "agent"))
os.chdir(ROOT / "apps" / "agent")  # pydantic-settings finds .env here

from app.rag.ingestion import ingest_document

DB_PATH = ROOT / "data" / "enterprise_rag.db"
DEMO_DIR = ROOT / "data" / "demo"
SUPPORTED = {"pdf", "docx", "xlsx", "txt"}


def main():
    if not DEMO_DIR.exists():
        print(f"Demo dir not found: {DEMO_DIR}")
        print("Create data/demo/ and add PDF/DOCX/XLSX/TXT files.")
        return

    con = sqlite3.connect(DB_PATH)
    files = sorted(
        f for f in DEMO_DIR.iterdir()
        if f.suffix.lstrip(".").lower() in SUPPORTED
    )
    if not files:
        print("No supported files in data/demo/")
        return

    for f in files:
        file_type = f.suffix.lstrip(".").lower()
        rel_path = f"demo/{f.name}"

        row = con.execute(
            "SELECT id, status FROM documents WHERE file_path = ?", (rel_path,)
        ).fetchone()

        if row and row[1] == "ready":
            print(f"Skip (ready): {f.name}")
            continue

        if row:
            doc_id = row[0]
        else:
            doc_id = str(uuid.uuid4())
            con.execute(
                "INSERT INTO documents (id, user_id, filename, file_path, file_type, status, is_demo) "
                "VALUES (?, NULL, ?, ?, ?, 'pending', 1)",
                (doc_id, f.name, rel_path, file_type),
            )
            con.commit()
            print(f"Registered: {f.name}")

        try:
            count = ingest_document(doc_id, str(f), file_type)
            con.execute(
                "UPDATE documents SET status='ready', chunk_count=? WHERE id=?",
                (count, doc_id),
            )
            con.commit()
            print(f"  ✓ {f.name} → {count} chunks")
        except Exception as e:
            con.execute("UPDATE documents SET status='failed' WHERE id=?", (doc_id,))
            con.commit()
            print(f"  ✗ {f.name}: {e}")

    con.close()


if __name__ == "__main__":
    main()
