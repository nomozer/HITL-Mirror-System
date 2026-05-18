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

  // Typography — font families
  font: `"Newsreader", Georgia, "Times New Roman", serif`,
  display: `"Fraunces", Georgia, "Times New Roman", serif`,
  mono: `"JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace`,

  // Type scale — Tailwind-aligned, used for sizes that recur across the UI.
  // Keep declarations to one of these values so the hierarchy stays consistent.
  fontSize: {
    xs: 12,    // captions, eyebrow tags, small meta
    sm: 14,    // secondary body, nav links, button text
    base: 16,  // primary body, form labels
    lg: 18,    // section heading inside a card
    xl: 20,    // sub-section title
    "2xl": 24, // card title / panel hero
    "3xl": 30, // page title
    "4xl": 36, // app hero
  },

  // Spacing — 4-point grid (multiples of 4). Pick from this list, never
  // a free-form number. Mirrors Tailwind's spacing scale.
  space: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    7: 28,
    8: 32,
    10: 40,
    12: 48,
    16: 64,
  },

  // Container widths — standard breakpoints for centred content blocks.
  width: {
    form: 720,    // single-column form (Stripe Checkout, Vercel auth)
    article: 760, // prose / read-only content
    content: 960, // dashboard / dual-column
    app: 1280,    // outer app cap
  },

  shadowSoft: "0 1px 3px rgba(44, 46, 58, 0.04), 0 8px 24px -12px rgba(44, 46, 58, 0.08)",
  shadowStrong: "0 2px 6px rgba(44, 46, 58, 0.06), 0 20px 40px -16px rgba(44, 46, 58, 0.12)",
} as const;

export type Theme = typeof T;
