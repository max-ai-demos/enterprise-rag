import httpx
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse, JSONResponse
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

    async with httpx.AsyncClient(timeout=300) as client:
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

    return StreamingResponse(
        res.aiter_bytes(),
        status_code=res.status_code,
        headers=response_headers,
        media_type=res.headers.get("content-type"),
    )


@router.api_route("/api/rag/{path:path}", methods=["GET", "POST", "DELETE", "PUT", "PATCH"])
async def rag_proxy(req: Request, path: str):
    return await _proxy(req, path)
