/**
 * HITLEditor.jsx — MIRROR · Minimal Wizard UI
 *
 * A clean, step-by-step grading interface:
 *   Step 1: Upload — prompt + student essay image
 *   Step 2: AI Reading — animated spinner while grading
 *   Step 3: Teacher Review — comment-style feedback UI
 *   Step 4: Re-grading — spinner again
 *   Step 5: Completed — tabbed results with progress bar
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAgentPipeline } from "./hooks/useAgentPipeline";
import { useFeedback } from "./hooks/useFeedback";

/* ═════════════════════════════════════════════════════════════════════
   THEME — light, minimal, clean
   ═════════════════════════════════════════════════════════════════════ */
const T = {
  bg: "#F8F9FA",
  bgCard: "#FFFFFF",
  bgElevated: "#F1F3F5",
  bgHover: "#E9ECEF",
  bgInput: "#FFFFFF",

  text: "#1A1A2E",
  textSoft: "#495057",
  textMute: "#868E96",
  textFaint: "#ADB5BD",
  border: "#DEE2E6",
  borderLight: "#CED4DA",

  accent: "#7C3AED", // purple
  accentLight: "#8B5CF6",
  accentSoft: "rgba(124, 58, 237, 0.08)",
  accentGlow: "rgba(124, 58, 237, 0.18)",

  green: "#16A34A",
  greenSoft: "rgba(22, 163, 74, 0.08)",
  red: "#DC2626",
  redSoft: "rgba(220, 38, 38, 0.06)",
  amber: "#D97706",
  amberSoft: "rgba(217, 119, 6, 0.06)",

  font: `"Inter", "SF Pro Display", -apple-system, BlinkMacSystemFont, system-ui, sans-serif`,
  mono: `"JetBrains Mono", "SF Mono", "Fira Code", monospace`,
};

/* ═════════════════════════════════════════════════════════════════════
   I18N — bilingual
   ═════════════════════════════════════════════════════════════════════ */
const i18n = {
  en: {
    title: "MIRROR",
    subtitle: "AI Essay Grading",
    langSwitch: "Tiếng Việt",
    // Steps short labels
    stepUpload: "Upload",
    stepReading: "Reading",
    stepReview: "Review",
    stepRegrade: "Re-grade",
    stepDone: "Done",
    // Step 1
    step1Title: "Upload Assignment",
    step1Desc: "Provide the essay prompt and the student's paper",
    promptLabel: "Essay Prompt",
    promptPlaceholder: "Type or paste the essay prompt here…",
    imageLabel: "Student's Paper",
    imageDrop: "Drop image or PDF here, or click to browse",
    imageChange: "Change file",
    pdfUploaded: "PDF uploaded",
    startGrading: "Start Grading",
    // Step 2
    step2Title: "AI is Reading",
    step2Desc: "The AI model is analyzing the essay. This may take a moment…",
    // Step 3
    step3Title: "Review & Feedback",
    step3Desc: "Review the AI's grading and provide your feedback",
    overallScore: "Overall",
    outOf: "/ 10",
    rubric: "Rubric Scores",
    rubricContent: "Content",
    rubricArgument: "Argument",
    rubricExpression: "Expression",
    rubricCreativity: "Creativity",
    strengths: "Strengths",
    weaknesses: "Weaknesses",
    comment: "Examiner's Comment",
    transcript: "What the AI read",
    approve: "Approve",
    revise: "Request Revision",
    reject: "Reject",
    feedbackPlaceholder: "Explain what needs to change…",
    submitFeedback: "Submit Feedback",
    regrade: "Re-grade with Corrections",
    regradeHint: "Your feedback will be sent to the AI for re-grading",
    feedbackSaved: "Feedback saved — the AI will remember",
    feedbackSaving: "Saving…",
    needComment: "Please provide an explanation for revision or rejection.",
    // Step 4
    step4Title: "Re-grading",
    step4Desc: "The AI is re-reading with your corrections in mind…",
    // Step 5
    step5Title: "Completed",
    step5Desc: "All essays have been graded",
    // General
    newEssay: "+ New Essay",
    essayN: "Essay",
    noResult: "No result yet",
    progress: "Progress",
    pipelineError: "An error occurred",
    viewResult: "View Result",
    backToReview: "Back to Review",
    grading: "Grading…",
    done: "Done",
    idle: "Ready",
    reset: "Clear All",
  },
  vi: {
    title: "MIRROR",
    subtitle: "Chấm Bài Luận AI",
    langSwitch: "English",
    stepUpload: "Tải lên",
    stepReading: "Đọc",
    stepReview: "Xem xét",
    stepRegrade: "Chấm lại",
    stepDone: "Xong",
    step1Title: "Tải Bài Lên",
    step1Desc: "Nhập đề bài và ảnh bài làm của học sinh",
    promptLabel: "Đề Bài",
    promptPlaceholder: "Nhập hoặc dán đề bài vào đây…",
    imageLabel: "Bài Làm Học Sinh",
    imageDrop: "Thả ảnh hoặc PDF vào đây, hoặc nhấp để chọn",
    imageChange: "Đổi file",
    pdfUploaded: "Đã tải PDF",
    startGrading: "Bắt Đầu Chấm",
    step2Title: "AI Đang Đọc",
    step2Desc: "Mô hình AI đang phân tích bài luận. Xin chờ…",
    step3Title: "Xem Xét & Phản Hồi",
    step3Desc: "Xem điểm AI chấm và đưa ra nhận xét",
    overallScore: "Tổng Điểm",
    outOf: "/ 10",
    rubric: "Điểm Tiêu Chí",
    rubricContent: "Nội dung",
    rubricArgument: "Lập luận",
    rubricExpression: "Diễn đạt",
    rubricCreativity: "Sáng tạo",
    strengths: "Ưu Điểm",
    weaknesses: "Hạn Chế",
    comment: "Nhận Xét Giám Khảo",
    transcript: "Bản AI đọc được",
    approve: "Duyệt",
    revise: "Yêu Cầu Sửa",
    reject: "Từ Chối",
    feedbackPlaceholder: "Giải thích cần thay đổi gì…",
    submitFeedback: "Gửi Phản Hồi",
    regrade: "Chấm Lại",
    regradeHint: "Phản hồi sẽ được gửi cho AI để chấm lại",
    feedbackSaved: "Đã lưu — AI sẽ ghi nhớ",
    feedbackSaving: "Đang lưu…",
    needComment: "Vui lòng giải thích khi Sửa hoặc Từ chối.",
    step4Title: "Đang Chấm Lại",
    step4Desc: "AI đang đọc lại với sửa đổi của bạn…",
    step5Title: "Hoàn Thành",
    step5Desc: "Tất cả bài đã được chấm",
    newEssay: "+ Bài Mới",
    essayN: "Bài",
    noResult: "Chưa có kết quả",
    progress: "Tiến trình",
    pipelineError: "Có lỗi xảy ra",
    viewResult: "Xem Kết Quả",
    backToReview: "Quay Lại Xem",
    grading: "Đang chấm…",
    done: "Xong",
    idle: "Sẵn sàng",
    reset: "Xóa Tất Cả",
  },
};

