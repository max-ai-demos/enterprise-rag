"""
Datalab (Marker) cloud PDF parser client.

激活方式：
1. 在 https://www.datalab.to 注册并获取 API Key
2. 在 .env 中设置 DATALAB_API_KEY=<your-key>
3. 在 .env 中设置 PDF_PARSER_PROVIDER=datalab
4. 可选：调整 DATALAB_USE_LLM / DATALAB_FORCE_OCR / DATALAB_MAX_FILE_SIZE_MB

输出格式：MinerU 兼容的 content_list JSON + markdown，可用于 document_index 表存图片 URL。
"""
import asyncio
import base64
import io
import json
import logging
import os
import re
import tempfile
import time
from math import ceil
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import aiohttp
from markdownify import markdownify as md

from app.infrastructure.config import settings
from app.infrastructure.exceptions import (
    DatalabConnectionError,
    DatalabTimeoutError,
    PDFProcessingError,
)
from app.rag.pdf_utils import (
    calculate_chunk_ranges_by_count,
    get_pdf_page_count,
    split_pdf_by_pages,
)

logger = logging.getLogger(__name__)

# --- Datalab block_type → MinerU content_list type mapping ---

_DATALAB_TYPE_TEXT = frozenset({
    "Text", "SectionHeader", "Caption", "Footnote",
    "ListItem", "Code", "Handwriting", "Form",
})
_DATALAB_TYPE_IMAGE = frozenset({"Image", "Figure", "Picture"})
_DATALAB_TYPE_TABLE = frozenset({"Table"})
_DATALAB_TYPE_FORMULA = frozenset({"Formula", "Equation", "TextInlineMath"})
_DATALAB_TYPE_SKIP = frozenset({
    "Page", "Document", "FigureGroup", "TableGroup",
    "ListGroup", "PictureGroup", "PageHeader", "PageFooter",
    "TableOfContents", "Line", "Span",
})


def _html_to_text(html: str) -> str:
    text = re.sub(r'<math display="block">(.*?)</math>', r"$$\1$$", html, flags=re.DOTALL)
    text = re.sub(r"<math>(.*?)</math>", r"$\1$", text, flags=re.DOTALL)
    return md(text, heading_style="ATX").strip()


def _map_block_type(raw_type: str) -> Optional[str]:
    if raw_type in _DATALAB_TYPE_TEXT:
        return "text"
    if raw_type in _DATALAB_TYPE_IMAGE:
        return "image"
    if raw_type in _DATALAB_TYPE_TABLE:
        return "table"
    if raw_type in _DATALAB_TYPE_FORMULA:
        return "formula"
    if raw_type in _DATALAB_TYPE_SKIP:
        return None
    logger.warning(f"Unknown Datalab block type: '{raw_type}', mapping to 'unknown'")
    return "unknown"


def _normalize_bbox(bbox: list, page_width: float, page_height: float) -> list:
    if len(bbox) != 4 or page_width <= 0 or page_height <= 0:
        return bbox
    x0, y0, x1, y1 = bbox
    return [
        round(x0 / page_width * 1000),
        round(y0 / page_height * 1000),
        round(x1 / page_width * 1000),
        round(y1 / page_height * 1000),
    ]


def _bbox_from_polygon(polygon: list) -> list:
    if not polygon or len(polygon) < 2:
        return []
    xs = [p[0] for p in polygon]
    ys = [p[1] for p in polygon]
    return [min(xs), min(ys), max(xs), max(ys)]


def _page_index_from_id(block_id: str, fallback: int) -> int:
    match = re.match(r"/page/(\d+)/", block_id)
    return int(match.group(1)) if match else fallback


def _image_filename_from_id(block_id: str) -> str:
    return block_id.strip("/").replace("/", "_") + ".png"


