import { T } from "../../theme/tokens";

interface ProgressBarProps {
  completed: number;
  total: number;
  label?: string;
}

export function ProgressBar({ completed, total, label }: ProgressBarProps) {
  const pct = total > 0 ? (completed / total) * 100 : 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "8px 0 12px",
      }}
    >
      {label && (
        <span style={{ fontSize: 13, color: T.textMute, minWidth: 64 }}>
          {label}
        </span>
      )}
      <div
        style={{
          flex: 1,
          height: 2,
          background: T.borderLight,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            background: T.accent,
            transition: "width 0.6s ease",
          }}
        />
      </div>
      <span
        style={{
          fontSize: 13,
          color: T.textMute,
          fontFamily: T.mono,
          minWidth: 40,
          textAlign: "right",
        }}
      >
        {completed}/{total}
      </span>
    </div>
  );
}
