import httpx
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from app.infrastructure.config import settings

router = APIRouter()

RAG = settings.rag_service_url


async def _proxy(req: Request, path: str):
    url = f"{RAG}/api/rag/{path}"
    params = dict(req.query_params)

    headers = {
        k: v for k, v in req.headers.items()
        if k.lower() not in ("host", "connection", "transfer-encoding", "expect")
    }

    body = await req.body()

    client = httpx.AsyncClient(timeout=300)
    proxy_req = client.build_request(
        method=req.method,
        url=url,
        params=params,
        headers=headers,
        content=body or None,
    )
    res = await client.send(proxy_req, stream=True)

    response_headers = {
        k: v for k, v in res.headers.items()
        if k.lower() not in ("transfer-encoding", "connection", "keep-alive")
    }

    async def _stream_and_close():
        try:
            async for chunk in res.aiter_bytes():
                yield chunk
        finally:
            await res.aclose()
            await client.aclose()

    return StreamingResponse(
        _stream_and_close(),
        status_code=res.status_code,
        headers=response_headers,
        media_type=res.headers.get("content-type"),
    )


@router.api_route("/api/rag/{path:path}", methods=["GET", "POST", "DELETE", "PUT", "PATCH"])
async def rag_proxy(req: Request, path: str):
    return await _proxy(req, path)
