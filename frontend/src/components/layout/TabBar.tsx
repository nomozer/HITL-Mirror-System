import { T } from "../../theme/tokens";
import { ProgressBar } from "../ui/ProgressBar";
import type { I18nStrings, Tab } from "../../types";

interface TabBarProps {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClose: (id: string) => void;
  onClear: () => void;
  completedCount: number;
  t: I18nStrings;
}

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onAdd,
  onClose,
  onClear,
  completedCount,
  t,
}: TabBarProps) {
  return (
    <div
      style={{
        padding: `${T.space[3]}px clamp(16px, 4vw, 32px) 0`,
        borderBottom: `1px solid ${T.border}`,
        background: T.bgCard,
      }}
    >
      <ProgressBar
        completed={completedCount}
        total={tabs.length}
        label={String(t.progress ?? "")}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          overflowX: "auto",
        }}
      >
        {tabs.map((tab, i) => {
          const isActive = tab.id === activeId;
          const statusColor =
            tab.phase === "generating" ? T.amber : tab.hasGrade ? T.gold : T.textFaint;
          return (
            <button
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: T.space[2],
                padding: `${T.space[3]}px ${T.space[4]}px`,
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${isActive ? T.accent : "transparent"}`,
                color: isActive ? T.text : T.textMute,
                fontSize: T.fontSize.sm,
                // Listing exactly what changes on (de)activation — "all"
                // would also animate any future layout property that gets
                // added, causing per-frame reflows we don't want.
                transition: "color 0.2s, border-bottom-color 0.2s",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: statusColor,
                  animation: tab.phase === "generating" ? "pulse 1.4s infinite" : undefined,
                }}
              />
              <span>{tab.label || `${String(t.essayN ?? "Essay")} ${i + 1}`}</span>
              {tabs.length > 1 && (
                // Close affordance — kept as a <span role="button"> because
                // nesting a real <button> inside the tab <button> is invalid
                // HTML. ARIA role + tabIndex + keydown make it keyboard-
                // reachable; stopPropagation prevents the outer tab from
                // selecting itself when the user closes via Enter/Space.
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Đóng ${tab.label || `${String(t.essayN ?? "Essay")} ${i + 1}`}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      onClose(tab.id);
                    }
                  }}
                  style={{
                    fontSize: T.fontSize.sm,
                    color: T.textFaint,
                    padding: "0 2px",
                    cursor: "pointer",
                  }}
                >
                  ×
                </span>
              )}
            </button>
          );
        })}

        <button
          onClick={onAdd}
          style={{
            padding: `${T.space[3]}px ${T.space[4]}px`,
            background: "transparent",
            border: "none",
            color: T.textFaint,
            fontSize: T.fontSize.sm,
            transition: "color 0.2s",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = T.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = T.textFaint)}
        >
          + {String(t.newEssay ?? "New")}
        </button>

        <div style={{ flex: 1 }} />

        <button
          onClick={onClear}
          style={{
            background: "transparent",
            border: "none",
            color: T.textFaint,
            fontSize: T.fontSize.xs,
            padding: `${T.space[3]}px ${T.space[1]}px`,
            transition: "color 0.2s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = T.accent)}
          onMouseLeave={(e) => (e.currentTarget.style.color = T.textFaint)}
        >
          {String(t.reset ?? "Reset")}
        </button>
      </div>
    </div>
  );
}
