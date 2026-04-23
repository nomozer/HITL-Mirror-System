/**
 * Theme tokens — warm academic · parchment + deep indigo.
 * Pure data, no React. Import anywhere styling is needed.
 */
export const T = {
  // Surfaces
  bg: "#F7F5F0",
  bgCard: "#FFFDF8",
  bgElevated: "#F0EDE6",
  bgHover: "#EBE7DF",
  bgInput: "#FFFDF8",
  bgPanel: "#FFFDF8",
  bgMuted: "#F0EDE6",
  nav: "#FFFDF8",
  paper: "#FFFDF8",
  paperBorder: "#E0DACF",
  paperLine: "#E0DACF",

  // Ink
  text: "#2C2E3A",
  textSoft: "#4A4C5C",
  textMute: "#7A7C8A",
  textFaint: "#A8A9B4",
  border: "#DDD9CE",
  borderLight: "#EDEAE3",

  // Accent
  accent: "#3B4F8A",
  accentLight: "#5A6FA0",
  accentDark: "#2A3B6B",
  accentSoft: "rgba(59, 79, 138, 0.08)",
  accentGlow: "rgba(59, 79, 138, 0.15)",

  // Semantic
  green: "#2E7D5B",
  greenSoft: "rgba(46, 125, 91, 0.10)",
  red: "#B8423A",
  redSoft: "rgba(184, 66, 58, 0.08)",
  amber: "#C08B30",
  amberSoft: "rgba(192, 139, 48, 0.10)",
  gold: "#2E7D5B",
  goldSoft: "rgba(46, 125, 91, 0.10)",

  // Typography
  font: `"Newsreader", Georgia, "Times New Roman", serif`,
  display: `"Fraunces", Georgia, "Times New Roman", serif`,
  mono: `"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace`,

  shadowSoft:
    "0 1px 3px rgba(44, 46, 58, 0.04), 0 8px 24px -12px rgba(44, 46, 58, 0.08)",
  shadowStrong:
    "0 2px 6px rgba(44, 46, 58, 0.06), 0 20px 40px -16px rgba(44, 46, 58, 0.12)",
} as const;

export type Theme = typeof T;
