"""
prompts — Subject-aware prompt package.

Public API consumed by prompt_orchestrator / agent:

    GRADER_SYSTEM[subject]         — full system prompt for each subject
    ANALYZE_COMMENT_SYSTEM         — HITL comment-analysis system instruction
    ANALYZE_COMMENT_USER_TEMPLATE  — HITL comment-analysis user template
    RUBRIC_LABELS                  — 4-rubric STEM labels (shared)
    DEFAULT_SUBJECT                — fallback when detection finds nothing
    detect_subject(task, hint)     — pick subject from explicit hint or
                                     keyword-match on task text

Adding a new subject (e.g. chem):
    1. Create prompts/chem.py with _RULE_8_CHEM + _RULE_9_CHEM and call
       ``compose_grader_system()`` from base.py to build GRADER_SYSTEM_CHEM.
    2. Import + register here:
           from .chem import GRADER_SYSTEM_CHEM
           GRADER_SYSTEM["chem"] = GRADER_SYSTEM_CHEM
    3. Add keyword hints to ``detect_subject`` so task text routes correctly.
"""

from __future__ import annotations

import re

from .base import (
    ANALYZE_COMMENT_SYSTEM,
    ANALYZE_COMMENT_USER_TEMPLATE,
    RUBRIC_LABELS,
)
from .math import GRADER_SYSTEM_MATH
from .cs import GRADER_SYSTEM_CS
from .phys import GRADER_SYSTEM_PHYS
from .chem import GRADER_SYSTEM_CHEM
from .bio import GRADER_SYSTEM_BIO


# Registry of subject → full system prompt. Keys are the canonical subject
# codes used throughout the backend (and sent by the frontend `subject`
# field, if set). Keep in sync with ``detect_subject`` below.
GRADER_SYSTEM: dict[str, str] = {
    "math": GRADER_SYSTEM_MATH,
    "cs":   GRADER_SYSTEM_CS,
    "phys": GRADER_SYSTEM_PHYS,
    "chem": GRADER_SYSTEM_CHEM,
    "bio":  GRADER_SYSTEM_BIO,
}

# Fallback when no explicit hint + no keyword match in task text.
# "cs" chosen because the frontend Sidebar currently defaults to "Môn Tin".
# Supported subjects: "math", "cs", "phys", "chem", "bio" (full STEM /
# tự nhiên cluster).
DEFAULT_SUBJECT: str = "cs"


# ---------------------------------------------------------------------------
# Subject detection — explicit hint > task keywords > DEFAULT_SUBJECT.
# ---------------------------------------------------------------------------

_CS_KEYWORDS = (
    "tin học", "tin hoc", "môn tin", "mon tin",
    "lập trình", "lap trinh", "thuật toán", "thuat toan",
    "pseudo", "python", "c++", "pascal", "sql",
    "kiểu dữ liệu", "kieu du lieu", "vòng lặp", "vong lap",
)

_MATH_KEYWORDS = (
    "toán học", "toan hoc", "môn toán", "mon toan",
    "phương trình", "phuong trinh", "bất phương trình", "bat phuong trinh",
    "đại số", "dai so", "hình học", "hinh hoc",
    "giải tích", "giai tich", "đạo hàm", "dao ham",
    "tích phân", "tich phan", "ma trận", "ma tran",
    "bài toán", "bai toan", "chứng minh", "chung minh",
)

_PHYS_KEYWORDS = (
    "vật lý", "vat ly", "môn lý", "mon ly",
    "lực", "luc", "vận tốc", "van toc", "gia tốc", "gia toc",
    "động lực học", "dong luc hoc", "động lượng", "dong luong",
    "công", "công suất", "cong suat", "năng lượng", "nang luong",
    "điện", "dien", "từ trường", "tu truong", "quang học", "quang hoc",
    "nhiệt", "nhiet", "dao động", "dao dong", "sóng", "song",
    "newton", "định luật", "dinh luat", "bảo toàn", "bao toan",
    "khối lượng", "khoi luong", "trọng lực", "trong luc",
)

_CHEM_KEYWORDS = (
    "hoá học", "hóa học", "hoa hoc", "môn hoá", "môn hóa", "mon hoa",
    "phương trình hoá", "phuong trinh hoa", "cân bằng", "can bang",
    "oxi hoá", "oxi hóa", "oxi hoa", "khử", "khu",
    "axit", "bazơ", "bazo", "muối", "muoi",
    "kim loại", "kim loai", "phi kim", "halogen",
    "mol", "đktc", "dktc", "nồng độ", "nong do", "dung dịch", "dung dich",
    "phản ứng", "phan ung", "kết tủa", "ket tua", "điện phân", "dien phan",
    "hidrocacbon", "hidrocarbon", "ancol", "andehit", "este", "amin",
    "polime", "este hoá", "este hoa", "thuỷ phân", "thuy phan",
    "iupac", "công thức phân tử", "cong thuc phan tu",
)

