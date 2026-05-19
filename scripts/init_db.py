# scripts/init_db.py
import sqlite3
import uuid
import bcrypt
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "enterprise_rag.db"
SQL_PATH = Path(__file__).parent / "init.sql"

USERS = [
    ("admin",  "Admin@2026",  "admin"),
    ("demo1",  "Demo@2026",   "user"),
    ("demo2",  "Demo@2026",   "user"),
    ("demo3",  "Demo@2026",   "user"),
    ("demo4",  "Demo@2026",   "user"),
]

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def main():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.executescript(SQL_PATH.read_text())
    for username, password, role in USERS:
        exists = con.execute(
            "SELECT 1 FROM users WHERE username = ?", (username,)
        ).fetchone()
        if not exists:
            con.execute(
                "INSERT INTO users (id, username, password_hash, role) VALUES (?,?,?,?)",
                (str(uuid.uuid4()), username, hash_password(password), role),
            )
            print(f"Created user: {username}")
        else:
            print(f"User already exists: {username}")
    con.commit()
    con.close()
    print(f"Database ready at {DB_PATH}")

if __name__ == "__main__":
    main()
