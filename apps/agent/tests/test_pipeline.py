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

def test_hybrid_retriever_returns_results(tmp_path, monkeypatch):
    """Verify hybrid retriever merges vector + BM25 results and deduplicates."""
    import chromadb
    from app.rag.hybrid_retriever import HybridRetriever

    # Setup: create a test ChromaDB collection with sample docs
    client = chromadb.EphemeralClient()
    col = client.create_collection("test_col")
    col.add(
        ids=["doc1_0", "doc1_1", "doc1_2"],
        documents=[
            "The payment deadline is 30 days from invoice.",
            "Late fees apply after the payment deadline passes.",
            "Contract termination requires 90 days notice.",
        ],
        embeddings=[[0.1]*1536, [0.2]*1536, [0.3]*1536],
        metadatas=[
            {"document_id": "doc1", "chunk_index": "0", "page_num": "1"},
            {"document_id": "doc1", "chunk_index": "1", "page_num": "1"},
            {"document_id": "doc1", "chunk_index": "2", "page_num": "2"},
        ],
    )

    # Mock the embed call
    monkeypatch.setattr(
        "app.rag.hybrid_retriever._embed_query",
        lambda q: [0.1] * 1536,
    )

    retriever = HybridRetriever(collection=col)
    results = retriever.retrieve("payment deadline", top_k=5)

    assert len(results) > 0
    assert all("text" in r and "score" in r and "metadata" in r for r in results)
    # No duplicates
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
