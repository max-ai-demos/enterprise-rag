"""
Session key-facts memory — MySQL-backed.

Extracts 0-2 user facts per turn using gpt-4o-mini, stored in user_key_facts.
Retrieved facts are injected into the next system prompt.

Design:
- No embedding search: facts are short strings, per-user FIFO retrieval suffices
- Max 30 facts per user (oldest trimmed on insert)
- LLM extraction is non-blocking (background thread) — never blocks response
- Any failure → silent no-op; memory is enhancement, not critical path
"""
from __future__ import annotations
import json
import logging
import re
import threading

from sqlalchemy import text

from app.db.database import engine

logger = logging.getLogger(__name__)

_EXTRACT_PROMPT = """Extract 0 to 2 key facts about the USER from this conversation turn.
Only extract facts explicitly stated by the user about themselves or their context.

Good facts (reusable in future conversations):
- "用户负责采购部门" (from: "我是采购部门的")
- "用户公司名为XX科技" (from: "我们公司XX科技...")

Do NOT extract:
- Questions the user asked
- Document content or system information
- Anything not explicitly stated by the user about themselves

User query: {query}
Assistant answer preview: {answer_preview}

Output JSON only: {{"facts": ["fact1", "fact2"]}} or {{"facts": []}}"""

_MAX_FACTS_PER_USER = 30
_client = None


def _get_client():
    global _client
    if _client is None:
        from openai import OpenAI
        from app.infrastructure.config import settings
        _client = OpenAI(api_key=settings.openai_api_key)
    return _client


def _extract_and_store(user_id: str, query: str, answer: str) -> None:
    try:
        resp = _get_client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": _EXTRACT_PROMPT.format(
                query=query[:500],
                answer_preview=answer[:300],
            )}],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=150,
        )
        raw = resp.choices[0].message.content or "{}"
        facts = json.loads(raw).get("facts", [])
        if not facts:
            return

        with engine.connect() as conn:
            for fact in facts[:2]:
                if not fact or len(fact) > 300:
                    continue
                conn.execute(text(
                    "INSERT INTO user_key_facts (user_id, fact) VALUES (:uid, :fact)"
                ), {"uid": user_id, "fact": str(fact)})

            # Trim oldest beyond the per-user cap
            conn.execute(text("""
                DELETE FROM user_key_facts
                WHERE user_id = :uid
                  AND id NOT IN (
                    SELECT id FROM (
                      SELECT id FROM user_key_facts
                      WHERE user_id = :uid
                      ORDER BY created_at DESC
                      LIMIT :cap
                    ) AS t
                  )
            """), {"uid": user_id, "cap": _MAX_FACTS_PER_USER})
            conn.commit()

    except Exception:
        logger.debug("Memory extraction failed (non-fatal)", exc_info=True)


def add_memory(user_id: str, query: str, answer: str) -> None:
    """Fire-and-forget: extract facts in background thread, never blocks."""
    if not user_id:
        return
    threading.Thread(
        target=_extract_and_store,
        args=(user_id, query, answer),
        daemon=True,
    ).start()


def _relevance_score(fact: str, query: str) -> int:
    """Keyword overlap count — includes Chinese characters and ASCII words."""
    q_tokens = set(re.findall(r'[\w一-鿿]+', query.lower()))
    f_tokens = set(re.findall(r'[\w一-鿿]+', fact.lower()))
    return len(q_tokens & f_tokens)


def get_memories(user_id: str, query: str) -> list[str]:
    """Return up to 5 most-relevant facts for this user, or 3 most-recent if no overlap."""
    if not user_id:
        return []
    try:
        with engine.connect() as conn:
            rows = conn.execute(text(
                "SELECT fact FROM user_key_facts "
                "WHERE user_id = :uid ORDER BY created_at DESC LIMIT 20"
            ), {"uid": user_id}).fetchall()
        facts = [r.fact for r in rows]
        scored = [(f, _relevance_score(f, query)) for f in facts]
        relevant = sorted([(f, s) for f, s in scored if s > 0], key=lambda x: x[1], reverse=True)
        return [f for f, _ in relevant[:5]] if relevant else [f for f, _ in scored[:3]]
    except Exception:
        logger.debug("Memory retrieval failed (non-fatal)", exc_info=True)
        return []
