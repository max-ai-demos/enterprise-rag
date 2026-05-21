"""
MinerU self-hosted PDF parser client.

激活方式：
1. 部署 MinerU 服务（参考 https://github.com/opendatalab/MinerU）
2. 在 .env 中设置 MINERU_BASE_URL=http://<your-host>:<port>
3. 在 .env 中设置 PDF_PARSER_PROVIDER=mineru
"""
import logging
from typing import Optional

import requests

from app.infrastructure.config import settings

logger = logging.getLogger(__name__)


class MineruClient:
    def __init__(self, base_url: Optional[str] = None, timeout: int = 120):
        self.base_url = base_url or settings.mineru_base_url
        if not self.base_url:
            raise ValueError(
                "MinerU service URL not configured. Set MINERU_BASE_URL in .env."
            )
        self.timeout = timeout

    def process_pdf(self, file_content: bytes, filename: str) -> str:
        """Send PDF to MinerU and return parsed markdown content."""
        process_url = f"{self.base_url}/process"
        files = {"file": (filename, file_content, "application/pdf")}

        logger.info(f"Sending '{filename}' to MinerU at {process_url}")
        response = requests.post(process_url, files=files, timeout=self.timeout)
        response.raise_for_status()

        data = response.json()
        if data.get("status") == "success" and "markdown_content" in data:
            logger.info(f"MinerU processed '{filename}' successfully.")
            return data["markdown_content"]

        error = data.get("message", "Unknown error from MinerU service")
        logger.error(f"MinerU error: {error}")
        raise ValueError(f"MinerU service error: {error}")
