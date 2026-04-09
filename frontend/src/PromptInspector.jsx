/**
 * PromptInspector.jsx — Transparent view of an assembled PromptBundle.
 * Purpose: Render the system / memory / dynamic components of a prompt
 *          returned by POST /api/prompt/preview or /api/generate?debug=true.
 *          Research-oriented: exposes hash, intent, lesson scores for A/B
 *          prompt-strategy comparison.
 */

import React, { useState } from "react";

/* inherit the theme tokens from HITLEditor to stay consistent */
const T = {
  bg:        "#0D0D0D",
  surface:   "#141414",
  surface2:  "#1A1A1A",
  border:    "#2A2A2A",
  cyan:      "#00E5FF",
  amber:     "#FFB300",
  green:     "#39FF14",
  red:       "#FF3D3D",
  textPri:   "#E0E0E0",
  textSec:   "#808080",
  mono:      "'JetBrains Mono', monospace",
  ui:        "'Space Mono', monospace",
};

function Section({ title, body, color = T.cyan, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 8, borderTop: `1px solid ${T.border}` }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", padding: "6px 0", background: "transparent",
          border: "none", color, fontFamily: T.ui, fontSize: 10, fontWeight: 700,
          cursor: "pointer", textAlign: "left", letterSpacing: 1,
          display: "flex", justifyContent: "space-between",
        }}
      >
        <span>{title}</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <pre style={{
          margin: 0, padding: "6px 8px",
          background: T.bg, border: `1px solid ${T.border}`, borderRadius: 3,
          fontFamily: T.mono, fontSize: 11, color: T.textPri,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
          maxHeight: 240, overflowY: "auto",
        }}>
          {body || "(empty)"}
        </pre>
      )}
    </div>
  );
}

function LessonsTable({ lessons, t }) {
  if (!lessons || lessons.length === 0) return null;
  return (
    <table style={{
      width: "100%", borderCollapse: "collapse", fontSize: 10,
      fontFamily: T.mono, marginTop: 4,
    }}>
      <thead>
        <tr style={{ color: T.textSec, textAlign: "left" }}>
          <th style={{ padding: "3px 4px", borderBottom: `1px solid ${T.border}` }}>#</th>
          <th style={{ padding: "3px 4px", borderBottom: `1px solid ${T.border}` }}>{t.colScore || "Score"}</th>
          <th style={{ padding: "3px 4px", borderBottom: `1px solid ${T.border}` }}>{t.colLesson || "Lesson"}</th>
        </tr>
      </thead>
      <tbody>
        {lessons.map((l) => (
          <tr key={l.id}>
            <td style={{ padding: "3px 4px", color: T.cyan }}>#{l.id}</td>
            <td style={{ padding: "3px 4px", color: T.amber }}>
              {Number(l.feedback_score ?? 0).toFixed(1)}
            </td>
            <td style={{
              padding: "3px 4px", color: T.textPri,
              maxWidth: 320, overflow: "hidden",
              textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {l.lesson_text}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * @param {object} props
 * @param {object|null} props.bundle  - PromptBundle (role, intent, system, memory, dynamic, user_content, full, lessons_used, meta)
 * @param {boolean=} props.loading
 * @param {string|null=} props.error
 * @param {string=} props.title        - Header label (e.g. "CODER PROMPT")
 * @param {object} props.t             - i18n object (from HITLEditor)
 * @param {boolean=} props.defaultOpen - Expanded by default
 */
export default function PromptInspector({
  bundle,
  loading = false,
  error = null,
  title = "PROMPT INSPECTOR",
  t = {},
  defaultOpen = false,
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!bundle && !loading && !error) return null;

  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 4, fontFamily: T.mono, fontSize: 11, color: T.textPri,
      padding: "6px 10px", marginTop: 8,
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", padding: "4px 0", background: "transparent",
          border: "none", color: T.cyan, fontFamily: T.ui, fontSize: 11,
          fontWeight: 700, cursor: "pointer", textAlign: "left",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          letterSpacing: 1,
        }}
      >
        <span>
          {title}
          {loading && <span style={{ color: T.textSec, marginLeft: 8 }}>… {t.loadingPreview || "building"}</span>}
        </span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {error && (
        <div style={{ color: T.red, fontSize: 10, padding: "4px 0" }}>
          ⚠ {error}
        </div>
      )}

      {open && bundle && (
        <div style={{ animation: "fadeIn .2s" }}>
          {/* Meta row */}
          <div style={{
            display: "flex", gap: 10, fontSize: 10, color: T.textSec,
            padding: "4px 0", flexWrap: "wrap",
          }}>
            <span>
              {t.role || "role"}:{" "}
              <span style={{ color: T.cyan }}>{bundle.role}</span>
            </span>
            <span>
              {t.intent || "intent"}:{" "}
              <span style={{ color: T.amber }}>{bundle.intent}</span>
            </span>
            <span>
              lang: <span style={{ color: T.textPri }}>{bundle.lang}</span>
            </span>
            {bundle.meta?.prompt_hash && (
              <span>
                hash:{" "}
                <span style={{ color: T.green }}>
                  {bundle.meta.prompt_hash}
                </span>
              </span>
            )}
            {bundle.meta?.strategy && (
              <span>
                strategy:{" "}
                <span style={{ color: T.textPri }}>{bundle.meta.strategy}</span>
              </span>
            )}
            <span>
              {t.lessonsInjected || "lessons"}:{" "}
              <span style={{ color: T.amber }}>
                {bundle.lessons_used?.length ?? 0}
              </span>
            </span>
          </div>

          <LessonsTable lessons={bundle.lessons_used} t={t} />

          <Section
            title={`◆ ${t.secSystem || "SYSTEM"}`}
            body={bundle.system}
            color={T.cyan}
          />
          <Section
            title={`◆ ${t.secMemory || "MEMORY / LESSONS"}`}
            body={bundle.memory}
            color={T.amber}
            defaultOpen
          />
          <Section
            title={`◆ ${t.secDynamic || "DYNAMIC (task / code / feedback)"}`}
            body={bundle.dynamic}
            color={T.green}
          />
          <Section
            title={`◆ ${t.secFull || "FULL PROMPT"}`}
            body={bundle.full}
            color={T.textSec}
          />
        </div>
      )}
    </div>
  );
}
