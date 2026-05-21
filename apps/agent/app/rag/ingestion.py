# apps/agent/app/rag/ingestion.py
import logging
from pathlib import Path
from typing import Any
from sqlalchemy.orm import Session
from llama_index.core import Settings as LlamaSettings
from llama_index.core.node_parser import SentenceSplitter
from llama_index.embeddings.openai import OpenAIEmbedding
from app.infrastructure.config import settings

logger = logging.getLogger(__name__)

CHUNK_SIZE = 600
CHUNK_OVERLAP = 80

_WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _parse_docx_blocks(file_path: str) -> list[dict]:
    """Extract paragraphs and table rows from DOCX in document order."""
    from docx import Document as DocxDocument
    from docx.table import Table as DocxTable

    doc = DocxDocument(file_path)
    blocks = []
    idx = 0

    for child in doc.element.body:
        tag = child.tag
        if tag == f"{_WORD_NS}p":
            text = "".join(child.itertext()).strip()
            if text:
                blocks.append({"text": text, "block_idx": idx, "is_table": False})
                idx += 1
        elif tag == f"{_WORD_NS}tbl":
            tbl = DocxTable(child, doc)
            for row in tbl.rows:
                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                if cells:
                    row_text = " | ".join(cells)
                    blocks.append({"text": row_text, "block_idx": idx, "is_table": True})
                    idx += 1
    return blocks


def _setup_llama_settings():
    LlamaSettings.embed_model = OpenAIEmbedding(
        model="text-embedding-3-small",
        api_key=settings.openai_api_key,
    )


def parse_document(file_path: str, file_type: str) -> list[dict[str, Any]]:
    """Parse a document into chunks with position metadata."""
    chunks = []

    if file_type == "pdf":
        import fitz
        doc = fitz.open(file_path)
        chunk_index = 0
        splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
        for page_num in range(len(doc)):
            page = doc[page_num]
            blocks = page.get_text("blocks")
            page_text_parts = []
            for block in blocks:
                x0, y0, x1, y1, text, _block_no, block_type = block
                if block_type == 0 and text.strip():
                    page_text_parts.append(text.strip())
            page_text = "\n".join(page_text_parts)
            if not page_text.strip():
                continue
            page_bbox = [0, 0, 1000, 1000]
            sub_texts = splitter.split_text(page_text)
            for sub in sub_texts:
                if sub.strip():
                    chunks.append({
                        "text": sub.strip(),
                        "page_num": page_num + 1,
                        "page_idx": page_num + 1,
                        "bbox": page_bbox,
                        "chunk_index": chunk_index,
                    })
                    chunk_index += 1

    elif file_type == "docx":
        splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
        chunk_index = 0
        for block in _parse_docx_blocks(file_path):
            for sub in splitter.split_text(block["text"]):
                if sub.strip():
                    chunks.append({
                        "text": sub.strip(),
                        "paragraph_idx": block["block_idx"],
                        "chunk_index": chunk_index,
                    })
                    chunk_index += 1

    elif file_type == "xlsx":
        from openpyxl import load_workbook
        wb = load_workbook(file_path, read_only=True, data_only=True)
        chunk_index = 0
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            for row_idx, row in enumerate(ws.iter_rows(values_only=True)):
                text = " | ".join(str(c) for c in row if c is not None)
                if text.strip():
                    chunks.append({
                        "text": text.strip(),
                        "sheet_name": sheet_name,
                        "row_start": row_idx + 1,
                        "row_end": row_idx + 1,
                        "chunk_index": chunk_index,
                    })
                    chunk_index += 1

    elif file_type == "txt":
        text = Path(file_path).read_text(encoding="utf-8", errors="ignore")
        splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
        for chunk_index, sub in enumerate(splitter.split_text(text)):
            if sub.strip():
                chunks.append({
                    "text": sub.strip(),
                    "char_offset": 0,
                    "chunk_index": chunk_index,
                })

    return chunks


def ingest_document(document_id: str, file_path: str, file_type: str, db: Session) -> int:
    """Parse, embed, and store chunks in MySQL. Returns chunk count."""
    from app.db.repository import ChunkRepository

    _setup_llama_settings()
    chunks = parse_document(file_path, file_type)
    if not chunks:
        logger.warning(f"No chunks from {file_path}")
        return 0

    chunk_repo = ChunkRepository(db)
    embed_model = LlamaSettings.embed_model
    batch_size = 100

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i:i + batch_size]
        embeddings = embed_model.get_text_embedding_batch([c["text"] for c in batch])
        chunk_repo.upsert_batch(document_id, batch, embeddings, file_type)

    return len(chunks)


def delete_document_vectors(document_id: str, db: Session):
    from app.db.repository import ChunkRepository
    ChunkRepository(db).delete_by_document(document_id)
