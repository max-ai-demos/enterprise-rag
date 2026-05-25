# apps/agent/app/rag/query_rewriter.py
import hashlib
import time
from openai import OpenAI
from app.infrastructure.config import settings

_CACHE: dict[str, tuple[list[str], float]] = {}
_CACHE_TTL = 300  # seconds

_client = None

def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=settings.openai_api_key)
    return _client

def _llm_complete(prompt: str, max_tokens: int = 200) -> str:
    response = _get_client().chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        temperature=0,
    )
    content = response.choices[0].message.content
    return content.strip() if content else ""


def generate_multi_queries(query: str, history: list[dict]) -> list[str]:
    """
    Generate 3 diverse, self-contained retrieval queries.
    Resolves conversation context and expands to multiple phrasings in one LLM call.
    Falls back to [query] on any error. Results are cached for 5 minutes.
    """
    hist_tail = "".join(f"{m['role']}:{m['content'][:40]}" for m in history[-2:])
    cache_key = hashlib.md5((query + hist_tail).encode()).hexdigest()
    cached = _CACHE.get(cache_key)
    if cached and time.time() - cached[1] < _CACHE_TTL:
        return cached[0]

    if history:
        recent = history[-6:]
        history_text = "\n".join(f"{m['role'].capitalize()}: {m['content']}" for m in recent)
        context_section = f"对话历史：\n{history_text}\n\n"
    else:
        context_section = ""

    prompt = f"""{context_section}基于以下用户问题，生成3个用于企业文档检索的独立问题。

要求：
1. 每个问题必须独立完整，不依赖对话历史
2. 使用不同关键词和表述角度，覆盖问题的不同侧面
3. 可中英文混合（有助于跨语言检索）
4. 每行输出一个问题，不加编号或其他符号

用户问题：{query}

输出3个检索问题（每行一个）："""

    try:
        result = _llm_complete(prompt, max_tokens=200)
        queries = [q.strip() for q in result.strip().splitlines() if q.strip()][:3]
        queries = queries if queries else [query]
    except Exception:
        queries = [query]

    _CACHE[cache_key] = (queries, time.time())
    return queries


def rewrite_query(query: str, history: list[dict]) -> str:
    """Backward-compat: return first of the multi-query set."""
    return generate_multi_queries(query, history)[0]
