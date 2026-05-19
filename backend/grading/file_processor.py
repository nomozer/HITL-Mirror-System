"""
file_processor.py — Image & PDF input handling for the Grader.

Converts uploaded essay files into Gemini inline-data parts:
  • Images: decode base64 → optional compress (resize + re-encode JPEG).
  • PDFs:   rasterize each page to JPEG via PyMuPDF.
  • Exam-prompt PDFs: kept raw so Gemini uses its native PDF reasoning.

All CPU-bound work (PIL, PyMuPDF) is offloaded to worker threads via
``asyncio.to_thread`` so the FastAPI event loop stays responsive while
the Grader pipeline is pending.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import io
import logging
import os
from typing import Any

import fitz
from PIL import Image as PILImage

logger = logging.getLogger(__name__)


# Tuning constants — balanced for speed vs VLM reading accuracy.
_MAX_IMAGE_EDGE = 1600        # px on the longest edge
_JPEG_QUALITY = 80            # re-encoded JPEG quality
_COMPRESS_THRESHOLD = 400_000 # 400 KB: skip compression below this size
_MAX_UPLOAD_BYTES = int(os.getenv("HITL_MAX_UPLOAD_BYTES", str(30 * 1024 * 1024)))
_MAX_PDF_PAGES = int(os.getenv("HITL_MAX_PDF_PAGES", "30"))
_ALLOWED_ESSAY_MIME_PREFIXES = ("image/",)
_ALLOWED_ESSAY_MIMES = {"application/pdf"}


def _decode_image(image_b64: str | None) -> dict[str, Any] | None:
    """Decode a base64-encoded file into a Gemini inline data part.

    Accepts either a raw base64 payload or a data URL
    (``data:image/png;base64,...`` / ``data:application/pdf;base64,...``).
    Returns ``None`` when no file is given. Images and PDFs both work —
    Gemini handles them natively.
    """
    if not image_b64:
        return None
    payload = image_b64.strip()
    mime = "image/png"
    has_explicit_mime = False
    if payload.startswith("data:"):
        try:
            header, payload = payload.split(",", 1)
            mime = header.split(";")[0].removeprefix("data:") or mime
            has_explicit_mime = True
        except ValueError:
            pass
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"Invalid base64 essay image: {exc}") from exc
    if _MAX_UPLOAD_BYTES > 0 and len(raw) > _MAX_UPLOAD_BYTES:
        raise ValueError(
            f"Uploaded file is too large ({len(raw)} bytes; max {_MAX_UPLOAD_BYTES})."
        )
    if not has_explicit_mime:
        if raw.startswith(b"%PDF-"):
            mime = "application/pdf"
        elif raw.startswith(b"\xff\xd8\xff"):
            mime = "image/jpeg"
        elif raw.startswith(b"\x89PNG\r\n\x1a\n"):
            mime = "image/png"
        elif raw.startswith(b"GIF87a") or raw.startswith(b"GIF89a"):
            mime = "image/gif"
        elif raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
            mime = "image/webp"
    return {"mime_type": mime, "data": raw}


def _is_allowed_essay_mime(mime: str) -> bool:
    folded = (mime or "").lower()
    return folded in _ALLOWED_ESSAY_MIMES or any(
        folded.startswith(prefix) for prefix in _ALLOWED_ESSAY_MIME_PREFIXES
    )


def _compress_image(part: dict[str, Any] | None) -> dict[str, Any] | None:
    """Compress an image part if it's large enough to benefit.

    Skips images under ``_COMPRESS_THRESHOLD`` bytes. Resizes to
    ``_MAX_IMAGE_EDGE`` on the longest edge (aspect ratio preserved) and
    re-encodes as JPEG quality ``_JPEG_QUALITY``. Falls back to the
    original on any PIL error.
    """
    if part is None:
        return None

    raw: bytes = part["data"]
    if len(raw) < _COMPRESS_THRESHOLD:
        return part

    try:
        img = PILImage.open(io.BytesIO(raw))
        # Convert palette / RGBA → RGB for JPEG
        if img.mode in ("P", "RGBA", "LA"):
            img = img.convert("RGB")

        w, h = img.size
        if max(w, h) > _MAX_IMAGE_EDGE:
            scale = _MAX_IMAGE_EDGE / max(w, h)
            new_w, new_h = int(w * scale), int(h * scale)
            img = img.resize((new_w, new_h), PILImage.Resampling.LANCZOS)
            logger.info("[HITL] Image resized: %dx%d -> %dx%d", w, h, new_w, new_h)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
        compressed = buf.getvalue()

        saved_pct = (1 - len(compressed) / len(raw)) * 100
        logger.info(
            "[HITL] Image compressed: %.1f KB -> %.1f KB (saved %.0f%%)",
            len(raw) / 1024, len(compressed) / 1024, saved_pct,
        )
        return {"mime_type": "image/jpeg", "data": compressed}
    except Exception as exc:
        logger.warning("[HITL] Image compression failed, using original: %s", exc)
        return part


def _render_pdf_pages(raw: bytes) -> list[dict[str, Any]]:
    """Render every page of a PDF blob to JPEG parts for Gemini.

    Uses ``page.rect`` for dimensions — 1 render per page instead of 2.
    Synchronous; the caller offloads via ``asyncio.to_thread``.
    """
    parts: list[dict[str, Any]] = []
    doc = fitz.open(stream=raw, filetype="pdf")
    try:
        logger.info("[HITL] Processing multi-page PDF: %d pages", len(doc))
        if _MAX_PDF_PAGES > 0 and len(doc) > _MAX_PDF_PAGES:
            raise ValueError(f"PDF has too many pages ({len(doc)}; max {_MAX_PDF_PAGES}).")
        for page in doc:
            # page.rect is in PDF points (72 DPI) — equals the default
            # pixmap dimensions in pixels, so we can skip the wasted
            # default get_pixmap() that the old code used only to read size.
            w, h = page.rect.width, page.rect.height
            scale = _MAX_IMAGE_EDGE / max(w, h) if max(w, h) > _MAX_IMAGE_EDGE else 1.0
            pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale))
            parts.append({
                "mime_type": "image/jpeg",
                "data": pix.tobytes("jpg", jpg_quality=_JPEG_QUALITY),
            })
    finally:
        doc.close()
    return parts


async def process_input_file(image_b64: str | None) -> list[dict[str, Any]]:
    """Turn a single uploaded essay file (image or PDF) into Gemini parts.

    - Image: decode + compress via ``_compress_image``.
    - PDF:   render each page as JPEG via PyMuPDF.

    CPU-bound work runs in a worker thread so the event loop stays free
    while the Grader pipeline is pending.
    """
    if not image_b64:
        return []
    decoded = _decode_image(image_b64)
    if not decoded:
        return []

    mime = decoded.get("mime_type", "")
    raw = decoded["data"]
    if not _is_allowed_essay_mime(mime):
        raise ValueError(f"Unsupported upload MIME type: {mime or 'unknown'}")

    if "pdf" in mime.lower():
        try:
            return await asyncio.to_thread(_render_pdf_pages, raw)
        except Exception as exc:
            logger.warning(
                "[HITL] PDF decomposition failed, falling back to raw PDF: %s", exc,
            )
            return [decoded]

    compressed = await asyncio.to_thread(_compress_image, decoded)
    return [compressed] if compressed else []


def decode_task_pdf(task_pdf_b64: str | None) -> dict[str, Any] | None:
    """Decode the exam-prompt PDF as a raw Gemini part (no rasterization).

    Kept raw so Gemini can use its native PDF reasoning on the rubric
    instead of page-by-page OCR.
    """
    decoded = _decode_image(task_pdf_b64)
    if decoded is None:
        return None
    mime = decoded.get("mime_type", "").lower()
    if "pdf" not in mime:
        raise ValueError("Task prompt must be a PDF.")
    return decoded


# Default page cap for subject-detection text extraction. Two pages is
# enough to clear the cover/instructions and reach the first question
# block, which is dense with subject-specific vocabulary. Going wider
# costs CPU without changing the verdict.
_DETECT_MAX_PAGES = 2


def _extract_pdf_text_sync(raw: bytes, max_pages: int) -> str:
    """Pull plain text from the first ``max_pages`` of a PDF.

    Used by ``/api/detect-subject`` to feed real exam content (instead of
    the bare filename metadata) into ``prompts.score_subjects``. Returns
    "" on any PyMuPDF failure — the caller treats that as "no signal" and
    falls back to DEFAULT_SUBJECT.
    """
    chunks: list[str] = []
    try:
        doc = fitz.open(stream=raw, filetype="pdf")
    except Exception as exc:  # pragma: no cover — corrupt PDF
        logger.warning("[HITL] PDF open for text extract failed: %s", exc)
        return ""
    try:
        for i, page in enumerate(doc):
            if i >= max_pages:
                break
            try:
                chunks.append(page.get_text("text") or "")
            except Exception as exc:  # pragma: no cover — page-level failure
                logger.warning("[HITL] page.get_text failed on page %d: %s", i, exc)
    finally:
        doc.close()
    return "\n".join(chunks)


async def extract_pdf_text(
    task_pdf_b64: str | None,
    *,
    max_pages: int = _DETECT_MAX_PAGES,
) -> str:
    """Extract text from the first pages of an exam PDF (async wrapper).

    Returns "" when ``task_pdf_b64`` is empty or the PDF cannot be parsed.
    CPU-bound work runs in a worker thread so the FastAPI event loop stays
    responsive.
    """
    if not task_pdf_b64:
        return ""
    decoded = _decode_image(task_pdf_b64)
    if not decoded:
        return ""
    mime = decoded.get("mime_type", "").lower()
    if "pdf" not in mime:
        return ""
    raw: bytes = decoded["data"]
    return await asyncio.to_thread(_extract_pdf_text_sync, raw, max_pages)
