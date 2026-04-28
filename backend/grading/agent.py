"""
agent.py — HITL Grading Orchestrator.

Owns the end-to-end grading pipeline: prompt assembly → Gemini VLM call
→ JSON parse → memory logging. Delegates concerns to dedicated modules:

  • ``vlm_client``     — Gemini SDK config + retry + model rotation
  • ``file_processor`` — Image/PDF decode + compress + rasterize
  • ``grade_parser``   — JSON parsing + comment-analysis fallback

Single Gemini call per grading request — the teacher provides quality
assurance via the HITL feedback loop instead of an AI Reviewer agent.

Research Project: Tác tử AI hỗ trợ chấm điểm tự luận đa phương thức kết hợp
                  phản hồi từ giáo viên (Human-in-the-loop VLM Grading Agent)
"""

from __future__ import annotations

import asyncio
import collections
import json
import logging
from dataclasses import dataclass, field
from typing import Any

# Sibling modules within the ``grading`` package use relative imports;
# cross-package deps (memory, prompts) stay absolute.
from .file_processor import decode_task_pdf, process_input_file
from .grade_parser import (
    ANALYZE_COMMENT_FALLBACK,
    fallback_comment_analysis,
    is_meaningful_text,
    parse_comment_analysis,
    parse_grade_json,
)
from .prompt_orchestrator import PromptOrchestrator
from .vlm_client import GeminiClient, looks_like_timeout
from memory import MemoryManager
from prompts import ANALYZE_COMMENT_SYSTEM, ANALYZE_COMMENT_USER_TEMPLATE

# Re-exported via ``grading/__init__.py`` so ``main.py`` can do
# ``from grading import AgentOrchestrator, looks_like_timeout``.
# without knowing about the vlm_client module.
__all__ = ["AgentOrchestrator", "PipelineResult", "looks_like_timeout"]

logger = logging.getLogger(__name__)

# Server-side file cache: keep decoded image/pdf parts so regrade requests
# don't need to re-upload the same 10–30 MB base64 payload.
MAX_FILE_CACHE = 50


@dataclass
class PipelineResult:
    """Immutable output of a single grading pipeline run.

    The historical field name ``code`` carries the Grader's JSON output
    (transcript + scores + comment). Kept as ``code`` for frontend compat.
    """

    code: str
    lessons_used: list[dict[str, Any]] = field(default_factory=list)
    run_id: int | None = None


