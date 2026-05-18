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
        gap: T.space[4],
        padding: `${T.space[2]}px 0 ${T.space[3]}px`,
      }}
    >
      {label && (
        <span style={{ fontSize: T.fontSize.xs, color: T.textMute, minWidth: 64 }}>
          {label}
        </span>
      )}
      <div
        style={{
          flex: 1,
          height: 2,
          background: T.borderLight,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Animate via transform scaleX instead of width so the progress
            fill runs on the compositor thread — no layout/paint per frame.
            transformOrigin keeps the fill anchored to the left edge. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: T.accent,
            transformOrigin: "left center",
            transform: `scaleX(${pct / 100})`,
            transition: "transform 0.6s ease",
          }}
        />
      </div>
      <span
        style={{
          fontSize: T.fontSize.xs,
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
