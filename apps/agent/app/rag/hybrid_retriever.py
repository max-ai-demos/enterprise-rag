# apps/agent/app/rag/hybrid_retriever.py
import math
import re
from collections import defaultdict
from typing import Any
import chromadb
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
    def __init__(self, collection: chromadb.Collection):
        self.collection = collection

    def retrieve(self, query: str, top_k: int = 15) -> list[dict[str, Any]]:
        """Vector + BM25 hybrid retrieval with RRF fusion."""
        # Fetch all docs from collection for BM25
        all_results = self.collection.get(
            include=["documents", "metadatas", "embeddings"]
        )
        if not all_results["ids"]:
            return []

        ids = all_results["ids"]
        documents = all_results.get("documents") or [""] * len(ids)
        metadatas = all_results.get("metadatas") or [{}] * len(ids)

        # --- Vector retrieval ---
        query_emb = _embed_query(query)
        vector_results = self.collection.query(
            query_embeddings=[query_emb],
            n_results=min(top_k, len(ids)),
            include=["distances", "metadatas", "documents"],
        )
        vector_ranked = vector_results["ids"][0]

        # --- BM25 retrieval ---
        bm25_scores = _bm25_scores(query, documents)
        bm25_ranked = [
            ids[i] for i in sorted(range(len(ids)),
                                   key=lambda x: bm25_scores[x], reverse=True)
        ][:top_k]

        # --- RRF fusion ---
        fused_scores = _reciprocal_rank_fusion([vector_ranked, bm25_ranked])
        top_ids = sorted(fused_scores, key=fused_scores.get, reverse=True)[:top_k]

        # Build result list
        id_to_doc = dict(zip(ids, documents))
        id_to_meta = dict(zip(ids, metadatas))
        results = []
        for doc_id in top_ids:
            if doc_id in id_to_doc:
                results.append({
                    "id": doc_id,
                    "text": id_to_doc[doc_id],
                    "score": fused_scores[doc_id],
                    "metadata": id_to_meta.get(doc_id, {}),
                })
        return results
