# apps/agent/app/rag/summarizer.py
import logging
from openai import OpenAI
from app.infrastructure.config import settings

logger = logging.getLogger(__name__)

MAX_CHARS_PER_CALL = 12000  # ~3000 tokens per call, safe slice

_DIRECT_PROMPT = """你是企业知识库助手。请对以下文档内容生成简洁、结构化的中文摘要。

要求：
1. 摘要长度：200-400字
2. 先写一句总述，再分点列出关键信息
3. 保留重要数字、日期、名称等关键信息
4. 使用客观、专业的语言

文档内容：
{content}

摘要："""

_MAP_PROMPT = """请对以下文档片段生成简短摘要（100字以内）：

{content}

摘要："""

_REDUCE_PROMPT = """以下是一份长文档各片段的摘要，请整合成一份完整摘要（200-400字）：

{summaries}

完整摘要："""


def _client() -> OpenAI:
    return OpenAI(api_key=settings.openai_api_key)


def summarize_document(full_text: str) -> str:
    """Summarize document text. Uses Map-Reduce for documents longer than MAX_CHARS_PER_CALL."""
    if not full_text.strip():
        return ""

    if len(full_text) <= MAX_CHARS_PER_CALL:
        resp = _client().chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": _DIRECT_PROMPT.format(content=full_text)}],
            max_tokens=800,
            temperature=0.3,
        )
        return resp.choices[0].message.content or ""

    # Map: summarize each chunk with cheap model
    chunks = [full_text[i:i + MAX_CHARS_PER_CALL] for i in range(0, len(full_text), MAX_CHARS_PER_CALL)]
    partial = []
    for chunk in chunks:
        resp = _client().chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": _MAP_PROMPT.format(content=chunk)}],
            max_tokens=300,
            temperature=0.3,
        )
        partial.append(resp.choices[0].message.content or "")

    # Reduce: merge partial summaries into one
    combined = "\n\n".join(f"[第{i+1}部分]\n{s}" for i, s in enumerate(partial))
    resp = _client().chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": _REDUCE_PROMPT.format(summaries=combined)}],
        max_tokens=800,
        temperature=0.3,
    )
    return resp.choices[0].message.content or ""


def get_document_full_text(file_path: str, file_type: str) -> str:
    """Extract full plain text from a document file (reuses ingestion parser)."""
    from app.rag.ingestion import parse_document
    chunks = parse_document(file_path, file_type)
    return "\n\n".join(c["text"] for c in chunks)
