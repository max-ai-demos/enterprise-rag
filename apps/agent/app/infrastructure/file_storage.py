# apps/agent/app/infrastructure/file_storage.py
import uuid
from pathlib import Path
from app.infrastructure.config import settings

def save_upload(file_bytes: bytes, filename: str, user_id: str) -> tuple[str, int]:
    """Save uploaded file. Returns (relative_path, file_size)."""
    upload_dir = settings.resolved_upload_dir() / user_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_id = str(uuid.uuid4())
    ext = Path(filename).suffix
    dest = upload_dir / f"{file_id}{ext}"
    dest.write_bytes(file_bytes)
    rel = str(dest.relative_to(settings.resolved_upload_dir().parent))
    return rel, len(file_bytes)

def delete_file(file_path: str):
    base = settings.resolved_upload_dir().parent
    full = base / file_path
    if full.exists():
        full.unlink()

def resolve_path(file_path: str) -> Path:
    base = settings.resolved_upload_dir().parent
    return base / file_path
