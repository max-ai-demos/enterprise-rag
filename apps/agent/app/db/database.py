# apps/agent/app/db/database.py
import logging
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from app.infrastructure.config import settings

logger = logging.getLogger(__name__)

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_chunks_table():
    """Create document_chunks table with MySQL VECTOR(1536) column if it doesn't exist."""
    try:
        with engine.connect() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS document_chunks (
                    id VARCHAR(255) NOT NULL PRIMARY KEY,
                    document_id VARCHAR(36) NOT NULL,
                    chunk_index INT NOT NULL,
                    text MEDIUMTEXT NOT NULL,
                    embedding VECTOR(1536) NOT NULL,
                    page_num INT DEFAULT NULL,
                    page_idx INT DEFAULT NULL,
                    bbox TEXT DEFAULT NULL,
                    paragraph_idx INT DEFAULT NULL,
                    sheet_name VARCHAR(255) DEFAULT NULL,
                    row_start INT DEFAULT NULL,
                    file_type VARCHAR(50) DEFAULT NULL,
                    INDEX idx_document_id (document_id)
                )
            """))
            conn.commit()
        logger.info("document_chunks table ready")
    except Exception as e:
        logger.warning("Could not create document_chunks table (requires MySQL 9.0+): %s", e)
