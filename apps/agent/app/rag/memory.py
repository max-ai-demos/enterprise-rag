# Session-based context is handled via MySQL message history (see chat.py → msg_repo.get_recent).
# Cross-session memory has been removed; the history parameter in build_messages carries
# the last N turns from the current session.

def get_memories(user_id: str, query: str) -> list[str]:
    return []

def add_memory(user_id: str, query: str, answer: str) -> None:
    pass
