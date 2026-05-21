"""
SmartChunker — 语义感知分块器，作为 SentenceSplitter 的替代。

激活方式：在 .env 中设置 CHUNK_STRATEGY=smart
当前默认：CHUNK_STRATEGY=sentence（使用 LlamaIndex SentenceSplitter）

策略对比：
  sentence: 基于句子边界均匀切分，适合通用文档
  smart:    优先按段落切分，过长再按句子细分，短段落合并，
            目标更接近语义完整单元，适合合同/规章/结构化文档
"""
from __future__ import annotations
import re
from typing import List


class SmartChunker:
    """段落优先、句子兜底的智能分块器。

    target_size: 目标 chunk 字符数（默认 400）
    min_size:    最小 chunk 字符数，低于此值会尝试合并（默认 100）
    """

    def __init__(self, target_size: int = 400, min_size: int = 100):
        if min_size > target_size:
            raise ValueError("min_size 不能大于 target_size")
        self.target_size = target_size
        self.min_size = min_size

    def split_text(self, text: str) -> List[str]:
        if not text.strip():
            return []

        # 统一句子结束符后加换行，便于后续按段落切分
        text = re.sub(r"([.!?。！？])\s*", r"\1\n", text)
        paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]

        chunks: List[str] = []

        for paragraph in paragraphs:
            if len(paragraph) > self.target_size:
                # 段落过长：按句子进一步细分后重组
                sentences = [s.strip() for s in paragraph.split("\n") if s.strip()]
                current = ""
                for sentence in sentences:
                    if len(current) + len(sentence) + 1 <= self.target_size:
                        current += sentence + " "
                    else:
                        if len(current.strip()) >= self.min_size:
                            chunks.append(current.strip())
                        current = sentence + " "
                if len(current.strip()) >= self.min_size:
                    chunks.append(current.strip())
            else:
                # 段落较短：尝试与上一个 chunk 合并
                if chunks and len(chunks[-1]) + len(paragraph) + 2 <= self.target_size:
                    chunks[-1] = chunks[-1] + "\n\n" + paragraph
                elif len(paragraph) >= self.min_size:
                    chunks.append(paragraph)

        return chunks
