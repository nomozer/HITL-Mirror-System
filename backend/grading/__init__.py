"""Grading domain — orchestrator + VLM + file processing + prompt assembly.

Public API re-exported here for tidy imports from ``main.py``:

    from grading import AgentOrchestrator, PromptOrchestrator, looks_like_timeout
    from grading import compute_score_deltas, format_delta_lesson, safe_delta

Internal modules:
    • agent              — AgentOrchestrator + PipelineResult (pipeline entry)
    • vlm_client         — GeminiClient + retry + model rotation
    • file_processor     — Image/PDF decode + compress + rasterize
    • grade_parser       — JSON parse + comment-analysis fallback
    • prompt_orchestrator — Subject-aware prompt assembly + lesson injection
    • scoring            — Numeric delta utilities for /api/finalize-grade
"""

from .agent import AgentOrchestrator, PipelineResult, looks_like_timeout
from .file_processor import extract_pdf_text
from .prompt_orchestrator import PromptOrchestrator
from .scoring import (
    RUBRIC_KEYS,
    compute_per_question_deltas,
    compute_score_deltas,
    format_delta_lesson,
    safe_delta,
)

__all__ = [
    "AgentOrchestrator",
    "PipelineResult",
    "PromptOrchestrator",
    "extract_pdf_text",
    "looks_like_timeout",
    "RUBRIC_KEYS",
    "compute_per_question_deltas",
    "compute_score_deltas",
    "format_delta_lesson",
    "safe_delta",
]
