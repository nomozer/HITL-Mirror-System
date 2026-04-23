import { T } from "../../theme/tokens";

interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div
      style={{
        padding: "32px 24px 28px",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 0,
        }}
      >
        {steps.map((step, i) => {
          const n = i + 1;
          const isActive = n === currentStep;
          const isDone = n < currentStep;
          const on = isActive || isDone;
          return (
            <div key={i} style={{ display: "flex", alignItems: "flex-start" }}>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 10,
                  width: 72,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: isActive ? T.accent : T.bgCard,
                    border: `1.5px solid ${on ? T.accent : T.border}`,
                    color: isActive
                      ? "#FFFFFF"
                      : isDone
                        ? T.accent
                        : T.textFaint,
                    fontFamily: T.mono,
                    fontSize: 13,
                    fontWeight: 600,
                    lineHeight: 1,
                    transition: "all 0.3s",
                  }}
                >
                  {n}
                </div>
                <span
                  style={{
                    fontSize: 12,
                    fontFamily: T.mono,
                    fontWeight: 600,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: isActive
                      ? T.text
                      : isDone
                        ? T.textSoft
                        : T.textFaint,
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    transition: "color 0.3s",
                  }}
                >
                  {step}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  style={{
                    width: 24,
                    height: 1,
                    background: n < currentStep ? T.accent : T.border,
                    marginTop: 14,
                    transition: "background 0.3s",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
