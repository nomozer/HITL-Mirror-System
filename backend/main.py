"""
main.py — FastAPI Backend for the HITL VLM Grading Agent

Responsibilities (kept deliberately small):
    • App bootstrap (FastAPI, CORS, lifespan)
    • Singleton wiring (MemoryManager → PromptOrchestrator → AgentOrchestrator)
    • Route handlers for the 5 grading/feedback endpoints
    • Including the heartbeat router from ``api.heartbeat``

Domain layout — each folder = one chapter of the report:
    • api/      — Pydantic schemas + heartbeat router + CSRF middleware
    • grading/  — AgentOrchestrator + Gemini client + scoring + helpers
    • memory/   — Dual-store (SQLite + ChromaDB) + JSONL event log
    • prompts/  — Subject-aware system prompts (math, cs, phys)

Research Project: Tác tử AI hỗ trợ chấm điểm tự luận đa phương thức kết hợp
                  phản hồi từ giáo viên (Human-in-the-loop VLM Grading Agent)
"""

from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

logger = logging.getLogger(__name__)

# Windows default console encoding is cp1252 — reconfigure stdout/stderr to
# UTF-8 so Vietnamese text in logs does not raise UnicodeEncodeError.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

# uvicorn is launched from backend/, so direct imports (no "backend." prefix).
from api.heartbeat import router as heartbeat_router, start_watchdog
from api.history import router as history_router, attach_history_memory
from api.memory import router as memory_router, attach_memory
from api.middleware import (
    make_csrf_origin_guard,
    make_request_size_guard,
    make_security_headers_middleware,
    normalize_origin,
)
from api.schemas import (
    AnalyzeCommentRequest,
    AnalyzeCommentResponse,
    DetectSubjectRequest,
    DetectSubjectResponse,
    FeedbackRequest,
    FeedbackResponse,
    FinalizeGradeRequest,
    FinalizeGradeResponse,
    GenerateRequest,
    GenerateResponse,
    RegradeRequest,
    RegradeResponse,
)
from grading import (
    AgentOrchestrator,
    PromptOrchestrator,
    compute_per_question_deltas,
    compute_score_deltas,
    extract_pdf_text,
    format_delta_lesson,
    looks_like_timeout,
    safe_delta,
)
from memory import MemoryManager, log_event as log_hitl_event
from prompts import DEFAULT_SUBJECT, pick_top_subject, score_subjects

# Kick off heartbeat watchdog before FastAPI bootstrap so it catches startup
# failures too. No-op under DEV_MODE=1.
start_watchdog()


# ---------------------------------------------------------------------------
# App bootstrap
# ---------------------------------------------------------------------------

_DEFAULT_CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
_BACKEND_DEV_ORIGINS = ("http://localhost:8000", "http://127.0.0.1:8000")
_DEFAULT_ALLOWED_HOSTS = "localhost,127.0.0.1"


def _split_csv_env(name: str, default: str = "") -> list[str]:
    return [
        item.strip().rstrip("/")
        for item in os.getenv(name, default).split(",")
        if item.strip()
    ]


