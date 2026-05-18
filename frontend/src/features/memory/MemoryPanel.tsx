import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ApiError,
  deleteLesson,
  getMemoryStats,
  listLessons,
  type MemoryStats,
} from "../../api";
import { Icon } from "../../components/ui/Icon";
import { T } from "../../theme/tokens";
import type { Lesson } from "../../types";

// ---------------------------------------------------------------------------
// Source / tier model — derives a 5-bucket source tag from the lesson's
// feedback_score plus a probe of lesson_text. Mirrors how the backend
// produces lessons:
//
//   reject  (5.0) → REJECT
//   revise  (4.0) → REVISE  (free-form correction note)
//   delta   (4.0) → Δ-GRADE (numeric-correction lesson, ``format_delta_lesson``)
//   per-q   (3.5) → PER-CÂU (distilled per-question rule)
//   approve (3.0) → APPROVE (aggregate comment on approve)
//
// Δ-GRADE lessons share score 4.0 with REVISE — they are disambiguated by
// the Vietnamese prefix that ``backend/grading/scoring.py`` writes into
// ``lesson_text``. Keep that string in sync if the prompt changes.
// ---------------------------------------------------------------------------

const DELTA_LESSON_PREFIX = "Hiệu chỉnh điểm";

type SourceTag = "REJECT" | "Δ-GRADE" | "REVISE" | "PER-CÂU" | "APPROVE";
type SourceFilter = "" | SourceTag;
// "" = "Mọi môn"; any other string is a subject code returned by the backend
// (e.g. "math", "cs", "phys", "chem", …). Pills are derived from
// stats.by_subject so adding a subject on the backend requires no frontend
// change.
type SubjectFilter = string;

interface SourceMeta {
  label: SourceTag;
  /** Score that defines this bucket — used by the distribution chart. */
  score: number;
  /** Display label for the score column in the table. */
  scoreLabel: string;
  color: string;
}

const SOURCE_META: Record<SourceTag, SourceMeta> = {
  REJECT:    { label: "REJECT",   score: 5.0, scoreLabel: "5.0", color: T.red },
  "Δ-GRADE": { label: "Δ-GRADE",  score: 4.0, scoreLabel: "4.0", color: T.amber },
  REVISE:    { label: "REVISE",   score: 4.0, scoreLabel: "4.0", color: T.amber },
  "PER-CÂU": { label: "PER-CÂU",  score: 3.5, scoreLabel: "3.5", color: T.accent },
  APPROVE:   { label: "APPROVE",  score: 3.0, scoreLabel: "3.0", color: T.green },
};

function sourceFromLesson(lesson: Pick<Lesson, "feedback_score" | "lesson_text">): SourceTag {
  const s = lesson.feedback_score;
  if (s >= 5.0) return "REJECT";
  if (s >= 4.0) {
    return lesson.lesson_text.startsWith(DELTA_LESSON_PREFIX) ? "Δ-GRADE" : "REVISE";
  }
  if (s >= 3.5) return "PER-CÂU";
  return "APPROVE";
}

// Known subject codes — extend when the backend adds a translated label.
// Unknown codes fall through to ``subjectLabel`` which capitalizes the raw key,
// so a brand-new subject (e.g. "chem") still renders without a code change.
const SUBJECT_LABEL: Record<string, string> = {
  cs: "Tin học",
  math: "Toán",
  phys: "Vật lý",
  stem: "STEM",
  unknown: "Khác",
};

function subjectLabel(code: string | null | undefined): string {
  if (!code) return "Khác";
  if (code in SUBJECT_LABEL) return SUBJECT_LABEL[code];
  return code.charAt(0).toUpperCase() + code.slice(1);
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // 2026-05-12 — short ISO so the column lines up under a mono font.
  return d.toISOString().slice(0, 10);
}

function formatLessonId(id: number): string {
  return `L-${id.toString().padStart(4, "0")}`;
}

