"""
RAG Hybrid Retriever — SQL-level Vector + MySQL FULLTEXT BM25

Why NOT Python-based cosine:
  - Python O(n) cosine over 10k chunks = ~300ms in-process + memory overhead
  - MySQL VEC_DISTANCE_COSINE = native C++ implementation, indexed, 10-50ms
  - Python BM25 reimplements what MySQL FULLTEXT already does (ngram for Chinese)

Architecture:
  1. MySQL VEC_DISTANCE_COSINE → top-K by vector similarity
  2. MySQL FULLTEXT MATCH...AGAINST → top-K by BM25 keyword score
  3. RRF fusion (k=60) → merged ranked list
  4. Returns dicts compatible with existing pipeline interface
"""
from __future__ import annotations
import json
import logging
import math
from collections import defaultdict
from typing import Any
from sqlalchemy.orm import Session
from sqlalchemy import text, bindparam
from llama_index.embeddings.openai import OpenAIEmbedding
from app.infrastructure.config import settings

logger = logging.getLogger(__name__)

_embed_model = None


def _get_embed_model() -> OpenAIEmbedding:
    global _embed_model
    if _embed_model is None:
        _embed_model = OpenAIEmbedding(
            model=settings.embedding_model,
            api_key=settings.openai_api_key,
        )
    return _embed_model


def _embed_query(query: str) -> list[float]:
    return _get_embed_model().get_query_embedding(query)


def _reciprocal_rank_fusion(
    ranked_lists: list[list[str]], k: int = 60, weights: list[float] | None = None
) -> dict[str, float]:
    if weights is None:
        weights = [1.0] * len(ranked_lists)
    scores: dict[str, float] = defaultdict(float)
    for ranked, weight in zip(ranked_lists, weights):
        for rank, doc_id in enumerate(ranked, start=1):
            scores[doc_id] += weight / (k + rank)
    return scores


def _safe_bm25_query(query: str) -> str:
    """Sanitize query for MySQL FULLTEXT BOOLEAN MODE to avoid syntax errors."""
    import re
    # Remove special FULLTEXT operators that can cause syntax errors
    return re.sub(r'[+\-><()~*"@]', ' ', query).strip()


class HybridRetriever:
    """
    SQL-level hybrid retriever: VEC_DISTANCE_COSINE + MySQL FULLTEXT ngram BM25.
    Falls back to vector-only if FULLTEXT index is unavailable.
    """

    def __init__(self, db: Session, document_id: str):
        self.db = db
        self.document_id = document_id

    def _vector_search(self, query_vec: list[float], top_k: int) -> list[dict]:
        stmt = text("""
            SELECT
                id,
                text,
                page_num,
                page_idx,
                bbox,
                paragraph_idx,
                sheet_name,
                row_start,
                file_type,
                1.0 - VEC_DISTANCE_COSINE(embedding, VEC_FromText(:qvec)) AS cosine_score
            FROM document_chunks
            WHERE document_id = :doc_id
            ORDER BY cosine_score DESC
            LIMIT :top_k
        """)
        rows = self.db.execute(stmt, {
            "qvec": json.dumps(query_vec),
            "doc_id": self.document_id,
            "top_k": top_k,
        }).fetchall()

        return [
            {
                "id": r.id,
                "text": r.text,
                "cosine_score": float(r.cosine_score or 0),
                "metadata": {
                    "page_num": r.page_num,
                    "page_idx": r.page_idx,
                    "bbox": r.bbox,
                    "paragraph_idx": r.paragraph_idx,
                    "sheet_name": r.sheet_name,
                    "row_start": r.row_start,
                    "file_type": r.file_type,
                    "cosine_score": float(r.cosine_score or 0),
                },
            }
            for r in rows
        ]

    def _bm25_search(self, query: str, top_k: int) -> list[dict]:
        safe_q = _safe_bm25_query(query)
        if not safe_q:
            return []
        try:
            stmt = text("""
                SELECT
                    id,
                    text,
                    page_num,
                    page_idx,
                    bbox,
                    paragraph_idx,
                    sheet_name,
                    row_start,
                    file_type,
                    MATCH(text) AGAINST (:q IN NATURAL LANGUAGE MODE) AS bm25_score
                FROM document_chunks
                WHERE document_id = :doc_id
                  AND MATCH(text) AGAINST (:q IN NATURAL LANGUAGE MODE)
                ORDER BY bm25_score DESC
                LIMIT :top_k
            """)
            rows = self.db.execute(stmt, {
                "q": safe_q,
                "doc_id": self.document_id,
                "top_k": top_k,
            }).fetchall()

            return [
                {
                    "id": r.id,
                    "text": r.text,
                    "cosine_score": 0.0,
                    "bm25_score": float(r.bm25_score or 0),
                    "metadata": {
                        "page_num": r.page_num,
                        "page_idx": r.page_idx,
                        "bbox": r.bbox,
                        "paragraph_idx": r.paragraph_idx,
                        "sheet_name": r.sheet_name,
                        "row_start": r.row_start,
                        "file_type": r.file_type,
                        "cosine_score": 0.0,
                    },
                }
                for r in rows
            ]
        except Exception:
            logger.warning("BM25 search failed (FULLTEXT index?), skipping", exc_info=True)
            return []

    def retrieve(self, query: str, top_k: int = 15) -> list[dict[str, Any]]:
        """
        SQL-level hybrid retrieval with RRF fusion.
        Returns chunks sorted by RRF score, with cosine_score in metadata.
        """
        query_vec = _embed_query(query)

        vector_results = self._vector_search(query_vec, top_k=top_k)
        bm25_results = self._bm25_search(query, top_k=top_k * 2)

        # Build ID→doc map and RRF
        all_docs: dict[str, dict] = {}
        for r in vector_results + bm25_results:
            if r["id"] not in all_docs:
                all_docs[r["id"]] = r

        vector_ids = [r["id"] for r in vector_results]
        bm25_ids = [r["id"] for r in bm25_results]

        rrf_scores = _reciprocal_rank_fusion(
            [vector_ids, bm25_ids],
            weights=[0.6, 0.4],   # vector slightly preferred
        )

        ranked_ids = sorted(rrf_scores.keys(), key=rrf_scores.get, reverse=True)[:top_k]

        return [
            {
                "id": chunk_id,
                "text": all_docs[chunk_id]["text"],
                "score": rrf_scores[chunk_id],
                "metadata": {
                    **all_docs[chunk_id]["metadata"],
                    "cosine_score": round(all_docs[chunk_id].get("cosine_score", 0), 4),
                },
            }
            for chunk_id in ranked_ids
            if chunk_id in all_docs
        ]
