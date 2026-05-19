from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import document, chat, history
from app.version import APP_VERSION

app = FastAPI(title="Enterprise RAG Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(document.router, prefix="/documents", tags=["documents"])
app.include_router(chat.router, prefix="/chat", tags=["chat"])
app.include_router(history.router, prefix="/sessions", tags=["history"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "enterprise-rag-agent", "version": APP_VERSION}
