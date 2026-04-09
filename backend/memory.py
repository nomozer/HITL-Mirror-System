"""
memory.py — Dual-Store Memory Manager (SQLite + ChromaDB)
Purpose: Provides synchronized persistent storage for HITL lessons using
         relational (SQLite) and vector (ChromaDB) backends.
Author: [Your Name]
Research Project: HITL Agentic Code-Learning System — "Mirror" Edition
"""

from __future__ import annotations

import datetime
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import chromadb
from sqlalchemy import (
    DateTime,
    Float,
    Integer,
    String,
    Text,
    create_engine,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker, mapped_column, Mapped


# ---------------------------------------------------------------------------
# SQLAlchemy Models (SQLAlchemy 2.x style)
# ---------------------------------------------------------------------------

class Base(DeclarativeBase):
    pass


class Lesson(Base):
    """A single lesson learned from a HITL correction cycle."""

    __tablename__ = "lessons"

    # BUG-1 FIX: Use Mapped[type] + mapped_column() — the correct SQLAlchemy 2.x pattern.
    # Previously the code mixed bare Column() with type annotations which caused
    # ArgumentError in SQLAlchemy 2.x.
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task: Mapped[str] = mapped_column(Text, nullable=False)
    wrong_code: Mapped[str] = mapped_column(Text, nullable=False)
    correct_code: Mapped[str] = mapped_column(Text, nullable=False)
    lesson_text: Mapped[str] = mapped_column(Text, nullable=False)
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


# ---------------------------------------------------------------------------
# Memory Manager
# ---------------------------------------------------------------------------

CHROMA_COLLECTION = "hitl_lessons_v1"


class MemoryManager:
    """Dual-backend memory: SQLite for structured data, ChromaDB for semantic search."""

    def __init__(self, db_dir: Path | None = None) -> None:
        if db_dir is None:
            db_dir = Path(__file__).resolve().parent / "data"
        db_dir.mkdir(parents=True, exist_ok=True)

        # --- SQLite ---
        db_path = db_dir / "hitl_mirror.db"
        self._engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
        )
        Base.metadata.create_all(self._engine)
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
    ) -> int:
        """Persist a lesson to both SQLite and ChromaDB atomically.

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
            )
            session.add(lesson)
            session.flush()   # flush to get auto-generated ID before commit
            lesson_id = lesson.id

        # Mirror into ChromaDB
        self._collection.upsert(
            ids=[str(lesson_id)],
            documents=[lesson_text],
            metadatas=[{"lesson_id": lesson_id, "task": task}],
        )
        return lesson_id

    def search_relevant_lessons(
        self, task_description: str, top_k: int = 3
    ) -> list[dict[str, Any]]:
        """Semantic search via ChromaDB, then hydrate full records from SQLite.

        Args:
            task_description: Natural-language query to match against stored lessons.
            top_k: Maximum number of results.

        Returns:
            List of lesson dicts ordered by relevance.
        """
        total = self._collection.count()
        if total == 0:
            return []

        n_results = min(top_k, total)
        results = self._collection.query(
            query_texts=[task_description],
            n_results=n_results,
        )

        if not results["ids"] or not results["ids"][0]:
            return []

        lesson_ids = [int(lid) for lid in results["ids"][0]]

        with self._get_session() as session:
            lessons = (
                session.query(Lesson).filter(Lesson.id.in_(lesson_ids)).all()
            )
            by_id = {les.id: les.to_dict() for les in lessons}

        # Preserve ChromaDB relevance ordering
        return [by_id[lid] for lid in lesson_ids if lid in by_id]

    def get_all_lessons_summary(self) -> dict[str, Any]:
        """Aggregate stats for the Research Dashboard.

        Returns:
            Dict with total, avg_score, and the 5 most recent lessons.
        """
        with self._get_session() as session:
            total: int = session.query(func.count(Lesson.id)).scalar() or 0
            avg_score: float | None = session.query(
                func.avg(Lesson.feedback_score)
            ).scalar()
            recent = (
                session.query(Lesson)
                .order_by(Lesson.timestamp.desc())
                .limit(5)
                .all()
            )
            recent_dicts = [les.to_dict() for les in recent]

        return {
            "total": total,
            "avg_score": round(avg_score, 2) if avg_score else 0.0,
            "recent": recent_dicts,
        }

    def log_pipeline_run(
        self, task: str, iterations: int = 1, auto_fixed: bool = False
    ) -> int:
        """Record a pipeline execution for research metrics."""
        with self._get_session() as session:
            run = PipelineRun(
                task=task, iterations=iterations, auto_fixed=int(auto_fixed)
            )
            session.add(run)
            session.flush()
            return run.id

    def get_pipeline_stats(self) -> dict[str, Any]:
        """Return pipeline-level research metrics."""
        with self._get_session() as session:
            total_runs: int = (
                session.query(func.count(PipelineRun.id)).scalar() or 0
            )
            auto_fixed_count: int = (
                session.query(func.count(PipelineRun.id))
                .filter(PipelineRun.auto_fixed == 1)
                .scalar()
                or 0
            )

        auto_fix_rate = (
            round(auto_fixed_count / total_runs * 100, 1) if total_runs else 0.0
        )
        return {
            "total_runs": total_runs,
            "auto_fixed_count": auto_fixed_count,
            "auto_fix_rate": auto_fix_rate,
        }
