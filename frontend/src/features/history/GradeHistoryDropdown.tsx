import { useCallback, useEffect, useMemo, useState } from "react";
import { T } from "../../theme/tokens";
import {
  type CachedGrade,
  clearCachedGrades,
  getCachedGrades,
} from "../../hooks/useAgentPipeline";

interface GradeHistoryDropdownProps {
  open: boolean;
  onClose: () => void;
  /** Anchor element rect for positioning the popover under the trigger. */
  anchorRect: DOMRect | null;
}

const SUBJECT_LABEL: Record<string, string> = {
  cs:   "Tin học",
  math: "Toán",
  phys: "Vật lý",
  chem: "Hoá học",
  bio:  "Sinh học",
  stem: "STEM",
};

function subjectLabel(code: string | null): string {
  if (!code) return "Khác";
  if (code in SUBJECT_LABEL) return SUBJECT_LABEL[code];
  return code.charAt(0).toUpperCase() + code.slice(1);
}

// "5 phút trước" / "2 giờ trước" / "3 ngày trước" — friendlier than a raw
// ISO timestamp for a history dropdown where exact time rarely matters.
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "vừa xong";
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return new Date(ts).toLocaleDateString("vi-VN");
}

// Split the "Môn X · Lớp Y · <name>" prefix that buildTaskContext prepends
// into structured pieces:
//   body       = the essay's actual name (shown as the row title)
//   classLabel = "Lớp 10" / "" (shown next to the subject pill)
// Subject itself is read from entry.subject (the backend code), so we
// only need to skip past it here. The subject segment can be multi-word
// ("Sinh học", "Vật lý", "Hoá học") so we match ``[^·]+?`` instead of
// ``\S+`` — the old single-token regex bailed on 2-word subjects and
// left the entire "Môn ... · Lớp ... · ..." prefix in the title, where
// it doubled up with the subject pill rendered right below.
function parseTaskContext(task: string): { body: string; classLabel: string } {
  const m = task.match(/^Môn\s+[^·]+?\s*·\s*(Lớp\s+\d+)\s*·\s*(.+)$/iu);
  if (m) {
    return { classLabel: m[1].trim(), body: m[2].trim() || "(không tên)" };
  }
  return { classLabel: "", body: (task || "").trim() || "(không tên)" };
}

// Recency buckets so a 30-50 row list still gives the teacher a temporal
// anchor without a real timeline. Comparing day-boundaries (not wall
// clock) so "chấm lúc 23:55 hôm qua" sits in "Hôm qua" even when read
// at 00:05 today. ``getCachedGrades`` already returns newest-first, so
// each bucket inherits that ordering.
type Bucket = "today" | "yesterday" | "week" | "older";

const BUCKET_LABEL: Record<Bucket, string> = {
  today: "Hôm nay",
  yesterday: "Hôm qua",
  week: "7 ngày trước",
  older: "Cũ hơn",
};

const BUCKET_ORDER: Bucket[] = ["today", "yesterday", "week", "older"];

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function bucketOf(ts: number): Bucket {
  const dayDiff = Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86_400_000);
  if (dayDiff <= 0) return "today";
  if (dayDiff === 1) return "yesterday";
  if (dayDiff <= 7) return "week";
  return "older";
}

