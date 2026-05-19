"""
memory.py — Dual-Store Memory Manager (SQLite + ChromaDB)
Purpose: Provides synchronized persistent storage for HITL grading lessons
         using relational (SQLite) and vector (ChromaDB) backends.

Field semantics in this project:
    task          → essay topic
    wrong_code    → AI's incorrect grade JSON
    correct_code  → teacher's corrected grade JSON (optional)
    lesson_text   → teacher's instructional note (the constraint to learn)

Author: [Your Name]
Research Project: Tác tử AI hỗ trợ chấm điểm tự luận đa phương thức kết hợp
                  phản hồi từ giáo viên (Human-in-the-loop VLM Grading Agent)
"""

from __future__ import annotations

import datetime
import json
import logging
import re
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import chromadb
from sqlalchemy import (
    DateTime,
    Float,
    Integer,
    Text,
    create_engine,
    inspect,
    text,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker, mapped_column, Mapped


logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# SQLAlchemy Models (SQLAlchemy 2.x style)
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    pass


class Lesson(Base):
    """A single grading lesson learned from a teacher correction cycle.

    See module docstring for field-name → semantic mapping.
    """

    __tablename__ = "lessons"

    # BUG-1 FIX: Use Mapped[type] + mapped_column() — the correct SQLAlchemy 2.x pattern.
    # Previously the code mixed bare Column() with type annotations which caused
    # ArgumentError in SQLAlchemy 2.x.
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task: Mapped[str] = mapped_column(Text, nullable=False)
    wrong_code: Mapped[str] = mapped_column(Text, nullable=False)
    correct_code: Mapped[str] = mapped_column(Text, nullable=False)
    lesson_text: Mapped[str] = mapped_column(Text, nullable=False)
    # Subject label for ChromaDB pre-filtering (literature/stem/language/history).
    # Empty string means "unknown / legacy" — compatible with old rows.
    subject: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # BUG-2 FIX: Replace deprecated datetime.utcnow with timezone-aware now().
    timestamp: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )
    feedback_score: Mapped[float] = mapped_column(Float, nullable=False, default=3.0)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "task": self.task,
            "wrong_code": self.wrong_code,
            "correct_code": self.correct_code,
            "lesson_text": self.lesson_text,
            "subject": self.subject,
            "timestamp": self.timestamp.isoformat() if self.timestamp else None,
            "feedback_score": self.feedback_score,
        }


class PipelineRun(Base):
    """Log entry for each agent pipeline execution (research metrics)."""

    __tablename__ = "pipeline_runs"

    # BUG-1 FIX: Use Mapped[type] + mapped_column()
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # BUG-2 FIX: timezone-aware default
    timestamp: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )
    task: Mapped[str] = mapped_column(Text, nullable=False)
    iterations: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    auto_fixed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # SQLite boolean as int
    # Links re-grade runs into a chain: run #1 → run #2 → run #3 (approved).
    # NULL for the first grading of an essay.
    parent_run_id: Mapped[int] = mapped_column(Integer, nullable=True, default=None)
    # Full Grader JSON for this run. Stored server-side so the "Bài đã chấm"
    # history is not a browser-local source of truth.
    grade_json: Mapped[str] = mapped_column(Text, nullable=False, default="")
    subject: Mapped[str] = mapped_column(Text, nullable=False, default="")
    lessons_used_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")


class ApprovedGrade(Base):
    """Record of a teacher-approved AI grade (positive HITL signal).

    Captures the grades the AI got RIGHT — useful for:
      - Measuring approval rate over time (research metric)
      - Building few-shot example pools for future prompts
      - Proving the HITL loop improves grading quality
    """

    __tablename__ = "approved_grades"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    timestamp: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        nullable=False,
    )
    task: Mapped[str] = mapped_column(Text, nullable=False)
    grade_json: Mapped[str] = mapped_column(Text, nullable=False)
    run_id: Mapped[int] = mapped_column(Integer, nullable=True)


# ---------------------------------------------------------------------------
# Memory Manager
# ---------------------------------------------------------------------------

CHROMA_COLLECTION = "hitl_grading_lessons_v1"


def _timestamp_ms(value: datetime.datetime | None) -> int:
    if value is None:
        return 0
    if value.tzinfo is None:
        value = value.replace(tzinfo=datetime.timezone.utc)
    return int(value.timestamp() * 1000)