/* ═════════════════════════════════════════════════════════════════════
   HELPERS
   ═════════════════════════════════════════════════════════════════════ */
function makeTabId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function parseGrade(raw) {
  if (!raw) return null;
  try {
    const p = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      scores: {
        content: p.scores?.content ?? "",
        argument: p.scores?.argument ?? "",
        expression: p.scores?.expression ?? "",
        creativity: p.scores?.creativity ?? "",
      },
      overall: p.overall ?? "",
      strengths: Array.isArray(p.strengths) ? p.strengths.slice() : [],
      weaknesses: Array.isArray(p.weaknesses) ? p.weaknesses.slice() : [],
      comment: p.comment ?? "",
      transcript: p.transcript ?? "",
    };
  } catch (e) {
    return null;
  }
}

function cloneGrade(g) {
  if (!g) return null;
  return {
    scores: { ...g.scores },
    overall: g.overall,
    strengths: g.strengths.slice(),
    weaknesses: g.weaknesses.slice(),
    comment: g.comment,
    transcript: g.transcript,
  };
}

/* ═════════════════════════════════════════════════════════════════════
   GLOBAL STYLES
   ═════════════════════════════════════════════════════════════════════ */
function GlobalStyles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        background: ${T.bg};
        color: ${T.text};
        font-family: ${T.font};
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }

      ::selection { background: ${T.accent}; color: white; }

      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb {
        background: ${T.borderLight};
        border-radius: 999px;
      }
      ::-webkit-scrollbar-thumb:hover { background: ${T.textMute}; }

      button { font-family: inherit; cursor: pointer; }
      textarea, input, select { font-family: inherit; }

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

      @keyframes shimmer {
        0% { background-position: -200% 0; }
        100% { background-position: 200% 0; }
      }

      @keyframes hourglassFlip {
        0% { transform: rotate(0deg); }
        25% { transform: rotate(180deg); }
        50% { transform: rotate(180deg); }
        75% { transform: rotate(360deg); }
        100% { transform: rotate(360deg); }
      }

      @keyframes dotBounce {
        0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
        40% { transform: scale(1); opacity: 1; }
      }

      @keyframes progressGlow {
        0%, 100% { box-shadow: 0 0 8px ${T.accentGlow}; }
        50% { box-shadow: 0 0 20px ${T.accentGlow}; }
      }

      @keyframes hourglassFlip {
        0% { transform: rotate(0deg); }
        20% { transform: rotate(180deg); }
        50% { transform: rotate(180deg); }
        70% { transform: rotate(360deg); }
        100% { transform: rotate(360deg); }
      }
    `}</style>
  );
}

/* ═════════════════════════════════════════════════════════════════════
   SVG ICONS — professional inline SVGs
   ═════════════════════════════════════════════════════════════════════ */
const Icon = {
  Check: ({ size = 14, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  Upload: ({ size = 40, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <polyline points="9 15 12 12 15 15" />
    </svg>
  ),
  Star: ({ size = 14, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      stroke="none"
    >
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
    </svg>
  ),
  AlertTriangle: ({ size = 14, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  ArrowDown: ({ size = 14, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  ChevronRight: ({ size = 14, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  MessageCircle: ({ size = 16, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
    </svg>
  ),
  RefreshCw: ({ size = 12, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  ),
  Languages: ({ size = 14, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 8l6 6" />
      <path d="M4 14l6-6 2-3" />
      <path d="M2 5h12" />
      <path d="M7 2h1" />
      <path d="M22 22l-5-10-5 10" />
      <path d="M14 18h6" />
    </svg>
  ),
  X: ({ size = 14, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Edit: ({ size = 14, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  ),
  FileText: ({ size = 14, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  Award: ({ size = 14, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="8" r="7" />
      <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
    </svg>
  ),
  PenTool: ({ size = 14, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  ),
  Cpu: ({ size = 14, color = "currentColor" }) => (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
      <rect x="9" y="9" width="6" height="6" />
      <line x1="9" y1="1" x2="9" y2="4" />
      <line x1="15" y1="1" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="23" />
      <line x1="15" y1="20" x2="15" y2="23" />
      <line x1="20" y1="9" x2="23" y2="9" />
      <line x1="20" y1="15" x2="23" y2="15" />
      <line x1="1" y1="9" x2="4" y2="9" />
      <line x1="1" y1="15" x2="4" y2="15" />
    </svg>
  ),
};

/* ═════════════════════════════════════════════════════════════════════
   SPINNER — used in Steps 2 and 4
   ═════════════════════════════════════════════════════════════════════ */
function HourglassIcon({ size = 28, color }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ animation: "hourglassFlip 3s ease-in-out infinite" }}
    >
      {/* Top cap */}
      <rect
        x="5"
        y="2"
        width="14"
        height="2"
        rx="1"
        fill={color}
        opacity="0.9"
      />
      {/* Bottom cap */}
      <rect
        x="5"
        y="20"
        width="14"
        height="2"
        rx="1"
        fill={color}
        opacity="0.9"
      />
      {/* Glass body */}
      <path
        d="M7 4 C7 4 7 9 12 12 C7 15 7 20 7 20 L17 20 C17 20 17 15 12 12 C17 9 17 4 17 4 Z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Sand top half */}
      <path
        d="M9 6 C9 6 9.5 9 12 10.5 C14.5 9 15 6 15 6 Z"
        fill={color}
        opacity="0.3"
      />
      {/* Sand bottom pile */}
      <path
        d="M8.5 18.5 C8.5 18.5 9.5 15.5 12 14.5 C14.5 15.5 15.5 18.5 15.5 18.5 Z"
        fill={color}
        opacity="0.6"
      />
      {/* Sand stream (center falling line) */}
      <line
        x1="12"
        y1="11"
        x2="12"
        y2="14"
        stroke={color}
        strokeWidth="1"
        opacity="0.45"
        strokeLinecap="round"
        strokeDasharray="1 2"
      >
        <animate
          attributeName="stroke-dashoffset"
          from="0"
          to="-6"
          dur="0.8s"
          repeatCount="indefinite"
        />
      </line>
    </svg>
  );
}

function LoadingSpinner({ title, description }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "50vh",
        gap: 32,
        animation: "fadeUp 0.5s ease-out",
      }}
    >
      {/* Orbital spinner + hourglass */}
      <div style={{ position: "relative", width: 96, height: 96 }}>
        {/* Outer ring */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: `2.5px solid ${T.border}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: "2.5px solid transparent",
            borderTopColor: T.accent,
            animation: "spin 1.2s linear infinite",
          }}
        />
        {/* Inner ring */}
        <div
          style={{
            position: "absolute",
            inset: 10,
            borderRadius: "50%",
            border: `2px solid ${T.border}`,
            opacity: 0.4,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 10,
            borderRadius: "50%",
            border: "2px solid transparent",
            borderTopColor: T.accentLight,
            animation: "spin 1.8s linear infinite reverse",
          }}
        />
        {/* Hourglass center */}
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <HourglassIcon size={30} color={T.accent} />
        </div>
      </div>

      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: T.text,
            marginBottom: 8,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 14,
            color: T.textMute,
            maxWidth: 360,
            lineHeight: 1.6,
          }}
        >
          {description}
        </div>
      </div>

      {/* Bouncing dots */}
      <div style={{ display: "flex", gap: 8 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: T.accent,
              animation: `dotBounce 1.4s ease-in-out ${i * 0.16}s infinite`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════
   PROGRESS BAR — Step 5 & general use
   ═════════════════════════════════════════════════════════════════════ */
function ProgressBar({ completed, total, label }) {
  const pct = total > 0 ? (completed / total) * 100 : 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 0",
      }}
    >
      {label && (
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: T.textSoft,
            minWidth: 72,
            fontFamily: T.mono,
          }}
        >
          {label}
        </span>
      )}
      <div
        style={{
          flex: 1,
          height: 6,
          background: T.border,
          borderRadius: 999,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${T.accent}, ${T.accentLight})`,
            borderRadius: 999,
            transition: "width 0.6s cubic-bezier(0.22, 1, 0.36, 1)",
            animation:
              pct > 0 && pct < 100 ? "progressGlow 2s infinite" : undefined,
          }}
        />
      </div>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: T.textSoft,
          fontFamily: T.mono,
          minWidth: 48,
          textAlign: "right",
        }}
      >
        {completed}/{total}
      </span>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════
   STEP INDICATOR — wizard steps
   ═════════════════════════════════════════════════════════════════════ */
function StepIndicator({ steps, currentStep }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      gap: 0,
      padding: "32px 0 24px",
      maxWidth: 600,
      margin: "0 auto",
    }}>
      {steps.map((step, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === currentStep;
        const isDone = stepNum < currentStep;
        const isLineDone = i < currentStep - 1; // Line before this circle belongs to progress if previous is done

        return (
          <React.Fragment key={i}>
            {i > 0 && (
              <div style={{
                flex: 1,
                height: 3,
                background: isLineDone ? T.accent : T.border,
                transition: "background 0.4s ease",
                marginTop: 16, // Perfect center of 32px circle
                marginLeft: -4,
                marginRight: -4,
                borderRadius: 4,
                zIndex: 0,
              }} />
            )}
            <div style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              position: "relative",
              zIndex: 1,
              width: 80, // Fixed width for labels
            }}>
              <div style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 700,
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                background: isDone ? T.accent : isActive ? T.accentSoft : T.bgCard,
                color: isDone ? "white" : isActive ? T.accent : T.textFaint,
                border: `2.5px solid ${isDone ? T.accent : isActive ? T.accent : T.border}`,
                boxShadow: isActive ? `0 0 0 4px ${T.accentGlow}` : isDone ? "0 4px 10px rgba(124, 58, 237, 0.2)" : "none",
                cursor: "default",
              }}>
                {isDone ? <Icon.Check size={16} color="white" /> : stepNum}
              </div>
              <span style={{
                fontSize: 10,
                fontWeight: isActive ? 700 : 500,
                color: isActive ? T.accent : isDone ? T.textSoft : T.textFaint,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                textAlign: "center",
                transition: "color 0.3s",
              }}>
                {step}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════
   STEP 1 — Upload (prompt + image)
   ═════════════════════════════════════════════════════════════════════ */
function StepUpload({
  task,
  setTask,
  essayImage,
  setEssayImage,
  onSubmit,
  canSubmit,
  t,
}) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    (file) => {
      if (!file) return;
      const isPdf =
        file.type === "application/pdf" ||
        file.name.toLowerCase().endsWith(".pdf");
      const isImage = file.type.startsWith("image/");
      if (!isPdf && !isImage) return; // ignore unsupported file types
      const reader = new FileReader();
      reader.onload = () =>
        setEssayImage({ dataUrl: reader.result, name: file.name, isPdf });
      reader.readAsDataURL(file);
    },
    [setEssayImage],
  );

  return (
    <div
      style={{
        maxWidth: 640,
        margin: "0 auto",
        animation: "fadeUp 0.4s ease-out",
      }}
    >
      {/* Prompt */}
      <div style={{ marginBottom: 24 }}>
        <label
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            color: T.textSoft,
            marginBottom: 8,
            letterSpacing: "0.02em",
          }}
        >
          {t.promptLabel}
        </label>
        <textarea
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder={t.promptPlaceholder}
          rows={4}
          style={{
            width: "100%",
            background: T.bgInput,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: "14px 16px",
            fontSize: 14,
            color: T.text,
            lineHeight: 1.6,
            resize: "vertical",
            outline: "none",
            transition: "border-color 0.2s",
          }}
          onFocus={(e) => (e.target.style.borderColor = T.accent)}
          onBlur={(e) => (e.target.style.borderColor = T.border)}
        />
      </div>

      {/* Image upload */}
      <div style={{ marginBottom: 32 }}>
        <label
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            color: T.textSoft,
            marginBottom: 8,
            letterSpacing: "0.02em",
          }}
        >
          {t.imageLabel}
        </label>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? T.accent : T.border}`,
            borderRadius: 12,
            padding: essayImage ? 16 : 48,
            textAlign: "center",
            cursor: "pointer",
            transition: "all 0.2s",
            background: dragOver ? T.accentSoft : T.bgCard,
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.pdf,application/pdf"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {essayImage ? (
            <div>
              {essayImage.isPdf ? (
                /* PDF preview — icon + filename */
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 12,
                    padding: "24px 0",
                  }}
                >
                  <div
                    style={{
                      width: 80,
                      height: 100,
                      borderRadius: 12,
                      background: `linear-gradient(135deg, ${T.red}, #C0392B)`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      boxShadow: `0 8px 24px rgba(239, 68, 68, 0.25)`,
                      position: "relative",
                      overflow: "hidden",
                    }}
                  >
                    {/* Decorative fold */}
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        width: 24,
                        height: 24,
                        background: "rgba(255,255,255,0.2)",
                        clipPath: "polygon(0 0, 100% 100%, 0 100%)",
                      }}
                    />
                    <Icon.FileText size={32} color="white" />
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        marginTop: 8,
                        letterSpacing: "0.1em",
                      }}
                    >
                      PDF
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: T.textSoft,
                      fontWeight: 500,
                    }}
                  >
                    {t.pdfUploaded}
                  </div>
                </div>
              ) : (
                /* Image preview */
                <img
                  src={essayImage.dataUrl}
                  alt={essayImage.name}
                  style={{
                    maxWidth: "100%",
                    maxHeight: 260,
                    borderRadius: 8,
                    display: "block",
                    margin: "0 auto",
                    boxShadow: `0 4px 24px rgba(0,0,0,0.3)`,
                  }}
                />
              )}
              <div
                style={{
                  marginTop: 10,
                  fontSize: 12,
                  color: T.textMute,
                  textAlign: "center",
                }}
              >
                {essayImage.name} ·{" "}
                <span style={{ color: T.accent, cursor: "pointer" }}>
                  {t.imageChange}
                </span>
              </div>
            </div>
          ) : (
            <div>
              <div
                style={{
                  marginBottom: 12,
                  opacity: 0.45,
                }}
              >
                <Icon.Upload size={44} color={T.textMute} />
              </div>
              <div
                style={{
                  fontSize: 14,
                  color: T.textSoft,
                  fontWeight: 500,
                }}
              >
                {t.imageDrop}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: T.textFaint,
                  marginTop: 6,
                }}
              >
                JPG, PNG, PDF
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        style={{
          width: "100%",
          padding: "16px 24px",
          fontSize: 15,
          fontWeight: 600,
          color: canSubmit ? "white" : T.textMute,
          background: canSubmit
            ? `linear-gradient(135deg, ${T.accent}, ${T.accentLight})`
            : T.bgCard,
          border: canSubmit ? "none" : `1px solid ${T.border}`,
          borderRadius: 10,
          transition: "all 0.2s",
          boxShadow: canSubmit ? `0 4px 16px ${T.accentGlow}` : "none",
          letterSpacing: "0.02em",
        }}
        onMouseEnter={(e) => {
          if (canSubmit) e.target.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          e.target.style.transform = "none";
        }}
      >
        {t.startGrading}
      </button>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════
   STEP 3 — Teacher Review (comment-style)
   ═════════════════════════════════════════════════════════════════════ */
