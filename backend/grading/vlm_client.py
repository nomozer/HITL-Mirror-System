"""
vlm_client.py — Gemini VLM SDK adapter.

Owns every Gemini-specific concern in one place:
  • API-key configuration (cached so repeat calls skip the SDK call).
  • Candidate model list + quota-driven rotation.
  • JSON-mode + token-limit tuning on the generation config.
  • Retry loop with timeout and rate-limit classification.

The rest of the backend talks to this module through
``GeminiClient.call_with_retry`` and ``looks_like_timeout`` — it does
not import ``google.generativeai`` directly anywhere else.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any

import google.generativeai as genai
from dotenv import load_dotenv

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Model selection — ordered by quality; quota-exhaustion rotates to next.
# All listed models support multimodal (image) inputs via Gemini Vision.
# ---------------------------------------------------------------------------

CANDIDATE_MODELS: list[str] = [
    # "gemini-3.1-pro-preview",
    "gemini-3-flash-preview",
    # "gemini-2.5-pro",
    "gemini-2.5-flash",
]

MAX_RETRIES = len(CANDIDATE_MODELS) + 2  # enough attempts to cycle all models
RETRY_BASE_DELAY = 5  # seconds — only used for per-minute rate limits

# Safety settings: allow everything to avoid empty "blocked" responses.
SAFETY_SETTINGS = {
    "HARM_CATEGORY_HARASSMENT": "BLOCK_NONE",
    "HARM_CATEGORY_HATE_SPEECH": "BLOCK_NONE",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT": "BLOCK_NONE",
    "HARM_CATEGORY_DANGEROUS_CONTENT": "BLOCK_NONE",
}


# ---------------------------------------------------------------------------
# Error classification — shared with the HTTP layer so the 502-vs-504
# mapping stays consistent with the retry-path classification rules.
# ---------------------------------------------------------------------------


def looks_like_timeout(err_str: str) -> bool:
    """True when an upstream-error message looks like a gateway/deadline timeout.

    ``\\b504\\b`` (word boundary) instead of substring ``"504"`` — the old
    substring check also matched text like "504 requests per day" inside
    quota messages, misrouting quota errors through the timeout path.
    """
    err_lower = err_str.lower()
    return (
        bool(re.search(r"\b504\b", err_str))
        or "timed out" in err_lower
        or "gateway timeout" in err_lower
        or ("deadline" in err_lower and ("exceed" in err_lower or "expired" in err_lower))
    )


def _is_timeout_like_error(exc: Exception) -> bool:
    """Classify local and upstream timeout failures as retryable."""
    return isinstance(exc, asyncio.TimeoutError) or looks_like_timeout(str(exc))


def _parse_retry_delay(err_str: str) -> float | None:
    """Extract the retry delay (in seconds) from a Google API 429 error."""
    match = re.search(r"retry(?:_delay)?.*?(\d+(?:\.\d+)?)\s*s", err_str, re.IGNORECASE)
    if match:
        return float(match.group(1))
    match = re.search(r"retry\s+in\s+(\d+(?:\.\d+)?)", err_str, re.IGNORECASE)
    if match:
        return float(match.group(1))
    return None


# ---------------------------------------------------------------------------
# API-key configuration — cached so repeat calls don't re-invoke the SDK.
# ---------------------------------------------------------------------------

_configured_api_key: str | None = None


def _ensure_configured() -> None:
    """Configure the Gemini SDK, reloading .env only when the key changed.

    The original code re-ran ``load_dotenv`` + ``genai.configure`` on
    every request; on a typical deploy the key never changes mid-session,
    so we cache the last-configured value and skip the redundant SDK call.
    """
    global _configured_api_key
    load_dotenv(override=True)
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "GOOGLE_API_KEY is missing. Set it in your .env file."
        )
    if api_key != _configured_api_key:
        genai.configure(api_key=api_key)
        _configured_api_key = api_key


def _create_model(
    system_instruction: str,
    model_name: str,
    *,
    json_mode: bool = False,
    max_output_tokens: int = 32768,
) -> genai.GenerativeModel:
    """Build a Gemini model with our standard generation config.

    ``json_mode`` forces ``response_mime_type=application/json`` which
    prevents text-truncation failures that previously produced partial
    JSON in the grader output.
    """
    gen_config: dict[str, Any] = {
        "max_output_tokens": max_output_tokens,
        "temperature": 0.0,
    }
    if json_mode:
        gen_config["response_mime_type"] = "application/json"
    return genai.GenerativeModel(
        model_name=model_name,
        system_instruction=system_instruction,
        safety_settings=SAFETY_SETTINGS,
        generation_config=gen_config,
    )


# ---------------------------------------------------------------------------
# GeminiClient — stateful wrapper with model rotation + retry
# ---------------------------------------------------------------------------


class GeminiClient:
    """Thin Gemini wrapper: quota-aware model rotation + retry.

    Holds the current-model index so successive calls rotate when a
    model's quota is exhausted. Shared by all AgentOrchestrator calls
    (grading + analyze-comment) so rotation persists across call types.
    """

    def __init__(self) -> None:
        # Advances when quota is hit. Ignored when GEMINI_MODEL is pinned.
        self._model_idx = 0

    def current_model_name(self) -> str:
        """Return active model: explicit env override, or current candidate."""
        override = os.getenv("GEMINI_MODEL", "").strip()
        return override if override else CANDIDATE_MODELS[self._model_idx]

    def rotate_model(self) -> None:
        """Advance to the next candidate.

        No-op when GEMINI_MODEL env var is pinned, or when only a single
        candidate is configured (rotating to itself buys nothing).
        """
        if os.getenv("GEMINI_MODEL", "").strip():
            return
        if len(CANDIDATE_MODELS) <= 1:
            logger.warning(
                "[HITL] Quota exhausted on %s — no fallback model configured",
                CANDIDATE_MODELS[self._model_idx],
            )
            return
        next_idx = (self._model_idx + 1) % len(CANDIDATE_MODELS)
        logger.warning(
            "[HITL] Quota exhausted on %s — rotating to %s",
            CANDIDATE_MODELS[self._model_idx],
            CANDIDATE_MODELS[next_idx],
        )
        self._model_idx = next_idx

    async def call_with_retry(
        self,
        system_instruction: str,
        prompt: str,
        image_parts: list[dict[str, Any]] | None = None,
        task_pdf_part: dict[str, Any] | None = None,
        *,
        json_mode: bool = False,
        max_output_tokens: int = 32768,
    ) -> str:
        """Call Gemini with auto model-rotation on quota errors.

        Multimodal call: essay images + exam-prompt PDF + text prompt are
        packed into a single ``generate_content`` payload. The order is
        images → PDF → text so the VLM reads the student work before
        the rubric, matching how a teacher grades.
        """
        _ensure_configured()

        last_exc: Exception | None = None
        for attempt in range(1, MAX_RETRIES + 1):
            model = _create_model(
                system_instruction,
                self.current_model_name(),
                json_mode=json_mode,
                max_output_tokens=max_output_tokens,
            )
            try:
                payload_count = (len(image_parts) if image_parts else 0) + (
                    1 if task_pdf_part is not None else 0
                )
                # Multi-page PDFs need ~45 s per page — scale timeout so
                # a 5-page scan doesn't spuriously trip the watchdog.
                default_timeout_secs = 60 + (45 * max(1, payload_count))
                timeout_secs = int(
                    os.getenv("GEMINI_TIMEOUT", str(default_timeout_secs))
                )
                watchdog_timeout = timeout_secs + 15

                # Order: images → PDF → prompt. Using extend/append instead
                # of the old insert(0) loop — same result, O(n) not O(n²).
                payload: list[Any] = []
                if image_parts:
                    payload.extend(image_parts)
                if task_pdf_part is not None:
                    payload.append(task_pdf_part)
                payload.append(prompt)

                response = await asyncio.wait_for(
                    asyncio.to_thread(
                        model.generate_content,
                        payload,
                        request_options={"timeout": timeout_secs},
                    ),
                    timeout=watchdog_timeout,
                )
                if not response.candidates:
                    raise ValueError("Model returned no candidates.")
                if not response.text:
                    raise ValueError("Model output is empty. Please try again.")
                return response.text
            except Exception as exc:
                last_exc = exc
                err_str = str(exc)
                err_lower = err_str.lower()
                is_timeout = _is_timeout_like_error(exc)
                is_quota = "429" in err_str
                is_daily_quota = is_quota and (
                    "PerDay" in err_str or "per_day" in err_lower
                    or "limit: 0," in err_str
                )
                retryable = is_timeout or is_quota or "503" in err_str

                if is_quota:
                    self.rotate_model()

                if not retryable or attempt >= MAX_RETRIES:
                    raise

                if is_daily_quota:
                    logger.warning(
                        "[HITL] Daily quota exhausted — switching to %s (attempt %d/%d)",
                        self.current_model_name(), attempt, MAX_RETRIES,
                    )
                    continue

                api_delay = _parse_retry_delay(err_str)
                delay = (api_delay if api_delay else RETRY_BASE_DELAY * attempt) + 3
                logger.warning(
                    "[HITL] %s — waiting %.0fs (attempt %d/%d, next model=%s)",
                    "Rate limited" if is_quota else "Transient error",
                    delay, attempt, MAX_RETRIES, self.current_model_name(),
                )
                await asyncio.sleep(delay)

        if last_exc is not None:
            raise last_exc
        raise RuntimeError("Pipeline retry loop exited unexpectedly.")
