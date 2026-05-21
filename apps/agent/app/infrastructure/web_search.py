"""
Tavily Web Search Client — 为 RAG 回答注入实时网页结果。

激活方式：
1. 在 https://tavily.com 注册并获取 API Key
2. 在 .env 中设置 TAVILY_API_KEY=<your-key>
3. 在 ChatRequest 中传入 use_web_search=true，或设置 WEB_SEARCH_ENABLED=true 全局开启

结果格式兼容 pipeline.py 的 chunk dict：
  {"text": str, "score": float, "metadata": {"source_type": "web", "url": str, "title": str}}
"""
from __future__ import annotations

import logging
from typing import List, Optional

import httpx

from app.infrastructure.config import settings

logger = logging.getLogger(__name__)


class WebSearchError(Exception):
    """Raised when Tavily API call fails."""


class TavilyClient:
    """Tavily web search client. Disabled when TAVILY_API_KEY is empty."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.tavily_api_key

    def is_available(self) -> bool:
        return bool(self.api_key)

    def _build_payload(self, query: str) -> dict:
        return {
            "api_key": self.api_key,
            "query": query,
            "max_results": settings.tavily_max_results,
            "search_depth": settings.tavily_search_depth,
            "include_answer": False,
            "include_raw_content": False,
        }

    def _parse_results(self, data: dict) -> List[dict]:
        chunks = []
        for item in data.get("results", []) or []:
            url = item.get("url", "") or ""
            title = item.get("title", "") or ""
            content = item.get("content", "") or ""
            score = float(item.get("score", 0.5) or 0.5)
            if not content:
                continue
            chunks.append({
                "id": f"web_{url}",
                "text": content,
                "score": score,
                "metadata": {
                    "source_type": "web",
                    "url": url,
                    "title": title,
                    "filename": title or url,
                    "file_type": "web",
                },
            })
        return chunks

    def search(self, query: str) -> List[dict]:
        """Synchronous search. Returns chunks compatible with pipeline chunk format."""
        if not self.api_key:
            raise WebSearchError("Web search unavailable: TAVILY_API_KEY not set")

        timeout = httpx.Timeout(float(settings.tavily_search_timeout))
        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post("https://api.tavily.com/search", json=self._build_payload(query))
        except httpx.TimeoutException as e:
            raise WebSearchError("Tavily search timed out") from e
        except httpx.RequestError as e:
            raise WebSearchError(f"Tavily request failed: {e}") from e

        if resp.status_code != 200:
            raise WebSearchError(f"Tavily API error ({resp.status_code}): {resp.text}")

        return self._parse_results(resp.json() or {})

    async def search_async(self, query: str) -> List[dict]:
        """Async search for use in async pipeline paths."""
        if not self.api_key:
            raise WebSearchError("Web search unavailable: TAVILY_API_KEY not set")

        timeout = httpx.Timeout(float(settings.tavily_search_timeout))
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post("https://api.tavily.com/search", json=self._build_payload(query))
        except httpx.TimeoutException as e:
            raise WebSearchError("Tavily search timed out") from e
        except httpx.RequestError as e:
            raise WebSearchError(f"Tavily request failed: {e}") from e

        if resp.status_code != 200:
            raise WebSearchError(f"Tavily API error ({resp.status_code}): {resp.text}")

        return self._parse_results(resp.json() or {})


_tavily_client: Optional[TavilyClient] = None


def get_tavily_client() -> TavilyClient:
    global _tavily_client
    if _tavily_client is None:
        _tavily_client = TavilyClient()
    return _tavily_client
