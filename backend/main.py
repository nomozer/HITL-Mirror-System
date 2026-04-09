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

last_heartbeat = time.time()


def _monitor_heartbeat():
    """Background thread: tắt server nếu không nhận heartbeat trong 60s."""
    global last_heartbeat
    while True:
        time.sleep(10)
        if time.time() - last_heartbeat > 60:
            print("[HITL] No heartbeat for 60s — shutting down.")
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
            req.task, lang=req.lang, feedback=req.feedback
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return GenerateResponse(
        code=result.code,
        critique=result.critique,
        lessons_used=result.lessons_used,
        run_id=result.run_id,
        coder_prompt=result.coder_prompt if req.debug else None,
        critic_prompt=result.critic_prompt if req.debug else None,
    )


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
