import { T } from "../../theme/tokens";
import { Icon } from "../ui/Icon";
import type { I18nStrings } from "../../types";

interface AppHeaderProps {
  selectedSubject: string;
  selectedClass: string;
  onToggleLang: () => void;
  t: I18nStrings;
}

export function AppHeader({
  selectedSubject,
  selectedClass,
  onToggleLang,
  t,
}: AppHeaderProps) {
  return (
    <header
      style={{
        padding: "18px 32px",
        borderBottom: `1px solid ${T.border}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: T.bg,
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}
    >
      <div
        style={{
          fontSize: 18,
          color: T.text,
          fontFamily: T.display,
          fontStyle: "italic",
        }}
      >
        {selectedSubject}
        <span style={{ color: T.textFaint, margin: "0 8px" }}>/</span>
        {selectedClass}
      </div>

      <button
        onClick={onToggleLang}
        style={{
          background: "transparent",
          border: `1px solid ${T.border}`,
          color: T.textSoft,
          padding: "6px 14px",
          fontSize: 14,
          transition: "all 0.2s",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = T.accent;
          e.currentTarget.style.color = T.accent;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = T.border;
          e.currentTarget.style.color = T.textSoft;
        }}
      >
        <Icon.Languages size={12} />
        {String(t.langSwitch)}
      </button>
    </header>
  );
}