def _parse_json_object(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw or "{}")
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _parse_json_array(raw: str) -> list[dict[str, Any]]:
    try:
        parsed = json.loads(raw or "[]")
    except Exception:
        return []
    return [x for x in parsed if isinstance(x, dict)] if isinstance(parsed, list) else []


_CAU_RE = re.compile(r"^\s*C[âa]u\s+(\d+)", re.IGNORECASE)


def _question_number(raw: str, fallback: int) -> int:
    match = _CAU_RE.match(raw or "")
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            return fallback
    return fallback


def _teacher_overrides_from_approved_grade(
    approved_grade_json: str,
) -> tuple[dict[int, float], dict[int, float]]:
    grade = _parse_json_object(approved_grade_json)
    pqf = grade.get("per_question_feedback")
    if not isinstance(pqf, list):
        return {}, {}
    final_scores: dict[int, float] = {}
    max_overrides: dict[int, float] = {}
    for i, item in enumerate(pqf):
        if not isinstance(item, dict):
            continue
        num = _question_number(str(item.get("question") or ""), i + 1)
        score = item.get("score")
        if isinstance(score, (int, float)):
            final_scores[num] = float(score)
        max_points = item.get("max_points")
        if isinstance(max_points, (int, float)):
            max_overrides[num] = float(max_points)
    return final_scores, max_overrides


