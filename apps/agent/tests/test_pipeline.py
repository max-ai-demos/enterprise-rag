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
    """Verify hybrid retriever merges vector + BM25 SQL results and deduplicates."""
    from unittest.mock import MagicMock
    from app.rag.hybrid_retriever import HybridRetriever

    # Mock _embed_query so no OpenAI call
    monkeypatch.setattr(
        "app.rag.hybrid_retriever._embed_query",
        lambda q: [0.1] * 1536,
    )

    # Build fake SQL row objects for the vector search result
    def _make_row(id_, text, score, page_num=1):
        r = MagicMock()
        r.id = id_
        r.text = text
        r.cosine_score = score
        r.page_num = page_num
        r.page_idx = page_num
        r.bbox = None
        r.paragraph_idx = None
        r.sheet_name = None
        r.row_start = None
        r.file_type = "pdf"
        return r

    vector_rows = [
        _make_row("doc1_0", "The payment deadline is 30 days from invoice.", 0.92),
        _make_row("doc1_1", "Late fees apply after the payment deadline passes.", 0.85),
        _make_row("doc1_2", "Contract termination requires 90 days notice.", 0.70),
    ]

    # BM25 returns same rows (overlap → RRF boost for doc1_0 and doc1_1)
    def _make_bm25_row(id_, text, bm25, page_num=1):
        r = MagicMock()
        r.id = id_
        r.text = text
        r.bm25_score = bm25
        r.page_num = page_num
        r.page_idx = page_num
        r.bbox = None
        r.paragraph_idx = None
        r.sheet_name = None
        r.row_start = None
        r.file_type = "pdf"
        return r

    bm25_rows = [
        _make_bm25_row("doc1_0", "The payment deadline is 30 days from invoice.", 12.3),
        _make_bm25_row("doc1_1", "Late fees apply after the payment deadline passes.", 9.1),
    ]

    call_count = [0]

    def mock_execute(stmt, params=None):
        result = MagicMock()
        if call_count[0] == 0:
            result.fetchall.return_value = vector_rows
        else:
            result.fetchall.return_value = bm25_rows
        call_count[0] += 1
        return result

    db = MagicMock()
    db.execute.side_effect = mock_execute

    retriever = HybridRetriever(db=db, document_id="doc1")
    results = retriever.retrieve("payment deadline", top_k=5)

    assert len(results) > 0
    assert all("text" in r and "score" in r and "metadata" in r for r in results)
    ids = [r["id"] for r in results]
    assert len(ids) == len(set(ids)), "Duplicate IDs returned"
    # Overlapping chunks (doc1_0, doc1_1) should rank highest via RRF boost
    assert ids[0] in ("doc1_0", "doc1_1")

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