def _convert_to_content_list(pages: list, images: dict) -> List[Dict[str, Any]]:
    """Convert Datalab JSON pages/blocks into MinerU-compatible content_list."""
    content_list: List[Dict[str, Any]] = []
    for page_idx, page in enumerate(pages):
        page_bbox = page.get("bbox", []) or _bbox_from_polygon(page.get("polygon", []))
        page_width = (page_bbox[2] - page_bbox[0]) if len(page_bbox) == 4 else 0
        page_height = (page_bbox[3] - page_bbox[1]) if len(page_bbox) == 4 else 0

        for block in page.get("children", []):
            block_type = block.get("block_type", "")
            mapped_type = _map_block_type(block_type)
            if mapped_type is None:
                continue

            bbox = block.get("bbox", []) or _bbox_from_polygon(block.get("polygon", []))
            bbox = _normalize_bbox(bbox, page_width, page_height)
            block_id = block.get("id", "")
            html = block.get("html") or ""
            text_content = _html_to_text(html) if html else ""

            item: Dict[str, Any] = {"page_idx": page_idx, "bbox": bbox}

            if mapped_type == "image":
                item["type"] = "image"
                if block_id in images:
                    item["img_path"] = f"images/{_image_filename_from_id(block_id)}"
                item["text"] = text_content
            elif mapped_type == "table":
                item["type"] = "table"
                item["table_body"] = text_content
            elif mapped_type == "formula":
                item["type"] = "equation"
                item["text"] = text_content
                item["text_format"] = "latex"
            else:
                item["type"] = mapped_type
                item["text"] = text_content

            content_list.append(item)
    return content_list


def _build_markdown(pages: list) -> str:
    parts: List[str] = []
    for page in pages:
        for block in page.get("children", []):
            if block.get("block_type", "") in _DATALAB_TYPE_SKIP:
                continue
            html = block.get("html") or ""
            if html:
                text = _html_to_text(html)
                if text:
                    parts.append(text)
    return "\n\n".join(parts)


def _write_mineru_structure(
    pdf_name_without_ext: str,
    markdown: str,
    images: dict,
    content_list: List[Dict[str, Any]],
) -> Path:
    """Write Datalab results into a temp dir matching MinerU ZIP layout."""
    extracted_dir = Path(tempfile.mkdtemp(prefix=f"datalab_{pdf_name_without_ext}_"))
    content_dir = extracted_dir / pdf_name_without_ext
    content_dir.mkdir(exist_ok=True)

    (content_dir / f"{pdf_name_without_ext}.md").write_text(markdown, encoding="utf-8")

    if images:
        images_dir = content_dir / "images"
        images_dir.mkdir(exist_ok=True)
        for block_id, img_b64 in images.items():
            (images_dir / _image_filename_from_id(block_id)).write_bytes(
                base64.b64decode(img_b64)
            )

    (content_dir / f"{pdf_name_without_ext}_content_list.json").write_text(
        json.dumps(content_list, ensure_ascii=False, indent=4), encoding="utf-8"
    )
    return extracted_dir


_REMAP_BLOCK_ID_RE = re.compile(r"^(/page/)(\d+)(/.*)$")


def _remap_block_id(block_id: str, page_offset: int) -> str:
    match = _REMAP_BLOCK_ID_RE.match(block_id)
    if match:
        prefix, page_num, suffix = match.groups()
        return f"{prefix}{int(page_num) + page_offset}{suffix}"
    return block_id


def _remap_block(block: dict, page_offset: int) -> dict:
    new_block = {**block}
    if "id" in new_block:
        new_block["id"] = _remap_block_id(new_block["id"], page_offset)
    if "children" in new_block and isinstance(new_block["children"], list):
        new_block["children"] = [_remap_block(c, page_offset) for c in new_block["children"]]
    return new_block


def _remap_page_references(
    pages: List[dict], images: Dict[str, str], page_offset: int
) -> Tuple[List[dict], Dict[str, str]]:
    if page_offset == 0:
        return pages, images
    remapped_pages = [_remap_block(p, page_offset) for p in pages]
    remapped_images = {_remap_block_id(k, page_offset): v for k, v in images.items()}
    return remapped_pages, remapped_images


