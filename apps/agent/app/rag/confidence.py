# apps/agent/app/rag/confidence.py
from app.infrastructure.config import settings

NOT_FOUND_MESSAGE = "抱歉，在现有文档中未找到与该问题相关的内容。请尝试换一种方式提问，或上传包含相关信息的文档。"

def is_confident(chunks: list[dict]) -> bool:
    """Return True if top chunk score exceeds threshold."""
    if not chunks:
        return False
    top_score = chunks[0].get("score", 0)
    return top_score >= settings.rerank_score_threshold
