from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import document, chat, history, auth, rag_proxy
from app.version import APP_VERSION
import os


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.db.database import create_chunks_table
    create_chunks_table()
    yield


app = FastAPI(title="Enterprise RAG Agent", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in os.getenv("CORS_ORIGINS", "").split(",") if o],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(rag_proxy.router, tags=["rag-proxy"])
app.include_router(document.router, prefix="/documents", tags=["documents"])
app.include_router(chat.router, prefix="/chat", tags=["chat"])
app.include_router(history.router, prefix="/sessions", tags=["history"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "enterprise-rag-agent", "version": APP_VERSION}
