"""
history.py — Backend-backed grade history for the workspace header.

The browser should not be the source of truth for graded papers. This
router exposes recent pipeline runs from SQLite so the UI can reopen
grades after reloads, browser cache clears, or another tab/session.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from memory import MemoryManager


router = APIRouter(prefix="/api/history", tags=["history"])

_memory: MemoryManager | None = None


def attach_history_memory(manager: MemoryManager) -> None:
    global _memory
    _memory = manager


def _require_memory() -> MemoryManager:
    if _memory is None:
        raise HTTPException(status_code=500, detail="Memory manager not attached")
    return _memory


class HistoryGenerateResponse(BaseModel):
    code: str
    lessons_used: list[dict[str, Any]] = Field(default_factory=list)
    run_id: int | None = None


class GradeHistoryItem(BaseModel):
    id: str
    ts: int
    task: str
    subject: str | None = None
    response: HistoryGenerateResponse
    finalScores: dict[int, float] | None = None
    maxOverrides: dict[int, float] | None = None


class GradeHistoryResponse(BaseModel):
    items: list[GradeHistoryItem]


@router.get("/grades", response_model=GradeHistoryResponse)
def list_grade_history(limit: int = Query(default=50, ge=1, le=100)):
    manager = _require_memory()
    return GradeHistoryResponse(items=manager.list_grade_history(limit=limit))