export function MemoryPanel() {
  const handleClose = useCallback(() => {
    if (window.opener && !window.opener.closed) {
      window.close();
      return;
    }
    window.location.hash = "";
    window.location.reload();
  }, []);

  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [subject, setSubject] = useState<SubjectFilter>("");
  const [source, setSource] = useState<SourceFilter>("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Backend filters: subject + free-text search.
  // Source filter is client-side because it depends on a lesson_text probe
  // that the SQLite layer doesn't index.
  const fetchAll = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const [list, st] = await Promise.all([
          listLessons({ subject, search, limit: 300 }, { signal }),
          getMemoryStats({ signal }),
        ]);
        setLessons(list.items);
        setStats(st);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const msg = err instanceof ApiError ? err.detail : (err as Error).message;
        setError(msg || "Không tải được bộ nhớ.");
      } finally {
        setLoading(false);
      }
    },
    [subject, search],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    const handle = setTimeout(() => {
      fetchAll(ctrl.signal);
    }, 250);
    return () => {
      clearTimeout(handle);
      ctrl.abort();
    };
  }, [fetchAll]);

  const handleDelete = useCallback(async (id: number) => {
    setDeletingId(id);
    try {
      await deleteLesson(id);
      setLessons((prev) => prev.filter((l) => l.id !== id));
      getMemoryStats()
        .then(setStats)
        .catch(() => undefined);
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : (err as Error).message;
      setError(msg || "Xoá bài học thất bại.");
    } finally {
      setDeletingId(null);
    }
  }, []);

  // Source filter is client-side; subject + search already happened on the
  // server. Compute the source tag once per lesson here so the table render
  // doesn't recompute on every hover.
  const tagged = useMemo(
    () => lessons.map((l) => ({ lesson: l, source: sourceFromLesson(l) })),
    [lessons],
  );
  const visible = useMemo(
    () => (source ? tagged.filter((t) => t.source === source) : tagged),
    [tagged, source],
  );

  const sourcePills: Array<{ value: SourceFilter; label: string }> = [
    { value: "",         label: "Tất cả" },
    { value: "REJECT",   label: "Reject" },
    { value: "Δ-GRADE",  label: "Δ-grade" },
    { value: "REVISE",   label: "Revise" },
    { value: "PER-CÂU",  label: "Per-câu" },
    { value: "APPROVE",  label: "Approve" },
  ];
  // Subject pills are derived from stats.by_subject so the list grows as
  // the backend adds subjects — no need to keep a hardcoded union in sync.
  // Sorted by count desc (most-used first) then alphabetical to keep order
  // stable across renders when counts tie. The currently-selected subject
  // is always included even if its count drops to 0, so a teacher who has
  // filtered to a subject doesn't see the active pill vanish mid-session.
  const subjectPills = useMemo<Array<{ value: SubjectFilter; label: string }>>(() => {
    const counts = stats?.by_subject ?? {};
    const codes = new Set<string>(Object.keys(counts).filter((k) => k && counts[k] > 0));
    if (subject) codes.add(subject);
    const sorted = Array.from(codes).sort((a, b) => {
      const diff = (counts[b] ?? 0) - (counts[a] ?? 0);
      return diff !== 0 ? diff : a.localeCompare(b);
    });
    return [
      { value: "", label: "Mọi môn" },
      ...sorted.map((c) => ({
        value: c,
        label: counts[c] ? `${subjectLabel(c)} (${counts[c]})` : subjectLabel(c),
      })),
    ];
  }, [stats, subject]);

  return (
    <div style={{ minHeight: "100vh" }}>
      <header
        style={{
          padding: `${T.space[3]}px clamp(16px, 4vw, 40px)`,
          borderBottom: `1px solid ${T.border}`,
          background: T.bgCard,
          position: "sticky",
          top: 0,
          zIndex: 80,
          display: "flex",
          alignItems: "center",
          gap: T.space[4],
        }}
      >
        <div
          style={{
            fontFamily: T.display,
            fontSize: T.fontSize.xl,
            fontWeight: 600,
            color: T.accentDark,
            letterSpacing: "-0.01em",
            lineHeight: 1.2,
          }}
        >
          Bộ nhớ AI
        </div>
      </header>

      {/* Hero — title + description (left), tier distribution chart (right). */}
      <div
        style={{
          maxWidth: T.width.app,
          margin: "0 auto",
          padding: `${T.space[8]}px clamp(16px, 4vw, 40px) 0`,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: T.space[8],
          alignItems: "start",
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: T.display,
              fontSize: T.fontSize["3xl"],
              fontWeight: 600,
              color: T.text,
              letterSpacing: "-0.02em",
              fontStyle: "italic",
              margin: `0 0 ${T.space[3]}px`,
            }}
          >
            Bộ nhớ HITL
          </h1>
          <p
            style={{
              fontSize: T.fontSize.base,
              color: T.textMute,
              margin: 0,
              lineHeight: 1.6,
              maxWidth: 560,
            }}
          >
            Mỗi lần bạn sửa AI, chúng tôi lưu lại bài học. Bài học có{" "}
            <span style={{ color: T.red, fontWeight: 600 }}>điểm càng cao</span>{" "}
            càng ảnh hưởng mạnh tới lần chấm tiếp theo.
          </p>
        </div>
        <TierDistribution lessons={lessons} />
      </div>

      {/* Filter row */}
      <div
        style={{
          maxWidth: T.width.app,
          margin: `${T.space[7]}px auto 0`,
          padding: `0 clamp(16px, 4vw, 40px)`,
          display: "flex",
          alignItems: "center",
          gap: T.space[4],
          flexWrap: "wrap",
        }}
      >
        <SearchInput value={search} onChange={setSearch} />
        <PillGroup
          pills={sourcePills}
          active={source}
          onChange={(v) => setSource(v as SourceFilter)}
        />
        <div style={{ flex: 1 }} />
        <PillGroup
          pills={subjectPills}
          active={subject}
          onChange={(v) => setSubject(v as SubjectFilter)}
        />
      </div>

      {/* Content */}
      <div
        style={{
          maxWidth: T.width.app,
          margin: `${T.space[5]}px auto 0`,
          padding: `0 clamp(16px, 4vw, 40px) 96px`,
        }}
      >
        {error && (
          <div
            style={{
              margin: `0 0 ${T.space[4]}px`,
              padding: `${T.space[3]}px ${T.space[4]}px`,
              background: T.redSoft,
              border: `1px solid ${T.red}`,
              borderRadius: 8,
              color: T.red,
              fontSize: T.fontSize.sm,
            }}
          >
            <Icon.AlertTriangle size={14} color={T.red} /> {error}
          </div>
        )}

        {loading && lessons.length === 0 ? (
          <SkeletonList />
        ) : visible.length === 0 ? (
          <EmptyState
            hasFilter={!!subject || !!search || !!source}
            onClose={handleClose}
          />
        ) : (
          <LessonTable
            rows={visible}
            deletingId={deletingId}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TierDistribution({ lessons }: { lessons: Lesson[] }) {
  // 4 buckets keyed by score — REVISE and Δ-GRADE both fall in 4.0, so the
  // chart shows the combined "score 4" column. The table column still
  // distinguishes them via the NGUỒN tag.
  const buckets: Array<{ score: number; label: string; color: string }> = [
    { score: 5.0, label: "score 5",   color: T.red },
    { score: 4.0, label: "score 4",   color: T.amber },
    { score: 3.5, label: "score 3.5", color: T.accent },
    { score: 3.0, label: "score 3",   color: T.green },
  ];
  const counts = buckets.map((b) => ({
    ...b,
    count: lessons.filter((l) => Math.abs(l.feedback_score - b.score) < 0.01).length,
  }));
  const max = Math.max(1, ...counts.map((b) => b.count));
  const barAreaHeight = 64;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: T.space[4],
      }}
    >
      {counts.map((b) => {
        const h = b.count === 0 ? 4 : Math.max(8, (b.count / max) * barAreaHeight);
        return (
          <div
            key={b.score}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: T.space[1],
            }}
          >
            <span
              style={{
                fontFamily: T.mono,
                fontSize: T.fontSize.xs,
                color: b.color,
                fontWeight: 600,
                lineHeight: 1,
              }}
            >
              {b.count}
            </span>
            <div
              style={{
                width: 24,
                height: h,
                background: b.color,
                opacity: b.count === 0 ? 0.25 : 1,
                borderRadius: 2,
                transition: "height 0.3s ease",
              }}
            />
            <span
              style={{
                fontFamily: T.mono,
                fontSize: T.fontSize.xs,
                color: T.textMute,
                lineHeight: 1,
              }}
            >
              {b.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        minWidth: 240,
        maxWidth: 320,
        display: "flex",
        alignItems: "center",
        gap: T.space[2],
        background: T.bgInput,
        border: `1px solid ${T.border}`,
        padding: `${T.space[2]}px ${T.space[3]}px`,
        borderRadius: 8,
      }}
    >
      <Icon.MessageCircle size={14} color={T.textFaint} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Tìm trong bài học…"
        style={{
          flex: 1,
          background: "transparent",
          border: "none",
          outline: "none",
          color: T.text,
          fontSize: T.fontSize.sm,
          fontFamily: T.font,
          minWidth: 0,
        }}
      />
      {value && (
        <button
          onClick={() => onChange("")}
          style={{
            background: "transparent",
            border: "none",
            color: T.textFaint,
            cursor: "pointer",
            padding: 2,
            display: "inline-flex",
          }}
          title="Xoá tìm kiếm"
        >
          <Icon.X size={12} />
        </button>
      )}
    </div>
  );
}

function PillGroup<V extends string>({
  pills,
  active,
  onChange,
}: {
  pills: Array<{ value: V; label: string }>;
  active: V;
  onChange: (v: V) => void;
}) {
  return (
    <div style={{ display: "flex", gap: T.space[1], flexWrap: "wrap" }}>
      {pills.map((pill) => {
        const isActive = pill.value === active;
        return (
          <button
            key={pill.value || "_all"}
            onClick={() => onChange(pill.value)}
            style={{
              background: isActive ? T.text : "transparent",
              border: `1px solid ${isActive ? T.text : T.border}`,
              color: isActive ? T.bgCard : T.textSoft,
              padding: `${T.space[1]}px ${T.space[3]}px`,
              fontSize: T.fontSize.sm,
              fontFamily: T.font,
              borderRadius: 999,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.borderColor = T.text;
                e.currentTarget.style.color = T.text;
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                e.currentTarget.style.borderColor = T.border;
                e.currentTarget.style.color = T.textSoft;
              }
            }}
          >
            {pill.label}
          </button>
        );
      })}
    </div>
  );
}

