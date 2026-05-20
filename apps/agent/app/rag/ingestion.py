# apps/agent/app/rag/ingestion.py
import logging
from pathlib import Path
from typing import Any
import chromadb
from llama_index.core import Settings as LlamaSettings
from llama_index.core.node_parser import SentenceSplitter
from llama_index.embeddings.openai import OpenAIEmbedding
from app.infrastructure.config import settings

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1500
CHUNK_OVERLAP = 150

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


def _get_chroma_collection(document_id: str):
    client = chromadb.PersistentClient(path=str(settings.resolved_chroma_dir()))
    collection_name = f"doc_{document_id.replace('-', '_')}"
    return client, client.get_or_create_collection(collection_name)


def parse_document(file_path: str, file_type: str) -> list[dict[str, Any]]:
    """Parse a document into chunks with position metadata."""
    chunks = []

    if file_type == "pdf":
        # PyMuPDF: extract text blocks with bbox, normalize to 0-1000
        # Reference: xxx-ai-agent/_normalize_bbox() + xxx-ai-frontend highlightIndex convention
        import fitz
        doc = fitz.open(file_path)
        chunk_index = 0
        splitter = SentenceSplitter(chunk_size=CHUNK_SIZE, chunk_overlap=CHUNK_OVERLAP)
        for page_num in range(len(doc)):
            page = doc[page_num]
            page_w = page.rect.width
            page_h = page.rect.height
            blocks = page.get_text("blocks")
            for block in blocks:
                x0, y0, x1, y1, text, _block_no, block_type = block
                if block_type != 0 or not text.strip():
                    continue
                norm_bbox = [
                    round(x0 / page_w * 1000),
                    round(y0 / page_h * 1000),
                    round(x1 / page_w * 1000),
                    round(y1 / page_h * 1000),
                ]
                sub_texts = splitter.split_text(text.strip())
                for sub in sub_texts:
                    if sub.strip():
                        chunks.append({
                            "text": sub.strip(),
                            "page_num": page_num + 1,
                            "page_idx": page_num + 1,
                            "bbox": norm_bbox,
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


def ingest_document(document_id: str, file_path: str, file_type: str) -> int:
    """Parse, embed, and store. Returns chunk count."""
    _setup_llama_settings()
    chunks = parse_document(file_path, file_type)
    if not chunks:
        logger.warning(f"No chunks from {file_path}")
        return 0

    client, collection = _get_chroma_collection(document_id)

    ids = [f"{document_id}_{c['chunk_index']}" for c in chunks]
    texts = [c["text"] for c in chunks]
    # Serialize metadata: all values must be strings for ChromaDB
    metadatas = []
    for c in chunks:
        meta = {k: str(v) for k, v in c.items() if k != "text"}
        meta["document_id"] = document_id
        meta["file_type"] = file_type
        metadatas.append(meta)

    embed_model = LlamaSettings.embed_model
    batch_size = 100
    for i in range(0, len(texts), batch_size):
        batch_texts = texts[i:i + batch_size]
        batch_ids = ids[i:i + batch_size]
        batch_metas = metadatas[i:i + batch_size]
        embeddings = embed_model.get_text_embedding_batch(batch_texts)
        collection.upsert(
            ids=batch_ids,
            documents=batch_texts,
            embeddings=embeddings,
            metadatas=batch_metas,
        )

    return len(chunks)


def delete_document_vectors(document_id: str):
    client = chromadb.PersistentClient(path=str(settings.resolved_chroma_dir()))
    collection_name = f"doc_{document_id.replace('-', '_')}"
    try:
        client.delete_collection(collection_name)
    except Exception:
        pass
