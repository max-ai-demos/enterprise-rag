# apps/agent/tests/test_repository.py
from app.db.repository import DocumentRepository, SessionRepository, MessageRepository

def test_create_and_get_document(db_session):
    repo = DocumentRepository(db_session)
    doc = repo.create(
        user_id="user1",
        filename="test.pdf",
        file_path="uploads/user1/test.pdf",
        file_type="pdf",
        file_size=1024,
    )
    assert doc.id is not None
    fetched = repo.get_by_id(doc.id)
    assert fetched.filename == "test.pdf"

def test_list_documents_for_user(db_session):
    repo = DocumentRepository(db_session)
    repo.create(user_id="user1", filename="a.pdf", file_path="x", file_type="pdf")
    repo.create(user_id="user2", filename="b.pdf", file_path="y", file_type="pdf")
    docs = repo.list_for_user("user1")
    assert len(docs) == 1
    assert docs[0].filename == "a.pdf"

def test_list_demo_documents(db_session):
    repo = DocumentRepository(db_session)
    repo.create(user_id=None, filename="demo.pdf", file_path="demo/demo.pdf",
                file_type="pdf", is_demo=True)
    demos = repo.list_demo()
    assert len(demos) == 1

def test_session_create_and_messages(db_session):
    sess_repo = SessionRepository(db_session)
    # Need a user in the session db for FK constraint
    from app.db.models import User
    import uuid
    user = User(id=str(uuid.uuid4()), username="u1", password_hash="x", role="user")
    db_session.add(user)
    db_session.commit()

    session = sess_repo.create(user_id=user.id, mode="upload")
    assert session.id is not None

    msg_repo = MessageRepository(db_session)
    msg = msg_repo.create(session_id=session.id, role="user", content="hello")
    assert msg.id is not None
    msgs = msg_repo.list_for_session(session.id)
    assert len(msgs) == 1
    assert msgs[0].content == "hello"
