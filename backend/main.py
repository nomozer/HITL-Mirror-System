"""
main.py — FastAPI Backend for HITL Mirror System
Purpose: REST API bridging the React frontend with the Agent pipeline
         and Memory subsystem.
Author: [Your Name]
Research Project: HITL Agentic Code-Learning System — "Mirror" Edition
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import tempfile
import time
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# FIX: uvicorn chạy từ thư mục backend/ nên import trực tiếp (không có prefix "backend.")
from agent import AgentOrchestrator
from memory import MemoryManager
from prompt_orchestrator import PromptOrchestrator

# ---------------------------------------------------------------------------
# Heartbeat — tự tắt server khi frontend đóng
# ---------------------------------------------------------------------------

# Lấy timeout từ .env, mặc định là 60s để đảm bảo ổn định
HEARTBEAT_TIMEOUT_SEC = int(os.getenv("HEARTBEAT_TIMEOUT", "30"))
last_heartbeat = time.time()


def _kill_frontend():
    """Tìm và tắt process đang chạy frontend (mặc định port 3000)."""
    try:
        if sys.platform == "win32":
            # Windows: Tìm PID dùng port 3000
            cmd = "netstat -ano | findstr :3000"
            out = subprocess.check_output(cmd, shell=True).decode()
            for line in out.strip().split("\n"):
                if "LISTENING" in line:
                    pid = line.strip().split()[-1]
                    print(f"[HITL] Killing frontend process PID: {pid}")
                    subprocess.run(f"taskkill /F /T /PID {pid}", shell=True, capture_output=True)
        else:
            # Linux/Mac
            subprocess.run("fuser -k 3000/tcp", shell=True, capture_output=True)
    except Exception as e:
        print(f"[HITL] Could not kill frontend: {e}")


def _monitor_heartbeat():
    """Background thread: tự động tắt backend nếu không nhận tín hiệu từ trình duyệt."""
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
    title="HITL Mirror API",
    lifespan=lifespan,
    version="0.1.0",
    description="Backend for the Human-in-the-Loop Agentic Code-Learning System",
)

app.add_middleware(
    CORSMiddleware,
    # FIX: đọc từ env var CORS_ORIGINS; mặc định localhost:3000 cho dev local.
    # Để deploy production: set CORS_ORIGINS=https://your-domain.com trong .env
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
    task: str = Field(..., min_length=1, description="Natural-language task description")
    lang: str = Field(default="en", description="Language code: 'en' or 'vi'")
    feedback: str | None = Field(
        default=None,
        description="Optional human feedback injected into the coder prompt (retry round)",
    )
    wrong_code: str | None = Field(
        default=None,
        description="Previous AI-generated code that had issues — shown to the Coder so it knows exactly what to fix",
    )
    debug: bool = Field(
        default=False,
        description="If true, include the full coder/critic PromptBundles in the response",
    )


class GenerateResponse(BaseModel):
    code: str
    critique: dict[str, Any]
    lessons_used: list[dict[str, Any]]
    run_id: int | None
    coder_prompt: dict[str, Any] | None = None
    critic_prompt: dict[str, Any] | None = None


class PromptPreviewRequest(BaseModel):
    role: str = Field(..., description='"coder" or "critic"')
    task: str = Field(..., min_length=1)
    code: str | None = None
    feedback: str | None = None
    lang: str = Field(default="en")
    strategy: str = Field(default="default")


class ExecuteRequest(BaseModel):
    code: str = Field(..., min_length=1)


class ExecuteResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int


class FeedbackRequest(BaseModel):
    """Structured human feedback from the HITL right panel.

    action : approve | revise | reject
    comment: free-form explanation (required for revise/reject)
    task   : original task description (so the lesson can be retrieved later)
    wrong_code: the code the user is reacting to (persisted as the "wrong"
               sample if the action is revise/reject)
    run_id : optional pointer to the pipeline run being reviewed
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
    task: str
    wrong_code: str
    correct_code: str
    lesson: str
    score: int = Field(..., ge=1, le=5)


class TeachResponse(BaseModel):
    lesson_id: int
    message: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.post("/api/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest):
    """Run the Coder → Critic pipeline for a given task."""
    try:
        result = await orchestrator.run_pipeline(
            req.task, lang=req.lang, feedback=req.feedback, wrong_code=req.wrong_code
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
        # Catch everything and return it as a 502 Bad Gateway to the UI
        # This prevents generic 500 Internal Server Errors when Pydantic fails.
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
    role: str = "coder",
    code: str | None = None,
    feedback: str | None = None,
    lang: str = "en",
    strategy: str = "default",
):
    """GET variant of prompt/preview — used by the HITL Debug panel to refresh
    the prompt view without maintaining POST state in the URL bar.
    """
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
    """Ingest structured HITL feedback from the right-side review panel.

    Routing rules:
      - "approve"      → no lesson saved, just acknowledge.
      - "revise"       → persist as a lesson (score 4.0) — useful correction.
      - "reject"       → persist as a lesson (score 5.0) — strongest signal,
                         ranks first in the retrieved-lesson ordering so the
                         Coder prompt emphasises it on the next run.
      NOTE: PromptOrchestrator sorts retrieved lessons by feedback_score DESC
      before injecting them into the prompt, so a HIGHER score ⇒ greater
      influence on the next generation. Reject must therefore be the highest.

    This is the bridge that turns a single human click into a durable
    improvement for subsequent pipeline runs, making the HITL loop closed.
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
        correct_code="",  # no human-edited correct code from this endpoint
        lesson_text=req.comment.strip(),
        score=score,
    )
    return FeedbackResponse(
        action=action,
        saved=True,
        lesson_id=lesson_id,
        message="Lesson persisted. Next /api/generate run will retrieve it.",
    )


@app.post("/api/execute", response_model=ExecuteResponse)
async def execute(req: ExecuteRequest):
    """Execute user-supplied Python code in a sandboxed subprocess."""
    tmp_dir = Path(tempfile.gettempdir()) / "hitl_sandbox"
    tmp_dir.mkdir(parents=True, exist_ok=True)

    tmp_file = tmp_dir / "run_code.py"
    tmp_file.write_text(req.code, encoding="utf-8")

    try:
        proc = await asyncio.to_thread(
            subprocess.run,
            [sys.executable, str(tmp_file)],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return ExecuteResponse(
            stdout=proc.stdout,
            stderr=proc.stderr,
            exit_code=proc.returncode,
        )
    except subprocess.TimeoutExpired:
        return ExecuteResponse(
            stdout="",
            stderr="Execution timed out (5 s limit).",
            exit_code=-1,
        )
    finally:
        tmp_file.unlink(missing_ok=True)


@app.post("/api/teach", response_model=TeachResponse)
async def teach(req: TeachRequest):
    """Store a human-authored lesson into dual memory."""
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
    """Reset heartbeat timer — called by frontend every 10s."""
    global last_heartbeat
    last_heartbeat = time.time()
    return {"status": "ok"}
