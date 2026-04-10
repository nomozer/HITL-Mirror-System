"""
agent.py — Dual-Persona Gemini Vision Engine (Grader + Reviewer)
Purpose: Orchestrates two Gemini VLM instances with distinct system
         instructions to grade essays from images and self-critique the
         resulting grade.
Author: [Your Name]
Research Project: Tác tử AI hỗ trợ chấm điểm tự luận đa phương thức kết hợp
                  phản hồi từ giáo viên (Human-in-the-loop VLM Grading Agent)
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any

import google.generativeai as genai
from dotenv import load_dotenv

from memory import MemoryManager
from prompt_orchestrator import PromptOrchestrator, Role

load_dotenv(override=True)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------


@dataclass
class PipelineResult:
    """Immutable output of a single grading pipeline run.

    The historical field name `code` now carries the Grader's JSON output
    (transcript + scores + comment). Kept as `code` for frontend compat.
    """

    code: str  # Grader JSON (essay grade)
    critique: dict[str, Any]
    lessons_used: list[dict[str, Any]] = field(default_factory=list)
    run_id: int | None = None
    # Transparency: the fully-assembled prompt bundles for UI inspector / research
    coder_prompt: dict[str, Any] | None = None  # Grader prompt
    critic_prompt: dict[str, Any] | None = None  # Reviewer prompt


# ---------------------------------------------------------------------------
# Agent wrappers
# ---------------------------------------------------------------------------

# Ordered by quality — auto-rotation falls through this list when quota is hit.
# All listed models support multimodal (image) inputs via Gemini Vision.
CANDIDATE_MODELS: list[str] = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash-lite",
]

# Safety settings: allow everything to avoid empty "blocked" responses
SAFETY_SETTINGS = {
    "HARM_CATEGORY_HARASSMENT": "BLOCK_NONE",
    "HARM_CATEGORY_HATE_SPEECH": "BLOCK_NONE",
    "HARM_CATEGORY_SEXUALLY_EXPLICIT": "BLOCK_NONE",
    "HARM_CATEGORY_DANGEROUS_CONTENT": "BLOCK_NONE",
}


def _configure_genai() -> None:
    """Re-read .env and configure Gemini API. Called before every pipeline run."""
    load_dotenv(override=True)
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "GOOGLE_API_KEY is missing. Set it in your .env file."
        )
    genai.configure(api_key=api_key)


def _create_model(system_instruction: str, model_name: str) -> genai.GenerativeModel:
    return genai.GenerativeModel(
        model_name=model_name,
        system_instruction=system_instruction,
        safety_settings=SAFETY_SETTINGS,
    )


def _decode_image(image_b64: str | None) -> dict[str, Any] | None:
    """Decode a base64-encoded essay file into a Gemini inline data part.

    Accepts either a raw base64 payload or a data URL
    (e.g. ``data:image/png;base64,XXXX`` or ``data:application/pdf;base64,XXXX``).
    Supports images (PNG, JPEG, etc.) and PDF files — Gemini handles both natively.
    Returns None when no file is given.
    """
    if not image_b64:
        return None
    payload = image_b64.strip()
    mime = "image/png"
    if payload.startswith("data:"):
        try:
            header, payload = payload.split(",", 1)
            mime = header.split(";")[0].removeprefix("data:") or mime
        except ValueError:
            pass
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"Invalid base64 essay image: {exc}") from exc
    return {"mime_type": mime, "data": raw}


def _parse_grade_json(text: str) -> dict[str, Any]:
    """Best-effort extraction of a Grader JSON object from VLM output."""
    cleaned = re.sub(r"```(?:json)?\s*\n?", "", text).strip()
    cleaned = cleaned.rstrip("`").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        # Fallback envelope so the UI can still render an error state.
        return {
            "transcript": "",
            "scores": {"content": 0, "argument": 0, "expression": 0, "creativity": 0},
            "overall": 0,
            "strengths": [],
            "weaknesses": ["Unparseable grader output"],
            "comment": cleaned[:400],
        }


def _parse_review_json(text: str) -> dict[str, Any]:
    """Best-effort extraction of the Reviewer's JSON critique."""
    cleaned = re.sub(r"```(?:json)?\s*\n?", "", text).strip()
    cleaned = cleaned.rstrip("`").strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass
        return {
            "issues": [
                {"dimension": "Parse Error", "description": cleaned, "line": None}
            ],
            "severity": "medium",
            "suggestion": "Could not parse reviewer output — review manually.",
        }


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

