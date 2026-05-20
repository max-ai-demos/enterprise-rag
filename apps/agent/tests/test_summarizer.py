# apps/agent/tests/test_summarizer.py
import pytest
from unittest.mock import patch, MagicMock


def test_summarize_short_document():
    """Short document → single LLM call with gpt-4o."""
    mock_response = MagicMock()
    mock_response.choices[0].message.content = "这是文档摘要。"

    with patch("app.rag.summarizer.OpenAI") as MockOpenAI:
        mock_client = MockOpenAI.return_value
        mock_client.chat.completions.create.return_value = mock_response

        from app.rag.summarizer import summarize_document
        result = summarize_document("短文档内容，不超过6000字。")

    assert result == "这是文档摘要。"
    mock_client.chat.completions.create.assert_called_once()
    call_kwargs = mock_client.chat.completions.create.call_args
    assert call_kwargs.kwargs["model"] == "gpt-4o"


def test_summarize_long_document():
    """Long document → map-reduce: mini calls per chunk + one final gpt-4o call."""
    mock_mini_response = MagicMock()
    mock_mini_response.choices[0].message.content = "片段摘要。"
    mock_final_response = MagicMock()
    mock_final_response.choices[0].message.content = "最终汇总摘要。"

    call_count = {"n": 0}

    def side_effect(**kwargs):
        call_count["n"] += 1
        if kwargs["model"] == "gpt-4o-mini":
            return mock_mini_response
        return mock_final_response

    with patch("app.rag.summarizer.OpenAI") as MockOpenAI:
        mock_client = MockOpenAI.return_value
        mock_client.chat.completions.create.side_effect = lambda **kw: side_effect(**kw)

        from app.rag.summarizer import summarize_document, MAX_CHARS_PER_CALL
        long_text = "内容。" * (MAX_CHARS_PER_CALL // 3 + 1)  # forces 2 chunks
        result = summarize_document(long_text)

    assert result == "最终汇总摘要。"
    assert call_count["n"] == 3  # 2 mini + 1 final


def test_get_document_full_text_txt(tmp_path):
    """Extract full text from a TXT file."""
    txt_file = tmp_path / "test.txt"
    txt_file.write_text("第一段。\n第二段。", encoding="utf-8")

    from app.rag.summarizer import get_document_full_text
    text = get_document_full_text(str(txt_file), "txt")
    assert "第一段" in text
    assert "第二段" in text