_BIO_KEYWORDS = (
    "sinh học", "sinh hoc", "môn sinh", "mon sinh",
    "tế bào", "te bao", "mô", "cơ quan", "co quan", "hệ cơ quan", "he co quan",
    "di truyền", "di truyen", "kiểu gen", "kieu gen", "kiểu hình", "kieu hinh",
    "menđen", "mendel", "punnett", "alen", "tính trạng", "tinh trang",
    "nhiễm sắc thể", "nhiem sac the", "nst", "dna", "adn", "rna", "arn",
    "đột biến", "dot bien", "phiên mã", "phien ma", "dịch mã", "dich ma",
    "quang hợp", "quang hop", "hô hấp", "ho hap", "enzim", "enzyme",
    "tiến hoá", "tien hoa", "chọn lọc", "chon loc", "darwin", "lamarck",
    "sinh thái", "sinh thai", "quần thể", "quan the", "quần xã", "quan xa",
    "chuỗi thức ăn", "chuoi thuc an", "lưới thức ăn", "luoi thuc an",
    "phân loại", "phan loai", "loài", "loai", "ngành", "nganh",
    "động vật", "dong vat", "thực vật", "thuc vat", "vi khuẩn", "vi khuan",
)

# UI metadata prefix produced by ``buildTaskContext`` on the frontend.
# Two shapes seen over time:
#   current : "Môn Tin · <real task>"           (class removed in 2026-05)
#   legacy  : "Môn Tin · Lớp 10 · <real task>"  (still in old DB rows)
# Stripped before keyword scoring so a "Môn Tin" prefix doesn't add a free
# CS point that biases the count when the actual task body is math. The
# ``lớp …`` middle segment is optional so both shapes collapse to the
# same body.
_UI_PREFIX_RE = re.compile(
    r"^\s*môn\s+\S+(?:\s*·\s*lớp\s+\d+)?\s*·\s*",
    re.IGNORECASE,
)


# Tie-break order: more "scientific identity" subjects (chem / bio / phys
# with specific vocabulary) win over generic math / cs when scores tie.
_TIE_PRIORITY: tuple[str, ...] = ("chem", "bio", "phys", "math", "cs")


def score_subjects(text: str) -> dict[str, int]:
    """Keyword-count each subject against ``text``.

    Returns a {subject_code -> hit_count} map covering every key in
    ``GRADER_SYSTEM``. Caller decides what to do with the counts —
    ``detect_subject`` picks the top one with tie-breaking; the
    ``/api/detect-subject`` endpoint exposes them all so the frontend can
    show "Sinh học (12 hits) vs Hoá học (8 hits)" if needed.
    """
    body = (text or "").lower()
    body = _UI_PREFIX_RE.sub("", body).strip() or body
    return {
        "cs":   sum(1 for k in _CS_KEYWORDS   if k in body),
        "math": sum(1 for k in _MATH_KEYWORDS if k in body),
        "phys": sum(1 for k in _PHYS_KEYWORDS if k in body),
        "chem": sum(1 for k in _CHEM_KEYWORDS if k in body),
        "bio":  sum(1 for k in _BIO_KEYWORDS  if k in body),
    }


def pick_top_subject(scores: dict[str, int]) -> tuple[str, int]:
    """Pick the highest-scoring subject from a ``score_subjects`` map.

    Returns ``(subject_code, top_score)``. When all scores are zero this
    returns ``(DEFAULT_SUBJECT, 0)`` so the caller can detect the "no
    signal" case via the score.
    """
    best = max(scores.values()) if scores else 0
    if best == 0:
        return DEFAULT_SUBJECT, 0
    for code in _TIE_PRIORITY:
        if scores.get(code, 0) == best:
            return code, best
    return DEFAULT_SUBJECT, best


def detect_subject(task: str, hint: str | None = None) -> str:
    """Resolve the subject for a grading call.

    Priority order:
      1. ``hint`` — if it's a known subject code, use it directly.
         (Frontend sends this via the request's ``subject`` field.)
      2. Keyword score on ``task`` text — count substring matches against each
         subject's keyword list, pick the higher count. Tie → DEFAULT_SUBJECT.
      3. ``DEFAULT_SUBJECT`` — fallback when no keyword matches at all.

    Returns a key that's guaranteed to exist in ``GRADER_SYSTEM``.

    The previous implementation used first-match-wins (``any(k in t for k in
    _CS_KEYWORDS)`` checked before MATH), which mis-classified tasks whose
    text contained both lists' keywords. In particular, frontend tasks built
    by ``buildTaskContext`` always begin with ``"Môn Tin · Lớp 10 · …"``,
    matching the CS keyword ``"môn tin"`` regardless of the body, so a task
    body of ``"ĐỀ TOÁN: phương trình bậc 2"`` was still classified as CS.
    Score-based counting makes math-heavy bodies tip the scale toward math
    even when the prefix tags it as Tin.
    """
    if hint and hint in GRADER_SYSTEM:
        return hint

    scores = score_subjects(task)
    code, _ = pick_top_subject(scores)
    return code


__all__ = [
    "GRADER_SYSTEM",
    "ANALYZE_COMMENT_SYSTEM",
    "ANALYZE_COMMENT_USER_TEMPLATE",
    "RUBRIC_LABELS",
    "DEFAULT_SUBJECT",
    "detect_subject",
    "score_subjects",
    "pick_top_subject",
]