class AgentOrchestrator:
    """Runs the end-to-end VLM Grading pipeline.

    Single Gemini call per grading request — the teacher provides quality
    assurance via the HITL feedback loop instead of an AI Reviewer agent.
    """

    def __init__(
        self,
        memory: MemoryManager | None = None,
        prompt_orchestrator: PromptOrchestrator | None = None,
    ) -> None:
        self.memory = memory or MemoryManager()
        self.prompts = prompt_orchestrator or PromptOrchestrator(self.memory)
        self.gemini = GeminiClient()
        # LRU file cache: run_id → (image_parts, task_pdf_part)
        self._file_cache: collections.OrderedDict[int, tuple] = collections.OrderedDict()

    # ---- file cache -----------------------------------------------------

    def _cache_files(
        self,
        run_id: int,
        image_parts: list[dict] | None,
        task_pdf_part: dict | None,
    ) -> None:
        """Store decoded file parts so regrade can reuse them."""
        if run_id is None:
            return
        self._file_cache[run_id] = (image_parts, task_pdf_part)
        while len(self._file_cache) > MAX_FILE_CACHE:
            self._file_cache.popitem(last=False)

    def _get_cached_files(
        self, run_id: int | None,
    ) -> tuple[list[dict] | None, dict | None]:
        """Retrieve cached file parts for a previous pipeline run."""
        if run_id is None:
            return None, None
        entry = self._file_cache.get(run_id)
        if entry:
            self._file_cache.move_to_end(run_id)  # refresh LRU position
            return entry
        return None, None

    # ---- public API -----------------------------------------------------

    async def run_pipeline(
        self,
        task: str,
        feedback: str | None = None,
        wrong_code: str | None = None,
        image_b64: str | None = None,
        task_pdf_b64: str | None = None,
        parent_run_id: int | None = None,
        subject: str | None = None,
        **_ignored: Any,
    ) -> PipelineResult:
        """Execute the end-to-end VLM Grading pipeline (single Gemini call).

        Steps:
          1. Build Grader PromptBundle ∥ rasterize input file (concurrent).
          2. Call Gemini VLM with the text prompt + PDF + essay pages.
          3. Parse the JSON envelope, stamp subject, log the run, cache files.

        Args:
            task:          Essay topic / question / rubric description.
            feedback:      Optional teacher feedback injected on a re-grade.
            wrong_code:    Previous (incorrect) grade JSON, shown so the
                           Grader can self-correct.
            image_b64:     Base64-encoded essay file (image or multi-page PDF).
            task_pdf_b64:  Base64-encoded exam-prompt PDF.
            parent_run_id: Previous run ID when this is a teacher-triggered
                           re-grade (forms a chain for research metrics).
            subject:       Optional subject hint ("math" / "cs"). Falls back
                           to keyword-detection + DEFAULT_SUBJECT.
        """
        # File rasterization (PDFs can take 1-3s) is independent of the
        # prompt assembly (SQLite + Chroma lookups). Run them concurrently
        # so memory retrieval happens while PyMuPDF renders pages.
        # wrong_code and feedback go through SEPARATE channels in
        # build_prompt — previously they were stitched together and hit
        # the 2000-char feedback cap, which truncated long grade JSON in
        # regrade rounds.
        image_parts, grader_bundle = await asyncio.gather(
            process_input_file(image_b64),
            asyncio.to_thread(
                self.prompts.build_prompt,
                task=task,
                feedback=feedback,
                wrong_code=wrong_code,
                subject=subject,
            ),
        )

        # Prompt PDFs kept raw so Gemini can use its native PDF reasoning.
        task_pdf_part = decode_task_pdf(task_pdf_b64)

        # Regrade shortcut: if no files were sent but a parent run exists,
        # pull the decoded parts from cache to avoid re-uploading.
        if not image_parts and parent_run_id is not None:
            cached_imgs, cached_pdf = self._get_cached_files(parent_run_id)
            if cached_imgs:
                image_parts = cached_imgs
                logger.info(
                    "[HITL] Reusing %d cached essay images from run %d",
                    len(image_parts), parent_run_id,
                )
            if task_pdf_part is None and cached_pdf is not None:
                task_pdf_part = cached_pdf
                logger.info(
                    "[HITL] Reusing cached task PDF from run %d", parent_run_id,
                )

        # Force JSON mime-type + raised token ceiling so the Grader cannot
        # emit truncated / markdown-wrapped output that breaks the review UI.
        # 32768 buffers long Vietnamese math/CS essays where 16384 was
        # truncating mid per_question_feedback (CLAUDE.md "stop after PQF"
        # failure mode). max_output_tokens is a ceiling, not a target —
        # Gemini stops on its own well below this for short essays, so this
        # does NOT increase latency on normal grades.
        raw_grade = await self.gemini.call_with_retry(
            grader_bundle.system, grader_bundle.user_content,
            image_parts=image_parts, task_pdf_part=task_pdf_part,
            json_mode=True, max_output_tokens=32768,
        )
        grade_json = parse_grade_json(raw_grade)
        # Always "stem" for frontend compat — math/cs share the same STEM
        # rubric set. The internal subject dispatch (math vs cs) lives only
        # in the system prompt; the grade envelope stays uniform.
        grade_json["subject"] = "stem"
        grade_str = json.dumps(grade_json, ensure_ascii=False, indent=2)

        run_id = self.memory.log_pipeline_run(
            task=task, iterations=1, auto_fixed=False,
            parent_run_id=parent_run_id,
        )
        self._cache_files(run_id, image_parts, task_pdf_part)

        return PipelineResult(
            code=grade_str,
            lessons_used=grader_bundle.lessons_used,
            run_id=run_id,
        )

    async def analyze_teacher_comment(
        self,
        question: str,
        student_answer: str,
        teacher_comment: str,
    ) -> dict[str, str]:
        """Analyze a teacher's comment and distill it into a reusable lesson.

        Returns three views of the same correction:
          • ``verdict``  ("agree" | "partial" | "dispute"): AI's judgment
            of whether the teacher misread the student's work. ``dispute``
            tells the UI to require explicit confirmation before staging
            the lesson into HITL memory.
          • ``analysis`` (≤80 words): conversational response shown in the
            per-question chat thread, with evidence from the student work.
          • ``lesson``   (≤60 words): distilled rule for embedding + future
            Grader prompt injection (the HITL signal). When verdict is
            "dispute", lesson is rewritten as a defensive rule that
            protects against the teacher's misread instead of codifying it.

        Single Gemini call in JSON mode to minimise latency and token cost.
        A fallback synthesizer fills in when the model returns empty fields
        (common with praise-only comments) — fallback always uses
        ``verdict="agree"`` since it can't independently verify the answer.
        """
        prompt = ANALYZE_COMMENT_USER_TEMPLATE.format(
            question=question,
            student_answer=student_answer,
            teacher_comment=teacher_comment,
        )
        # Cap at 768 tokens — slightly above the 512 used for the simpler
        # 2-field schema, since analysis now has room for evidence-based
        # rationale and we don't want JSON-mode truncation mid-string.
        raw = await self.gemini.call_with_retry(
            ANALYZE_COMMENT_SYSTEM, prompt,
            json_mode=True, max_output_tokens=768,
        )
        parsed = parse_comment_analysis(raw)
        verdict = parsed.get("verdict", "agree")
        analysis = parsed.get("analysis", "").strip()
        lesson = parsed.get("lesson", "").strip()

        # Word-count guards — stricter than empty-string check. Catches the
        # "Đúng," failure mode where Gemini returns valid JSON but a useless
        # 1-2 word analysis. Thresholds match the prompt's "TỐI THIỂU N từ".
        analysis_ok = is_meaningful_text(analysis, min_words=8)
        lesson_ok = is_meaningful_text(lesson, min_words=6)

        if not analysis_ok or not lesson_ok:
            logger.info(
                "[HITL] analyze-comment underdelivered (analysis_ok=%s lesson_ok=%s) — applying fallback",
                analysis_ok, lesson_ok,
            )
            synthesized = fallback_comment_analysis(
                teacher_comment, student_answer=student_answer,
            )
            if not analysis_ok:
                analysis = synthesized.get("analysis", "").strip()
            if not lesson_ok:
                lesson = synthesized.get("lesson", "").strip()

        # Never surface broken JSON fragments to the chat bubble.
        if not is_meaningful_text(analysis):
            logger.warning(
                "[HITL] analyze-comment returned unusable payload; using fallback. raw=%r",
                raw[:200],
            )
            analysis = ANALYZE_COMMENT_FALLBACK
        return {"verdict": verdict, "analysis": analysis, "lesson": lesson}
