"""
main.py — FastAPI Backend for the HITL VLM Grading Agent
Purpose: REST API bridging the React frontend with the multimodal grading
         pipeline (Grader → Reviewer) and the Memory subsystem.
Author: [Your Name]
Research Project: Tác tử AI hỗ trợ chấm điểm tự luận đa phương thức kết hợp
                  phản hồi từ giáo viên (Human-in-the-loop VLM Grading Agent)
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# uvicorn is launched from backend/, so direct imports (no "backend." prefix).
from agent import AgentOrchestrator
from memory import MemoryManager
from prompt_orchestrator import PromptOrchestrator

# ---------------------------------------------------------------------------
# Heartbeat — auto-shutdown when the frontend tab is closed
# ---------------------------------------------------------------------------

HEARTBEAT_TIMEOUT_SEC = int(os.getenv("HEARTBEAT_TIMEOUT", "30"))
last_heartbeat = time.time()


def _kill_frontend():
    """Find and kill the process serving the frontend (default port 3000)."""
    try:
        if sys.platform == "win32":
            cmd = "netstat -ano | findstr :3000"
            out = subprocess.check_output(cmd, shell=True).decode()
            for line in out.strip().split("\n"):
                if "LISTENING" in line:
                    pid = line.strip().split()[-1]
                    print(f"[HITL] Killing frontend process PID: {pid}")
                    subprocess.run(
                        f"taskkill /F /T /PID {pid}", shell=True, capture_output=True
                    )
        else:
            subprocess.run("fuser -k 3000/tcp", shell=True, capture_output=True)
    except Exception as e:
        print(f"[HITL] Could not kill frontend: {e}")


def _monitor_heartbeat():
    """Background thread: shut the backend down if the browser stops pinging."""
    global last_heartbeat
    while True:
        time.sleep(5)
        elapsed = time.time() - last_heartbeat
        if elapsed > HEARTBEAT_TIMEOUT_SEC:
            print(f"[HITL] No heartbeat for {HEARTBEAT_TIMEOUT_SEC}s — shutting down.")
            _kill_frontend()
            os._exit(0)


_heartbeat_thread = threading.Thread(target=_monitor_heartbeat, daemon=True)
_heartbeat_thread.start()

# ---------------------------------------------------------------------------
# App bootstrap
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="HITL VLM Grading Agent API",
    lifespan=lifespan,
    version="0.1.0",
    description="Backend for the Human-in-the-Loop multimodal essay-grading system",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

memory = MemoryManager()
prompt_orch = PromptOrchestrator(
    memory,
    k_lessons=3,
    log_dir=Path(__file__).resolve().parent / "data" / "prompt_logs",
)
orchestrator = AgentOrchestrator(memory=memory, prompt_orchestrator=prompt_orch)

# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------


class GenerateRequest(BaseModel):
    """Request body for /api/generate (a.k.a. ‘grade essay’).

    Field name kept for frontend backwards-compatibility, but the semantics
    are now: ``task`` = essay topic / rubric, ``image_b64`` = the student's
    essay image, ``wrong_code`` = the AI's previous (incorrect) grade JSON.
    """

    task: str = Field(..., min_length=1, description="Essay topic / rubric")
    lang: str = Field(default="en", description="Language code: 'en' or 'vi'")
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
    debug: bool = Field(
        default=False,
        description="If true, include the full grader/reviewer PromptBundles in the response",
    )


class GenerateResponse(BaseModel):
    code: str  # Grader JSON output
    critique: dict[str, Any]
    lessons_used: list[dict[str, Any]]
    run_id: int | None
    coder_prompt: dict[str, Any] | None = None  # Grader prompt
    critic_prompt: dict[str, Any] | None = None  # Reviewer prompt


class PromptPreviewRequest(BaseModel):
    role: str = Field(..., description='"grader" or "reviewer"')
    task: str = Field(..., min_length=1)
    code: str | None = None
    feedback: str | None = None
    lang: str = Field(default="en")
    strategy: str = Field(default="default")


class FeedbackRequest(BaseModel):
    """Structured teacher feedback from the HITL right panel.

    action     : approve | revise | reject
    comment    : free-form explanation (required for revise/reject)
    task       : essay topic (so the lesson can be retrieved later)
    wrong_code : the AI grade JSON the teacher is reacting to
    run_id     : optional pointer to the pipeline run being reviewed
    """

    action: str = Field(..., description='"approve" | "revise" | "reject"')
    comment: str = Field(default="", description="Explanation of what is wrong")
    task: str = Field(..., min_length=1)
    wrong_code: str = Field(default="")
    run_id: int | None = None


class FeedbackResponse(BaseModel):
    action: str
    saved: bool
    lesson_id: int | None = None
    message: str


class TeachRequest(BaseModel):
    run_id: int | None = None
    task: str          # essay topic
    wrong_code: str    # AI's incorrect grade JSON
    correct_code: str  # teacher's corrected grade JSON
    lesson: str        # teacher's note
    score: int = Field(..., ge=1, le=5)


class TeachResponse(BaseModel):
    lesson_id: int
    message: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest):
    """Run the VLM Grader → Reviewer pipeline for a given essay.

    Despite the legacy URL ``/api/generate``, this is a multimodal grading
    endpoint. Provide ``image_b64`` to enable true VLM grading; omit it to
    fall back to topic-only grading.
    """
    try:
        result = await orchestrator.run_pipeline(
            req.task,
            lang=req.lang,
            feedback=req.feedback,
            wrong_code=req.wrong_code,
            image_b64=req.image_b64,
        )
        return GenerateResponse(
            code=result.code,
            critique=result.critique,
            lessons_used=result.lessons_used,
            run_id=result.run_id,
            coder_prompt=result.coder_prompt if req.debug else None,
            critic_prompt=result.critic_prompt if req.debug else None,
        )
    except Exception as exc:
        # Catch everything and return it as a 502 Bad Gateway to the UI.
        import traceback
        print(f"[API ERROR] {traceback.format_exc()}")
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/prompt/preview")
async def prompt_preview(req: PromptPreviewRequest):
    """Dry-run prompt assembly. Returns the full PromptBundle WITHOUT calling
    the LLM — used by the frontend Prompt Inspector for live debugging.
    """
    try:
        bundle = prompt_orch.build_prompt(
            role=req.role,
            task=req.task,
            code=req.code,
            feedback=req.feedback,
            lang=req.lang,
            strategy=req.strategy,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return bundle.to_dict()


@app.get("/api/prompt/preview")
async def prompt_preview_get(
    task: str,
    role: str = "grader",
    code: str | None = None,
    feedback: str | None = None,
    lang: str = "en",
    strategy: str = "default",
):
    """GET variant of prompt/preview — used by the HITL Debug panel."""
    try:
        bundle = prompt_orch.build_prompt(
            role=role,
            task=task,
            code=code,
            feedback=feedback,
            lang=lang,
            strategy=strategy,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return bundle.to_dict()


@app.post("/api/feedback", response_model=FeedbackResponse)
async def feedback(req: FeedbackRequest):
    """Ingest structured teacher feedback from the right-side review panel.

    Routing rules:
      - "approve" → no lesson saved, just acknowledge.
      - "revise"  → persist as a lesson (score 4.0) — useful correction.
      - "reject"  → persist as a lesson (score 5.0) — strongest signal,
                    ranks first in the retrieved-lesson ordering so the
                    Grader prompt emphasises it on the next run.

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
        return FeedbackResponse(
            action=action,
            saved=False,
            message="Feedback acknowledged. No lesson persisted.",
        )

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
    )
    return FeedbackResponse(
        action=action,
        saved=True,
        lesson_id=lesson_id,
        message="Lesson persisted. Next /api/generate run will retrieve it.",
    )


@app.post("/api/teach", response_model=TeachResponse)
async def teach(req: TeachRequest):
    """Store a teacher-authored grading lesson into dual memory."""
    lesson_id = memory.save_lesson(
        task=req.task,
        wrong_code=req.wrong_code,
        correct_code=req.correct_code,
        lesson_text=req.lesson,
        feedback_score=float(req.score),
    )
    return TeachResponse(
        lesson_id=lesson_id,
        message="Lesson saved to SQLite + ChromaDB.",
    )


@app.get("/api/research/stats")
async def research_stats():
    """Aggregated metrics for the Research Dashboard."""
    lessons_summary = memory.get_all_lessons_summary()
    pipeline_stats = memory.get_pipeline_stats()
    return {**lessons_summary, **pipeline_stats}


@app.post("/api/heartbeat")
async def heartbeat():
    """Reset heartbeat timer — called by the frontend every 10 s."""
    global last_heartbeat
    last_heartbeat = time.time()
    return {"status": "ok"}
