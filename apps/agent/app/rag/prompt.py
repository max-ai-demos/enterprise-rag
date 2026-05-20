# apps/agent/app/rag/prompt.py

SYSTEM_PROMPT = """你是一个企业知识库问答助手。请基于提供的文档内容回答用户问题。

规则：
1. 优先使用文档中的信息，可以结合上下文进行合理解释和归纳
2. 如果文档中确实没有与问题相关的任何信息，再说明"文档中未找到相关内容"
3. 回答时注明来源，格式：[来源N]
4. 用户可以用任何语言提问，请用同样的语言回答
"""

def build_context_block(chunks: list[dict]) -> str:
    """Format retrieved chunks as context for the prompt."""
    parts = []
    for i, chunk in enumerate(chunks, start=1):
        meta = chunk.get("metadata", {})
        source_label = _format_source_label(meta)
        parts.append(f"[来源{i}] {source_label}\n{chunk['text']}")
    return "\n\n".join(parts)


def _format_source_label(meta: dict) -> str:
    filename = meta.get("filename", "未知文件")
    file_type = meta.get("file_type", "")
    if file_type == "pdf":
        page = meta.get("page_num", "?")
        return f"{filename} 第{page}页"
    elif file_type == "docx":
        para = meta.get("paragraph_idx", "?")
        return f"{filename} 第{para}段"
    elif file_type == "xlsx":
        sheet = meta.get("sheet_name", "?")
        row = meta.get("row_start", "?")
        return f"{filename} {sheet}表第{row}行"
    return filename


def build_messages(
    query: str,
    chunks: list[dict],
    history: list[dict],
    mem0_memories: list[str] | None = None,
) -> list[dict]:
    """Build the full message list for OpenAI chat completion."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Add Mem0 memories if available
    if mem0_memories:
        memory_text = "\n".join(f"- {m}" for m in mem0_memories)
        messages.append({
            "role": "system",
            "content": f"关于该用户的历史记忆：\n{memory_text}"
        })

    # Add document context
    context = build_context_block(chunks)
    messages.append({
        "role": "system",
        "content": f"以下是相关文档内容：\n\n{context}"
    })

    # Add conversation history (last 6 messages)
    for msg in history[-6:]:
        messages.append({"role": msg["role"], "content": msg["content"]})

    # Add current query
    messages.append({"role": "user", "content": query})
    return messages
