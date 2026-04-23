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
        padding: "10px 32px 0",
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
            tab.phase === "generating"
              ? T.amber
              : tab.hasGrade
                ? T.gold
                : T.textFaint;
          return (
            <button
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${isActive ? T.accent : "transparent"}`,
                color: isActive ? T.text : T.textMute,
                fontSize: 15,
                transition: "all 0.2s",
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: statusColor,
                  animation:
                    tab.phase === "generating" ? "pulse 1.4s infinite" : undefined,
                }}
              />
              <span>{tab.label || `${String(t.essayN ?? "Essay")} ${i + 1}`}</span>
              {tabs.length > 1 && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(tab.id);
                  }}
                  style={{ fontSize: 14, color: T.textFaint, padding: "0 2px" }}
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
            padding: "10px 14px",
            background: "transparent",
            border: "none",
            color: T.textFaint,
            fontSize: 14,
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
            fontSize: 13,
            padding: "10px 4px",
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