def _merge_raw_results(
    chunk_results: List[Tuple[Dict[str, Any], int]],
) -> Tuple[List[dict], Dict[str, str]]:
    merged_pages: List[dict] = []
    merged_images: Dict[str, str] = {}
    for raw_result, page_offset in chunk_results:
        chunk_images = raw_result.get("images") or {}
        chunk_pages = (raw_result.get("json") or {}).get("children", [])
        remapped_pages, remapped_images = _remap_page_references(
            chunk_pages, chunk_images, page_offset
        )
        merged_pages.extend(remapped_pages)
        merged_images.update(remapped_images)
    return merged_pages, merged_images


async def _async_sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)


class DatalabClient:
    """
    Datalab (Marker) REST API client. Converts Datalab JSON output to MinerU-compatible format.

    Call flow:
    1. POST /api/v1/convert  — upload PDF → get request_id
    2. GET  /api/v1/convert/{request_id} — poll until complete/error/timeout
    3. Convert to MinerU directory structure (markdown + content_list + images)
    """

    _RATE_LIMIT_SLEEP_SECONDS = 60

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        max_poll_seconds: Optional[int] = None,
        poll_interval: Optional[int] = None,
    ):
        self.api_key = api_key or settings.datalab_api_key
        self.base_url = (base_url or settings.datalab_base_url).rstrip("/")
        self.max_poll_seconds = max_poll_seconds or settings.datalab_max_poll_seconds
        self.poll_interval = poll_interval or settings.datalab_poll_interval
        if not self.api_key:
            raise ValueError(
                "Datalab API key not configured. Set DATALAB_API_KEY in .env."
            )

    async def submit_pdf(
        self,
        session: aiohttp.ClientSession,
        file_content: bytes,
        file_name: str,
        output_format: str = "json",
        use_llm: bool = False,
        force_ocr: bool = False,
        _retry_count: int = 0,
    ) -> str:
        """Submit PDF for conversion. Returns request_id. Retries once on 429."""
        url = f"{self.base_url}/api/v1/convert"
        data = aiohttp.FormData()
        data.add_field("file", io.BytesIO(file_content), filename=file_name, content_type="application/pdf")
        data.add_field("output_format", output_format)
        if use_llm:
            data.add_field("use_llm", "true")
        if force_ocr:
            data.add_field("force_ocr", "true")
        headers = {"X-API-Key": self.api_key}

        try:
            async with session.post(url, data=data, headers=headers) as response:
                if response.status == 429:
                    if _retry_count < 1:
                        logger.warning(
                            f"Datalab rate limited (429). Sleeping {self._RATE_LIMIT_SLEEP_SECONDS}s..."
                        )
                        await _async_sleep(self._RATE_LIMIT_SLEEP_SECONDS)
                        return await self.submit_pdf(
                            session, file_content, file_name,
                            output_format=output_format, use_llm=use_llm,
                            force_ocr=force_ocr, _retry_count=_retry_count + 1,
                        )
                    raise DatalabConnectionError("Rate limited by Datalab API (429) after retry")
                if response.status >= 400:
                    body = await response.text()
                    raise DatalabConnectionError(f"Datalab HTTP {response.status}: {body}")
                result = await response.json()
        except DatalabConnectionError:
            raise
        except aiohttp.ClientError as e:
            raise DatalabConnectionError(f"Network error: {type(e).__name__}") from e

        request_id = result.get("request_id")
        if not request_id:
            raise PDFProcessingError("Datalab response missing request_id")
        logger.info(f"Datalab submitted, request_id={request_id}")
        return request_id

    async def poll_result(self, session: aiohttp.ClientSession, request_id: str) -> Dict[str, Any]:
        """Poll until complete/error or timeout."""
        url = f"{self.base_url}/api/v1/convert/{request_id}"
        headers = {"X-API-Key": self.api_key}
        start_time = time.monotonic()

        while True:
            elapsed = time.monotonic() - start_time
            if elapsed > self.max_poll_seconds:
                raise DatalabTimeoutError(
                    f"request_id={request_id} not complete after {self.max_poll_seconds}s"
                )
            try:
                async with session.get(url, headers=headers) as response:
                    if response.status >= 400:
                        body = await response.text()
                        raise DatalabConnectionError(f"Datalab poll HTTP {response.status}: {body}")
                    result = await response.json()
            except (DatalabConnectionError, DatalabTimeoutError):
                raise
            except aiohttp.ClientError as e:
                logger.warning(f"Poll network error request_id={request_id}: {e}. Retrying...")
                await _async_sleep(self.poll_interval)
                continue

            status = result.get("status", "")
            if status == "complete":
                logger.info(f"Datalab request_id={request_id} complete after {elapsed:.1f}s")
                return result
            if status == "error":
                raise PDFProcessingError(
                    f"Datalab error for request_id={request_id}: {result.get('error', 'unknown')}"
                )
            logger.info(f"Datalab request_id={request_id} status={status}, polling in {self.poll_interval}s...")
            await _async_sleep(self.poll_interval)

    async def _call_api(self, file_content: bytes, file_name: str) -> Dict[str, Any]:
        async with aiohttp.ClientSession() as session:
            request_id = await self.submit_pdf(
                session, file_content, file_name,
                output_format=settings.datalab_output_format,
                use_llm=settings.datalab_use_llm,
                force_ocr=settings.datalab_force_ocr,
            )
            return await self.poll_result(session, request_id)

    async def _process_chunk(
        self, chunk_bytes: bytes, chunk_name: str, page_offset: int
    ) -> Tuple[Dict[str, Any], int]:
        logger.info(
            f"Submitting chunk '{chunk_name}' ({len(chunk_bytes) / (1024 * 1024):.1f}MB, offset={page_offset})"
        )
        result = await self._call_api(chunk_bytes, chunk_name)
        return result, page_offset

    async def process_pdf(
        self,
        file_content: bytes,
        file_name: str,
        page_size: Optional[int] = None,
    ) -> Tuple[str, Path]:
        """Process PDF and return (markdown_content, extracted_dir) in MinerU-compatible format.

        Large files are automatically split into chunks and processed concurrently.
        page_size can be provided to skip pypdf page-count parsing.
        """
        pdf_name_without_ext = os.path.splitext(file_name)[0]

        total_pages = page_size or get_pdf_page_count(file_content)
        file_size = len(file_content)
        max_chunk_bytes = settings.datalab_max_file_size_mb * 1024 * 1024
        num_chunks = max(1, ceil(file_size / max_chunk_bytes))
        page_ranges = calculate_chunk_ranges_by_count(total_pages, num_chunks)
        chunks = split_pdf_by_pages(file_content, page_ranges)

        logger.info(
            f"Processing '{file_name}': {total_pages} pages, "
            f"{file_size / (1024 * 1024):.1f}MB, {len(chunks)} chunk(s)"
        )

        tasks = [
            self._process_chunk(chunk_bytes, chunk_name, page_ranges[i][0] - 1)
            for i, (chunk_bytes, chunk_name) in enumerate(chunks)
        ]
        results = await asyncio.gather(*tasks)

        pages, images = _merge_raw_results(results)
        markdown = _build_markdown(pages)
        if not markdown:
            raise PDFProcessingError("Datalab returned empty content.")

        content_list = _convert_to_content_list(pages, images)
        extracted_dir = _write_mineru_structure(pdf_name_without_ext, markdown, images, content_list)

        logger.info(
            f"Datalab complete: {len(markdown)} chars markdown, "
            f"{len(images)} images, {len(content_list)} content items"
        )
        return markdown, extracted_dir
