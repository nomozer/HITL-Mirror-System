"""
prompt_orchestrator.py — Prompt Orchestration Layer
Purpose: Modular prompt builder for the HITL VLM Grading Agent. Decomposes
         prompts into System / Memory / Dynamic components, retrieves teacher
         lessons from MemoryManager (SQLite + ChromaDB), and produces a
         PromptBundle suitable for transparency, UI debugging, and research
         logging.
Author: [Your Name]
Research Project: Tác tử AI hỗ trợ chấm điểm tự luận đa phương thức kết hợp
                  phản hồi từ giáo viên (Human-in-the-loop VLM Grading Agent)
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
    GRADER = "grader"      # Giám khảo (VLM): đọc ảnh bài làm, chấm điểm
    REVIEWER = "reviewer"  # Tổ trưởng kiểm định: soát lại bản chấm


class Intent(str, Enum):
    """High-level essay genre — controls grader style hints."""

    ARGUMENTATIVE = "argumentative"  # Nghị luận (xã hội / văn học)
    NARRATIVE = "narrative"          # Tự sự / kể chuyện
    EXPOSITORY = "expository"        # Thuyết minh / giải thích
    DESCRIPTIVE = "descriptive"      # Miêu tả
    GENERAL = "general"              # Mặc định


# ---------------------------------------------------------------------------
# Role-based system prompts
# ---------------------------------------------------------------------------

GRADER_SYSTEM: dict[str, str] = {
    "en": (
        "You are an experienced Essay Grader (VLM). Carefully read the essay image "
        "supplied by the user (typed or handwritten). Grade on a 0–10 scale across "
        "four rubric dimensions: Content, Argument, Expression, Creativity. "
        "High-priority teacher constraints (HITL) override general rules. "
        "Return ONLY a JSON object with fields: "
        "{\"transcript\": str, \"scores\": {\"content\": float, \"argument\": float, "
        "\"expression\": float, \"creativity\": float}, \"overall\": float, "
        "\"strengths\": [str], \"weaknesses\": [str], \"comment\": str}."
    ),
    "vi": (
        "Bạn là một Giám khảo chấm bài tự luận giàu kinh nghiệm (sử dụng VLM). "
        "Hãy đọc kỹ ảnh bài làm do người dùng cung cấp (chữ đánh máy hoặc viết tay). "
        "Chấm theo thang điểm 0–10 cho bốn tiêu chí: Nội dung, Lập luận, Diễn đạt, "
        "Sáng tạo. Các ràng buộc ưu tiên từ giáo viên (HITL) cao hơn quy tắc chung. "
        "CHỈ trả về một JSON: {\"transcript\": str, \"scores\": {\"content\": số, "
        "\"argument\": số, \"expression\": số, \"creativity\": số}, \"overall\": số, "
        "\"strengths\": [str], \"weaknesses\": [str], \"comment\": str}."
    ),
}

REVIEWER_SYSTEM: dict[str, str] = {
    "en": (
        "You are a strict Grading Reviewer. Compare the Grader's JSON output with the "
        "rubric and the essay. Be brief and direct. NO praise. Limit each issue to 15 "
        "words. Return ONLY valid JSON: {\"issues\": [{\"dimension\": str, "
        "\"description\": str, \"line\": int|null}], \"severity\": "
        "\"low|medium|high\", \"suggestion\": str}."
    ),
    "vi": (
        "Bạn là Tổ trưởng kiểm định nghiêm khắc. So sánh JSON chấm điểm của Giám khảo "
        "với rubric và nội dung bài làm. Phản hồi cực kỳ ngắn gọn, KHÔNG khen xã giao. "
        "Giới hạn mô tả lỗi trong 15 từ. CHỈ trả về JSON: {\"issues\": [{\"dimension\": "
        "str, \"description\": str, \"line\": số|null}], \"severity\": "
        "\"low|medium|high\", \"suggestion\": str}."
    ),
}

# Intent-specific style hints appended to the system prompt (adaptive prompting)
INTENT_HINTS: dict[Intent, dict[str, str]] = {
    Intent.ARGUMENTATIVE: {
        "en": "Style hint: weight 'Argument' highest; check thesis, evidence, refutation.",
        "vi": "Gợi ý: trọng số cao nhất ở 'Lập luận'; kiểm tra luận điểm, dẫn chứng, phản đề.",
    },
    Intent.NARRATIVE: {
        "en": "Style hint: weight 'Creativity' and 'Expression'; check plot arc and voice.",
        "vi": "Gợi ý: trọng số cao ở 'Sáng tạo' và 'Diễn đạt'; kiểm tra cốt truyện và giọng văn.",
    },
    Intent.EXPOSITORY: {
        "en": "Style hint: weight 'Content' and clarity; verify factual accuracy.",
        "vi": "Gợi ý: trọng số cao ở 'Nội dung' và sự rõ ràng; kiểm tra tính chính xác.",
    },
    Intent.DESCRIPTIVE: {
        "en": "Style hint: weight 'Expression' and sensory detail; check imagery.",
        "vi": "Gợi ý: trọng số cao ở 'Diễn đạt' và chi tiết giác quan; kiểm tra hình ảnh.",
    },
    Intent.GENERAL: {
        "en": "Style hint: balance the four rubric dimensions equally.",
        "vi": "Gợi ý: cân bằng đều bốn tiêu chí của rubric.",
    },
}


# ---------------------------------------------------------------------------
# Intent detection (bilingual heuristic; swap for a classifier later)
# ---------------------------------------------------------------------------

_INTENT_PATTERNS: list[tuple[Intent, re.Pattern]] = [
    (
        Intent.ARGUMENTATIVE,
        re.compile(
            r"(\bargue\b|\bopinion\b|\bdebate\b|\bpersuad\w*|nghị luận|bàn luận|chứng minh|thuyết phục)",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.NARRATIVE,
        re.compile(
            r"(\bstory\b|\bnarrat\w*|\btale\b|kể chuyện|tự sự|hồi tưởng)",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.EXPOSITORY,
        re.compile(
            r"(\bexplain\b|\bexposit\w*|\bdefine\b|\binform\b|thuyết minh|giải thích|trình bày)",
            re.IGNORECASE,
        ),
    ),
    (
        Intent.DESCRIPTIVE,
        re.compile(
            r"(\bdescribe\b|\bdescript\w*|\bportray\b|miêu tả|tả cảnh|tả người)",
            re.IGNORECASE,
        ),
    ),
]


def detect_intent(task: str) -> Intent:
    """Lightweight keyword-based intent detection. Defaults to GENERAL."""
    for intent, pattern in _INTENT_PATTERNS:
        if pattern.search(task or ""):
            return intent
    return Intent.GENERAL


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
    """Fully assembled prompt, split by component for transparency & replay."""

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
    """Builds structured prompts for the VLM grading pipeline.

    Inputs combined: essay topic + (AI grade JSON | rubric) + teacher feedback +
    retrieved teacher lessons. The actual essay image is supplied separately to
    the Gemini Vision call by the AgentOrchestrator.
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
            role:     GRADER (initial pass) or REVIEWER (validation pass).
            task:     The essay topic / question / rubric prompt.
            code:     For REVIEWER, this carries the Grader's JSON output to be
                      reviewed. (Field name kept for backward compatibility.)
            feedback: Optional human teacher feedback to inject on a re-grade.
            lang:     'en' or 'vi'.
            intent:   Optional explicit essay genre — auto-detected otherwise.
            strategy: Reserved for future grading strategies (default/strict/...).
        """
        if isinstance(role, str):
            role = Role(role)
        lang = lang if lang in ("en", "vi") else "en"

        task = _sanitize(task, 4000)
        code = _sanitize(code or "", 8000)
        feedback = _sanitize(feedback or "", 2000)

        intent = intent or detect_intent(task)

        # 1. System component -------------------------------------------------
        base_system = GRADER_SYSTEM[lang] if role is Role.GRADER else REVIEWER_SYSTEM[lang]
        system = base_system + "\n\n" + INTENT_HINTS[intent][lang]

        # 2. Memory component -------------------------------------------------
        lessons = (
            self.memory.search_relevant_lessons(task, top_k=self.k) if task else []
        )
        lessons = sorted(
            lessons, key=lambda l: -float(l.get("feedback_score", 0.0))
        )
        memory_block = self._format_lessons(lessons, lang)

        # 3. Dynamic component (Topic / AI grade / Teacher feedback) ----------
        topic_label = "ESSAY TOPIC" if lang == "en" else "ĐỀ BÀI TỰ LUẬN"
        grade_label = "AI GRADE TO REVIEW" if lang == "en" else "BẢN CHẤM CỦA AI CẦN SOÁT"
        feedback_label = (
            "TEACHER FEEDBACK" if lang == "en" else "PHẢN HỒI CỦA GIÁO VIÊN"
        )

        dynamic_parts: list[str] = [f"### {topic_label}\n{task}"]
        if code:
            dynamic_parts.append(f"### {grade_label}\n{code}")
        if feedback:
            dynamic_parts.append(f"### {feedback_label}\n{feedback}")
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
        """Persist a teacher correction as a reusable grading lesson.

        Field semantics in this project:
            task          → essay topic
            wrong_code    → AI's incorrect grade JSON
            correct_code  → teacher's corrected grade JSON (may be empty)
            lesson_text   → teacher's instructional note
        """
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
            "PRIORITY GRADING CONSTRAINTS (Learned from teacher feedback):"
            if lang == "en"
            else "RÀNG BUỘC CHẤM ĐIỂM ƯU TIÊN (Học từ phản hồi của giáo viên):"
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