function StepReview({
  grade,
  pipeline,
  feedbackHook,
  onRegrade,
  onApprove,
  task,
  t,
}) {
  const [action, setAction] = useState(null);
  const [comment, setComment] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  if (!grade) return null;

  const canSubmitFeedback =
    action === "approve" || (action && comment.trim().length > 0);

  const handleSubmitFeedback = async () => {
    if (!action) return;
    if (action !== "approve" && !comment.trim()) return;
    const res = await feedbackHook.submit({
      action,
      comment,
      task: task || "",
      wrongCode: pipeline.code || "",
      runId: pipeline.runId,
    });
    if (res) {
      setJustSaved(true);
      // If approved, move to done
      if (action === "approve" && onApprove) {
        onApprove();
      }
    }
  };

  const ScoreCard = ({ label, value, color, icon: IconComp }) => {
    const num = Number(value);
    const c = !Number.isNaN(num)
      ? num >= 8
        ? T.green
        : num >= 6.5
          ? T.accent
          : num >= 5
            ? T.amber
            : T.red
      : T.textMute;
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 18px",
          background: T.bgCard,
          borderRadius: 10,
          border: `1px solid ${T.border}`,
          transition: "transform 0.2s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {IconComp && <IconComp size={16} color={T.textFaint} />}
          <span style={{ fontSize: 13, color: T.textSoft, fontWeight: 500 }}>
            {label}
          </span>
        </div>
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: color || c,
            fontFamily: T.mono,
          }}
        >
          {value || "—"}
          <span
            style={{
              fontSize: 11,
              fontWeight: 400,
              color: T.textFaint,
              marginLeft: 2,
            }}
          >
            {t.outOf}
          </span>
        </span>
      </div>
    );
  };

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        animation: "fadeUp 0.4s ease-out",
      }}
    >
      {/* Overall Score — hero */}
      <div
        style={{
          textAlign: "center",
          padding: "32px 24px",
          marginBottom: 24,
          background: T.bgCard,
          borderRadius: 16,
          border: `1px solid ${T.border}`,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: T.textMute,
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            marginBottom: 8,
          }}
        >
          {t.overallScore}
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 700,
            color: T.accent,
            fontFamily: T.mono,
            lineHeight: 1,
          }}
        >
          {grade.overall || "—"}
          <span style={{ fontSize: 20, fontWeight: 400, color: T.textFaint }}>
            {" "}
            {t.outOf}
          </span>
        </div>
      </div>

      {/* Rubric grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 8,
          marginBottom: 24,
        }}
      >
        <ScoreCard
          label={t.rubricContent}
          value={grade.scores.content}
          icon={Icon.FileText}
        />
        <ScoreCard
          label={t.rubricArgument}
          value={grade.scores.argument}
          icon={Icon.MessageCircle}
        />
        <ScoreCard
          label={t.rubricExpression}
          value={grade.scores.expression}
          icon={Icon.PenTool}
        />
        <ScoreCard
          label={t.rubricCreativity}
          value={grade.scores.creativity}
          icon={Icon.Award}
        />
      </div>

      {/* Strengths & Weaknesses */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {/* Strengths */}
        <div
          style={{
            background: T.bgCard,
            borderRadius: 12,
            border: `1px solid ${T.border}`,
            padding: 16,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: T.green,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon.Star size={13} color={T.green} /> {t.strengths}
          </div>
          {grade.strengths.length > 0 ? (
            <ul
              style={{
                margin: 0,
                paddingLeft: 16,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {grade.strengths.map((s, i) => (
                <li
                  key={i}
                  style={{ fontSize: 13, color: T.textSoft, lineHeight: 1.5 }}
                >
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <div
              style={{ fontSize: 13, color: T.textFaint, fontStyle: "italic" }}
            >
              —
            </div>
          )}
        </div>

        {/* Weaknesses */}
        <div
          style={{
            background: T.bgCard,
            borderRadius: 12,
            border: `1px solid ${T.border}`,
            padding: 16,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: T.red,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginBottom: 12,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon.ArrowDown size={13} color={T.red} /> {t.weaknesses}
          </div>
          {grade.weaknesses.length > 0 ? (
            <ul
              style={{
                margin: 0,
                paddingLeft: 16,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {grade.weaknesses.map((s, i) => (
                <li
                  key={i}
                  style={{ fontSize: 13, color: T.textSoft, lineHeight: 1.5 }}
                >
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <div
              style={{ fontSize: 13, color: T.textFaint, fontStyle: "italic" }}
            >
              —
            </div>
          )}
        </div>
      </div>

      {/* Comment */}
      <div
        style={{
          background: T.bgCard,
          borderRadius: 12,
          border: `1px solid ${T.border}`,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: T.textMute,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            marginBottom: 10,
          }}
        >
          {t.comment}
        </div>
        <div
          style={{
            fontSize: 14,
            color: T.textSoft,
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
          }}
        >
          {grade.comment || "—"}
        </div>
      </div>

      {/* Transcript collapsible */}
      {grade.transcript && (
        <details style={{ marginBottom: 24 }}>
          <summary
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: T.textFaint,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              padding: "8px 0",
            }}
          >
            <span style={{ display: "inline-flex", marginRight: 4 }}>
              <Icon.ChevronRight size={12} color={T.textFaint} />
            </span>{" "}
            {t.transcript}
          </summary>
          <pre
            style={{
              marginTop: 8,
              padding: 16,
              background: T.bgCard,
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              fontFamily: T.mono,
              fontSize: 11,
              lineHeight: 1.6,
              color: T.textMute,
              whiteSpace: "pre-wrap",
              maxHeight: 200,
              overflowY: "auto",
            }}
          >
            {grade.transcript}
          </pre>
        </details>
      )}

      {/* Critique if any */}
      {pipeline.critique?.suggestion && (
        <div
          style={{
            padding: "14px 18px",
            background: T.amberSoft,
            borderLeft: `3px solid ${T.amber}`,
            borderRadius: 8,
            marginBottom: 24,
            fontSize: 13,
            color: T.textSoft,
            lineHeight: 1.5,
          }}
        >
          <span
            style={{
              fontFamily: T.mono,
              fontSize: 10,
              color: T.amber,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              marginRight: 8,
            }}
          >
            Reviewer ·
          </span>
          {pipeline.critique.suggestion}
        </div>
      )}

      {/* ─── Feedback Section (comment-style) ─── */}
      <div
        style={{
          background: T.bgCard,
          borderRadius: 12,
          border: `1px solid ${T.border}`,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: T.text,
            marginBottom: 16,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              verticalAlign: "middle",
              marginRight: 6,
            }}
          >
            <Icon.MessageCircle size={16} color={T.accent} />
          </span>
          {t.step3Title}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {[
            {
              key: "approve",
              label: t.approve,
              color: T.green,
              bg: T.greenSoft,
              icon: Icon.Check,
            },
            {
              key: "revise",
              label: t.revise,
              color: T.amber,
              bg: T.amberSoft,
              icon: Icon.Edit,
            },
            {
              key: "reject",
              label: t.reject,
              color: T.red,
              bg: T.redSoft,
              icon: Icon.X,
            },
          ].map(({ key, label, color, bg, icon: BtnIcon }) => (
            <button
              key={key}
              onClick={() => {
                setAction(key);
                setJustSaved(false);
              }}
              style={{
                flex: 1,
                padding: "12px",
                fontSize: 13,
                fontWeight: 600,
                background: action === key ? bg : "transparent",
                color: action === key ? color : T.textMute,
                border: `1.5px solid ${action === key ? color : T.border}`,
                borderRadius: 10,
                transition: "all 0.2s",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <BtnIcon size={16} />
              {label}
            </button>
          ))}
        </div>

        {/* Comment box (when revise/reject) */}
        {action && action !== "approve" && (
          <div style={{ marginBottom: 12 }}>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t.feedbackPlaceholder}
              rows={3}
              style={{
                width: "100%",
                background: T.bgInput,
                border: `1px solid ${T.border}`,
                borderRadius: 8,
                padding: 12,
                fontSize: 13,
                color: T.text,
                lineHeight: 1.5,
                resize: "vertical",
                outline: "none",
              }}
              onFocus={(e) => (e.target.style.borderColor = T.accent)}
              onBlur={(e) => (e.target.style.borderColor = T.border)}
            />
            {!comment.trim() && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  color: T.red,
                  fontStyle: "italic",
                }}
              >
                {t.needComment}
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {feedbackHook.error && (
          <div
            style={{
              padding: "8px 12px",
              background: T.redSoft,
              borderRadius: 6,
              fontSize: 12,
              color: T.red,
              marginBottom: 12,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                verticalAlign: "middle",
                marginRight: 4,
              }}
            >
              <Icon.AlertTriangle size={13} color={T.red} />
            </span>{" "}
            {feedbackHook.error}
          </div>
        )}

        {/* Success */}
        {justSaved && (
          <div
            style={{
              padding: "10px 14px",
              background: T.greenSoft,
              borderRadius: 6,
              fontSize: 12,
              color: T.green,
              marginBottom: 12,
              animation: "fadeUp 0.3s ease-out",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                verticalAlign: "middle",
                marginRight: 4,
              }}
            >
              <Icon.Check size={13} color={T.green} />
            </span>{" "}
            {t.feedbackSaved}
          </div>
        )}

        {/* Submit feedback button */}
        <button
          onClick={handleSubmitFeedback}
          disabled={!canSubmitFeedback || feedbackHook.isSubmitting}
          style={{
            width: "100%",
            padding: "12px",
            fontSize: 13,
            fontWeight: 600,
            color: canSubmitFeedback ? "white" : T.textFaint,
            background: canSubmitFeedback ? T.accent : T.bgElevated,
            border: "none",
            borderRadius: 8,
            marginBottom: 12,
            transition: "all 0.2s",
            opacity: canSubmitFeedback ? 1 : 0.5,
          }}
        >
          {feedbackHook.isSubmitting ? t.feedbackSaving : t.submitFeedback}
        </button>

        {/* Re-grade button */}
        <button
          onClick={onRegrade}
          disabled={pipeline.phase === "generating"}
          style={{
            width: "100%",
            padding: "12px",
            fontSize: 13,
            fontWeight: 600,
            color: T.accent,
            background: T.accentSoft,
            border: `1px solid ${T.accent}`,
            borderRadius: 10,
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <Icon.RefreshCw size={14} />
          {t.regrade}
        </button>
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: T.textFaint,
            textAlign: "center",
          }}
        >
          {t.regradeHint}
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════
   RESULT CARD — compact result for Step 5 tabs
   ═════════════════════════════════════════════════════════════════════ */
function ResultCard({ grade, t }) {
  if (!grade) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          color: T.textFaint,
          fontSize: 14,
        }}
      >
        {t.noResult}
      </div>
    );
  }

  return (
    <div style={{ animation: "fadeUp 0.3s ease-out" }}>
      {/* Overall */}
      <div
        style={{
          textAlign: "center",
          padding: "28px 20px",
          marginBottom: 20,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: T.textMute,
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            marginBottom: 6,
          }}
        >
          {t.overallScore}
        </div>
        <div
          style={{
            fontSize: 52,
            fontWeight: 700,
            color: T.accent,
            fontFamily: T.mono,
            lineHeight: 1,
          }}
        >
          {grade.overall || "—"}
          <span style={{ fontSize: 16, fontWeight: 400, color: T.textFaint }}>
            {" "}
            {t.outOf}
          </span>
        </div>
      </div>

      {/* Rubric */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 6,
          marginBottom: 20,
        }}
      >
        {[
          [t.rubricContent, grade.scores.content],
          [t.rubricArgument, grade.scores.argument],
          [t.rubricExpression, grade.scores.expression],
          [t.rubricCreativity, grade.scores.creativity],
        ].map(([label, val]) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "10px 14px",
              background: T.bgElevated,
              borderRadius: 6,
            }}
          >
            <span style={{ fontSize: 12, color: T.textMute }}>{label}</span>
            <span
              style={{
                fontSize: 16,
                fontWeight: 600,
                color: T.text,
                fontFamily: T.mono,
              }}
            >
              {val || "—"}
            </span>
          </div>
        ))}
      </div>

      {/* Comment */}
      {grade.comment && (
        <div
          style={{
            padding: 16,
            background: T.bgElevated,
            borderRadius: 8,
            borderLeft: `3px solid ${T.accent}`,
            fontSize: 13,
            color: T.textSoft,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          {grade.comment}
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════
   ESSAY WORKSPACE — one per essay, drives through steps
   ═════════════════════════════════════════════════════════════════════ */
function EssayWorkspace({ active, lang, onMeta }) {
  const t = i18n[lang];
  const pipeline = useAgentPipeline();
  const feedbackHook = useFeedback();

  const [task, setTask] = useState("");
  const [essayImage, setEssayImage] = useState(null);
  const [grade, setGrade] = useState(null);
  const [step, setStep] = useState(1); // 1=upload, 2=loading, 3=review, 4=regrade, 5=done
  const [regradeCount, setRegradeCount] = useState(0);

  // Parse grade when pipeline returns
  useEffect(() => {
    const g = parseGrade(pipeline.code);
    if (g) {
      setGrade(g);
      // After grading/re-grading → always return to review (step 3)
      if (step === 2 || step === 4) {
        setStep(3);
      }
    }
  }, [pipeline.code]);

  // Handle pipeline phase changes
  useEffect(() => {
    if (pipeline.phase === "generating") {
      if (step === 1) setStep(2);
      if (step === 3) setStep(4); // re-grade starts
    }
    if (pipeline.phase === "idle" && pipeline.error) {
      // Go back on error
      if (step === 2) setStep(1);
      if (step === 4) setStep(3);
    }
  }, [pipeline.phase, pipeline.error]);

  // Report tab metadata
  const label = useMemo(() => {
    const firstLine = task.trim().split("\n")[0] || "";
    return firstLine.slice(0, 30);
  }, [task]);

  useEffect(() => {
    onMeta({
      label,
      phase: pipeline.phase,
      step,
      hasGrade: step === 5,
    });
  }, [label, pipeline.phase, step]);

  const canRun =
    task.trim().length > 0 && !!essayImage && pipeline.phase !== "generating";

  const handleRun = useCallback(() => {
    feedbackHook.reset();
    pipeline.generate(task, lang, null, null, essayImage?.dataUrl || null);
  }, [task, lang, essayImage, pipeline, feedbackHook]);

  // Re-grade: sends previous AI output as wrong_code for the AI to self-correct
  const handleRegrade = useCallback(() => {
    feedbackHook.reset();
    setRegradeCount((c) => c + 1);
    pipeline.generate(
      task,
      lang,
      null,
      pipeline.code || null,
      essayImage?.dataUrl || null,
    );
  }, [task, lang, essayImage, pipeline, feedbackHook]);

  // Approve: teacher says the grade is correct → move to done
  const handleApprove = useCallback(() => {
    setStep(5);
  }, []);

  // Simplify steps: only show 3 steps to the user (Upload → Review → Done)
  // Steps 2 & 4 (loading) are transient — the indicator skips them visually.
  const displayStep =
    step === 1
      ? 1
      : step === 2
        ? 2
        : step === 3
          ? 3
          : step === 4
            ? 3 // re-grading shows as still in "Review" phase
            : 5;

  const stepLabels = [
    t.stepUpload,
    t.stepReading,
    t.stepReview,
    t.stepRegrade,
    t.stepDone,
  ];

  if (!active) return null;

  return (
    <div style={{ padding: "0 32px 40px" }}>
      {/* Step indicator */}
      <StepIndicator steps={stepLabels} currentStep={displayStep} />

      {/* Re-grade counter */}
      {regradeCount > 0 && (step === 3 || step === 4) && (
        <div
          style={{
            textAlign: "center",
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontFamily: T.mono,
              color: T.textFaint,
              padding: "4px 12px",
              background: T.bgCard,
              borderRadius: 20,
              border: `1px solid ${T.border}`,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                verticalAlign: "middle",
                marginRight: 4,
              }}
            >
              <Icon.RefreshCw size={11} color={T.textFaint} />
            </span>{" "}
            Re-grade #{regradeCount}
          </span>
        </div>
      )}

      {/* Error banner */}
      {pipeline.error && (
        <div
          style={{
            maxWidth: 640,
            margin: "0 auto 20px",
            padding: "12px 16px",
            background: T.redSoft,
            border: `1px solid ${T.red}`,
            borderRadius: 8,
            fontSize: 13,
            color: T.red,
            animation: "fadeUp 0.3s ease-out",
          }}
        >
          <span
            style={{
              display: "inline-flex",
              verticalAlign: "middle",
              marginRight: 4,
            }}
          >
            <Icon.AlertTriangle size={14} color={T.red} />
          </span>{" "}
          {t.pipelineError}: {pipeline.error}
        </div>
      )}

      {/* Step content */}
      {step === 1 && (
        <StepUpload
          task={task}
          setTask={setTask}
          essayImage={essayImage}
          setEssayImage={setEssayImage}
          onSubmit={handleRun}
          canSubmit={canRun}
          t={t}
        />
      )}

      {step === 2 && (
        <LoadingSpinner title={t.step2Title} description={t.step2Desc} />
      )}

      {step === 3 && (
        <StepReview
          grade={grade}
          pipeline={pipeline}
          feedbackHook={feedbackHook}
          onRegrade={handleRegrade}
          onApprove={handleApprove}
          task={task}
          t={t}
        />
      )}

      {step === 4 && (
        <LoadingSpinner title={t.step4Title} description={t.step4Desc} />
      )}

      {step === 5 && <ResultCard grade={grade} t={t} />}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════
   ROOT — HITLEditor default export
   ═════════════════════════════════════════════════════════════════════ */
export default function HITLEditor() {
  const [lang, setLang] = useState(
    () => localStorage.getItem("hitl_lang") || "en",
  );
  const t = i18n[lang];

  const [tabs, setTabs] = useState(() => [
    { id: makeTabId(), label: "", phase: "idle", step: 1, hasGrade: false },
  ]);
  const [activeId, setActiveId] = useState(() => null);

  useEffect(() => {
    if (!activeId && tabs.length > 0) setActiveId(tabs[0].id);
  }, [activeId, tabs]);

  // Keep backend alive
  useEffect(() => {
    const send = () =>
      fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
    send();
    const id = setInterval(send, 10000);
    return () => clearInterval(id);
  }, []);

  const toggleLang = () => {
    const next = lang === "en" ? "vi" : "en";
    setLang(next);
    localStorage.setItem("hitl_lang", next);
  };

  const addTab = () => {
    const id = makeTabId();
    setTabs((ts) => [
      ...ts,
      { id, label: "", phase: "idle", step: 1, hasGrade: false },
    ]);
    setActiveId(id);
  };

  const closeTab = (id) => {
    setTabs((ts) => {
      const idx = ts.findIndex((x) => x.id === id);
      const next = ts.filter((x) => x.id !== id);
      if (next.length === 0) {
        const fresh = {
          id: makeTabId(),
          label: "",
          phase: "idle",
          step: 1,
          hasGrade: false,
        };
        setTimeout(() => setActiveId(fresh.id), 0);
        return [fresh];
      }
      if (activeId === id) {
        setTimeout(
          () => setActiveId(next[Math.max(0, idx - 1)]?.id || next[0].id),
          0,
        );
      }
      return next;
    });
  };

  const clearAll = () => {
    const fresh = {
      id: makeTabId(),
      label: "",
      phase: "idle",
      step: 1,
      hasGrade: false,
    };
    setTabs([fresh]);
    setActiveId(fresh.id);
  };

  const updateTabMeta = useCallback((id, meta) => {
    setTabs((ts) => ts.map((x) => (x.id === id ? { ...x, ...meta } : x)));
  }, []);

  // Progress calculation
  const completedCount = tabs.filter((tab) => tab.hasGrade).length;

  return (
    <div style={{ minHeight: "100vh", background: T.bg }}>
      <GlobalStyles />

      {/* ─────── HEADER ─────── */}
      <header
        style={{
          padding: "20px 32px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: T.bg,
          position: "sticky",
          top: 0,
          zIndex: 100,
          backdropFilter: "blur(12px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: `linear-gradient(135deg, ${T.accent}, ${T.accentLight})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 700,
              color: "white",
            }}
          >
            M
          </div>
          <div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: T.text,
                letterSpacing: "-0.02em",
              }}
            >
              {t.title}
            </div>
            <div
              style={{
                fontSize: 11,
                color: T.textFaint,
                fontWeight: 400,
              }}
            >
              {t.subtitle}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={toggleLang}
            style={{
              background: "transparent",
              border: `1px solid ${T.border}`,
              color: T.textSoft,
              padding: "6px 14px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.target.style.borderColor = T.accent;
              e.target.style.color = T.accent;
            }}
            onMouseLeave={(e) => {
              e.target.style.borderColor = T.border;
              e.target.style.color = T.textSoft;
            }}
          >
            <span
              style={{
                display: "inline-flex",
                verticalAlign: "middle",
                marginRight: 4,
              }}
            >
              <Icon.Languages size={13} />
            </span>
            {t.langSwitch}
          </button>
        </div>
      </header>

      {/* ─────── TAB BAR + PROGRESS ─────── */}
      <div
        style={{
          padding: "12px 32px",
          borderBottom: `1px solid ${T.border}`,
          background: T.bgCard,
        }}
      >
        {/* Progress bar */}
        <ProgressBar
          completed={completedCount}
          total={tabs.length}
          label={t.progress}
        />

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {tabs.map((tab, i) => {
            const isActive = tab.id === activeId;
            const statusColor =
              tab.phase === "generating"
                ? T.amber
                : tab.hasGrade
                  ? T.green
                  : T.textFaint;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveId(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  background: isActive ? T.bgElevated : "transparent",
                  border: isActive
                    ? `1px solid ${T.borderLight}`
                    : "1px solid transparent",
                  borderRadius: 8,
                  color: isActive ? T.text : T.textMute,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                  transition: "all 0.2s",
                  whiteSpace: "nowrap",
                  position: "relative",
                }}
              >
                {/* Status dot */}
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: statusColor,
                    flexShrink: 0,
                    animation:
                      tab.phase === "generating"
                        ? "pulse 1.4s infinite"
                        : undefined,
                  }}
                />
                <span>{tab.label || `${t.essayN} ${i + 1}`}</span>
                {tabs.length > 1 && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    style={{
                      width: 16,
                      height: 16,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 4,
                      fontSize: 12,
                      color: T.textFaint,
                      opacity: isActive ? 0.7 : 0,
                      transition: "opacity 0.2s",
                    }}
                  >
                    ×
                  </span>
                )}
              </button>
            );
          })}

          <button
            onClick={addTab}
            style={{
              padding: "8px 14px",
              background: "transparent",
              border: `1px dashed ${T.border}`,
              borderRadius: 8,
              color: T.textFaint,
              fontSize: 12,
              fontWeight: 500,
              transition: "all 0.2s",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => {
              e.target.style.borderColor = T.accent;
              e.target.style.color = T.accent;
            }}
            onMouseLeave={(e) => {
              e.target.style.borderColor = T.border;
              e.target.style.color = T.textFaint;
            }}
          >
            {t.newEssay}
          </button>

          <div style={{ flex: 1 }} />

          <button
            onClick={clearAll}
            style={{
              background: "transparent",
              border: "none",
              color: T.textFaint,
              fontSize: 11,
              fontWeight: 400,
              textDecoration: "underline",
              textUnderlineOffset: 3,
              textDecorationColor: T.border,
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) => {
              e.target.style.color = T.red;
            }}
            onMouseLeave={(e) => {
              e.target.style.color = T.textFaint;
            }}
          >
            {t.reset}
          </button>
        </div>
      </div>

      {/* ─────── WORKSPACES ─────── */}
      <main style={{ paddingTop: 12 }}>
        {tabs.map((tab) => (
          <EssayWorkspace
            key={tab.id}
            active={tab.id === activeId}
            lang={lang}
            onMeta={(meta) => updateTabMeta(tab.id, meta)}
          />
        ))}
      </main>

      {/* ─────── FOOTER ─────── */}
      <footer
        style={{
          padding: "20px 32px",
          borderTop: `1px solid ${T.border}`,
          textAlign: "center",
          fontSize: 11,
          color: T.textFaint,
          fontFamily: T.mono,
        }}
      >
        MIRROR · AI Essay Grading Agent
      </footer>
    </div>
  );
}
