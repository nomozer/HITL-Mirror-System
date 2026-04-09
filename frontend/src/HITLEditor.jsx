/**
 * HITLEditor.jsx — Main React Component for HITL Mirror System
 * Purpose : 4-phase UI (Generate → Review → Execute → Teach) with
 *           "Neural Dark Lab" aesthetic and Research Dashboard.
 * Author  : [Your Name]
 * Research: HITL Agentic Code-Learning System — "Mirror" Edition
 *
 * BUG-6 FIX: Removed duplicate inline hooks — now imports from src/hooks/.
 *            The inline hooks used a hardcoded "http://localhost:8000" base URL
 *            which breaks on HTTPS or production. The hook files use "/api" relative
 *            path which works correctly when a proxy is configured in package.json.
 */

import React, { useCallback, useState, useEffect, useRef } from "react";
import { DiffEditor } from "@monaco-editor/react";
// BUG-6 FIX: Import shared hooks instead of re-declaring them inline
import { useAgentPipeline } from "./hooks/useAgentPipeline";
import { useCodeExecution } from "./hooks/useCodeExecution";
import { useTeachMemory } from "./hooks/useTeachMemory";
import { usePromptPreview } from "./hooks/usePromptPreview";
import PromptInspector from "./PromptInspector";

/* =========================================================================
   0. THEME TOKENS
   ========================================================================= */

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

/* =========================================================================
   0.5 INTERNATIONALIZATION (i18n)
   ========================================================================= */

const i18n = {
  en: {
    title: "MIRROR",
    subtitle: "HITL AGENTIC CODE-LEARNING SYSTEM",
    reset: "RESET",
    phases: ["GENERATE", "REVIEW", "EXECUTE", "TEACH"],
    taskLabel: "TASK DESCRIPTION",
    taskPlaceholder: "Describe the coding task for the AI agent…",
    generating: "GENERATING…",
    initPipeline: "INITIATE PIPELINE",
    criticTitle: "CRITIC REVIEW",
    suggestion: "SUGGESTION",
    running: "RUNNING…",
    runSandbox: "RUN SANDBOX",
    exitLabel: "EXIT",
    lessonLabel: "LESSON LEARNED",
    lessonPlaceholder: "What should the AI learn from this correction?",
    qualityScore: "QUALITY SCORE",
    scorePoor: "1 — Poor",
    scoreExcellent: "5 — Excellent",
    saving: "SAVING…",
    teachSync: "TEACH & SYNC",
    memoryUpdated: "MEMORY UPDATED — LESSON SYNCED",
    memoryContext: "MEMORY CONTEXT",
    lessonsInjected: "lesson(s) injected",
    aiGenerated: "AI GENERATED (readonly)",
    humanEditor: "HUMAN EDITOR",
    pipelineError: "Pipeline error",
    dashboard: "RESEARCH DASHBOARD",
    totalLessons: "Total Lessons",
    avgScore: "Avg Score",
    pipelineRuns: "Pipeline Runs",
    autoFixRate: "Auto-fix Rate",
    statsError: "Could not load stats",
    colId: "ID",
    colTask: "Task",
    colScore: "Score",
    colTime: "Time",
    colLesson: "Lesson",
    // Prompt Inspector
    livePromptPreview: "LIVE PROMPT PREVIEW",
    coderPromptTitle: "CODER PROMPT",
    criticPromptTitle: "CRITIC PROMPT",
    secSystem: "SYSTEM",
    secMemory: "MEMORY / LESSONS",
    secDynamic: "DYNAMIC (task / code / feedback)",
    secFull: "FULL PROMPT",
    loadingPreview: "building",
    role: "role",
    intent: "intent",
  },
  vi: {
    title: "MIRROR",
    subtitle: "HỆ THỐNG HỌC CODE CÓ CON NGƯỜI CAN THIỆP",
    reset: "ĐẶT LẠI",
    phases: ["TẠO CODE", "ĐÁNH GIÁ", "THỰC THI", "DẠY AI"],
    taskLabel: "MÔ TẢ NHIỆM VỤ",
    taskPlaceholder: "Mô tả nhiệm vụ lập trình cho AI…",
    generating: "ĐANG TẠO…",
    initPipeline: "BẮT ĐẦU PIPELINE",
    criticTitle: "ĐÁNH GIÁ CODE",
    suggestion: "GỢI Ý",
    running: "ĐANG CHẠY…",
    runSandbox: "CHẠY THỬ",
    exitLabel: "MÃ THOÁT",
    lessonLabel: "BÀI HỌC RÚT RA",
    lessonPlaceholder: "AI nên học được gì từ lần sửa này?",
    qualityScore: "ĐIỂM CHẤT LƯỢNG",
    scorePoor: "1 — Kém",
    scoreExcellent: "5 — Xuất sắc",
    saving: "ĐANG LƯU…",
    teachSync: "DẠY & ĐỒNG BỘ",
    memoryUpdated: "ĐÃ CẬP NHẬT TRÍ NHỚ — BÀI HỌC ĐÃ ĐỒNG BỘ",
    memoryContext: "NGỮ CẢNH TRÍ NHỚ",
    lessonsInjected: "bài học được sử dụng",
    aiGenerated: "AI TẠO (chỉ đọc)",
    humanEditor: "NGƯỜI CHỈNH SỬA",
    pipelineError: "Lỗi Pipeline",
    dashboard: "BẢNG ĐIỀU KHIỂN NGHIÊN CỨU",
    totalLessons: "Tổng Bài Học",
    avgScore: "Điểm TB",
    pipelineRuns: "Số Lần Chạy",
    autoFixRate: "Tỷ Lệ Tự Sửa",
    statsError: "Không thể tải thống kê",
    colId: "ID",
    colTask: "Nhiệm vụ",
    colScore: "Điểm",
    colTime: "Thời gian",
    colLesson: "Bài học",
    // Prompt Inspector
    livePromptPreview: "XEM TRƯỚC PROMPT (TRỰC TIẾP)",
    coderPromptTitle: "PROMPT CODER",
    criticPromptTitle: "PROMPT CRITIC",
    secSystem: "HỆ THỐNG",
    secMemory: "TRÍ NHỚ / BÀI HỌC",
    secDynamic: "ĐỘNG (nhiệm vụ / code / feedback)",
    secFull: "PROMPT ĐẦY ĐỦ",
    loadingPreview: "đang dựng",
    role: "vai trò",
    intent: "ý định",
  },
};

