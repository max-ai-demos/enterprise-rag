# apps/agent/tests/test_pipeline.py

def test_query_rewriter_standalone_query():
    from app.rag.query_rewriter import rewrite_query
    history = []  # no history
    result = rewrite_query("What is the payment term?", history)
    # With no history, returns query unchanged
    assert "payment" in result.lower()

def test_query_rewriter_with_context(monkeypatch):
    from app.rag import query_rewriter

    def mock_complete(prompt):
        return "What is the payment deadline in the contract?"

    monkeypatch.setattr(query_rewriter, "_llm_complete", mock_complete)

    from app.rag.query_rewriter import rewrite_query
    history = [
        {"role": "user", "content": "Tell me about the contract"},
        {"role": "assistant", "content": "The contract covers payment terms and penalties."},
    ]
    result = rewrite_query("What is the deadline?", history)
    assert "payment" in result.lower() or "deadline" in result.lower()

def test_hybrid_retriever_returns_results(monkeypatch):
    """Verify hybrid retriever merges vector + BM25 results and deduplicates."""
    from unittest.mock import MagicMock
    from app.rag.hybrid_retriever import HybridRetriever

    sample_chunks = [
        {"id": "doc1_0", "text": "The payment deadline is 30 days from invoice.",
         "embedding": [0.1] * 1536, "metadata": {"document_id": "doc1", "page_num": 1}},
        {"id": "doc1_1", "text": "Late fees apply after the payment deadline passes.",
         "embedding": [0.2] * 1536, "metadata": {"document_id": "doc1", "page_num": 1}},
        {"id": "doc1_2", "text": "Contract termination requires 90 days notice.",
         "embedding": [0.3] * 1536, "metadata": {"document_id": "doc1", "page_num": 2}},
    ]

    mock_repo = MagicMock()
    mock_repo.get_all_for_document.return_value = sample_chunks

    monkeypatch.setattr(
        "app.rag.hybrid_retriever._embed_query",
        lambda q: [0.1] * 1536,
    )

    def mock_chunk_repo(db):
        return mock_repo

    monkeypatch.setattr("app.db.repository.ChunkRepository", mock_chunk_repo)

    db = MagicMock()
    retriever = HybridRetriever(db=db, document_id="doc1")
    results = retriever.retrieve("payment deadline", top_k=5)

    assert len(results) > 0
    assert all("text" in r and "score" in r and "metadata" in r for r in results)
    ids = [r["id"] for r in results]
    assert len(ids) == len(set(ids))

def test_confidence_check_passes():
    from app.rag.confidence import is_confident
    chunks = [{"text": "hello", "score": 0.9}]
    assert is_confident(chunks) is True

def test_confidence_check_fails_on_low_score():
    from app.rag.confidence import is_confident
    chunks = [{"text": "hello", "score": 0.1}]
    assert is_confident(chunks) is False

def test_confidence_check_fails_on_empty():
    from app.rag.confidence import is_confident
    assert is_confident([]) is False
