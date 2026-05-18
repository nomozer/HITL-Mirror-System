import type { CSSProperties } from "react";
import { T } from "../../theme/tokens";
import { Icon } from "../ui/Icon";
import type { I18nStrings } from "../../types";

interface SidebarProps {
  t: I18nStrings;
  selectedSubject: string;
  onSubjectChange: (value: string) => void;
  selectedClass: string;
  onClassChange: (value: string) => void;
  /** When true, render as a fixed-position slide-in drawer with a backdrop
   *  overlay. Used on mobile (≤900 px) — App.tsx mounts/unmounts this branch
   *  based on a hamburger toggle. */
  drawer?: boolean;
  /** Required when ``drawer`` — fires on backdrop click, ESC, or close button. */
  onClose?: () => void;
}

/**
 * Sidebar — subject + class selectors.
 *
 * Two render modes:
 *   - default: sticky 260 px left rail (desktop)
 *   - drawer:  fixed slide-in panel + backdrop (mobile)
 *
 * The drawer variant matches the reference design — vertical sections with
 * uppercase labels, slide-in from the left, click-outside-to-close.
 */
export function Sidebar({
  t,
  selectedSubject,
  onSubjectChange,
  selectedClass,
  onClassChange,
  drawer = false,
  onClose,
}: SidebarProps) {
  const asideStyle: CSSProperties = drawer
    ? {
        position: "fixed",
        top: 0,
        left: 0,
        bottom: 0,
        width: "min(86vw, 320px)",
        background: T.bgCard,
        borderRight: `1px solid ${T.border}`,
        padding: `${T.space[6]}px ${T.space[5]}px`,
        display: "flex",
        flexDirection: "column",
        gap: T.space[6],
        boxShadow: T.shadowStrong,
        zIndex: 200,
        animation: "drawerSlideIn 0.24s ease-out",
        overflowY: "auto",
      }
    : {
        background: T.bgCard,
        borderRight: `1px solid ${T.border}`,
        padding: `${T.space[7]}px ${T.space[5]}px`,
        display: "flex",
        flexDirection: "column",
        gap: T.space[7],
        height: "100vh",
        position: "sticky",
        top: 0,
      };

  const sectionLabelStyle: CSSProperties = {
    fontSize: T.fontSize.xs,
    color: T.textMute,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    marginBottom: T.space[3],
    fontWeight: 600,
  };

  const content = (
    <aside style={asideStyle}>
      {/* Header — logo + title, inspired by reference UI */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: T.display,
                // Brand hero — used to be 3xl/800 on desktop and 2xl/800 on
                // drawer. The jump from 30 px hero → 14 px tagline → 12 px
                // section label was too harsh (16 px + 12 px gaps inside
                // 3 stacked lines, plus weight 800 made it visually ~2×
                // heavier than anything else). Smoothed to 2xl/xl + weight
                // 700 so the descending hierarchy is closer to a 1.4× step.
                fontSize: drawer ? T.fontSize.xl : T.fontSize["2xl"],
                fontWeight: 700,
                color: T.accentDark,
                letterSpacing: 0,
                lineHeight: 1,
              }}
            >
              {String(t.title)}
            </div>
            <div
              style={{
                // Tagline at `base` (16 px) instead of `sm` (14 px): the gap
                // from the 24 px brand becomes 8 px instead of 16 px, and
                // tagline → section label ("MÔN HỌC" at xs/12) is now a
                // sensible 4 px step.
                fontSize: T.fontSize.base,
                color: T.textMute,
                marginTop: T.space[2],
                lineHeight: 1.35,
                letterSpacing: 0,
              }}
            >
              Bài chấm tự động
            </div>
          </div>
        </div>
        {drawer && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            title="Đóng"
            style={{
              background: "transparent",
              border: "none",
              color: T.textMute,
              padding: 4,
              marginTop: -2,
              marginRight: -4,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 6,
              transition: "color 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = T.text;
              e.currentTarget.style.background = T.bgHover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = T.textMute;
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Icon.X size={16} />
          </button>
        )}
      </div>

      {/* Subject + Class group — wrapped together so the gap between the
          two dropdowns (T.space[5] = 20 px) is tighter than the gap from
          the brand block above (T.space[7] = 28 px, set on the aside).
          Visually they read as one "selectors" group instead of three
          equally-spaced sections. */}
      <div style={{ display: "flex", flexDirection: "column", gap: T.space[5] }}>
      {/* Subject select */}
      <div>
        <div style={sectionLabelStyle}>Môn học</div>
        <div
          style={{
            position: "relative",
            // Pulse the dropdown border when no subject is selected so the
            // teacher's eye is drawn here from the waiting hero in the
            // main pane. Once a subject is picked this dies down.
            borderRadius: 6,
            animation: !selectedSubject ? "subjectPrompt 1.6s ease-in-out infinite" : "none",
          }}
        >
          <select
            value={selectedSubject}
            onChange={(e) => onSubjectChange(e.target.value)}
            style={{
              width: "100%",
              appearance: "none",
              padding: `${T.space[3]}px ${T.space[8]}px ${T.space[3]}px ${T.space[3]}px`,
              background: T.bg,
              color: selectedSubject ? T.text : T.textFaint,
              // Native <select> doesn't inherit page font reliably — the
              // closed trigger usually does, but the opened popup (rendered
              // by the OS / browser chrome) falls back to a system sans
              // unless we set font-family on the <select> *and* every
              // <option>. Setting both keeps the dropdown choices in the
              // same Newsreader serif as the rest of the app.
              fontFamily: T.font,
              fontSize: T.fontSize.base,
              border: `1px solid ${selectedSubject ? T.border : T.accent}`,
              borderRadius: 6,
              cursor: "pointer",
              outline: "none",
            }}
          >
            <option value="" disabled style={{ fontFamily: T.font }}>
              -- Chọn môn --
            </option>
            {["Môn Tin", "Môn Toán", "Môn Vật lý", "Môn Hoá học", "Môn Sinh học"].map((sub) => (
              <option key={sub} value={sub} style={{ fontFamily: T.font }}>
                {sub}
              </option>
            ))}
          </select>
          <div
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
              color: T.textFaint,
            }}
          >
            <Icon.ArrowDown size={12} />
          </div>
        </div>
      </div>

      {/* Class select */}
      <div>
        <div style={sectionLabelStyle}>Khối lớp</div>
        <div style={{ position: "relative", borderRadius: 6 }}>
          <select
            value={selectedClass}
            onChange={(e) => onClassChange(e.target.value)}
            style={{
              width: "100%",
              appearance: "none",
              padding: `${T.space[3]}px ${T.space[8]}px ${T.space[3]}px ${T.space[3]}px`,
              background: T.bg,
              color: T.text,
              fontFamily: T.font,
              fontSize: T.fontSize.base,
              border: `1px solid ${T.border}`,
              borderRadius: 6,
              cursor: "pointer",
              outline: "none",
            }}
          >
            {["Lớp 10", "Lớp 11", "Lớp 12"].map((cls) => (
              <option key={cls} value={cls} style={{ fontFamily: T.font }}>
                {cls}
              </option>
            ))}
          </select>
          <div
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              pointerEvents: "none",
              color: T.textFaint,
            }}
          >
            <Icon.ArrowDown size={12} />
          </div>
        </div>
      </div>
      </div>
    </aside>
  );

  if (!drawer) return content;

  // Drawer mode: pair the panel with a click-to-close backdrop. Both share a
  // sibling fragment so the panel slides in over the dimmed page.
  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(20, 22, 32, 0.42)",
          zIndex: 190,
          animation: "backdropFadeIn 0.2s ease-out",
        }}
      />
      {content}
    </>
  );
}
