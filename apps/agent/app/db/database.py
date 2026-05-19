# apps/agent/app/db/database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.infrastructure.config import settings

engine = create_engine(
    f"sqlite:///{settings.resolved_database_path()}",
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
