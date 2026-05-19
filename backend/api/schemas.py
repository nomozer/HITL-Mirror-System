"""
schemas.py — Pydantic request/response models for the HITL API.

One file per concern so the route handlers in ``main.py`` stay focused on
orchestration logic. Every endpoint's I/O contract lives here and nowhere
else — if the frontend breaks, this is the first file to open.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# /api/generate — grade an essay
# ---------------------------------------------------------------------------


class GenerateRequest(BaseModel):
    """Request body for /api/generate (a.k.a. 'grade essay').

    Field name kept for frontend backwards-compatibility, but the semantics
    are now: ``task`` = essay topic / rubric, ``image_b64`` = the student's
    essay image, ``wrong_code`` = the AI's previous (incorrect) grade JSON.
    """

    task: str = Field(..., min_length=1, description="Essay topic / rubric")
    feedback: str | None = Field(
        default=None,
        description="Optional teacher feedback injected into the grader prompt (re-grade round)",
    )
    wrong_code: str | None = Field(
        default=None,
        description="Previous AI-produced grade JSON the teacher rejected — shown to the Grader so it knows exactly what to fix",
    )
    image_b64: str | None = Field(
        default=None,
        description="Base64-encoded essay image (data URL or raw payload). Required for true multimodal grading.",
    )
    task_pdf_b64: str | None = Field(
        default=None,
        description="Base64-encoded PDF of the exam prompt (data URL). Gemini reads the rubric/topic directly from this document.",
    )
    subject: str | None = Field(
        default=None,
        description='Optional subject hint ("math" | "cs"). Falls back to '
        "keyword-detection from task text if omitted.",
    )


class GenerateResponse(BaseModel):
    code: str  # Grader JSON output
    lessons_used: list[dict[str, Any]]
    run_id: int | None


# ---------------------------------------------------------------------------
# /api/feedback — teacher approve/revise/reject
# ---------------------------------------------------------------------------


class StagedLesson(BaseModel):
    """A per-question lesson distilled by /api/analyze-comment.

    The frontend stages these client-side as the teacher annotates each
    question, then submits the full batch when they click "Duyệt". This
    gives the HITL loop per-question granularity instead of a single
    blob-level correction.
    """

    lesson_text: str = Field(..., min_length=1, description="Distilled grading rule")
    question_ref: str = Field(default="", description='e.g. "Câu 1"')


class FeedbackRequest(BaseModel):
    """Structured teacher feedback from the HITL right panel.

    action         : approve | revise | reject
    comment        : free-form aggregate explanation (required for revise/reject)
    staged_lessons : per-question lessons pre-distilled client-side
    task           : essay topic (so the lesson can be retrieved later)
    wrong_code     : the AI grade JSON the teacher is reacting to
    run_id         : optional pointer to the pipeline run being reviewed
    """

    action: str = Field(..., description='"approve" | "revise" | "reject"')
    comment: str = Field(default="", description="Explanation of what is wrong")
    task: str = Field(..., min_length=1)
    wrong_code: str = Field(default="")
    run_id: int | None = None
    staged_lessons: list[StagedLesson] = Field(default_factory=list)
    subject: str | None = None


class FeedbackResponse(BaseModel):
    action: str
    saved: bool
    lesson_id: int | None = None
    lesson_ids: list[int] = Field(default_factory=list)
    message: str


# ---------------------------------------------------------------------------
# /api/analyze-comment — distill teacher annotation into reusable lesson
# ---------------------------------------------------------------------------


class AnalyzeCommentRequest(BaseModel):
    """Request body for /api/analyze-comment.

    The teacher annotates a specific question in the review UI; this
    endpoint sends the context to a lightweight Gemini call that returns
    a concise analysis (≤30 words per error).
    """

    question: str = Field(default="", description="Exam question / topic")
    student_answer: str = Field(
        default="", description="Student's transcribed answer for this question"
    )
    teacher_comment: str = Field(
        ..., min_length=1, description="Teacher's annotation"
    )


class AnalyzeCommentResponse(BaseModel):
    analysis: str
    lesson: str = Field(
        default="",
        description="Distilled ≤60-word grading rule for future HITL retrieval. "
        "Empty if the model could not produce a reusable rule.",
    )
    verdict: str = Field(
        default="agree",
        description='AI\'s judgment of the teacher\'s comment vs the student\'s '
        'actual work. One of "agree" | "partial" | "dispute". '
        '"dispute" means the AI thinks the teacher misread the student work — '
        "the frontend should require explicit confirmation before staging the "
        "lesson into HITL memory.",
    )


# ---------------------------------------------------------------------------
# /api/finalize-grade — persist teacher-approved grade + score deltas
# ---------------------------------------------------------------------------


class FinalizeGradeRequest(BaseModel):
    """Persist a teacher-finalized grade + capture score-delta as a lesson.

    Fires when the teacher clicks "Xác nhận điểm" on Tab 5 with scores that
    differ from the AI's suggestion. The numeric delta is itself a HITL
    signal — currently the strongest one the UI captures, since it's a
    concrete correction rather than free-form text.

    Two complementary score axes are accepted:
      * rubric: 4-dim VN STEM rubric (content/argument/expression/creativity)
      * per-câu: per-question scores keyed by câu number ("1","2",...)
    Either or both may be empty. The finalize handler computes deltas on
    whichever axis has data and combines them into a single lesson so the
    RAG corpus does not double-count a single correction.
    """

    task: str = Field(..., min_length=1)
    ai_overall: float | None = None
    teacher_overall: float | None = None
    ai_scores: dict[str, float] = Field(default_factory=dict)
    teacher_scores: dict[str, float] = Field(default_factory=dict)
    ai_per_question: dict[str, float] = Field(
        default_factory=dict,
        description='Per-câu AI scores keyed by câu number as string ("1","2",...). '
        "When present, finalize computes per-câu deltas alongside the rubric ones.",
    )
    teacher_per_question: dict[str, float] = Field(
        default_factory=dict,
        description="Per-câu teacher overrides, same shape as ai_per_question.",
    )
    approved_grade_json: str = Field(default="")
    run_id: int | None = None
    subject: str | None = None


class FinalizeGradeResponse(BaseModel):
    approved_id: int | None = None
    delta_lesson_id: int | None = None
    deltas: dict[str, float] = Field(default_factory=dict)
    message: str


# ---------------------------------------------------------------------------
# /api/regrade — atomic feedback-then-regrade
# ---------------------------------------------------------------------------


class RegradeRequest(BaseModel):
    """Atomic HITL re-grade: save teacher feedback as a lesson, then
    re-run the VLM pipeline in a single request.  This ensures the
    feedback is always persisted before re-grading begins.
    """

    task: str = Field(..., min_length=1, description="Essay topic / rubric")
    action: str = Field(..., description='"revise" | "reject"')
    comment: str = Field(..., min_length=1, description="Teacher correction note")
    wrong_code: str = Field(default="", description="Previous AI grade JSON")
    image_b64: str | None = None
    task_pdf_b64: str | None = None
    run_id: int | None = None
    subject: str | None = None


class RegradeResponse(BaseModel):
    """Combines feedback acknowledgement + new pipeline result."""

    code: str
    lessons_used: list[dict[str, Any]]
    run_id: int | None
    lesson_id: int | None = None


# ---------------------------------------------------------------------------
# /api/detect-subject — auto-classify the exam PDF before grading
# ---------------------------------------------------------------------------


class DetectSubjectRequest(BaseModel):
    """Inputs for keyword-based subject detection on an uploaded exam.

    The frontend used to require the teacher to pick a subject in a left
    Sidebar before any grading could start (the picked code became the
    backend ``subject`` hint, which is authoritative). Auto-detecting from
    the exam PDF lets us drop that gate — the teacher uploads the PDF,
    we read its first pages, score keywords, and surface the result as a
    confirmation chip in the upload step.

    Filename alone is intentionally weak: many teachers use generic names
    like ``de_so_1.pdf``. The full PDF body usually carries dozens of
    subject-specific terms, so the verdict is much more reliable.
    """

    task_pdf_b64: str = Field(
        ...,
        min_length=1,
        description="Base64-encoded exam-prompt PDF (data URL or raw payload).",
    )


class DetectSubjectResponse(BaseModel):
    """Detection verdict + raw scores.

    ``confidence``: ``"high"`` when the top-1 score clearly dominates
    (margin + minimum count threshold met), ``"low"`` when there is some
    signal but it is ambiguous, ``"none"`` when no keywords matched. The
    frontend uses confidence to decide whether to auto-apply the pick or
    require explicit teacher confirmation before grading.
    """

    detected: str = Field(
        ...,
        description='Top-scoring subject code (matches GRADER_SYSTEM keys). '
        'Always populated — falls back to DEFAULT_SUBJECT when confidence="none".',
    )
    confidence: str = Field(
        ...,
        description='"high" | "low" | "none"',
    )
    scores: dict[str, int] = Field(
        default_factory=dict,
        description="Keyword hit count per subject code. Surfaces the raw "
        "signal so the UI can show a tooltip / debug overlay if needed.",
    )
