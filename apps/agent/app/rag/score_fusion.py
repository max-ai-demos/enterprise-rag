"""
Score Fusion — 将 reranker 分数与向量检索 cosine score 按权重融合。

激活方式：在 .env 中设置 RERANKER_ALPHA=<0.0~1.0>
  - alpha=1.0（默认）：纯 reranker 分数，等同于不融合
  - alpha=0.0：纯向量 cosine 分数
  - alpha=0.7：推荐值，reranker 主导 + cosine 辅助

chunk 格式要求：
  - chunk["score"]              : reranker 打分（0~1）
  - chunk["metadata"]["cosine_score"]: HybridRetriever 存入的余弦相似度
"""
from __future__ import annotations
from typing import List


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, x))


def apply_score_fusion(chunks: List[dict], *, alpha: float) -> List[dict]:
    """Blend reranker score and cosine_score, sort by fused result.

    alpha=1.0 → pure reranker (no-op), alpha=0.0 → pure cosine.
    Writes fused_score into chunk["metadata"] for observability.
    """
    alpha = _clamp01(float(alpha))
    if alpha >= 1.0 or not chunks:
        return chunks

    cosines = []
    for c in chunks:
        raw = (c.get("metadata") or {}).get("cosine_score")
        try:
            cosines.append(float(raw) if raw is not None else 0.0)
        except Exception:
            cosines.append(0.0)

    cmin, cmax = min(cosines), max(cosines)
    span = (cmax - cmin) if (cmax - cmin) > 1e-9 else 1.0

    result = []
    for c, cosine_raw in zip(chunks, cosines):
        cosine_norm = (cosine_raw - cmin) / span
        reranker_score = float(c.get("score") or 0.0)
        fused = alpha * reranker_score + (1.0 - alpha) * cosine_norm
        c = {**c, "metadata": {**c.get("metadata", {}), "fused_score": round(fused, 4)}}
        result.append((fused, c))

    result.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in result]