def _env_flag(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


CORS_ORIGINS = _split_csv_env("CORS_ORIGINS", _DEFAULT_CORS_ORIGINS)
ALLOWED_HOSTS = _split_csv_env("ALLOWED_HOSTS", _DEFAULT_ALLOWED_HOSTS)
CSRF_TRUSTED_ORIGINS = tuple(
    dict.fromkeys(
        [
            *(normalize_origin(origin) for origin in CORS_ORIGINS),
            *(
                normalize_origin(origin)
                for origin in _split_csv_env("CSRF_TRUSTED_ORIGINS", "")
            ),
            *_BACKEND_DEV_ORIGINS,
        ]
    )
)
CSRF_ORIGIN_CHECK_ENABLED = _env_flag("CSRF_ORIGIN_CHECK", "1")
CORS_ALLOW_CREDENTIALS = _env_flag("CORS_ALLOW_CREDENTIALS", "0")
MAX_REQUEST_BODY_BYTES = int(os.getenv("MAX_REQUEST_BODY_BYTES", str(40 * 1024 * 1024)))
PROMPT_LOGS_ENABLED = _env_flag("HITL_PROMPT_LOGS", "0")


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="HITL VLM Grading Agent API",
    lifespan=lifespan,
    version="0.1.0",
    description="Backend for the Human-in-the-Loop multimodal essay-grading system",
)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)
app.middleware("http")(make_security_headers_middleware())
app.middleware("http")(make_request_size_guard(MAX_REQUEST_BODY_BYTES))
app.middleware("http")(
    make_csrf_origin_guard(
        CSRF_TRUSTED_ORIGINS,
        enabled=CSRF_ORIGIN_CHECK_ENABLED,
    )
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.include_router(heartbeat_router)
app.include_router(memory_router)
app.include_router(history_router)

# Singletons: memory drives prompt retrieval, prompt drives grading.
memory = MemoryManager()
prompt_orch = PromptOrchestrator(
    memory,
    k_lessons=3,
    log_dir=(
        Path(__file__).resolve().parent / "data" / "prompt_logs"
        if PROMPT_LOGS_ENABLED
        else None
    ),
)
orchestrator = AgentOrchestrator(memory=memory, prompt_orchestrator=prompt_orch)

# Inject the singleton into the memory router so its handlers can use it.
attach_memory(memory)
attach_history_memory(memory)


# ---------------------------------------------------------------------------
# Helpers (shared by multiple endpoints)
# ---------------------------------------------------------------------------


def _pipeline_http_error(exc: Exception) -> HTTPException:
    """Map a pipeline exception to a 504 (timeout) or 502 (upstream) HTTPException.

    Keeps the UI's timeout-vs-upstream distinction intact instead of
    flattening everything to 502. Shares its timeout phrase-matching with
    the retry classifier via ``agent.looks_like_timeout``.
    """
    detail = str(exc)
    status_code = 504 if looks_like_timeout(detail) else 502
    logger.exception("Pipeline error (returning %d): %s", status_code, detail)
    safe_detail = (
        "AI upstream timed out. Please try again."
        if status_code == 504
        else "AI upstream request failed. Please check backend logs."
    )
    return HTTPException(status_code=status_code, detail=safe_detail)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest):
    """Run the Gemini VLM Grader pipeline for a given essay.

    Despite the legacy URL ``/api/generate``, this is a multimodal grading
    endpoint. Provide ``image_b64`` to enable true VLM grading; omit it to
    fall back to topic-only grading.
    """
    try:
        result = await orchestrator.run_pipeline(
            req.task,
            feedback=req.feedback,
            wrong_code=req.wrong_code,
            image_b64=req.image_b64,
            task_pdf_b64=req.task_pdf_b64,
            subject=req.subject,
        )
        return GenerateResponse(
            code=result.code,
            lessons_used=result.lessons_used,
            run_id=result.run_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise _pipeline_http_error(exc) from exc


@app.post("/api/regrade", response_model=RegradeResponse)
async def regrade(req: RegradeRequest):
    """Atomic HITL re-grade: save feedback → re-run pipeline.

    Primary endpoint for the revise/reject path.  Guarantees the teacher's
    correction is persisted as a lesson BEFORE the pipeline re-runs, so
    the Grader always sees the latest feedback.
    """
    action = req.action.lower().strip()
    if action not in {"revise", "reject"}:
        raise HTTPException(
            status_code=400,
            detail='action must be "revise" or "reject"',
        )
    comment = req.comment.strip()
    if not comment:
        raise HTTPException(
            status_code=400,
            detail='"comment" is required for regrade.',
        )

    # 1 — Persist lesson (reject=5.0 > revise=4.0, per retrieval ordering)
    score = 5.0 if action == "reject" else 4.0
    lesson_id = prompt_orch.ingest_feedback(
        task=req.task,
        wrong_code=req.wrong_code,
        correct_code="",
        lesson_text=comment,
        score=score,
        subject=req.subject,
    )
    log_hitl_event(
        action,
        task=req.task,
        lesson_id=lesson_id,
        via="regrade",
        run_id=req.run_id,
    )

    # 2 — Build feedback text and re-run pipeline
    feedback_text = f"Teacher action: {action}\nTeacher note: {comment}"
    try:
        result = await orchestrator.run_pipeline(
            req.task,
            feedback=feedback_text,
            wrong_code=req.wrong_code,
            image_b64=req.image_b64,
            task_pdf_b64=req.task_pdf_b64,
            parent_run_id=req.run_id,
            subject=req.subject,
        )
        return RegradeResponse(
            code=result.code,
            lessons_used=result.lessons_used,
            run_id=result.run_id,
            lesson_id=lesson_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise _pipeline_http_error(exc) from exc


@app.post("/api/feedback", response_model=FeedbackResponse)
async def feedback(req: FeedbackRequest):
    """Ingest structured teacher feedback from the right-side review panel.

    Routing rules:
      - "approve" → persist the approved grade as a positive HITL signal.
                    Staged per-question lessons (score 3.5) are preferred
                    over the aggregated comment (score 3.0) when both exist.
      - "revise"  → persist as a lesson (score 4.0) — useful correction.
      - "reject"  → persist as a lesson (score 5.0) — strongest signal.

    NOTE: PromptOrchestrator sorts retrieved lessons by feedback_score DESC
    before injecting them into the prompt, so a HIGHER score ⇒ greater
    influence on the next grading round. Reject must therefore be the highest.
    """
    action = req.action.lower().strip()
    if action not in {"approve", "revise", "reject"}:
        raise HTTPException(
            status_code=400,
            detail='action must be one of "approve", "revise", "reject"',
        )

    if action == "approve":
        return _handle_approve(req)

    if not req.comment.strip():
        raise HTTPException(
            status_code=400,
            detail='"comment" is required when action is "revise" or "reject".',
        )

    # reject > revise: stronger rejection must dominate retrieval ordering
    score = 5.0 if action == "reject" else 4.0
    lesson_id = prompt_orch.ingest_feedback(
        task=req.task,
        wrong_code=req.wrong_code,
        correct_code="",  # no teacher-edited corrected grade from this endpoint
        lesson_text=req.comment.strip(),
        score=score,
        subject=req.subject,
    )
    log_hitl_event(
        action,
        task=req.task,
        lesson_id=lesson_id,
        via="feedback",
        run_id=req.run_id,
    )
    return FeedbackResponse(
        action=action,
        saved=True,
        lesson_id=lesson_id,
        message="Lesson persisted. Next /api/generate run will retrieve it.",
    )


def _handle_approve(req: FeedbackRequest) -> FeedbackResponse:
    """Approve path of /api/feedback — extracted to keep the router flat.

    Persists the approved grade, back-fills correct_code on earlier lessons,
    and stores per-question annotations (preferring staged lessons over the
    raw aggregated comment).
    """
    approved_id: int | None = None
    grade = req.wrong_code.strip()
    if grade:
        approved_id = memory.save_approved_grade(
            task=req.task,
            grade_json=grade,
            run_id=req.run_id,
        )
        # Back-propagate the approved grade as correct_code into any lessons
        # created during earlier revise/reject cycles for this task.
        memory.backfill_correct_code(task=req.task, correct_code=grade)

    # Prefer the structured ``staged_lessons`` (per-question distilled rules
    # from /api/analyze-comment) — they embed much better than the aggregated
    # blob. Fall back to the free-form ``comment`` only if none were staged.
    lesson_ids: list[int] = []
    if req.staged_lessons:
        for staged in req.staged_lessons:
            text = staged.lesson_text.strip()
            if not text:
                continue
            prefix = f"[{staged.question_ref}] " if staged.question_ref else ""
            lesson_ids.append(
                prompt_orch.ingest_feedback(
                    task=req.task,
                    wrong_code="",
                    correct_code=grade,
                    lesson_text=f"{prefix}{text}",
                    score=3.5,  # per-question distilled rule > raw annotation (3.0)
                    subject=req.subject,
                )
            )
    elif req.comment.strip():
        lesson_ids.append(
            prompt_orch.ingest_feedback(
                task=req.task,
                wrong_code="",
                correct_code=grade,
                lesson_text=req.comment.strip(),
                score=3.0,
                subject=req.subject,
            )
        )

    saved = approved_id is not None or bool(lesson_ids)
    log_hitl_event(
        "approve",
        task=req.task,
        approved_id=approved_id,
        staged=len(req.staged_lessons),
        lesson_ids=lesson_ids,
    )
    message = (
        f"Grade approved and {len(lesson_ids)} lesson(s) saved."
        if lesson_ids else "Grade approved and recorded."
    )
    return FeedbackResponse(
        action="approve",
        saved=saved,
        lesson_id=lesson_ids[0] if lesson_ids else approved_id,
        lesson_ids=lesson_ids,
        message=message,
    )


@app.post("/api/finalize-grade", response_model=FinalizeGradeResponse)
async def finalize_grade(req: FinalizeGradeRequest):
    """Persist a teacher-finalized grade and capture numeric score deltas.

    Strongest HITL signal the UI captures — a concrete rubric-level
    correction (e.g. AI gave 7.5 / content, teacher gave 5.0).  The delta
    lesson complements per-question lessons from /api/feedback: together
    they teach the Grader both *how to narrate* the correction and *by how
    much* to adjust the score.

    Learning thresholds tuned to the VN 10-point rubric:
      • per-rubric:  0.25  (the smallest meaningful step teachers use)
      • per-câu:     0.25  (same step size — câu scores live on the same scale)
      • overall:     0.10  (overall = sum of per-câu, deltas smooth out)

    Two score axes are compared independently and folded into ONE lesson:
      * Rubric (content/argument/expression/creativity) — legacy 4-dim.
      * Per-câu (Câu 1/2/…) — what the current UI actually edits in step 4.
    Combining them in a single lesson avoids double-counting one correction
    in the score-weighted retrieval ranking. Dedup via ``find_recent_lesson``
    keeps double-clicks on "Đã lưu" from polluting the corpus.
    """
    PER_RUBRIC_THRESHOLD = 0.25
    PER_QUESTION_THRESHOLD = 0.25
    OVERALL_THRESHOLD = 0.10
    DEDUP_WINDOW_SECONDS = 300

    rubric_deltas = compute_score_deltas(
        req.ai_scores, req.teacher_scores, PER_RUBRIC_THRESHOLD
    )
    per_question_deltas = compute_per_question_deltas(
        req.ai_per_question, req.teacher_per_question, PER_QUESTION_THRESHOLD
    )
    overall_delta = safe_delta(req.ai_overall, req.teacher_overall)

    # Persist the approved grade (research-grade audit log). Idempotent via
    # the UNIQUE INDEX on approved_grades — no need to pre-check.
    approved_id: int | None = None
    approved_grade_json = req.approved_grade_json.strip()
    if approved_grade_json:
        approved_id = memory.save_approved_grade(
            task=req.task,
            grade_json=approved_grade_json,
            run_id=req.run_id,
        )
        # Finalize is the one place that knows the teacher-approved JSON.
        # Back-fill older revise/reject lessons here so Step 4 no longer
        # needs to call /api/feedback with a premature "approve" signal.
        memory.backfill_correct_code(task=req.task, correct_code=approved_grade_json)

    # Save review annotations atomically with finalization. Prefer the
    # distilled per-question lessons staged by the frontend; fall back to an
    # aggregate comment only when no structured lessons were staged.
    comment_lesson_ids: list[int] = []

    def _save_comment_lesson(text: str, score: float) -> int:
        existing_id = memory.find_recent_lesson(
            task=req.task,
            lesson_text=text,
            feedback_score=score,
            within_seconds=DEDUP_WINDOW_SECONDS,
        )
        if existing_id is not None:
            return existing_id
        return prompt_orch.ingest_feedback(
            task=req.task,
            wrong_code="",
            correct_code=approved_grade_json,
            lesson_text=text,
            score=score,
            subject=req.subject,
        )

    if req.staged_lessons:
        for staged in req.staged_lessons:
            text = staged.lesson_text.strip()
            if not text:
                continue
            prefix = f"[{staged.question_ref}] " if staged.question_ref else ""
            comment_lesson_ids.append(
                _save_comment_lesson(f"{prefix}{text}", 3.5)
            )
    elif req.comment.strip():
        comment_lesson_ids.append(_save_comment_lesson(req.comment.strip(), 3.0))

    # Auto-generate a lesson capturing the numeric correction so future
    # grading runs can learn the AI's tendency. Fires if ANY axis has a
    # delta above its threshold — including per-câu, which is the path that
    # 100% of teacher edits flow through under the current step-4 UI.
    delta_lesson_id: int | None = None
    has_signal = bool(rubric_deltas) or bool(per_question_deltas) or (
        overall_delta is not None and abs(overall_delta) >= OVERALL_THRESHOLD
    )
    if has_signal:
        lesson_text = format_delta_lesson(
            ai_overall=req.ai_overall,
            teacher_overall=req.teacher_overall,
            overall_delta=overall_delta,
            ai_scores=req.ai_scores,
            teacher_scores=req.teacher_scores,
            rubric_deltas=rubric_deltas,
            ai_per_question=req.ai_per_question,
            teacher_per_question=req.teacher_per_question,
            per_question_deltas=per_question_deltas,
        )
        # Idempotent save: a recent identical lesson (same task + same
        # rendered text + same score tier) means the teacher already
        # finalized this correction. Returning the existing id keeps the
        # corpus clean instead of duplicating the embedding/row.
        existing_id = memory.find_recent_lesson(
            task=req.task,
            lesson_text=lesson_text,
            feedback_score=4.0,
            within_seconds=DEDUP_WINDOW_SECONDS,
        )
        if existing_id is not None:
            delta_lesson_id = existing_id
        else:
            delta_lesson_id = prompt_orch.ingest_feedback(
                task=req.task,
                wrong_code="",
                correct_code=approved_grade_json,
                lesson_text=lesson_text,
                score=4.0,  # stronger than per-Q annotations (3.5), weaker than reject (5.0)
                subject=req.subject,
            )

    deltas_out: dict[str, float] = dict(rubric_deltas)
    for cau, d in per_question_deltas.items():
        # Prefix per-câu keys so the API response can distinguish them from
        # rubric keys ("content" vs "cau:1") without changing the dict shape.
        deltas_out[f"cau:{cau}"] = d
    if overall_delta is not None:
        deltas_out["overall"] = overall_delta

    rubric_count = len(rubric_deltas)
    cau_count = len(per_question_deltas)
    if delta_lesson_id:
        message = (
            f"Finalized. Captured {rubric_count} rubric delta(s) "
            f"and {cau_count} per-câu delta(s)."
        )
    else:
        message = "Finalized. No significant delta to learn from."
    log_hitl_event(
        "finalize",
        task=req.task,
        approved_id=approved_id,
        delta_lesson_id=delta_lesson_id,
        comment_lesson_ids=comment_lesson_ids,
        deltas=deltas_out,
    )
    return FinalizeGradeResponse(
        approved_id=approved_id,
        delta_lesson_id=delta_lesson_id,
        comment_lesson_ids=comment_lesson_ids,
        deltas=deltas_out,
        message=message,
    )


@app.post("/api/detect-subject", response_model=DetectSubjectResponse)
async def detect_subject_endpoint(req: DetectSubjectRequest):
    """Auto-classify the subject of an uploaded exam PDF.

    Pipeline: decode PDF → extract text from first ``_DETECT_MAX_PAGES``
    pages (PyMuPDF, no Gemini call) → keyword-score against each subject's
    vocabulary list → return the top pick + confidence + raw scores.

    Confidence rule (matches what the frontend chip needs to decide
    "auto-apply" vs "ask the teacher to confirm"):
      * ``high`` — top1 ≥ 5 hits AND top1 ≥ top2 + 3. Big margin + enough
                   absolute signal to trust the verdict silently.
      * ``low``  — some signal (top1 ≥ 1) but margin too narrow or count
                   too small. UI should highlight the chip and require
                   an explicit confirmation click.
      * ``none`` — no keyword matched at all. ``detected`` falls back to
                   DEFAULT_SUBJECT but the chip should ask the teacher to
                   pick manually.
    """
    HIGH_MIN_TOP = 5
    HIGH_MIN_MARGIN = 3

    try:
        text = await extract_pdf_text(req.task_pdf_b64)
    except Exception as exc:  # decode/IO problems
        logger.exception("detect-subject text extraction failed")
        raise HTTPException(status_code=400, detail=f"Cannot read PDF: {exc}") from exc

    scores = score_subjects(text)
    detected, top_score = pick_top_subject(scores)

    if top_score == 0:
        confidence = "none"
        detected = DEFAULT_SUBJECT
    else:
        second = sorted(scores.values(), reverse=True)[1] if len(scores) > 1 else 0
        if top_score >= HIGH_MIN_TOP and (top_score - second) >= HIGH_MIN_MARGIN:
            confidence = "high"
        else:
            confidence = "low"

    log_hitl_event(
        "detect-subject",
        detected=detected,
        confidence=confidence,
        top_score=top_score,
        text_len=len(text),
    )
    return DetectSubjectResponse(
        detected=detected,
        confidence=confidence,
        scores=scores,
    )


@app.post("/api/analyze-comment", response_model=AnalyzeCommentResponse)
async def analyze_comment(req: AnalyzeCommentRequest):
    """Analyze a teacher's annotation on a specific question.

    Returns three views of the same correction:
      - ``verdict``  ("agree" | "partial" | "dispute"): AI's judgment of
                     whether the teacher's comment matches the student's
                     actual work. The frontend uses this to gate staging
                     of the lesson into HITL memory.
      - ``analysis``: ≤80-word reply shown in the per-question chat thread,
                      with evidence cited from the student answer.
      - ``lesson``:   ≤60-word distilled rule that the frontend stages
                      client-side and flushes to Chroma on approve/regrade.
                      For ``dispute`` verdicts, the lesson is a defensive
                      rule protecting against the teacher's misread.
    """
    try:
        result = await orchestrator.analyze_teacher_comment(
            question=req.question,
            student_answer=req.student_answer,
            teacher_comment=req.teacher_comment,
        )
        lesson_text = result.get("lesson", "")
        verdict = result.get("verdict", "agree")
        log_hitl_event(
            "analyze-comment",
            verdict=verdict,
            lesson_len=len(lesson_text),
            preview=lesson_text[:80],
        )
        return AnalyzeCommentResponse(
            analysis=result.get("analysis", ""),
            lesson=lesson_text,
            verdict=verdict,
        )
    except Exception as exc:
        logger.exception("analyze-comment failed")
        raise HTTPException(status_code=502, detail=str(exc)) from exc
