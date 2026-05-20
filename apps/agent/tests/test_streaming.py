# apps/agent/tests/test_streaming.py
import pytest
from unittest.mock import patch, MagicMock


def _make_stream_chunk(content: str):
    chunk = MagicMock()
    chunk.choices[0].delta.content = content
    return chunk


def test_rag_answer_stream_yields_events():
    """Stream should yield sources event then delta events then end event."""
    fake_chunks = [{
        "id": "doc1_0",
        "text": "合同付款期限为30天。",
        "score": 0.9,
        "metadata": {
            "document_id": "doc1",
            "file_type": "pdf",
            "page_num": "1",
            "bbox": "[10,20,100,50]",
            "filename": "contract.pdf",
        }
    }]

    with patch("app.rag.pipeline._retrieve_across_documents", return_value=fake_chunks), \
         patch("app.rag.pipeline.rewrite_query", return_value="付款期限"), \
         patch("app.rag.pipeline.get_memories", return_value=[]), \
         patch("app.rag.pipeline.rerank", return_value=fake_chunks), \
         patch("app.rag.pipeline.is_confident", return_value=True), \
         patch("app.rag.pipeline.add_memory"), \
         patch("app.rag.pipeline._get_openai") as mock_openai_fn:

        mock_client = mock_openai_fn.return_value
        mock_client.chat.completions.create.return_value = iter([
            _make_stream_chunk("付款"),
            _make_stream_chunk("期限"),
            _make_stream_chunk("30天"),
        ])

        from app.rag.pipeline import rag_answer_stream
        events = list(rag_answer_stream(
            query="付款期限是多少天？",
            user_id="u1",
            session_id="s1",
            document_ids=["doc1"],
            history=[],
            document_metadata={"doc1": {"filename": "contract.pdf", "file_type": "pdf"}},
        ))

    types = [e["type"] for e in events]
    assert types[0] == "sources"
    assert all(t == "delta" for t in types[1:-1])
    assert types[-1] == "end"

    sources_event = events[0]
    assert len(sources_event["sources"]) == 1
    assert sources_event["sources"][0]["filename"] == "contract.pdf"

    end_event = events[-1]
    assert end_event["answer"] == "付款期限30天"


def test_rag_answer_stream_no_docs():
    """Empty document list should yield error event."""
    with patch("app.rag.pipeline._retrieve_across_documents", return_value=[]), \
         patch("app.rag.pipeline.rewrite_query", return_value="q"), \
         patch("app.rag.pipeline.get_memories", return_value=[]):

        from app.rag.pipeline import rag_answer_stream
        events = list(rag_answer_stream(
            query="q", user_id="u1", session_id="s1",
            document_ids=[], history=[], document_metadata={},
        ))

    assert len(events) == 1
    assert events[0]["type"] == "error"


def test_rag_answer_stream_low_confidence():
    """Low confidence rerank should yield error event."""
    fake_chunks = [{"id": "doc1_0", "text": "text", "score": 0.1, "metadata": {"document_id": "doc1"}}]

    with patch("app.rag.pipeline._retrieve_across_documents", return_value=fake_chunks), \
         patch("app.rag.pipeline.rewrite_query", return_value="q"), \
         patch("app.rag.pipeline.get_memories", return_value=[]), \
         patch("app.rag.pipeline.rerank", return_value=fake_chunks), \
         patch("app.rag.pipeline.is_confident", return_value=False):

        from app.rag.pipeline import rag_answer_stream
        events = list(rag_answer_stream(
            query="q", user_id="u1", session_id="s1",
            document_ids=["doc1"], history=[], document_metadata={},
        ))

    assert len(events) == 1
    assert events[0]["type"] == "error"
