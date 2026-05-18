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

// Strip the "Môn X · Lớp Y · " prefix that buildTaskContext prepends so the
// row label focuses on the essay's actual name (subject is shown separately
// as a pill below). Falls back to the raw task if no prefix is found.
function shortTaskLabel(task: string): string {
  const m = task.match(/^Môn\s+\S+\s*·\s*Lớp\s+\d+\s*·\s*(.+)$/i);
  return (m ? m[1] : task).trim() || "(không tên)";
}

export function GradeHistoryDropdown({ open, onClose, anchorRect }: GradeHistoryDropdownProps) {
  // Re-read on each open so a freshly-saved grade appears without remounting.
  // Closed dropdowns don't pay the cost.
  const [entries, setEntries] = useState<CachedGrade[]>([]);
  useEffect(() => {
    if (open) setEntries(getCachedGrades());
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

        {/* Body — scrollable list */}
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
                Mỗi lần chấm thành công sẽ tự lưu vào đây (tối đa 15 bài gần nhất).
              </div>
            </div>
          ) : (
            entries.map((entry) => (
              <HistoryRow
                key={entry.id}
                entry={entry}
                onLoad={(step) => handleLoad(entry.id, step)}
              />
            ))
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
//   Title (clickable, body sans) ─────────────────► (opens step 3)
//   Subject pill · 1 giờ trước
//   [Chấm lại]  [Phiếu chấm]                  ◄── secondary affordances
//
// The whole row is the primary "open" action — defaults to step 3 (Xem
// xét) because that's where a re-pass typically starts. Two small
// secondary buttons let the teacher jump straight to step 4 or step 5
// without forcing them through review. Earlier design had three
// equal-weight pill buttons + a "Mở ở:" eyebrow which created decision
// fatigue and let the actions out-shout the title.

function HistoryRow({
  entry,
  onLoad,
}: {
  entry: CachedGrade;
  onLoad: (step: 3 | 4 | 5) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onLoad(3)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onLoad(3);
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Mở bài chấm này (bắt đầu ở bước Xem xét)"
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
        {shortTaskLabel(entry.task)}
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
            click handler from firing — without it, clicking "Phiếu
            chấm" would open step 3 AND step 5 in succession. */}
        <SecondaryJump
          label="Chấm lại"
          hint="Mở thẳng ở bước Chấm lại (bỏ qua Xem xét)"
          onClick={(e) => {
            e.stopPropagation();
            onLoad(4);
          }}
        />
        <span style={{ color: T.textFaint, fontSize: 11 }}>·</span>
        <SecondaryJump
          label="Phiếu chấm"
          hint="Mở thẳng ở bước Kết quả / in phiếu chấm"
          onClick={(e) => {
            e.stopPropagation();
            onLoad(5);
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