class MemoryManager:
    """Dual-backend memory for grading lessons.

    SQLite stores the structured record (essay topic, AI grade JSON,
    teacher grade JSON, instructional note) and ChromaDB indexes the
    free-text lesson for semantic retrieval at prompt-build time.
    """

    def __init__(self, db_dir: Path | None = None) -> None:
        if db_dir is None:
            # ``__file__`` is at ``backend/memory/store.py`` — go up TWO
            # levels to reach ``backend/`` then into ``data/``. After the
            # domain-folder restructure the file lives one level deeper
            # than the original ``backend/memory.py``.
            db_dir = Path(__file__).resolve().parent.parent / "data"
        db_dir.mkdir(parents=True, exist_ok=True)

        # --- SQLite ---
        db_path = db_dir / "hitl_mirror.db"
        self._engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self._engine)
        self._migrate_legacy_schema()
        # BUG-3 FIX: sessionmaker produces context-manager-compatible sessions in SQLAlchemy 2.x
        # when used with `with self._SessionLocal() as session:` syntax.
        self._SessionLocal = sessionmaker(bind=self._engine, expire_on_commit=False)

        # --- ChromaDB ---
        chroma_path = db_dir / "chroma"
        self._chroma_client = chromadb.PersistentClient(path=str(chroma_path))
        self._collection = self._chroma_client.get_or_create_collection(
            name=CHROMA_COLLECTION,
            metadata={"hnsw:space": "cosine"},
        )

    # ---- helpers ----------------------------------------------------------

    def _migrate_legacy_schema(self) -> None:
        """Add columns introduced after the initial schema on legacy DBs.

        ``Base.metadata.create_all()`` only creates MISSING tables — it never
        alters an existing one. For columns added after v1 (e.g. ``subject``
        on ``lessons``), probe the live schema on startup and ``ALTER TABLE``
        if needed. SQLite supports ADD COLUMN since 3.2, so this is cheap.
        """
        inspector = inspect(self._engine)
        if not inspector.has_table("lessons"):
            return  # fresh DB — create_all() already produced the correct shape

        existing = {c["name"] for c in inspector.get_columns("lessons")}
        if "subject" not in existing:
            with self._engine.begin() as conn:
                conn.execute(
                    text(
                        "ALTER TABLE lessons "
                        "ADD COLUMN subject TEXT NOT NULL DEFAULT ''"
                    )
                )
            logger.info("Migrated legacy 'lessons' table: added 'subject' column")

        if inspector.has_table("pipeline_runs"):
            run_columns = {c["name"] for c in inspector.get_columns("pipeline_runs")}
            run_migrations = {
                "grade_json": "ALTER TABLE pipeline_runs ADD COLUMN grade_json TEXT NOT NULL DEFAULT ''",
                "subject": "ALTER TABLE pipeline_runs ADD COLUMN subject TEXT NOT NULL DEFAULT ''",
                "lessons_used_json": "ALTER TABLE pipeline_runs ADD COLUMN lessons_used_json TEXT NOT NULL DEFAULT '[]'",
            }
            for column, ddl in run_migrations.items():
                if column not in run_columns:
                    with self._engine.begin() as conn:
                        conn.execute(text(ddl))
                    logger.info("Migrated legacy 'pipeline_runs' table: added '%s' column", column)

        # UNIQUE INDEX on approved_grades — prevents the finalize_grade race
        # where two concurrent requests both pass "not found" and both
        # insert the same row. COALESCE(run_id, -1) collapses NULL into a
        # sentinel so SQLite's NULL-is-distinct semantics don't let two
        # rows with run_id=NULL slip through.
        #
        # Wrapped in try/except because a legacy DB MAY already contain
        # duplicate rows that would block creation. In that case we log a
        # warning and let save_approved_grade continue without DB-level
        # dedup — callers keep working, duplicates just won't be prevented.
        try:
            with self._engine.begin() as conn:
                conn.execute(
                    text(
                        "CREATE UNIQUE INDEX IF NOT EXISTS "
                        "uq_approved_task_grade_run ON approved_grades("
                        "task, grade_json, COALESCE(run_id, -1))"
                    )
                )
        except Exception:
            logger.warning(
                "Could not create UNIQUE INDEX on approved_grades — "
                "duplicate rows may already exist; idempotent save will "
                "degrade gracefully",
                exc_info=True,
            )

    @contextmanager
    def _get_session(self):
        """BUG-3 FIX: Proper session context manager that commits and rolls back correctly."""
        session: Session = self._SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    # ---- public API -------------------------------------------------------

    def save_lesson(
        self,
        task: str,
        wrong_code: str,
        correct_code: str,
        lesson_text: str,
        feedback_score: float = 3.0,
        subject: str = "",
    ) -> int:
        """Persist a grading lesson to both SQLite and ChromaDB with compensation.

        Args:
            task:          essay topic
            wrong_code:    AI's incorrect grade JSON (or empty)
            correct_code:  teacher's corrected grade JSON (or empty)
            lesson_text:   teacher's instructional note
            feedback_score: 1.0–5.0 priority weight (higher = stronger constraint)
            subject:       subject label (literature/stem/language/history) for
                           ChromaDB pre-filtering — speeds up retrieval by
                           narrowing the search space before vector similarity.

        Returns:
            The auto-generated lesson ID.
        """
        with self._get_session() as session:
            lesson = Lesson(
                task=task,
                wrong_code=wrong_code,
                correct_code=correct_code,
                lesson_text=lesson_text,
                feedback_score=feedback_score,
                subject=subject,
            )
            session.add(lesson)
            session.flush()   # flush to get auto-generated ID before commit
            lesson_id = lesson.id

        try:
            # Mirror into ChromaDB. Embed ``task`` + ``lesson_text`` together so
            # future-task retrieval works even when the teacher's note is terse
            # (e.g. "[Câu 1] sai ý a") — the topic context still anchors the vector.
            embed_text = f"{task}\n{lesson_text}".strip() or lesson_text
            meta: dict[str, Any] = {"lesson_id": lesson_id, "task": task}
            if subject:
                meta["subject"] = subject
            self._collection.upsert(
                ids=[str(lesson_id)],
                documents=[embed_text],
                metadatas=[meta],
            )
        except Exception:
            # SQLite committed first, so compensate to keep both stores aligned.
            try:
                with self._get_session() as session:
                    persisted = session.get(Lesson, lesson_id)
                    if persisted is not None:
                        session.delete(persisted)
            except Exception:
                logger.exception(
                    "Failed to roll back SQLite lesson %s after Chroma upsert error",
                    lesson_id,
                )
            raise
        return lesson_id

    # Cosine-distance cutoff for the *semantic* leg of retrieval.
    # Default embeddings (MiniLM) compress Vietnamese short-text distances
    # into 0.4–0.7. Empirically ≤ 0.4 catches near-duplicates and slight
    # rewordings of the same topic while filtering out unrelated Vietnamese
    # essays (which cluster around 0.48–0.56). Tune if you swap embedding
    # models to one with stronger Vietnamese coverage.
    SIMILARITY_DISTANCE_THRESHOLD: float = 0.4

    def _semantic_leg(
        self,
        query: str,
        total: int,
        top_k: int,
        seen: set[int],
        ordered_ids: list[int],
        *,
        where: dict[str, Any] | None = None,
        label: str = "semantic",
    ) -> None:
        """Run one semantic-search leg, appending new hits in-place.

        Both the subject-scoped and the global-fallback legs share the same
        Chroma query shape and same id/distance filtering — they only
        differ in the ``where`` clause. This helper keeps the retrieval
        logic DRY so the main method reads as "exact → subject → global".
        """
        remaining = top_k - len(ordered_ids)
        if remaining <= 0:
            return
        try:
            kwargs: dict[str, Any] = {
                "query_texts": [query],
                "n_results": min(top_k * 2, total),
            }
            if where:
                kwargs["where"] = where
            sem = self._collection.query(**kwargs)
            ids = (sem.get("ids") or [[]])[0]
            distances = (sem.get("distances") or [[]])[0]
            for lid, dist in zip(ids, distances):
                if remaining <= 0:
                    break
                if dist is not None and dist > self.SIMILARITY_DISTANCE_THRESHOLD:
                    continue
                try:
                    i = int(lid)
                except (TypeError, ValueError):
                    continue
                if i in seen:
                    continue
                seen.add(i)
                ordered_ids.append(i)
                remaining -= 1
        except Exception:
            logger.exception("%s lesson retrieval failed", label)

    def search_relevant_lessons(
        self, task_description: str, top_k: int = 3, subject: str = ""
    ) -> list[dict[str, Any]]:
        """Hybrid retrieval of grading lessons relevant to the current task.

        Strategy (3-leg, subject-aware):
          1. Exact task match via Chroma metadata — always included (this is
             the "same essay prompt re-uploaded" path that powered the
             original HITL loop).
          2. Subject-scoped semantic search — narrows the vector search to
             lessons of the SAME subject (math vs cs). Dramatically reduces
             the search space and removes cross-subject noise.
          3. Fallback full-collection semantic search — if subject-scoped
             search didn't fill all slots, fall back to a global search.

        Exact matches come first (strongest signal); subject-scoped
        expansions next; global fallback fills any remaining slots.

        Args:
            task_description: The essay topic text.
            top_k:           Maximum number of lessons to return.
            subject:         Subject label for pre-filtering. Empty string
                             skips subject filter.
        """
        total = self._collection.count()
        if total == 0 or not (task_description or "").strip():
            return []

        seen: set[int] = set()
        ordered_ids: list[int] = []

        # Leg 1 — exact task metadata match.
        try:
            exact = self._collection.get(
                where={"task": task_description},
                limit=top_k,
            )
            for lid in exact.get("ids", []) or []:
                try:
                    i = int(lid)
                except (TypeError, ValueError):
                    continue
                if i not in seen:
                    seen.add(i)
                    ordered_ids.append(i)
        except Exception:
            logger.exception("Exact-match lesson retrieval failed")

        # Leg 2 — subject-scoped semantic search (only when a subject was given).
        if subject:
            self._semantic_leg(
                task_description, total, top_k, seen, ordered_ids,
                where={"subject": subject},
                label="Subject-scoped semantic",
            )

        # Leg 3 — global fallback semantic search.
        self._semantic_leg(
            task_description, total, top_k, seen, ordered_ids,
            label="Global semantic",
        )

        if not ordered_ids:
            return []

        with self._get_session() as session:
            lessons = (
                session.query(Lesson).filter(Lesson.id.in_(ordered_ids)).all()
            )
            by_id = {les.id: les.to_dict() for les in lessons}

        return [by_id[lid] for lid in ordered_ids if lid in by_id]


    def log_pipeline_run(
        self,
        task: str,
        iterations: int = 1,
        auto_fixed: bool = False,
        parent_run_id: int | None = None,
        grade_json: str = "",
        subject: str = "",
        lessons_used: list[dict[str, Any]] | None = None,
    ) -> int:
        """Record a pipeline execution for research metrics.

        Args:
            parent_run_id: ID of the previous run when this is a teacher-
                           triggered re-grade, forming a chain for analysis.
        """
        try:
            lessons_used_json = json.dumps(lessons_used or [], ensure_ascii=False)
        except TypeError:
            lessons_used_json = "[]"
        with self._get_session() as session:
            run = PipelineRun(
                task=task,
                iterations=iterations,
                auto_fixed=int(auto_fixed),
                parent_run_id=parent_run_id,
                grade_json=grade_json,
                subject=subject,
                lessons_used_json=lessons_used_json,
            )
            session.add(run)
            session.flush()
            return run.id

    def list_grade_history(self, limit: int = 50) -> list[dict[str, Any]]:
        """Return recent grade runs for the workspace history dropdown.

        The browser used to persist this in localStorage. Keeping it here
        makes SQLite the source of truth and lets finalized teacher scores
        survive browser/cache clears.
        """
        with self._get_session() as session:
            runs = (
                session.query(PipelineRun)
                .order_by(PipelineRun.timestamp.desc())
                .limit(max(1, min(limit, 100)))
                .all()
            )
            run_ids = [run.id for run in runs]
            approved_rows = (
                session.query(ApprovedGrade)
                .filter(ApprovedGrade.run_id.in_(run_ids))
                .order_by(ApprovedGrade.timestamp.desc())
                .all()
                if run_ids
                else []
            )
            approved_by_run: dict[int, ApprovedGrade] = {}
            for row in approved_rows:
                if row.run_id is not None and row.run_id not in approved_by_run:
                    approved_by_run[row.run_id] = row

        items: list[dict[str, Any]] = []
        for run in runs:
            approved = approved_by_run.get(run.id)
            code = run.grade_json or (approved.grade_json if approved else "")
            if not code:
                continue
            final_scores: dict[int, float] = {}
            max_overrides: dict[int, float] = {}
            if approved and approved.grade_json:
                final_scores, max_overrides = _teacher_overrides_from_approved_grade(
                    approved.grade_json
                )
            items.append(
                {
                    "id": str(run.id),
                    "ts": _timestamp_ms(approved.timestamp if approved else run.timestamp),
                    "task": run.task,
                    "subject": run.subject or None,
                    "response": {
                        "code": code,
                        "lessons_used": _parse_json_array(run.lessons_used_json),
                        "run_id": run.id,
                    },
                    "finalScores": final_scores or None,
                    "maxOverrides": max_overrides or None,
                }
            )
        items.sort(key=lambda item: int(item.get("ts") or 0), reverse=True)
        return items

    def save_approved_grade(
        self, task: str, grade_json: str, run_id: int | None = None
    ) -> int:
        """Persist a teacher-approved grade as a positive HITL signal.

        Idempotent under the UNIQUE INDEX added in ``_migrate_legacy_schema``:
        if a row with the same ``(task, grade_json, run_id)`` already exists,
        returns that row's ID instead of inserting a duplicate. Race-safe —
        two concurrent calls both attempt INSERT; the DB rejects the loser
        with IntegrityError, which we catch and convert to a SELECT.

        Replaces the old find-then-save pattern in main.finalize_grade that
        had a classic check-then-act race (both requests passed the find,
        both inserted).
        """
        with self._get_session() as session:
            record = ApprovedGrade(
                task=task, grade_json=grade_json, run_id=run_id,
            )
            session.add(record)
            try:
                session.flush()
                return record.id
            except IntegrityError:
                session.rollback()
                query = session.query(ApprovedGrade.id).filter(
                    ApprovedGrade.task == task,
                    ApprovedGrade.grade_json == grade_json,
                )
                if run_id is None:
                    query = query.filter(ApprovedGrade.run_id.is_(None))
                else:
                    query = query.filter(ApprovedGrade.run_id == run_id)
                existing_id = query.scalar()
                if existing_id is None:
                    # UNIQUE violated but row not found — integrity is
                    # genuinely broken (DB corruption / schema mismatch).
                    raise
                return existing_id

    def list_lessons(
        self,
        subject: str = "",
        search: str = "",
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        """Return lessons sorted by retrieval priority (feedback_score DESC, timestamp DESC).

        This sort order matches PromptOrchestrator's ranking — what the
        teacher sees here is the same order Gemini sees in the prompt block.
        """
        with self._get_session() as session:
            q = session.query(Lesson)
            if subject:
                q = q.filter(Lesson.subject == subject)
            if search:
                pattern = f"%{search}%"
                q = q.filter(
                    (Lesson.lesson_text.ilike(pattern)) | (Lesson.task.ilike(pattern))
                )
            q = q.order_by(Lesson.feedback_score.desc(), Lesson.timestamp.desc())
            q = q.limit(max(1, min(limit, 500)))
            return [les.to_dict() for les in q.all()]

    def delete_lesson(self, lesson_id: int) -> bool:
        """Remove a lesson from BOTH stores. Returns True if found and deleted.

        Deletes ChromaDB first (idempotent — missing IDs are silently
        ignored) so a partial failure leaves the SQL row intact rather than
        the other way round; orphaned vectors would silently re-surface in
        retrieval, but an orphaned SQL row with no vector is harmless.
        """
        try:
            self._collection.delete(ids=[str(lesson_id)])
        except Exception:
            logger.exception("Chroma delete failed for lesson %s", lesson_id)

        with self._get_session() as session:
            lesson = session.get(Lesson, lesson_id)
            if lesson is None:
                return False
            session.delete(lesson)
            return True

    def get_memory_stats(self) -> dict[str, Any]:
        """Aggregate counts for the memory inspector dashboard.

        Returns total lesson count + per-subject breakdown + count by HITL
        signal tier (reject 5.0 / revise+delta 4.0 / staged 3.5 /
        aggregate 3.0). Useful for showing the teacher how the AI's
        learning corpus is composed without forcing them to scroll.
        """
        with self._get_session() as session:
            total = session.query(Lesson).count()
            approved = session.query(ApprovedGrade).count()
            runs = session.query(PipelineRun).count()
            by_subject: dict[str, int] = {}
            for sub, cnt in (
                session.query(Lesson.subject, Lesson.id)
                .all()
            ):
                key = sub or "unknown"
                by_subject[key] = by_subject.get(key, 0) + 1
            # Bucket scores into the named tiers from CLAUDE.md so the UI
            # can show "5 reject lessons, 12 revise, 8 staged" without
            # hard-coding the score → label map on the frontend.
            tiers = {"reject": 0, "revise": 0, "staged": 0, "aggregate": 0, "other": 0}
            for (score,) in session.query(Lesson.feedback_score).all():
                if score >= 5.0:
                    tiers["reject"] += 1
                elif score >= 4.0:
                    tiers["revise"] += 1
                elif score >= 3.5:
                    tiers["staged"] += 1
                elif score >= 3.0:
                    tiers["aggregate"] += 1
                else:
                    tiers["other"] += 1
        return {
            "total_lessons": total,
            "total_approved_grades": approved,
            "total_pipeline_runs": runs,
            "by_subject": by_subject,
            "by_tier": tiers,
        }

    def find_recent_lesson(
        self,
        *,
        task: str,
        lesson_text: str,
        feedback_score: float,
        within_seconds: int = 300,
    ) -> int | None:
        """Return id of a matching lesson saved within ``within_seconds``, else None.

        Used by /api/finalize-grade to keep the HITL corpus clean when a
        teacher double-clicks "Đã lưu" or unlocks + re-finalizes with
        identical edits. Exact byte-equality on ``lesson_text`` is enough
        because ``format_delta_lesson`` is deterministic given the same
        deltas — anything that round-trips to the same rendered text is
        the same correction and should reuse the existing lesson id.

        Without this guard each click would mint a new row + a new Chroma
        vector, and retrieval would over-weight the duplicated correction
        (score-DESC ordering doesn't dedupe).
        """
        cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
            seconds=within_seconds
        )
        with self._get_session() as session:
            return (
                session.query(Lesson.id)
                .filter(
                    Lesson.task == task,
                    Lesson.lesson_text == lesson_text,
                    Lesson.feedback_score == feedback_score,
                    Lesson.timestamp >= cutoff,
                )
                .order_by(Lesson.timestamp.desc())
                .limit(1)
                .scalar()
            )

    def backfill_correct_code(self, task: str, correct_code: str) -> int:
        """Fill in ``correct_code`` on lessons that lack it for *task*.

        Called when the teacher approves a grade after one or more
        revise/reject cycles.  The approved grade JSON is back-propagated
        to every lesson that was created during those cycles (they were
        stored with ``correct_code=""`` because the correct answer was
        not yet known).

        Returns the number of lessons updated.
        """
        with self._get_session() as session:
            lessons = (
                session.query(Lesson)
                .filter(Lesson.task == task, Lesson.correct_code == "")
                .all()
            )
            for les in lessons:
                les.correct_code = correct_code
            return len(lessons)
