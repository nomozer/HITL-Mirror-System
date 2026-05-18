import { useRef } from "react";
import { T } from "../../theme/tokens";
import { Icon } from "../ui/Icon";

interface AppHeaderProps {
  /** Mobile-only — opens the Sidebar drawer when defined. */
  onOpenDrawer?: () => void;
  onOpenMemory: () => void;
  onOpenHelp: () => void;
  memoryActive: boolean;
  /** Toggle the "Bài đã chấm" history dropdown. Called with the trigger
   *  button's bounding rect so the dropdown can anchor under it. */
  onToggleHistory: (anchorRect: DOMRect | null) => void;
  historyActive: boolean;
}

/**
 * Top app bar — global navigation. Visible on both desktop and mobile.
 *
 * Layout:
 *   [hamburger? | brand]    Bộ nhớ HITL | Hướng dẫn
 *
 * Nav items are rendered as plain text links (no border, no icon) with
 * a thin vertical separator between them — the same restrained style as
 * a top-of-page document menu.
 */
export function AppHeader({
  onOpenDrawer,
  onOpenMemory,
  onOpenHelp,
  memoryActive,
  onToggleHistory,
  historyActive,
}: AppHeaderProps) {
  // Anchor ref so the History dropdown can position itself under the
  // trigger button regardless of header padding / responsive padding.
  const historyBtnRef = useRef<HTMLButtonElement | null>(null);
  return (
    <header
      style={{
        padding: "10px clamp(12px, 4vw, 32px)",
        borderBottom: `1px solid ${T.border}`,
        background: T.bg,
        position: "sticky",
        top: 0,
        zIndex: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {onOpenDrawer && (
          <button
            type="button"
            onClick={onOpenDrawer}
            aria-label="Mở thanh điều khiển"
            title="Mở thanh điều khiển"
            style={{
              background: "transparent",
              border: "none",
              color: T.textSoft,
              padding: 6,
              borderRadius: 6,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "color 0.15s, background 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = T.accent;
              e.currentTarget.style.background = T.accentSoft;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = T.textSoft;
              e.currentTarget.style.background = "transparent";
            }}
          >
            <Icon.Menu size={20} />
          </button>
        )}
      </div>

      <nav
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          flexShrink: 0,
        }}
      >
        <HeaderLink
          label="Bài đã chấm"
          title="Xem lại các bài đã chấm (lưu trong trình duyệt, không gọi API)"
          onClick={() => {
            const rect = historyBtnRef.current?.getBoundingClientRect() ?? null;
            onToggleHistory(rect);
          }}
          active={historyActive}
          buttonRef={historyBtnRef}
        />
        <Separator />
        <HeaderLink
          label="Bộ nhớ HITL"
          title={memoryActive ? "Quay lại bàn chấm" : "Bộ nhớ HITL"}
          onClick={onOpenMemory}
          active={memoryActive}
        />
        <Separator />
        <HeaderLink label="Hướng dẫn" onClick={onOpenHelp} />
      </nav>
    </header>
  );
}

function Separator() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 1,
        height: T.space[4],
        background: T.border,
        margin: `0 ${T.space[5]}px`,
      }}
    />
  );
}

function HeaderLink({
  label,
  title,
  onClick,
  active = false,
  buttonRef,
}: {
  label: string;
  /** Optional tooltip/aria override — defaults to ``label`` when omitted. */
  title?: string;
  onClick: () => void;
  active?: boolean;
  /** Optional ref so parent can read the trigger's bounding rect for
   *  anchoring popovers (e.g. the history dropdown). */
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const hover = title ?? label;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={hover}
      title={hover}
      style={{
        background: "transparent",
        border: "none",
        // Reserve 2px below the text for the underline cue so hover does
        // not cause a layout shift. Transparent by default, accent when
        // hovered or active.
        borderBottom: `2px solid ${active ? T.accent : "transparent"}`,
        padding: `${T.space[2]}px ${T.space[1]}px ${T.space[1]}px`,
        color: active ? T.text : T.textSoft,
        fontSize: T.fontSize.sm,
        fontFamily: T.font,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        transition: "color 0.15s, border-color 0.15s",
        whiteSpace: "nowrap",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.color = T.text;
          e.currentTarget.style.borderBottomColor = T.accent;
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.color = T.textSoft;
          e.currentTarget.style.borderBottomColor = "transparent";
        }
      }}
    >
      {label}
    </button>
  );
}