MAX_RETRIES = len(CANDIDATE_MODELS) + 2  # enough attempts to cycle all models
RETRY_BASE_DELAY = 5  # seconds — only used for per-minute rate limits


def _parse_retry_delay(err_str: str) -> float | None:
    """Extract the retry delay (in seconds) from a Google API 429 error."""
    match = re.search(r"retry(?:_delay)?.*?(\d+(?:\.\d+)?)\s*s", err_str, re.IGNORECASE)
    if match:
        return float(match.group(1))
    match = re.search(r"retry\s+in\s+(\d+(?:\.\d+)?)", err_str, re.IGNORECASE)
    if match:
        return float(match.group(1))
    return None


class AgentOrchestrator:
    """Runs the VLM Grader → Reviewer pipeline with retry & memory integration.

    Prompt assembly is delegated to PromptOrchestrator (injection-safe
    system/memory/dynamic decomposition + research logging).
    """

    def __init__(
        self,
        memory: MemoryManager | None = None,
        prompt_orchestrator: PromptOrchestrator | None = None,
    ) -> None:
        self.memory = memory or MemoryManager()
        self.prompts = prompt_orchestrator or PromptOrchestrator(self.memory)
        # Index into CANDIDATE_MODELS; advances when quota is hit.
        # Ignored when GEMINI_MODEL env var is explicitly set.
        self._model_idx: int = 0

    # ---- internal ---------------------------------------------------------

    def _current_model_name(self) -> str:
        """Return active model: explicit env override, or current candidate."""
        override = os.getenv("GEMINI_MODEL", "").strip()
        return override if override else CANDIDATE_MODELS[self._model_idx]

    def _rotate_model(self) -> None:
        """Advance to the next candidate (no-op when GEMINI_MODEL is pinned)."""
        if os.getenv("GEMINI_MODEL", "").strip():
            return  # pinned — don't rotate
        next_idx = (self._model_idx + 1) % len(CANDIDATE_MODELS)
        logger.warning(
            "[HITL] Quota exhausted on %s — rotating to %s",
            CANDIDATE_MODELS[self._model_idx],
            CANDIDATE_MODELS[next_idx],
        )
        self._model_idx = next_idx

    async def _call_with_retry(
        self,
        system_instruction: str,
        prompt: str,
        image_part: dict[str, Any] | None = None,
    ) -> str:
        """Call Gemini Vision with auto model-rotation on quota errors.

        When ``image_part`` is supplied, the call is multimodal — the essay
        image is sent alongside the textual prompt so the VLM can read both
        printed and handwritten student work.
        """
        last_exc: Exception | None = None
        for attempt in range(1, MAX_RETRIES + 1):
            model = _create_model(system_instruction, self._current_model_name())
            try:
                timeout_secs = int(os.getenv("GEMINI_TIMEOUT", "60"))
                payload: list[Any] = [prompt]
                if image_part is not None:
                    payload.insert(0, image_part)
                response = await asyncio.wait_for(
                    asyncio.to_thread(model.generate_content, payload),
                    timeout=timeout_secs,
                )
                if not response.candidates:
                    raise ValueError("Model returned no candidates.")
                if not response.text:
                    raise ValueError("Model output is empty. Please try again.")
                return response.text
            except Exception as exc:
                last_exc = exc
                err_str = str(exc)
                is_timeout = isinstance(exc, asyncio.TimeoutError)
                is_quota = "429" in err_str
                is_daily_quota = is_quota and (
                    "PerDay" in err_str or "per_day" in err_str.lower()
                    or "limit: 0," in err_str
                )
                retryable = is_timeout or is_quota or "503" in err_str

                if is_quota:
                    self._rotate_model()

                if not retryable or attempt >= MAX_RETRIES:
                    raise

                if is_daily_quota:
                    logger.warning(
                        "[HITL] Daily quota exhausted — switching to %s (attempt %d/%d)",
                        self._current_model_name(), attempt, MAX_RETRIES,
                    )
                    continue

                api_delay = _parse_retry_delay(err_str)
                delay = (api_delay if api_delay else RETRY_BASE_DELAY * attempt) + 3
                logger.warning(
                    "[HITL] %s — waiting %.0fs (attempt %d/%d, next model=%s)",
                    "Rate limited" if is_quota else "Transient error",
                    delay, attempt, MAX_RETRIES, self._current_model_name(),
                )
                await asyncio.sleep(delay)

        if last_exc is not None:
            raise last_exc
        raise RuntimeError("Pipeline retry loop exited unexpectedly.")

    # ---- public -----------------------------------------------------------

    async def run_pipeline(
        self,
        task: str,
        lang: str = "en",
        feedback: str | None = None,
        wrong_code: str | None = None,
        image_b64: str | None = None,
    ) -> PipelineResult:
        """Execute the full VLM Grader → Reviewer pipeline.

        Args:
            task:       Essay topic / question / rubric description.
            lang:       Language code ('en' or 'vi').
            feedback:   Optional teacher feedback to inject on a re-grade.
            wrong_code: AI's previous (incorrect) grade JSON, shown to the
                        Grader so it can self-correct.
            image_b64:  Base64-encoded essay image (PNG/JPEG). Optional —
                        if omitted, the Grader works from the topic alone.

        Steps:
            1. Build Grader PromptBundle (system + lessons + topic [+ feedback]).
            2. Call Gemini VLM with the essay image to produce a grade JSON.
            3. Wait 2 s (rate-limit courtesy).
            4. Build Reviewer PromptBundle (system + lessons + topic + grade).
            5. Call Gemini Reviewer; parse JSON critique.
            6. Log the pipeline run to SQLite.
        """
        # 0 — Re-read .env to pick up any API key / model changes
        _configure_genai()

        # Decode the essay image once; reused by both Grader and Reviewer.
        image_part = _decode_image(image_b64)

        # 1 — Merge wrong_code into feedback so the Grader sees exactly what
        #     it produced before and what the teacher found wrong with it.
        effective_feedback = feedback
        if wrong_code and wrong_code.strip():
            wrong_section = (
                f"Previous AI grade (had issues):\n```json\n{wrong_code.strip()}\n```"
            )
            effective_feedback = (
                f"{wrong_section}\n\nTeacher correction: {feedback}"
                if feedback else wrong_section
            )

        grader_bundle = self.prompts.build_prompt(
            role=Role.GRADER,
            task=task,
            feedback=effective_feedback,
            lang=lang,
        )

        # 2 — Call Grader VLM (multimodal: text prompt + essay image)
        raw_grade = await self._call_with_retry(
            grader_bundle.system, grader_bundle.user_content, image_part=image_part
        )
        grade_json = _parse_grade_json(raw_grade)
        grade_str = json.dumps(grade_json, ensure_ascii=False, indent=2)

        # 3 — Rate-limit gap
        await asyncio.sleep(2)

        # 4 — Build Reviewer prompt (with grader output attached as `code`)
        reviewer_bundle = self.prompts.build_prompt(
            role=Role.REVIEWER,
            task=task,
            code=grade_str,
            lang=lang,
        )

        # 5 — Call Reviewer (also multimodal so it can verify against the image)
        raw_review = await self._call_with_retry(
            reviewer_bundle.system, reviewer_bundle.user_content, image_part=image_part
        )
        critique = _parse_review_json(raw_review)

        # 6 — Log pipeline run
        # "low" severity ⇒ no manual intervention needed (auto-accepted grade).
        auto_fixed = str(critique.get("severity", "")).strip().lower() == "low"
        run_id = self.memory.log_pipeline_run(
            task=task, iterations=1, auto_fixed=auto_fixed
        )

        return PipelineResult(
            code=grade_str,
            critique=critique,
            lessons_used=grader_bundle.lessons_used,
            run_id=run_id,
            coder_prompt=grader_bundle.to_dict(),
            critic_prompt=reviewer_bundle.to_dict(),
        )
