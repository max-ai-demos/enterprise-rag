# apps/agent/app/rag/reranker.py
import json
import logging
import re
from openai import OpenAI
from app.infrastructure.config import settings

logger = logging.getLogger(__name__)
_client = None

def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=settings.openai_api_key)
    return _client

def rerank(query: str, chunks: list[dict], top_n: int = 5) -> list[dict]:
    """LLM-based reranking: score each chunk's relevance to the query."""
    if not chunks:
        return []
    if len(chunks) <= top_n:
        return chunks

    # Build scoring prompt
    chunk_texts = "\n\n".join(
        f"[{i}] {c['text'][:300]}" for i, c in enumerate(chunks)
    )
    prompt = f"""Rate how relevant each passage is to the question on a scale 0-10.
Return ONLY a JSON array of scores, one per passage, in order.
Example: [8, 3, 7, 1, 5]

Question: {query}

Passages:
{chunk_texts}

Scores:"""

    try:
        response = _get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=100,
            temperature=0,
        )
        scores_text = response.choices[0].message.content or ""
        match = re.search(r"\[[\d,\s\.]+\]", scores_text)
        if match:
            scores = json.loads(match.group())
            scored = list(zip(scores, chunks))
            scored.sort(key=lambda x: x[0], reverse=True)
            return [c for _, c in scored[:top_n]]
    except Exception as e:
        logger.warning(f"Reranking failed, using fallback: {e}")

    # Fallback: return top_n by original score
    return chunks[:top_n]