interface TaggedLesson {
  lesson: Lesson;
  source: SourceTag;
}

function LessonTable({
  rows,
  deletingId,
  onDelete,
}: {
  rows: TaggedLesson[];
  deletingId: number | null;
  onDelete: (id: number) => void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          tableLayout: "fixed",
        }}
      >
        <colgroup>
          <col style={{ width: 88 }} />
          <col style={{ width: 80 }} />
          <col />
          <col style={{ width: 96 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 112 }} />
          <col style={{ width: 48 }} />
        </colgroup>
        <thead>
          <tr style={{ borderBottom: `1px solid ${T.border}` }}>
            {["ID", "SCORE", "BÀI HỌC", "MÔN", "NGUỒN", "NGÀY", ""].map((h, i) => (
              <th
                key={i}
                style={{
                  textAlign: "left",
                  padding: `${T.space[3]}px ${T.space[3]}px`,
                  fontSize: T.fontSize.xs,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: T.textMute,
                  fontFamily: T.mono,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ lesson, source }) => (
            <LessonRow
              key={lesson.id}
              lesson={lesson}
              source={source}
              isDeleting={deletingId === lesson.id}
              onDelete={() => onDelete(lesson.id)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LessonRow({
  lesson,
  source,
  isDeleting,
  onDelete,
}: {
  lesson: Lesson;
  source: SourceTag;
  isDeleting: boolean;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const meta = SOURCE_META[source];
  const subjLabel = subjectLabel(lesson.subject);

  const cellStyle: React.CSSProperties = {
    padding: `${T.space[3]}px ${T.space[3]}px`,
    verticalAlign: "top",
    fontSize: T.fontSize.sm,
    lineHeight: 1.55,
  };

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderBottom: `1px solid ${T.borderLight}`,
        background: hovered ? T.bgHover : "transparent",
        opacity: isDeleting ? 0.45 : 1,
        transition: "background 0.15s, opacity 0.2s",
      }}
    >
      <td style={{ ...cellStyle, fontFamily: T.mono, color: T.textMute, fontSize: T.fontSize.xs }}>
        {formatLessonId(lesson.id)}
      </td>
      <td
        style={{
          ...cellStyle,
          fontFamily: T.mono,
          color: meta.color,
          fontWeight: 600,
        }}
      >
        {meta.scoreLabel}
      </td>
      <td style={{ ...cellStyle, color: T.text }}>{lesson.lesson_text}</td>
      <td style={{ ...cellStyle, color: T.textSoft }}>{subjLabel}</td>
      <td
        style={{
          ...cellStyle,
          fontFamily: T.mono,
          fontSize: T.fontSize.xs,
          letterSpacing: "0.05em",
          color: meta.color,
          fontWeight: 600,
        }}
      >
        {meta.label}
      </td>
      <td
        style={{
          ...cellStyle,
          fontFamily: T.mono,
          fontSize: T.fontSize.xs,
          color: T.textMute,
        }}
      >
        {formatDate(lesson.timestamp)}
      </td>
      <td style={{ ...cellStyle, textAlign: "right" }}>
        <button
          onClick={onDelete}
          disabled={isDeleting}
          title="Quên bài học này"
          aria-label="Quên bài học này"
          style={{
            background: "transparent",
            border: "none",
            color: hovered ? T.red : "transparent",
            cursor: isDeleting ? "wait" : "pointer",
            padding: T.space[1],
            display: "inline-flex",
            transition: "color 0.15s",
          }}
        >
          <Icon.X size={14} />
        </button>
      </td>
    </tr>
  );
}

function SkeletonList() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: T.space[2] }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          style={{
            height: 48,
            background: T.bgCard,
            border: `1px solid ${T.borderLight}`,
            borderRadius: 4,
            opacity: 0.5,
            animation: `pulse 1.4s ease-in-out ${i * 0.1}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function EmptyState({
  hasFilter,
  onClose,
}: {
  hasFilter: boolean;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        maxWidth: 560,
        margin: `${T.space[8]}px auto 0`,
        padding: `${T.space[8]}px clamp(${T.space[6]}px, 5vw, ${T.space[10]}px)`,
        background: T.bgCard,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        textAlign: "center",
        boxShadow: T.shadowSoft,
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 72,
          height: 72,
          borderRadius: "50%",
          background: T.accentSoft,
          marginBottom: T.space[5],
        }}
      >
        <Icon.Lightbulb size={36} color={T.accent} />
      </div>
      <div
        style={{
          fontFamily: T.display,
          fontSize: T.fontSize["2xl"],
          fontWeight: 600,
          color: T.text,
          marginBottom: T.space[3],
          letterSpacing: "-0.01em",
        }}
      >
        {hasFilter ? "Không có bài học khớp bộ lọc" : "Chưa có bài học nào"}
      </div>
      <div
        style={{
          fontSize: T.fontSize.base,
          color: T.textSoft,
          lineHeight: 1.65,
          marginBottom: T.space[6],
        }}
      >
        {hasFilter
          ? "Thử bỏ bộ lọc hoặc xoá ô tìm kiếm để xem toàn bộ kho bài học."
          : "Khi bạn duyệt, sửa hoặc từ chối các bài chấm, AI sẽ ghi nhớ chỗ này. Hãy chấm vài bài rồi quay lại."}
      </div>
      {!hasFilter && (
        <button
          onClick={onClose}
          style={{
            background: T.accent,
            border: "none",
            color: "#FFFDF8",
            padding: `${T.space[3]}px ${T.space[6]}px`,
            fontSize: T.fontSize.base,
            fontFamily: T.font,
            fontWeight: 500,
            borderRadius: 8,
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            gap: T.space[2],
            transition: "background 0.15s, transform 0.15s",
            boxShadow: T.shadowSoft,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = T.accentDark;
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = T.accent;
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          <Icon.ArrowLeft size={14} /> Quay lại chấm bài
        </button>
      )}
    </div>
  );
}

