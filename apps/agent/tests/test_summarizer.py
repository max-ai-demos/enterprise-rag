# apps/agent/tests/test_summarizer.py
import sys
import types
import pytest
from unittest.mock import MagicMock

_STUB_NAMES = [
    "llama_index",
    "llama_index.core",
    "llama_index.core.node_parser",
    "llama_index.embeddings",
    "llama_index.embeddings.openai",
]


@pytest.fixture(autouse=True)
def _stub_heavy_deps():
    """Install lightweight stubs for heavy deps, then restore sys.modules after each test."""
    saved = {name: sys.modules.get(name) for name in _STUB_NAMES}

    for name in _STUB_NAMES:
        if name not in sys.modules:
            sys.modules[name] = types.ModuleType(name)

    core_mod = sys.modules["llama_index.core"]
    if not hasattr(core_mod, "Settings"):
        core_mod.Settings = MagicMock()
    node_parser_mod = sys.modules["llama_index.core.node_parser"]
    if not hasattr(node_parser_mod, "SentenceSplitter"):
        node_parser_mod.SentenceSplitter = MagicMock()

    oai_embed_mod = sys.modules["llama_index.embeddings.openai"]
    if not hasattr(oai_embed_mod, "OpenAIEmbedding"):
        oai_embed_mod.OpenAIEmbedding = MagicMock()

    yield

    for name, original in saved.items():
        if original is None:
            sys.modules.pop(name, None)
        else:
            sys.modules[name] = original


def test_summarize_short_document():
    """Short document → single LLM call with gpt-4o."""
    mock_response = MagicMock()
    mock_response.choices = [MagicMock()]
    mock_response.choices[0].message.content = "这是文档摘要。"

    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = mock_response

    from app.rag.summarizer import summarize_document
    import app.rag.summarizer as summarizer_mod

    original = summarizer_mod._get_client
    summarizer_mod._get_client = lambda: mock_client
    try:
        result = summarize_document("短文档内容，不超过6000字。")
    finally:
        summarizer_mod._get_client = original

    assert result == "这是文档摘要。"
    mock_client.chat.completions.create.assert_called_once()
    call_kwargs = mock_client.chat.completions.create.call_args
    assert call_kwargs.kwargs["model"] == "gpt-4o"


def test_summarize_long_document():
    """Long document → map-reduce: mini calls per chunk + one final gpt-4o call."""
    mock_mini_response = MagicMock()
    mock_mini_response.choices = [MagicMock()]
    mock_mini_response.choices[0].message.content = "片段摘要。"
    mock_final_response = MagicMock()
    mock_final_response.choices = [MagicMock()]
    mock_final_response.choices[0].message.content = "最终汇总摘要。"

    call_count = {"n": 0}

    def side_effect(**kwargs):
        call_count["n"] += 1
        if kwargs["model"] == "gpt-4o-mini":
            return mock_mini_response
        return mock_final_response

    mock_client = MagicMock()
    mock_client.chat.completions.create.side_effect = lambda **kw: side_effect(**kw)

    from app.rag.summarizer import summarize_document, MAX_CHARS_PER_CALL
    import app.rag.summarizer as summarizer_mod

    original = summarizer_mod._get_client
    summarizer_mod._get_client = lambda: mock_client
    try:
        long_text = "内容。" * (MAX_CHARS_PER_CALL // 3 + 1)  # forces 2 chunks
        result = summarize_document(long_text)
    finally:
        summarizer_mod._get_client = original

    assert result == "最终汇总摘要。"
    assert call_count["n"] == 3  # 2 mini + 1 final


def test_get_document_full_text_uses_parse_document(monkeypatch):
    monkeypatch.setattr(
        "app.rag.ingestion.parse_document",
        lambda path, ftype: [{"text": "chunk one"}, {"text": "chunk two"}],
    )
    from app.rag.summarizer import get_document_full_text
    result = get_document_full_text("/fake/path.txt", "txt")
    assert result == "chunk one\n\nchunk two"


def test_summarize_raises_on_empty_choices(monkeypatch):
    mock_client = MagicMock()
    mock_client.chat.completions.create.return_value = MagicMock(choices=[])
    monkeypatch.setattr("app.rag.summarizer._get_client", lambda: mock_client)
    from app.rag.summarizer import summarize_document
    with pytest.raises(ValueError, match="empty choices"):
        summarize_document("short text")
