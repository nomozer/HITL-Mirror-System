import { T } from "./tokens";

export function GlobalStyles() {
  return (
    <style>{`
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        color: ${T.text};
        font-family: ${T.font};
        font-feature-settings: "onum", "liga", "kern";
        background: ${T.bg};
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      #root { min-height: 100vh; }

      ::selection { background: ${T.accent}; color: ${T.bgCard}; }

      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: ${T.borderLight}; border-radius: 0; }
      ::-webkit-scrollbar-thumb:hover { background: ${T.textFaint}; }

      button, textarea, input, select { font-family: inherit; color: inherit; }
      button { cursor: pointer; }
      a { color: ${T.accent}; text-underline-offset: 3px; }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }
      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(12px); }
        to { opacity: 1; transform: none; }
      }
      @keyframes dotBounce {
        0%, 80%, 100% { transform: scale(0.5); opacity: 0.3; }
        40% { transform: scale(1); opacity: 1; }
      }
      @keyframes hourglassFlip {
        0%, 40%   { transform: rotate(0deg); }
        50%, 90%  { transform: rotate(180deg); }
        100%      { transform: rotate(360deg); }
      }
      @keyframes sandTop {
        0%, 10%  { transform: scaleY(1); opacity: 1; }
        40%      { transform: scaleY(0.05); opacity: 0.4; }
        50%, 100% { transform: scaleY(0.05); opacity: 0.4; }
      }
      @keyframes sandBottom {
        0%, 10%  { transform: scaleY(0.05); opacity: 0.4; }
        40%      { transform: scaleY(1); opacity: 1; }
        50%, 100% { transform: scaleY(1); opacity: 1; }
      }
    `}</style>
  );
}
