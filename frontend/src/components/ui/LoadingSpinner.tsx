import { T } from "../../theme/tokens";

interface LoadingSpinnerProps {
  title: string;
  description: string;
}

export function LoadingSpinner({ title, description }: LoadingSpinnerProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "50vh",
        gap: 20,
        animation: "fadeUp 0.5s ease-out",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          animation: "hourglassFlip 2.4s cubic-bezier(0.7, 0, 0.3, 1) infinite",
          transformOrigin: "center center",
        }}
      >
        <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
          <path
            d="M10 4 H34 M10 40 H34 M12 4 V12 Q12 18 22 22 Q32 26 32 32 V40 M32 4 V12 Q32 18 22 22 Q12 26 12 32 V40"
            stroke={T.accent}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M14 6 L30 6 Q30 13 22 18 Q14 13 14 6 Z"
            fill={T.accent}
            style={{
              transformOrigin: "22px 6px",
              animation: "sandTop 2.4s cubic-bezier(0.7, 0, 0.3, 1) infinite",
            }}
          />
          <path
            d="M14 38 L30 38 Q30 31 22 26 Q14 31 14 38 Z"
            fill={T.accent}
            style={{
              transformOrigin: "22px 38px",
              animation:
                "sandBottom 2.4s cubic-bezier(0.7, 0, 0.3, 1) infinite",
            }}
          />
        </svg>
      </div>
      <div
        style={{
          fontFamily: T.display,
          fontSize: 32,
          fontStyle: "italic",
          fontWeight: 400,
          color: T.text,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 17,
          color: T.textMute,
          maxWidth: 420,
          lineHeight: 1.6,
        }}
      >
        {description}
      </div>
    </div>
  );
}
