# apps/agent/app/rag/prompt.py

SYSTEM_PROMPT = """你是一个企业知识库问答助手。请基于提供的文档内容回答用户问题。

规则：
1. 优先使用文档中的信息，结合上下文合理解释和归纳，不要逐字引用。
2. 每当使用某个来源的内容时，必须在句尾用 [来源N] 标注，N 为对应来源编号。每个段落至少引用一次来源。
3. 只有当文档中完全没有任何相关信息时，才说明"文档中未找到相关内容"。如果文档包含部分相关信息，请基于这些信息给出尽量完整的回答。
4. 用户可以用任何语言提问，请用同样的语言回答。
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
) -> list[dict]:
    """Build the full message list for OpenAI chat completion."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

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