export function GradeHistoryDropdown({ open, onClose, anchorRect }: GradeHistoryDropdownProps) {
  // Re-read on each open so a freshly-saved grade appears without remounting.
  // Closed dropdowns don't pay the cost.
  const [entries, setEntries] = useState<CachedGrade[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) {
      setEntries(getCachedGrades());
      // Reset query when re-opening so the previous filter doesn't ghost
      // through (teacher's mental model: opening fresh = see everything).
      setQuery("");
    }
  }, [open]);

  // ESC closes — same UX as Memory / Help modals.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Filtered + grouped view. Filter against body + subject label so a
  // teacher searching "sinh" finds bio essays even when the row title is
  // just the đề name. Recomputed only when entries/query change.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter((e) => {
          const { body } = parseTaskContext(e.task);
          const subj = subjectLabel(e.subject).toLowerCase();
          return body.toLowerCase().includes(q) || subj.includes(q);
        })
      : entries;
    const out: Record<Bucket, CachedGrade[]> = {
      today: [],
      yesterday: [],
      week: [],
      older: [],
    };
    for (const entry of filtered) {
      out[bucketOf(entry.ts)].push(entry);
    }
    return out;
  }, [entries, query]);

  const totalVisible = groups.today.length + groups.yesterday.length + groups.week.length + groups.older.length;

  const handleLoad = useCallback(
    (id: string, step: 3 | 4 | 5 = 3) => {
      // Hand off to the active tab's EssayWorkspace via a window event. The
      // dropdown lives in the header and has no direct ref into the tab,
      // and the active tab listens for this exact event. Carrying ``step``
      // lets one cached grade enter at any of the three teacher-facing
      // surfaces (Review / Regrade / Done) — Review is the default since
      // that's where you usually want to start a re-pass.
      window.dispatchEvent(
        new CustomEvent("hitl.loadGrade", { detail: { id, step } }),
      );
      onClose();
    },
    [onClose],
  );

  const handleClearAll = useCallback(() => {
    if (entries.length === 0) return;
    if (!window.confirm(`Xoá toàn bộ ${entries.length} bài chấm khỏi lịch sử trình duyệt?`)) return;
    clearCachedGrades();
    setEntries([]);
  }, [entries.length]);

  // Anchor under the trigger button's right edge so the popover hangs
  // beneath the link rather than centering on the page.
  const popoverStyle = useMemo<React.CSSProperties>(() => {
    if (!anchorRect) {
      return { top: 60, right: 24 };
    }
    return {
      top: anchorRect.bottom + 6,
      right: Math.max(8, window.innerWidth - anchorRect.right),
    };
  }, [anchorRect]);

  if (!open) return null;

  return (
    <>
      {/* Transparent click-outside catcher. Sits below the popover (z 240)
          and above the page (z 80), so clicks anywhere except inside the
          popover close it. */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "transparent",
          zIndex: 240,
        }}
      />
      <div
        role="dialog"
        aria-label="Bài đã chấm"
        style={{
          position: "fixed",
          ...popoverStyle,
          width: "min(420px, calc(100vw - 16px))",
          maxHeight: "min(560px, calc(100vh - 80px))",
          background: T.bgCard,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          boxShadow: T.shadowStrong,
          zIndex: 250,
          display: "flex",
          flexDirection: "column",
          animation: "fadeUp 0.18s ease-out",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: `${T.space[3]}px ${T.space[4]}px`,
            borderBottom: `1px solid ${T.borderLight}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: T.space[3],
          }}
        >
          <div
            style={{
              fontFamily: T.display,
              fontSize: T.fontSize.lg,
              fontWeight: 600,
              color: T.text,
            }}
          >
            Bài đã chấm
          </div>
          {entries.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              style={{
                background: "transparent",
                border: "none",
                color: T.textFaint,
                fontSize: T.fontSize.xs,
                fontFamily: T.font,
                cursor: "pointer",
                padding: 4,
              }}
              title="Xoá toàn bộ lịch sử trình duyệt"
            >
              Xoá tất cả
            </button>
          )}
        </div>

        {/* Search box — only shown once there's at least one entry. Hidden
            on a fresh empty cache to keep the "Chưa có bài" empty state
            as the primary content. */}
        {entries.length > 0 && (
          <div
            style={{
              padding: `${T.space[2]}px ${T.space[4]}px`,
              borderBottom: `1px solid ${T.borderLight}`,
            }}
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo tên đề hoặc môn…"
              aria-label="Tìm trong lịch sử bài chấm"
              autoFocus
              style={{
                width: "100%",
                background: T.bg,
                border: `1px solid ${T.borderLight}`,
                borderRadius: 6,
                padding: "6px 10px",
                fontFamily: T.font,
                fontSize: T.fontSize.sm,
                color: T.text,
                outline: "none",
              }}
            />
          </div>
        )}

        {/* Body — scrollable list grouped by recency bucket */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {entries.length === 0 ? (
            <div
              style={{
                padding: `${T.space[8]}px ${T.space[5]}px`,
                textAlign: "center",
                color: T.textMute,
                fontSize: T.fontSize.sm,
                lineHeight: 1.6,
              }}
            >
              Chưa có bài chấm nào trong lịch sử.
              <div style={{ marginTop: T.space[2], fontSize: T.fontSize.xs, color: T.textFaint }}>
                Mỗi lần chấm thành công sẽ tự lưu vào đây (tối đa 50 bài gần nhất).
              </div>
            </div>
          ) : totalVisible === 0 ? (
            <div
              style={{
                padding: `${T.space[8]}px ${T.space[5]}px`,
                textAlign: "center",
                color: T.textMute,
                fontSize: T.fontSize.sm,
              }}
            >
              Không có bài nào khớp với “{query.trim()}”.
            </div>
          ) : (
            BUCKET_ORDER.map((bucket) => {
              const rows = groups[bucket];
              if (rows.length === 0) return null;
              return (
                <section key={bucket}>
                  <div
                    style={{
                      padding: `${T.space[2]}px ${T.space[4]}px`,
                      background: T.bg,
                      color: T.textMute,
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: 0.5,
                      textTransform: "uppercase",
                      borderBottom: `1px solid ${T.borderLight}`,
                      position: "sticky",
                      top: 0,
                      zIndex: 1,
                    }}
                  >
                    {BUCKET_LABEL[bucket]} ({rows.length})
                  </div>
                  {rows.map((entry) => (
                    <HistoryRow
                      key={entry.id}
                      entry={entry}
                      onLoad={(step) => handleLoad(entry.id, step)}
                    />
                  ))}
                </section>
              );
            })
          )}
        </div>

        {/* Footer caption — hint about cache scope */}
        {entries.length > 0 && (
          <div
            style={{
              padding: `${T.space[2]}px ${T.space[4]}px`,
              borderTop: `1px solid ${T.borderLight}`,
              fontSize: 11,
              color: T.textFaint,
              textAlign: "center",
            }}
          >
            Lưu cục bộ trong trình duyệt · Không gọi API
          </div>
        )}
      </div>
    </>
  );
}

// Row layout:
//   Title (clickable, body sans) ─────────────────► (opens step 5 — phiếu chấm)
//   Subject pill · 1 giờ trước
//   [Xem xét]  [Chấm lại]                     ◄── secondary affordances
//
// The whole row is the primary "open" action — defaults to step 5 (Xong /
// phiếu chấm) because "Bài đã chấm" implies the teacher wants to SEE the
// completed grade, not re-evaluate it. Two small secondary buttons let
// the teacher jump back to step 3 (Xem xét, re-review) or step 4 (Chấm
// lại, regrade) when that IS the intent. Earlier design defaulted to
// step 3 and surprised teachers who clicked a row expecting the final
// grade sheet (real user report 2026-05-19).

function HistoryRow({
  entry,
  onLoad,
}: {
  entry: CachedGrade;
  onLoad: (step: 3 | 4 | 5) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const { body, classLabel } = parseTaskContext(entry.task);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onLoad(5)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onLoad(5);
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Xem bài chấm này (mở thẳng phiếu chấm)"
      style={{
        background: hovered ? T.bgHover : "transparent",
        borderBottom: `1px solid ${T.borderLight}`,
        padding: `${T.space[3]}px ${T.space[4]}px`,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        cursor: "pointer",
        outline: "none",
        transition: "background 0.12s",
      }}
    >
      <div
        style={{
          // Use the body sans-serif (T.font) — the inherited display
          // serif made user-entered titles like "ĐỀ HÌNH" read as a
          // section header instead of a list item.
          fontFamily: T.font,
          fontSize: 15,
          color: T.text,
          fontWeight: 600,
          letterSpacing: 0,
          textTransform: "none",
          lineHeight: 1.3,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {body}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: T.space[2],
          fontSize: T.fontSize.xs,
          color: T.textMute,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            padding: "1px 8px",
            background: T.accentSoft,
            color: T.accent,
            borderRadius: 999,
            fontWeight: 600,
            fontSize: 11,
          }}
        >
          {subjectLabel(entry.subject)}
        </span>
        {classLabel && (
          <>
            <span>·</span>
            <span>{classLabel}</span>
          </>
        )}
        <span>·</span>
        <span>{relativeTime(entry.ts)}</span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          marginTop: 6,
        }}
      >
        {/* Secondary jumps. ``stopPropagation`` prevents the parent row
            click handler from firing — without it, clicking these would
            also open step 5 (the row default) in succession. */}
        <SecondaryJump
          label="Xem xét"
          hint="Mở ở bước Xem xét (đọc lại nhận xét của AI)"
          onClick={(e) => {
            e.stopPropagation();
            onLoad(3);
          }}
        />
        <span style={{ color: T.textFaint, fontSize: 11 }}>·</span>
        <SecondaryJump
          label="Chấm lại"
          hint="Mở thẳng ở bước Chấm lại (bỏ qua Xem xét)"
          onClick={(e) => {
            e.stopPropagation();
            onLoad(4);
          }}
        />
      </div>
    </div>
  );
}

function SecondaryJump({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={hint}
      aria-label={hint}
      style={{
        background: "transparent",
        border: "none",
        padding: "2px 4px",
        color: hover ? T.accent : T.textSoft,
        fontSize: 12,
        fontFamily: T.font,
        fontWeight: 500,
        cursor: "pointer",
        textDecoration: hover ? "underline" : "none",
        textUnderlineOffset: 3,
        transition: "color 0.12s",
      }}
    >
      {label}
    </button>
  );
}
