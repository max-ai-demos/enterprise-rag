# apps/agent/app/rag/query_rewriter.py
from openai import OpenAI
from app.infrastructure.config import settings

_client = None

def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=settings.openai_api_key)
    return _client

def _llm_complete(prompt: str) -> str:
    response = _get_client().chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=150,
        temperature=0,
    )
    return response.choices[0].message.content.strip()

def rewrite_query(query: str, history: list[dict]) -> str:
    """Rewrite query to be self-contained using recent conversation history."""
    if not history:
        return query

    recent = history[-6:]  # last 3 turns
    history_text = "\n".join(
        f"{m['role'].capitalize()}: {m['content']}" for m in recent
    )
    prompt = f"""Given this conversation history:
{history_text}

Rewrite the following question to be fully self-contained and unambiguous,
preserving the user's intent. Output ONLY the rewritten question, nothing else.

Original question: {query}
Rewritten question:"""

    try:
        return _llm_complete(prompt)
    except Exception:
        return query  # fallback to original on error
