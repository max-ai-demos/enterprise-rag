"""PDF splitting helpers — used by DatalabClient when processing large files."""
import logging
from io import BytesIO
from math import ceil
from typing import List, Tuple

from pypdf import PdfReader, PdfWriter

from app.infrastructure.exceptions import PDFProcessingError

logger = logging.getLogger(__name__)


def get_pdf_page_count(file_content: bytes) -> int:
    try:
        return len(PdfReader(BytesIO(file_content), strict=False).pages)
    except Exception as e:
        logger.error(f"Failed to read PDF page count: {e}")
        raise PDFProcessingError(f"Failed to read PDF: {e}") from e


def generate_page_ranges(total_pages: int, pages_per_request: int) -> List[Tuple[int, int]]:
    """Return (start, end) page ranges (1-indexed, end inclusive)."""
    ranges = []
    for start in range(1, total_pages + 1, pages_per_request):
        end = min(start + pages_per_request - 1, total_pages)
        ranges.append((start, end))
    return ranges


def calculate_chunk_ranges_by_count(total_pages: int, num_chunks: int) -> List[Tuple[int, int]]:
    if num_chunks <= 0:
        raise ValueError("num_chunks must be positive")
    if total_pages <= 0:
        raise ValueError("total_pages must be positive")
    num_chunks = min(num_chunks, total_pages)
    pages_per_chunk = max(1, ceil(total_pages / num_chunks))
    return generate_page_ranges(total_pages, pages_per_chunk)


def split_pdf_by_pages(file_content: bytes, page_ranges: List[Tuple[int, int]]) -> List[Tuple[bytes, str]]:
    """Split PDF into byte chunks per page range. Returns [(bytes, filename)]."""
    pdf_reader = PdfReader(BytesIO(file_content), strict=False)
    split_files = []
    for start_page, end_page in page_ranges:
        writer = PdfWriter()
        for page_num in range(start_page - 1, end_page):
            if page_num < len(pdf_reader.pages):
                page = pdf_reader.pages[page_num]
                if "/Annots" in page:
                    del page["/Annots"]
                writer.add_page(page)
        buf = BytesIO()
        writer.write(buf)
        split_files.append((buf.getvalue(), f"pages_{start_page}-{end_page}.pdf"))
    return split_files