/* =========================================================================
   1. SUB-COMPONENTS
   ========================================================================= */

/* ---------- Scanline Loader ---------- */
function ScanlineLoader() {
  const lines = useRef(
    Array.from({ length: 12 }, (_, i) => {
      const prefixes = [
        "INIT", "LOAD", "PARSE", "COMPILE", "LINK",
        "EXEC", "VERIFY", "SYNC", "ALLOC", "ENCODE",
        "ROUTE", "EMIT",
      ];
      return `[${prefixes[i]}] ${"█".repeat(Math.floor(Math.random() * 24) + 8)}`;
    })
  );
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setIdx((p) => (p + 1) % lines.current.length), 220);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      fontFamily: T.mono, fontSize: 12, color: T.cyan, padding: 16,
      background: T.bg, border: `1px solid ${T.border}`, borderRadius: 4,
      overflow: "hidden", position: "relative",
    }}>
      {/* scanline overlay */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,229,255,0.03) 2px, rgba(0,229,255,0.03) 4px)`,
      }} />
      {lines.current.slice(0, idx + 1).map((l, i) => (
        <div key={i} style={{ opacity: i === idx ? 1 : 0.35 }}>
          <span style={{ color: T.textSec }}>{String(i + 1).padStart(2, "0")} </span>{l}
        </div>
      ))}
      <span className="blink" style={{ color: T.green }}>▊</span>
    </div>
  );
}

/* ---------- Severity Badge ---------- */
function SeverityBadge({ level }) {
  const colors = { high: T.red, medium: T.amber, low: T.green };
  const c = colors[level] || T.textSec;
  return (
    <span style={{
      display: "inline-block", padding: "2px 10px", borderRadius: 3,
      fontSize: 11, fontFamily: T.ui, fontWeight: 700,
      color: T.bg, background: c, textTransform: "uppercase",
      animation: level === "high" ? "pulse 1.2s infinite" : undefined,
    }}>
      {level}
    </span>
  );
}

/* ---------- Critic Panel ---------- */
function CriticPanel({ critique, t }) {
  if (!critique) return null;
  const { issues = [], severity, suggestion } = critique;
  return (
    <div style={{
      fontFamily: T.mono, fontSize: 12, color: T.textPri,
      padding: 14, background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 4, overflowY: "auto", maxHeight: "100%",
    }}>
      <div style={{ marginBottom: 10, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: T.cyan, fontFamily: T.ui, fontSize: 13, fontWeight: 700 }}>
          {t.criticTitle}
        </span>
        <SeverityBadge level={severity} />
      </div>

      {issues.map((iss, i) => (
        <div key={i} style={{
          marginBottom: 8, padding: "6px 8px",
          background: T.surface2, borderLeft: `3px solid ${
            iss.dimension === "Security Vulnerabilities" || iss.dimension === "Lỗ Hổng Bảo Mật" ? T.red :
            iss.dimension === "Logic Correctness" || iss.dimension === "Tính Đúng Đắn Logic" ? T.amber : T.cyan
          }`, borderRadius: 2,
        }}>
          <div style={{ color: T.textSec, fontSize: 10, marginBottom: 2 }}>
            {iss.dimension} {iss.line != null && `· L${iss.line}`}
          </div>
          <div>{iss.description}</div>
        </div>
      ))}

      {suggestion && (
        <div style={{ marginTop: 10, padding: "8px 10px", background: T.surface2, borderRadius: 4 }}>
          <span style={{ color: T.amber, fontSize: 11 }}>{t.suggestion} </span>
          <span>{suggestion}</span>
        </div>
      )}
    </div>
  );
}

/* ---------- Terminal Panel ---------- */
function TerminalPanel({ stdout, stderr, exitCode, t }) {
  if (exitCode === null) return null;
  const ok = exitCode === 0;
  return (
    <div style={{
      fontFamily: T.mono, fontSize: 12, padding: 14,
      background: T.bg, border: `1px solid ${ok ? T.green : T.red}`,
      borderRadius: 4, color: T.textPri,
    }}>
      <div style={{ marginBottom: 6 }}>
        <span style={{ color: ok ? T.green : T.red, fontFamily: T.ui, fontWeight: 700, fontSize: 11 }}>
          {t.exitLabel} {exitCode}
        </span>
      </div>
      {stdout && <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: T.green }}>{stdout}</pre>}
      {stderr && <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: T.red }}>{stderr}</pre>}
    </div>
  );
}

/* ---------- Teach Form ---------- */
function TeachForm({ state, pipelineCode, editedCode, runId, onTeach, t }) {
  const [lesson, setLesson] = useState("");
  const [score, setScore] = useState(3);

  if (state.saved) {
    return (
      <div style={{
        textAlign: "center", padding: 30, fontFamily: T.ui,
        color: T.green, fontSize: 14, animation: "fadeIn .5s",
      }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>✦</div>
        {t.memoryUpdated}
      </div>
    );
  }

  return (
    <div style={{ fontFamily: T.mono, color: T.textPri }}>
      <label style={{ display: "block", marginBottom: 4, color: T.cyan, fontSize: 11, fontFamily: T.ui }}>
        {t.lessonLabel}
      </label>
      <textarea
        value={lesson}
        onChange={(e) => setLesson(e.target.value)}
        rows={4}
        style={{
          width: "100%", background: T.surface2, color: T.textPri,
          border: `1px solid ${T.border}`, borderRadius: 4, padding: 10,
          fontFamily: T.mono, fontSize: 12, resize: "vertical",
        }}
        placeholder={t.lessonPlaceholder}
      />

      <label style={{ display: "block", margin: "12px 0 4px", color: T.cyan, fontSize: 11, fontFamily: T.ui }}>
        {t.qualityScore}: {score}
      </label>
      <input
        type="range" min={1} max={5} step={1} value={score}
        onChange={(e) => setScore(Number(e.target.value))}
        style={{ width: "100%", accentColor: T.cyan }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.textSec }}>
        <span>{t.scorePoor}</span><span>{t.scoreExcellent}</span>
      </div>

      {state.error && (
        <div style={{ marginTop: 8, color: T.red, fontSize: 11 }}>
          ⚠ {state.error}
        </div>
      )}

      <button
        onClick={() => onTeach({ lesson, score })}
        disabled={!lesson.trim() || state.isSaving}
        style={{
          marginTop: 14, width: "100%", padding: "10px 0",
          background: lesson.trim() && !state.isSaving ? T.cyan : T.border,
          color: T.bg, border: "none", borderRadius: 4,
          fontFamily: T.ui, fontWeight: 700, fontSize: 13, cursor: "pointer",
        }}
      >
        {state.isSaving ? t.saving : t.teachSync}
      </button>
    </div>
  );
}

/* ---------- Research Dashboard ---------- */
// BUG-7 FIX: Added statsError state to show fetch failures to the user.
function ResearchDashboard({ stats, statsError, t }) {
  const [open, setOpen] = useState(false);

  if (!stats && !statsError) return null;

  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 4, fontFamily: T.mono, fontSize: 12, color: T.textPri,
    }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", padding: "10px 14px", background: "transparent",
          border: "none", color: T.cyan, fontFamily: T.ui, fontSize: 12,
          fontWeight: 700, cursor: "pointer", textAlign: "left",
          display: "flex", justifyContent: "space-between",
        }}
      >
        <span>{t.dashboard}</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ padding: "0 14px 14px", animation: "fadeIn .3s" }}>
          {statsError && (
            <div style={{ color: T.red, fontSize: 11, marginBottom: 8 }}>
              ⚠ {t.statsError}: {statsError}
            </div>
          )}
          {stats && (
            <>
              {/* stat cards */}
              <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                {[
                  { label: t.totalLessons, value: stats.total, color: T.cyan },
                  { label: t.avgScore, value: stats.avg_score, color: T.amber },
                  { label: t.pipelineRuns, value: stats.total_runs, color: T.textPri },
                  { label: t.autoFixRate, value: `${stats.auto_fix_rate}%`, color: T.green },
                ].map((s) => (
                  <div key={s.label} style={{
                    flex: 1, padding: "10px 12px", background: T.surface2,
                    borderRadius: 4, textAlign: "center",
                  }}>
                    <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: T.textSec, marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* recent lessons table */}
              {stats.recent && stats.recent.length > 0 && (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr style={{ color: T.textSec, textAlign: "left" }}>
                      <th style={{ padding: "4px 6px", borderBottom: `1px solid ${T.border}` }}>{t.colId}</th>
                      <th style={{ padding: "4px 6px", borderBottom: `1px solid ${T.border}` }}>{t.colTask}</th>
                      <th style={{ padding: "4px 6px", borderBottom: `1px solid ${T.border}` }}>{t.colScore}</th>
                      <th style={{ padding: "4px 6px", borderBottom: `1px solid ${T.border}` }}>{t.colTime}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recent.map((r) => (
                      <tr key={r.id}>
                        <td style={{ padding: "4px 6px", color: T.cyan }}>{r.id}</td>
                        <td style={{ padding: "4px 6px", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.task}</td>
                        <td style={{ padding: "4px 6px", color: T.amber }}>{r.feedback_score}</td>
                        <td style={{ padding: "4px 6px", color: T.textSec }}>{r.timestamp?.slice(0, 16)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Phase Indicator ---------- */
function PhaseIndicator({ current, t }) {
  const phases = t.phases;
  return (
    <div style={{ display: "flex", gap: 0, marginBottom: 16 }}>
      {phases.map((p, i) => {
        const active = p === current;
        const done = phases.indexOf(current) > i;
        return (
          <div key={p} style={{
            flex: 1, padding: "8px 0", textAlign: "center",
            fontFamily: T.ui, fontSize: 11, fontWeight: 700,
            color: active ? T.bg : done ? T.green : T.textSec,
            background: active ? T.cyan : "transparent",
            borderBottom: `2px solid ${active ? T.cyan : done ? T.green : T.border}`,
            transition: "all .3s",
          }}>
            {done ? "✓ " : `${i + 1}. `}{p}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Lessons Used ---------- */
function LessonsUsed({ lessons, t }) {
  if (!lessons || lessons.length === 0) return null;
  return (
    <div style={{
      margin: "8px 0", padding: 10, background: T.surface2,
      border: `1px solid ${T.border}`, borderRadius: 4,
      fontFamily: T.mono, fontSize: 11, color: T.textSec,
    }}>
      <span style={{ color: T.amber, fontFamily: T.ui, fontWeight: 700, fontSize: 10 }}>
        {t.memoryContext} — {lessons.length} {t.lessonsInjected}
      </span>
      {lessons.map((l) => (
        <div key={l.id} style={{ marginTop: 6, color: T.textPri }}>
          <span style={{ color: T.cyan }}>#{l.id}</span> {l.lesson_text.slice(0, 100)}…
        </div>
      ))}
    </div>
  );
}

/* =========================================================================
   2. MAIN COMPONENT
   ========================================================================= */

export default function HITLEditor() {
  // BUG-6 FIX: Use hooks from src/hooks/ — they use relative "/api" path which
  // respects the proxy setting in package.json, not hardcoded localhost:8000.
  const pipeline = useAgentPipeline();
  const execution = useCodeExecution();
  const teachMemory = useTeachMemory();

  // Language state — persisted to localStorage
  const [lang, setLang] = useState(() => localStorage.getItem("hitl_lang") || "en");
  const t = i18n[lang];
  const toggleLang = () => {
    const next = lang === "en" ? "vi" : "en";
    setLang(next);
    localStorage.setItem("hitl_lang", next);
  };

  // Heartbeat: keeps backend alive as long as this tab is open
  useEffect(() => {
    const sendHeartbeat = () => {
      fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
    };
    sendHeartbeat();
    const timer = setInterval(sendHeartbeat, 10000);
    return () => clearInterval(timer);
  }, []);

  const [task, setTask] = useState("");
  const [editedCode, setEditedCode] = useState("");
  const [phase, setPhase] = useState(0); // index-based: 0=Generate, 1=Review, 2=Execute, 3=Teach
  const [stats, setStats] = useState(null);

  // Live prompt preview — debounced fetch to /api/prompt/preview.
  // Only enabled while on the GENERATE phase so we don't spam the backend.
  const preview = usePromptPreview({
    role: "coder",
    task,
    lang,
    enabled: phase === 0,
  });
  // BUG-7 FIX: Track stats fetch errors separately for display in dashboard
  const [statsError, setStatsError] = useState(null);

  // BUG-8 FIX: Store the Monaco editor instance ref so we can dispose listeners on unmount
  const monacoEditorRef = useRef(null);
  const contentListenerRef = useRef(null);

  // Sync edited code when new AI code arrives and advance phase
  useEffect(() => {
    if (pipeline.code) {
      setEditedCode(pipeline.code);
      setPhase(1); // REVIEW
    }
  }, [pipeline.code]);

  // Advance to EXECUTE phase when execution completes
  useEffect(() => {
    if (execution.exitCode !== null) {
      setPhase(2); // EXECUTE
    }
  }, [execution.exitCode]);

  // Advance to TEACH phase when lesson saved
  useEffect(() => {
    if (teachMemory.saved) {
      setPhase(3); // TEACH
      fetchStats();
    }
  }, [teachMemory.saved]);

  const fetchStats = useCallback(async () => {
    setStatsError(null);
    await teachMemory.fetchStats();
  }, [teachMemory]);

  // BUG-7 FIX: Expose stats error from hook to UI
  useEffect(() => {
    if (teachMemory.stats) setStats(teachMemory.stats);
    if (teachMemory.error) setStatsError(teachMemory.error);
  }, [teachMemory.stats, teachMemory.error]);

  // Load stats on mount
  useEffect(() => {
    fetchStats();
  }, []);

  const handleReset = () => {
    pipeline.reset();
    teachMemory.resetTeach();
    setTask("");
    setEditedCode("");
    setPhase(0); // GENERATE
    fetchStats();
  };

  const handleTeach = async ({ lesson, score }) => {
    await teachMemory.teach({
      runId: pipeline.runId,
      task,
      wrongCode: pipeline.code,
      correctCode: editedCode,
      lesson,
      score,
    });
  };

  // BUG-8 FIX: Dispose the Monaco content listener when component unmounts or
  // when the editor is re-mounted (phase reset), preventing stale event subscriptions
  // and potential memory leaks.
  const handleEditorMount = useCallback((editor) => {
    // Dispose previous listener if any
    if (contentListenerRef.current) {
      contentListenerRef.current.dispose();
    }
    monacoEditorRef.current = editor;
    const modified = editor.getModifiedEditor();
    contentListenerRef.current = modified.onDidChangeModelContent(() => {
      setEditedCode(modified.getValue());
    });
  }, []);

  // Cleanup Monaco listeners on unmount
  useEffect(() => {
    return () => {
      if (contentListenerRef.current) {
        contentListenerRef.current.dispose();
      }
    };
  }, []);

  return (
    <div style={{
      minHeight: "100vh", background: T.bg, color: T.textPri,
      fontFamily: T.ui, padding: "20px 24px",
    }}>
      {/* inject global styles */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&family=Space+Mono:wght@400;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${T.bg}; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
        .blink { animation: pulse 1s step-end infinite; }
        textarea:focus, input:focus { outline: 1px solid ${T.cyan}; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${T.surface}; }
        ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 20, paddingBottom: 12,
        borderBottom: `1px solid ${T.border}`,
      }}>
        <div>
          <h1 style={{
            fontSize: 20, fontWeight: 700, fontFamily: T.ui,
            color: T.cyan, letterSpacing: 2,
          }}>
            {t.title}
          </h1>
          <div style={{ fontSize: 10, color: T.textSec, letterSpacing: 1 }}>
            {t.subtitle}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Language Toggle */}
          <button
            onClick={toggleLang}
            style={{
              padding: "6px 14px", background: T.surface2,
              border: `1px solid ${T.cyan}`, borderRadius: 3,
              color: T.cyan, fontFamily: T.ui, fontSize: 11, fontWeight: 700,
              cursor: "pointer", transition: "all .2s",
              letterSpacing: 1,
            }}
          >
            {lang === "en" ? "🇻🇳 VI" : "🇺🇸 EN"}
          </button>
          <button
            onClick={handleReset}
            style={{
              padding: "6px 16px", background: "transparent",
              border: `1px solid ${T.border}`, borderRadius: 3,
              color: T.textSec, fontFamily: T.ui, fontSize: 11, cursor: "pointer",
            }}
          >
            {t.reset}
          </button>
        </div>
      </header>

      {/* Phase bar */}
      <PhaseIndicator current={t.phases[phase]} t={t} />

      {/* Pipeline error banner */}
      {pipeline.error && (
        <div style={{
          marginBottom: 12, padding: "8px 14px",
          background: T.surface2, border: `1px solid ${T.red}`,
          color: T.red, fontFamily: T.mono, fontSize: 12, borderRadius: 4,
        }}>
          ⚠ {t.pipelineError}: {pipeline.error}
        </div>
      )}

      {/* ===== PHASE 1: GENERATE ===== */}
      {phase === 0 && (
        <div style={{ maxWidth: 700 }}>
          <label style={{ display: "block", marginBottom: 6, color: T.cyan, fontSize: 11, fontWeight: 700 }}>
            {t.taskLabel}
          </label>
          <textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            rows={4}
            placeholder={t.taskPlaceholder}
            style={{
              width: "100%", background: T.surface2, color: T.textPri,
              border: `1px solid ${T.border}`, borderRadius: 4, padding: 12,
              fontFamily: T.mono, fontSize: 13, resize: "vertical",
            }}
          />
          <button
            onClick={() => pipeline.generate(task, lang)}
            disabled={!task.trim() || pipeline.phase === "generating"}
            style={{
              marginTop: 12, padding: "10px 28px",
              background: task.trim() && pipeline.phase !== "generating" ? T.cyan : T.border,
              color: T.bg, border: "none", borderRadius: 4,
              fontFamily: T.ui, fontWeight: 700, fontSize: 13, cursor: "pointer",
            }}
          >
            {pipeline.phase === "generating" ? t.generating : t.initPipeline}
          </button>

          {pipeline.phase === "generating" && (
            <div style={{ marginTop: 16 }}>
              <ScanlineLoader />
            </div>
          )}

          {/* Live Prompt Inspector — shows what the coder prompt will look
              like (including retrieved lessons) as the user types. */}
          <PromptInspector
            bundle={preview.bundle}
            loading={preview.loading}
            error={preview.error}
            title={t.livePromptPreview}
            t={t}
          />
        </div>
      )}

      {/* ===== PHASE 2+: REVIEW / EXECUTE / TEACH ===== */}
      {phase !== 0 && (
        <div style={{ display: "flex", gap: 14, minHeight: "60vh" }}>
          {/* LEFT — Critic (30%) */}
          <div style={{ flex: "0 0 30%", display: "flex", flexDirection: "column", gap: 12 }}>
            <CriticPanel critique={pipeline.critique} t={t} />
            <LessonsUsed lessons={pipeline.lessonsUsed} t={t} />

            {/* Prompt Inspectors — transparency for the two bundles that
                actually drove the Coder/Critic calls. */}
            <PromptInspector
              bundle={pipeline.coderPrompt}
              title={t.coderPromptTitle}
              t={t}
            />
            <PromptInspector
              bundle={pipeline.criticPrompt}
              title={t.criticPromptTitle}
              t={t}
            />

            {/* Execute button */}
            {(phase === 1 || phase === 2) && (
              <button
                onClick={() => execution.execute(editedCode)}
                disabled={execution.isRunning}
                style={{
                  padding: "10px 0", background: execution.isRunning ? T.border : T.green,
                  color: T.bg, border: "none", borderRadius: 4,
                  fontFamily: T.ui, fontWeight: 700, fontSize: 13, cursor: "pointer",
                }}
              >
                {execution.isRunning ? t.running : t.runSandbox}
              </button>
            )}

            {/* Terminal output */}
            <TerminalPanel
              stdout={execution.stdout}
              stderr={execution.stderr}
              exitCode={execution.exitCode}
              t={t}
            />

            {/* Teach form — visible after execute */}
            {execution.exitCode !== null && (
              <TeachForm
                state={teachMemory}
                pipelineCode={pipeline.code}
                editedCode={editedCode}
                runId={pipeline.runId}
                onTeach={handleTeach}
                t={t}
              />
            )}
          </div>

          {/* RIGHT — DiffEditor (70%) */}
          <div style={{
            flex: 1, border: `1px solid ${T.border}`, borderRadius: 4,
            overflow: "hidden",
          }}>
            <div style={{
              padding: "8px 14px", background: T.surface,
              borderBottom: `1px solid ${T.border}`,
              display: "flex", justifyContent: "space-between",
              fontFamily: T.ui, fontSize: 11, color: T.textSec,
            }}>
              <span>{t.aiGenerated}</span>
              <span style={{ color: T.cyan }}>{t.humanEditor}</span>
            </div>
            {/* BUG-8 FIX: Use handleEditorMount ref callback to properly manage listener lifecycle */}
            <DiffEditor
              height="60vh"
              language="python"
              original={pipeline.code || ""}
              modified={editedCode}
              onMount={handleEditorMount}
              theme="vs-dark"
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
                minimap: { enabled: false },
                readOnly: false,
                originalEditable: false,
                renderSideBySide: true,
                scrollBeyondLastLine: false,
              }}
            />
          </div>
        </div>
      )}

      {/* ===== BOTTOM — Research Dashboard ===== */}
      <div style={{ marginTop: 20 }}>
        {/* BUG-7 FIX: Pass statsError to dashboard for display */}
        <ResearchDashboard stats={stats} statsError={statsError} t={t} />
      </div>
    </div>
  );
}
