"""
prompt_orchestrator.py — Prompt Orchestration Layer
Purpose: Modular prompt builder for the HITL pipeline. Decomposes prompts
         into System / Memory / Dynamic components, retrieves lessons from
         MemoryManager (SQLite + ChromaDB), and produces a PromptBundle
         suitable for transparency, UI debugging, and research logging.
Author: [Your Name]
Research Project: HITL Agentic Code-Learning System — "Mirror" Edition
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Optional

from memory import MemoryManager

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class Role(str, Enum):
    CODER = "coder"
    CRITIC = "critic"


class Intent(str, Enum):
    GENERATION = "generation"
    BUG_FIX = "bug_fix"
    OPTIMIZE = "optimization"
    REFACTOR = "refactor"
    EXPLAIN = "explain"


# ---------------------------------------------------------------------------
# Role-based system prompts (single source of truth — previously in agent.py)
# ---------------------------------------------------------------------------

CODER_SYSTEM: dict[str, str] = {
    "en": (
        "You are a Senior Python Engineer. Write concise, production-grade code. "
        "Strictly follow PEP 8 and handle edge cases. High-priority instructions (HITL) "
        "take precedence over general rules. Output ONLY code in ```python blocks."
    ),
    "vi": (
        "Bạn là Kỹ sư Python cấp cao. Viết code súc tích, chất lượng production. "
        "Tuân thủ PEP 8 và xử lý trường hợp biên. Các bài học bổ sung (HITL) "
        "có ưu tiên cao nhất. CHỈ trả về code trong khối ```python."
    ),
}

CRITIC_SYSTEM: dict[str, str] = {
    "en": (
        "You are a strict Code Reviewer. Be brief and direct. NO introductory praise. "
        "Limit each issue description to 15 words. Return ONLY valid JSON with fields: "
        "'issues' (dimension, description, line), 'severity', 'suggestion'."
    ),
    "vi": (
        "Bạn là Người kiểm duyệt Code nghiêm khắc. Phản hồi cực kỳ ngắn gọn và trực tiếp. "
        "KHÔNG khen ngợi xã giao. Giới hạn mô tả lỗi trong 15 từ. "
        "CHỈ trả về JSON: {'issues': [...], 'severity': '...', 'suggestion': '...'}"
    ),
}

# Intent-specific style hints appended to the system prompt (adaptive prompting)
INTENT_HINTS: dict[Intent, dict[str, str]] = {
    Intent.GENERATION: {
        "en": "Style hint: favor clarity over cleverness. Keep docstrings minimal.",
        "vi": "Gợi ý phong cách: ưu tiên rõ ràng hơn thông minh. Docstring ngắn gọn.",
    },
    Intent.BUG_FIX: {
        "en": "Style hint: locate the root cause first, then patch. Preserve the public API.",
        "vi": "Gợi ý phong cách: tìm nguyên nhân gốc trước khi sửa. Giữ nguyên API công khai.",
    },
    Intent.OPTIMIZE: {
        "en": "Style hint: explain the Big-O change in a short comment at the top.",
        "vi": "Gợi ý phong cách: giải thích thay đổi Big-O trong một comment ngắn ở đầu.",
    },
    Intent.REFACTOR: {
        "en": "Style hint: keep behavior identical; list renames explicitly.",
        "vi": "Gợi ý phong cách: giữ nguyên hành vi; liệt kê các tên đổi rõ ràng.",
    },
    Intent.EXPLAIN: {
        "en": "Style hint: short bullets first, then an annotated snippet.",
        "vi": "Gợi ý phong cách: bullet ngắn trước, sau đó là snippet có chú thích.",
    },
}


# ---------------------------------------------------------------------------
# Intent detection (bilingual heuristic; swap for a classifier later)
# ---------------------------------------------------------------------------

_INTENT_PATTERNS: list[tuple[Intent, re.Pattern]] = [
    (
        Intent.BUG_FIX,
        re.compile(
            r"(\bbug\b|\berror\b|\bexception\b|\btraceback\b|\bfix\b|\bbroken\b|\bfails?\b|lỗi|sửa|sai)",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.OPTIMIZE,
        re.compile(
            r"(optimi[sz]e|faster|speed ?up|latency|memory|tối ưu|nhanh hơn|hiệu năng)",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.REFACTOR,
        re.compile(
            r"(refactor|clean ?up|restructure|\brename\b|extract|tái cấu trúc|dọn dẹp)",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.EXPLAIN,
        re.compile(
            r"(\bexplain\b|\bwhy\b|how does|giải thích|tại sao|như thế nào)",
            re.IGNORECASE,
        ),
    ),
]


def detect_intent(task: str) -> Intent:
    """Lightweight keyword-based intent detection. Defaults to GENERATION."""
    for intent, pattern in _INTENT_PATTERNS:
        if pattern.search(task or ""):
            return intent
    return Intent.GENERATION


# ---------------------------------------------------------------------------
# Sanitization + tag wrapping (basic prompt-injection hardening)
# ---------------------------------------------------------------------------

_TAG_OPEN = "<<<{name}>>>"
_TAG_CLOSE = "<<<END {name}>>>"


def _wrap(name: str, content: str) -> str:
    """Wrap user content in visually-isolated sentinels."""
    content = (content or "").replace("<<<", "<<")  # neutralize delimiter clashes
    return f"{_TAG_OPEN.format(name=name)}\n{content}\n{_TAG_CLOSE.format(name=name)}"


def _sanitize(s: Optional[str], max_len: int = 8000) -> str:
    """Neutralize role-impersonation prefixes and cap length."""
    if s is None:
        return ""
    s = str(s)
    s = re.sub(r"(?im)^\s*(system|assistant|user)\s*:", "", s)
    s = s.replace("```system", "```")
    return s[:max_len]


# ---------------------------------------------------------------------------
# Prompt Bundle — the transparent artifact of one build_prompt() call
# ---------------------------------------------------------------------------


@dataclass
class PromptBundle:
    """Fully assembled prompt, split by component for transparency & replay.

    Field usage:
        system       -> passed to genai.GenerativeModel(system_instruction=...)
        user_content -> passed to model.generate_content(...)
        full         -> concatenation used for UI display / debugging only
    """

    role: Role
    intent: Intent
    lang: str
    system: str
    memory: str
    dynamic: str
    user_content: str
    full: str
    lessons_used: list[dict[str, Any]] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "role": self.role.value,
            "intent": self.intent.value,
            "lang": self.lang,
            "system": self.system,
            "memory": self.memory,
            "dynamic": self.dynamic,
            "user_content": self.user_content,
            "full": self.full,
            "lessons_used": self.lessons_used,
            "meta": self.meta,
        }


# ---------------------------------------------------------------------------
# Prompt Orchestrator
# ---------------------------------------------------------------------------


class PromptOrchestrator:
    """Builds structured prompts from task + code + feedback + retrieved lessons.

    Responsibilities:
        1. Decompose prompts into System / Memory / Dynamic components.
        2. Retrieve top-k lessons from MemoryManager, re-ranked by feedback_score.
        3. Wrap user-supplied content in sentinels to reduce prompt-injection risk.
        4. Produce a PromptBundle consumable by the agent AND the UI inspector.
        5. Optionally log every bundle to disk for research reproducibility.
    """

    def __init__(
        self,
        memory: MemoryManager,
        *,
        k_lessons: int = 3,
        log_dir: Path | str | None = None,
    ) -> None:
        self.memory = memory
        self.k = k_lessons
        self.log_dir: Path | None = Path(log_dir) if log_dir else None
        if self.log_dir:
            self.log_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------ API

    def build_prompt(
        self,
        role: Role | str,
        task: str,
        code: Optional[str] = None,
        feedback: Optional[str] = None,
        *,
        lang: str = "en",
        intent: Intent | None = None,
        strategy: str = "default",
    ) -> PromptBundle:
        """Assemble a PromptBundle for the given role and inputs.

        Args:
            role: "coder" or "critic".
            task: Natural-language task description.
            code: Optional current code (required for critic).
            feedback: Optional human feedback to inject for a retry round.
            lang: "en" or "vi".
            intent: Override auto-detected intent.
            strategy: Free-form tag stored in meta for A/B research comparison.

        Returns:
            A PromptBundle with system / memory / dynamic / user_content / full.
        """
        if isinstance(role, str):
            role = Role(role)
        lang = lang if lang in ("en", "vi") else "en"

        task = _sanitize(task, 4000)
        code = _sanitize(code or "", 8000)
        feedback = _sanitize(feedback or "", 2000)

        intent = intent or detect_intent(task)

        # 1. System component -------------------------------------------------
        base_system = CODER_SYSTEM[lang] if role is Role.CODER else CRITIC_SYSTEM[lang]
        system = base_system + "\n\n" + INTENT_HINTS[intent][lang]

        # 2. Memory component -------------------------------------------------
        lessons = (
            self.memory.search_relevant_lessons(task, top_k=self.k) if task else []
        )
        # Re-rank: prioritize high feedback_score (stable sort preserves
        # ChromaDB semantic ordering for ties).
        lessons = sorted(
            lessons, key=lambda l: -float(l.get("feedback_score", 0.0))
        )
        memory_block = self._format_lessons(lessons, lang)

        # 3. Dynamic component (Task/Code/Feedback) ---------------------------
        dynamic_parts: list[str] = [f"### TASK\n{task}"]
        if code:
            dynamic_parts.append(f"### CODE TO REVIEW\n{code}")
        if feedback:
            dynamic_parts.append(f"### ADDITIONAL FEEDBACK\n{feedback}")
        dynamic = "\n\n".join(dynamic_parts)

        # 4. Assemble ---------------------------------------------------------
        user_content = f"{memory_block}\n\n{dynamic}".strip()
        full = "### SYSTEM\n" + system + "\n\n### USER\n" + user_content + "\n"

        bundle = PromptBundle(
            role=role,
            intent=intent,
            lang=lang,
            system=system,
            memory=memory_block,
            dynamic=dynamic,
            user_content=user_content,
            full=full,
            lessons_used=lessons,
            meta={
                "strategy": strategy,
                "k": self.k,
                "ts": time.time(),
                "prompt_hash": hashlib.sha1(full.encode("utf-8")).hexdigest()[:16],
            },
        )
        self._log(bundle)
        return bundle

    def ingest_feedback(
        self,
        *,
        task: str,
        wrong_code: str,
        correct_code: str,
        lesson_text: str,
        score: float = 3.0,
    ) -> int:
        """Persist a human correction as a reusable lesson via MemoryManager."""
        return self.memory.save_lesson(
            task=task,
            wrong_code=wrong_code,
            correct_code=correct_code,
            lesson_text=lesson_text,
            feedback_score=score,
        )

    # -------------------------------------------------------------- helpers

    @staticmethod
    def _format_lessons(
        lessons: list[dict[str, Any]], lang: str
    ) -> str:
        if not lessons:
            return ""
        
        header = (
            "PRIORITY CONSTRAINTS (Learned from human feedback):"
            if lang == "en"
            else "RÀNG BUỘC ƯU TIÊN (Học từ phản hồi của con người):"
        )
        
        bullets: list[str] = []
        for les in lessons:
            text = str(les.get("lesson_text", "")).strip()
            bullets.append(f"(!) {text}")
        
        body = "\n".join(bullets)
        return f"### {header}\n{body}"

    def _log(self, bundle: PromptBundle) -> None:
        logger.info(
            "prompt_built role=%s intent=%s hash=%s lessons=%d",
            bundle.role.value,
            bundle.intent.value,
            bundle.meta["prompt_hash"],
            len(bundle.lessons_used),
        )
        if not self.log_dir:
            return
        filename = (
            f"{int(bundle.meta['ts'])}_{bundle.role.value}_{bundle.meta['prompt_hash']}.json"
        )
        path = self.log_dir / filename
        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(bundle.to_dict(), f, ensure_ascii=False, indent=2)
        except OSError as exc:  # non-fatal — logging must not break pipeline
            logger.warning("Failed to write prompt log %s: %s", path, exc)
