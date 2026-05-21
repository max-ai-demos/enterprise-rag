# apps/agent/app/rag/hybrid_retriever.py
from __future__ import annotations
import math
import re
from collections import defaultdict
from typing import Any
from sqlalchemy.orm import Session
from llama_index.embeddings.openai import OpenAIEmbedding
from app.infrastructure.config import settings

_embed_model = None

def _get_embed_model() -> OpenAIEmbedding:
    global _embed_model
    if _embed_model is None:
        _embed_model = OpenAIEmbedding(
            model="text-embedding-3-small",
            api_key=settings.openai_api_key,
        )
    return _embed_model

def _embed_query(query: str) -> list[float]:
    return _get_embed_model().get_query_embedding(query)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def _tokenize(text: str) -> list[str]:
    return re.findall(r"\b\w+\b", text.lower())


def _bm25_scores(query: str, documents: list[str],
                 k1: float = 1.5, b: float = 0.75) -> list[float]:
    """Lightweight BM25 scoring over a list of documents."""
    query_terms = _tokenize(query)
    tokenized_docs = [_tokenize(d) for d in documents]
    avg_dl = sum(len(d) for d in tokenized_docs) / max(len(tokenized_docs), 1)
    N = len(tokenized_docs)

    scores = []
    for doc_tokens in tokenized_docs:
        score = 0.0
        dl = len(doc_tokens)
        for term in query_terms:
            tf = doc_tokens.count(term)
            df = sum(1 for d in tokenized_docs if term in d)
            if df == 0:
                continue
            idf = math.log((N - df + 0.5) / (df + 0.5) + 1)
            tf_norm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avg_dl))
            score += idf * tf_norm
        scores.append(score)
    return scores


def _reciprocal_rank_fusion(
    ranked_lists: list[list[str]], k: int = 60
) -> dict[str, float]:
    """Merge multiple ranked lists using Reciprocal Rank Fusion."""
    scores: dict[str, float] = defaultdict(float)
    for ranked in ranked_lists:
        for rank, doc_id in enumerate(ranked, start=1):
            scores[doc_id] += 1.0 / (k + rank)
    return scores


class HybridRetriever:
    def __init__(self, db: Session, document_id: str):
        self.db = db
        self.document_id = document_id

    def retrieve(self, query: str, top_k: int = 15) -> list[dict[str, Any]]:
        """Vector + BM25 hybrid retrieval with RRF fusion. Cosine computed in Python."""
        from app.db.repository import ChunkRepository

        all_chunks = ChunkRepository(self.db).get_all_for_document(self.document_id)
        if not all_chunks:
            return []

        ids = [c["id"] for c in all_chunks]
        documents = [c["text"] for c in all_chunks]
        id_to_doc = {c["id"]: c["text"] for c in all_chunks}
        id_to_meta = {c["id"]: c["metadata"] for c in all_chunks}
        embeddings = [c["embedding"] for c in all_chunks]

        # --- Vector retrieval (cosine in Python) ---
        query_emb = _embed_query(query)
        cos_sims = [_cosine_similarity(query_emb, emb) for emb in embeddings]
        vector_ranked = [
            ids[i] for i in sorted(range(len(ids)),
                                   key=lambda x: cos_sims[x], reverse=True)
        ][:top_k]

        # --- BM25 retrieval ---
        bm25_scores = _bm25_scores(query, documents)
        bm25_ranked = [
            ids[i] for i in sorted(range(len(ids)),
                                   key=lambda x: bm25_scores[x], reverse=True)
        ][:top_k]

        # --- RRF fusion ---
        fused_scores = _reciprocal_rank_fusion([vector_ranked, bm25_ranked])
        top_ids = sorted(fused_scores, key=fused_scores.get, reverse=True)[:top_k]

        return [
            {
                "id": chunk_id,
                "text": id_to_doc[chunk_id],
                "score": fused_scores[chunk_id],
                "metadata": id_to_meta.get(chunk_id, {}),
            }
            for chunk_id in top_ids
            if chunk_id in id_to_doc
        ]
