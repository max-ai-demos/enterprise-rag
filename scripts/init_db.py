# scripts/init_db.py
import sys
import os
import uuid
import bcrypt
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT / "apps" / "agent"))
os.chdir(ROOT / "apps" / "agent")  # pydantic-settings finds .env here

from app.db.models import Base
from app.db.database import engine, SessionLocal
from app.db.models import User

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
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        for username, password, role in USERS:
            exists = db.query(User).filter(User.username == username).first()
            if not exists:
                user = User(
                    id=str(uuid.uuid4()),
                    username=username,
                    password_hash=hash_password(password),
                    role=role,
                )
                db.add(user)
                print(f"Created user: {username}")
            else:
                print(f"User already exists: {username}")
        db.commit()
    finally:
        db.close()
    print("Database ready (MySQL: enterprise_rag)")

if __name__ == "__main__":
    main()
