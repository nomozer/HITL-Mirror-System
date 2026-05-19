import { useEffect, useRef, useState } from "react";
import { T } from "../../theme/tokens";
import { Icon } from "./Icon";
import { SUBJECT_OPTIONS, subjectLabelOf } from "../../lib/subject";
import type { BackendSubject } from "../../types";
import type { DetectConfidence } from "../../api";

// ---------------------------------------------------------------------------
// SubjectChip — replaces the old left-Sidebar subject picker.
//
// Lives next to the task PDF in StepUpload. After the teacher drops a PDF,
// the parent fires `detectSubject` against it and feeds the verdict in via
// `detected` + `confidence`. The chip auto-applies "high" picks silently
// and asks for explicit confirmation on "low"/"none" — the same rule the
// backend uses to grade reliability of its own keyword scoring.
//
// Visual states:
//   loading   → spinning dot,   "Đang phát hiện môn…"
//   high      → green check,    "Sinh học · Đổi ▾"
//   low       → amber ?,         "Có vẻ là Sinh học · Xác nhận ▾"
//   none      → amber !,         "Không phát hiện được môn · Chọn ▾"
//   manual    → indigo dot,      "Sinh học · Đổi ▾"        (user override)
//   idle      → grey dot,        "Tải đề bài để phát hiện môn"
// ---------------------------------------------------------------------------

interface SubjectChipProps {
  /** Currently-applied subject (what the next /api/generate call will use as
   *  hint). Null = no subject confirmed yet. */
  subject: BackendSubject | null;
  /** Most recent detection verdict — may differ from `subject` when the
   *  teacher overrode it manually. Used to render the "Phát hiện: X" hint. */
  detected: BackendSubject | null;
  confidence: DetectConfidence | null;
  /** True while `/api/detect-subject` is in flight. */
  loading: boolean;
  /** True before any task PDF is uploaded — chip stays in "idle" state and
   *  click is a no-op nudge to upload first. */
  idle: boolean;
  /** Whether the user has explicitly confirmed/changed the subject. Used to
   *  surface the "Đã xác nhận" badge after a low-confidence pick is OK'd. */
  manualOverride: boolean;
  onChange: (code: BackendSubject) => void;
}

export function SubjectChip({
  subject,
  detected,
  confidence,
  loading,
  idle,
  manualOverride,
  onChange,
}: SubjectChipProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close the dropdown on outside click + ESC. Standard popover hygiene.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const needsConfirm =
    !manualOverride && (confidence === "low" || confidence === "none");

  // Pick color + label per state. Branch order matters: idle/loading
  // short-circuit before subject-driven branches so the chip never claims
  // a verdict it does not yet have. The `: string` annotations stop TS
  // from narrowing each `let` to the first literal value pulled from T
  // (the tokens object is `as const`-style narrow).
  let color: string = T.textMute;
  let bg: string = T.bgMuted;
  let border: string = T.border;
  let leadingIcon: React.ReactNode = (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: 999,
        background: T.textFaint,
        display: "inline-block",
      }}
    />
  );
  let primaryLabel = "Tải đề bài để phát hiện môn";
  let secondaryLabel: string | null = null;
  let disabled = true;

  if (loading) {
    color = T.accent;
    bg = T.accentSoft;
    border = T.accentSoft;
    leadingIcon = (
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          border: `2px solid ${T.accent}`,
          borderTopColor: "transparent",
          animation: "spin 0.8s linear infinite",
          display: "inline-block",
        }}
      />
    );
    primaryLabel = "Đang phát hiện môn…";
    disabled = true;
  } else if (idle) {
    // keep defaults
  } else if (subject && !needsConfirm) {
    // Auto-applied (high confidence) OR manual override — confident state.
    const usedDetection =
      !manualOverride && confidence === "high" && detected === subject;
    color = T.green;
    bg = T.greenSoft;
    border = T.greenSoft;
    leadingIcon = <Icon.Check size={12} color={T.green} />;
    primaryLabel = subjectLabelOf(subject);
    secondaryLabel = usedDetection
      ? "Tự phát hiện"
      : manualOverride
        ? "Đã xác nhận"
        : null;
    disabled = false;
  } else {
    // needsConfirm: low/none verdict, teacher needs to click.
    color = T.amber;
    bg = T.amberSoft;
    border = T.amber;
    leadingIcon = <Icon.AlertTriangle size={12} color={T.amber} />;
    if (confidence === "none") {
      primaryLabel = "Chưa nhận diện được môn";
      secondaryLabel = "Chọn thủ công";
    } else {
      primaryLabel = subjectLabelOf(detected);
      secondaryLabel = "Xác nhận hoặc đổi";
    }
    disabled = false;
  }

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", display: "inline-block" }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={
          idle
            ? "Tải file đề trước để hệ thống phát hiện môn"
            : "Đổi môn"
        }
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: `6px 12px`,
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: 999,
          color,
          fontFamily: T.font,
          fontSize: T.fontSize.sm,
          cursor: disabled ? "default" : "pointer",
          transition: "background 0.15s, border-color 0.15s",
        }}
      >
        {leadingIcon}
        <span style={{ fontWeight: 600 }}>{primaryLabel}</span>
        {secondaryLabel && (
          <span
            style={{
              color,
              opacity: 0.75,
              fontWeight: 400,
              fontStyle: "italic",
            }}
          >
            · {secondaryLabel}
          </span>
        )}
        {!disabled && (
          <span style={{ display: "inline-flex", marginLeft: 2, color }}>
            <Icon.ArrowDown size={10} />
          </span>
        )}
      </button>

      {open && !disabled && (
        <ul
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            marginTop: 6,
            minWidth: 180,
            padding: 4,
            background: T.bgCard,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            boxShadow: T.shadowSoft,
            listStyle: "none",
            zIndex: 50,
          }}
        >
          {SUBJECT_OPTIONS.map((opt) => {
            const isActive = subject === opt.code;
            const isDetected = detected === opt.code;
            return (
              <li key={opt.code}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    onChange(opt.code);
                    setOpen(false);
                  }}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: `8px 12px`,
                    background: isActive ? T.accentSoft : "transparent",
                    color: isActive ? T.accentDark : T.text,
                    border: "none",
                    borderRadius: 6,
                    fontFamily: T.font,
                    fontSize: T.fontSize.sm,
                    fontWeight: isActive ? 600 : 400,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.background = T.bgHover;
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span>{opt.label}</span>
                  {isDetected && !isActive && (
                    <span
                      style={{
                        fontSize: T.fontSize.xs,
                        color: T.textMute,
                        fontStyle: "italic",
                      }}
                    >
                      AI gợi ý
                    </span>
                  )}
                  {isActive && <Icon.Check size={12} color={T.accent} />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
