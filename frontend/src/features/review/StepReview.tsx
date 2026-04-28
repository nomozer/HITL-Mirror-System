import { useState, useCallback, useMemo, useEffect } from "react";
import { T } from "../../theme/tokens";
import { Icon } from "../../components/ui/Icon";
import { formatTranscript } from "../../lib/mathFormat";
import { analyzeComment } from "../../api";
import type {
  BackendSubject,
  CommentThreads,
  CommentVerdict,
  EssayFile,
  Grade,
  I18nStrings,
  StagedLesson,
  Subject,
  ThreadMessage,
} from "../../types";
import type { UseAgentPipelineResult } from "../../hooks/useAgentPipeline";
import type { UseFeedbackResult } from "../../hooks/useFeedback";

function parseMarkdown(md: string): string {
  if (!md) return "";
  const html = md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^[-•]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/gs, (m) => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br/>");
  return `<p>${html}</p>`;
}

interface QuestionPart {
  idx: number;
  label: string;
  num: number | null;
  body: string;
}

// ---------------------------------------------------------------------------
// Parse a flat string into per-question blocks.
// Convention: "Câu 1: …\nCâu 2: …" or "Question 1: …"
// ---------------------------------------------------------------------------
function parseIntoQuestions(source: string | null | undefined): QuestionPart[] {
  if (typeof source !== "string" || !source.trim()) return [];
  const regex = /(?=(?:Câu|Question|Câu hỏi)\s*\d+\s*[:：])/i;
  const parts = source.split(regex).filter((p) => p.trim());
  if (parts.length <= 1) {
    return [{ idx: 0, label: "", num: null, body: source.trim() }];
  }
  return parts.map((part, i) => {
    const match = part.match(/^((?:Câu|Question|Câu hỏi)\s*(\d+)\s*[:：])\s*/i);
    const label = match ? match[1] : `#${i + 1}`;
    const num = match ? parseInt(match[2], 10) : null;
    const body = match ? part.slice(match[0].length).trim() : part.trim();
    return { idx: i, label, num, body };
  });
}

function normalizeAiAnalysisText(
  value: string | null | undefined,
  t: I18nStrings,
): string {
  const trimmed = String(value || "").trim();
  const fallback = String(
    t.aiAnalyzeFallback ?? "AI chưa phân tích được nhận xét này. Vui lòng thử lại.",
  );
  if (!trimmed) return fallback;
  // Reject obvious broken JSON fragments such as `{`, `"`, `{ "`.
  if (/^[\s{}[\]",:]+$/.test(trimmed)) return fallback;
  return trimmed;
}

function clipText(value: string | null | undefined, maxLen: number): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

interface QuestionPair {
  num: number;
  student: QuestionPart;
  ai: QuestionPart;
}

function buildAnalyzeQuestionContext(
  task: string | null | undefined,
  pair: QuestionPair | undefined,
): string {
  const parts: string[] = [];
  const taskLine = clipText(task, 180);
  const questionLabel = clipText(
    pair?.student?.label || pair?.ai?.label || "",
    60,
  );
  const aiSummary = clipText(pair?.ai?.body, 500);

  if (taskLine) parts.push(`Bối cảnh bài: ${taskLine}`);
  if (questionLabel) parts.push(`Câu đang xét: ${questionLabel}`);
  if (aiSummary) parts.push(`Nhận xét AI hiện tại: ${aiSummary}`);

  return parts.join("\n");
}

/**
 * Find the most recent AI lesson the teacher hasn't actively rejected.
 *
 * Verdict gating:
 *   - "agree" / "partial":  always stageable
 *   - "dispute":            only stageable when teacher explicitly chose
 *                           ``disputeDecision === "apply"``. This is the
 *                           anti-poison guard — AI flagged the teacher
 *                           comment as wrong, so we won't write a lesson
 *                           into HITL memory unless the teacher overrides.
 */
function getStageableLesson(messages: ThreadMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.type !== "ai") continue;
    const lesson = String(message.lesson || "").trim();
    if (!lesson) continue;
    if (message.verdict === "dispute" && message.disputeDecision !== "apply") {
      return "";
    }
    return lesson;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Align transcript parts with AI comment parts BY QUESTION NUMBER.
// ---------------------------------------------------------------------------
function alignByQuestionNumber(
  studentParts: QuestionPart[],
  commentParts: QuestionPart[],
): QuestionPair[] {
  const studentNumbered =
    studentParts.length > 0 && studentParts.every((p) => p.num !== null);
  const commentNumbered =
    commentParts.length > 0 && commentParts.every((p) => p.num !== null);

  if (!studentNumbered || !commentNumbered) {
    const count = Math.max(studentParts.length, commentParts.length, 1);
    return Array.from({ length: count }, (_, i) => ({
      num: i + 1,
      student: studentParts[i] || { idx: i, label: "", num: null, body: "" },
      ai: commentParts[i] || { idx: i, label: "", num: null, body: "" },
    }));
  }

  const byNum = (parts: QuestionPart[]) => {
    const map = new Map<number, QuestionPart>();
    for (const p of parts) if (p.num !== null && !map.has(p.num)) map.set(p.num, p);
    return map;
  };
  const studentMap = byNum(studentParts);
  const commentMap = byNum(commentParts);
  const nums = Array.from(
    new Set([...studentMap.keys(), ...commentMap.keys()]),
  ).sort((a, b) => a - b);

  return nums.map((num) => ({
    num,
    student: studentMap.get(num) || {
      idx: num - 1,
      label: `Câu ${num}`,
      num,
      body: "",
    },
    ai: commentMap.get(num) || {
      idx: num - 1,
      label: `Câu ${num}`,
      num,
      body: "",
    },
  }));
}

// ---------------------------------------------------------------------------
// Word-style Comment Thread
// ---------------------------------------------------------------------------
interface CommentThreadProps {
  comments: ThreadMessage[];
  onSend: (text: string) => void;
  /** Fires when teacher decides on a disputed AI lesson. */
  onDisputeDecide: (msgIdx: number, decision: "apply" | "skip") => void;
  isLoading: boolean;
  t: I18nStrings;
}

/** Color/icon styling per AI verdict — kept in one place so dispute UI
 *  stays consistent across bubble + badge + decision panel. */
function verdictStyle(verdict: CommentVerdict | undefined) {
  if (verdict === "dispute") {
    return { bg: T.redSoft, accent: T.red, label: "AI" };
  }
  if (verdict === "partial") {
    return { bg: T.amberSoft, accent: T.amber, label: "AI" };
  }
  return { bg: T.accentSoft, accent: T.accent, label: "AI" };
}

function CommentThread({
  comments,
  onSend,
  onDisputeDecide,
  isLoading,
  t,
}: CommentThreadProps) {
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = !!input.trim() && !isLoading;

  return (
    <div style={{ marginTop: 6 }}>
      {comments.length > 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginBottom: 8,
            maxHeight: 320,
            overflowY: "auto",
            paddingRight: 4,
          }}
        >
          {comments.map((c, i) => {
            const isTeacher = c.type === "teacher";
            const vstyle = isTeacher
              ? { bg: T.amberSoft, accent: T.amber, label: "GV" }
              : verdictStyle(c.verdict);
            const isDispute = !isTeacher && c.verdict === "dispute";
            const isPartial = !isTeacher && c.verdict === "partial";
            const skipped = isDispute && c.disputeDecision === "skip";

            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    padding: "8px 10px",
                    background: vstyle.bg,
                    borderLeft: `3px solid ${vstyle.accent}`,
                    borderRadius: "0 8px 8px 0",
                    opacity: skipped ? 0.55 : 1,
                  }}
                >
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: vstyle.accent,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      color: "#fff",
                      fontWeight: 700,
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  >
                    {vstyle.label}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {(isDispute || isPartial) && (
                      <div
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 11,
                          fontWeight: 700,
                          color: vstyle.accent,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          marginBottom: 4,
                        }}
                      >
                        <Icon.AlertTriangle size={11} color={vstyle.accent} />
                        {isDispute
                          ? String(t.verdictDisputeTitle ?? "AI không đồng tình")
                          : String(t.verdictPartialBadge ?? "AI đồng tình một phần")}
                      </div>
                    )}
                    <div
                      style={{
                        fontSize: 13,
                        color: T.textSoft,
                        lineHeight: 1.55,
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {c.text}
                    </div>
                  </div>
                </div>

                {isDispute && c.disputeDecision === undefined && (
                  <div
                    style={{
                      marginLeft: 30,
                      padding: "8px 10px",
                      background: T.bgCard,
                      border: `1px dashed ${T.red}`,
                      borderRadius: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ fontSize: 12, color: T.textSoft }}>
                      {String(
                        t.verdictDisputeHint ??
                          "AI cho rằng nhận xét này có thể không khớp bài làm thực tế. Đọc kỹ phân tích trên rồi chọn:",
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => onDisputeDecide(i, "skip")}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          background: T.bgElevated,
                          color: T.textSoft,
                          border: `1px solid ${T.border}`,
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {String(
                          t.verdictDisputeSkip ?? "Bỏ qua, không lưu bài học",
                        )}
                      </button>
                      <button
                        onClick={() => onDisputeDecide(i, "apply")}
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          background: T.red,
                          color: "#fff",
                          border: "none",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {String(
                          t.verdictDisputeApply ?? "Vẫn áp dụng nhận xét",
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {isDispute && c.disputeDecision === "apply" && (
                  <div
                    style={{
                      marginLeft: 30,
                      fontSize: 11,
                      color: T.red,
                      fontStyle: "italic",
                    }}
                  >
                    <Icon.Check size={10} color={T.red} />{" "}
                    {String(
                      t.verdictDisputeApplied ??
                        "Đã chọn áp dụng — bài học sẽ lưu khi duyệt.",
                    )}
                  </div>
                )}
                {isDispute && c.disputeDecision === "skip" && (
                  <div
                    style={{
                      marginLeft: 30,
                      fontSize: 11,
                      color: T.textFaint,
                      fontStyle: "italic",
                    }}
                  >
                    {String(
                      t.verdictDisputeSkipped ??
                        "Đã bỏ qua — bài học KHÔNG lưu vào bộ nhớ.",
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isLoading && (
        <div
          style={{
            padding: "5px 10px",
            fontSize: 12,
            color: T.textFaint,
            fontStyle: "italic",
            marginBottom: 6,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon.RefreshCw size={11} color={T.textFaint} />
          {String(t.aiAnalyzing ?? "AI đang phân tích...")}
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={String(
            t.teacherNotePlaceholder ?? "Nhập nhận xét cho câu này…",
          )}
          rows={1}
          style={{
            flex: 1,
            background: T.bgInput,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            padding: "7px 10px",
            fontSize: 13,
            color: T.text,
            lineHeight: 1.4,
            resize: "none",
            outline: "none",
            fontFamily: T.font,
            boxSizing: "border-box",
            minHeight: 34,
          }}
          onFocus={(e) => (e.target.style.borderColor = T.accent)}
          onBlur={(e) => (e.target.style.borderColor = T.border)}
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          style={{
            padding: "6px 14px",
            background: canSend ? T.accent : T.bgElevated,
            color: canSend ? "#fff" : T.textFaint,
            border: "none",
            borderRadius: 8,
            cursor: canSend ? "pointer" : "not-allowed",
            fontSize: 13,
            fontWeight: 600,
            height: 34,
            display: "flex",
            alignItems: "center",
            gap: 4,
            transition: "all 0.15s",
          }}
        >
          <Icon.MessageCircle
            size={12}
            color={canSend ? "#fff" : T.textFaint}
          />
          {String(t.sendComment ?? "Gửi")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// QuestionBox
// ---------------------------------------------------------------------------
interface QuestionBoxProps {
  studentAnswer: QuestionPart;
  aiComment: QuestionPart;
  questionIdx: number;
  comments: ThreadMessage[];
  onSendComment: (text: string) => void;
  onDisputeDecide: (msgIdx: number, decision: "apply" | "skip") => void;
  isAnalyzing: boolean;
  t: I18nStrings;
  subject: Subject | string;
  /**
   * Whether the parent grade envelope was flagged as salvaged. Gates the
   * empty-AI-comment placeholder: when salvaged, the absence of a comment
   * means Gemini stopped early — show an amber warning instead of the green
   * "no issues" badge that would falsely imply approval.
   */
  isSalvaged: boolean;
}

function QuestionBox({
  studentAnswer,
  aiComment,
  questionIdx,
  comments,
  onSendComment,
  onDisputeDecide,
  isAnalyzing,
  t,
  subject,
  isSalvaged,
}: QuestionBoxProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 0,
        marginBottom: 16,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: T.shadowSoft,
        background: T.bgCard,
      }}
    >
      {/* Left: Student Answer */}
      <div
        style={{
          borderRight: `1px solid ${T.border}`,
          padding: "18px 20px",
          background: T.paper,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: T.accentSoft,
                border: `1.5px solid ${T.accent}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                fontWeight: 700,
                color: T.accent,
                fontFamily: T.mono,
              }}
            >
              {questionIdx + 1}
            </div>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: T.accent,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {studentAnswer.label || `Câu ${questionIdx + 1}`}
            </span>
          </div>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: T.textFaint,
              padding: 2,
              display: "flex",
              alignItems: "center",
            }}
          >
            {expanded ? (
              <Icon.ArrowDown size={14} color={T.textFaint} />
            ) : (
              <Icon.ChevronRight size={14} color={T.textFaint} />
            )}
          </button>
        </div>

        {expanded && (
          <div
            style={{
              fontSize: 14.5,
              color: T.textSoft,
              lineHeight: 1.7,
              fontFamily: T.mono,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              tabSize: 4,
            }}
          >
            {formatTranscript(studentAnswer.body, subject)}
          </div>
        )}
      </div>

      {/* Right: AI Comment + Teacher Comments */}
      <div
        style={{
          padding: "18px 20px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 8,
          }}
        >
          <Icon.MessageCircle size={13} color={T.accentLight} />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: T.accentLight,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
            }}
          >
            {String(t.aiComment ?? "Nhận xét AI")}
          </span>
        </div>

        {aiComment.body ? (
          <div
            className="md-prose"
            dangerouslySetInnerHTML={{ __html: parseMarkdown(aiComment.body) }}
            style={{
              fontSize: 14,
              color: T.textSoft,
              lineHeight: 1.6,
              padding: "8px 12px",
              background: T.accentSoft,
              borderLeft: `3px solid ${T.accentLight}`,
              borderRadius: "0 8px 8px 0",
              marginBottom: 10,
            }}
          />
        ) : isSalvaged ? (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: T.amberSoft,
              borderLeft: `3px solid ${T.amber}`,
              fontSize: 14,
              color: T.textSoft,
              lineHeight: 1.5,
              marginBottom: 10,
            }}
          >
            <Icon.AlertTriangle
              size={12}
              color={T.amber}
              style={{ marginRight: 6, verticalAlign: "middle" }}
            />
            {String(
              t.noCommentSalvaged ??
                "Phản hồi cho câu này bị cắt — hãy đối chiếu bài làm hoặc chấm lại.",
            )}
          </div>
        ) : (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              background: T.greenSoft,
              borderLeft: `3px solid ${T.green}`,
              fontSize: 14,
              color: T.textSoft,
              lineHeight: 1.5,
              marginBottom: 10,
            }}
          >
            <Icon.Check
              size={12}
              color={T.green}
              style={{ marginRight: 6, verticalAlign: "middle" }}
            />
            {String(t.noIssues ?? "Không có vấn đề cần báo cáo.")}
          </div>
        )}

        <div style={{ marginTop: "auto" }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: T.textMute,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 6,
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <Icon.Edit size={11} color={T.textFaint} />
            {String(t.teacherNote ?? "Nhận xét giáo viên")}
          </div>
          <CommentThread
            comments={comments}
            onSend={onSendComment}
            onDisputeDecide={onDisputeDecide}
            isLoading={isAnalyzing}
            t={t}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// OriginalImageModal
// ---------------------------------------------------------------------------
interface OriginalImageModalProps {
  src: string | null;
  isPdf: boolean;
  onClose: () => void;
  t: I18nStrings;
}

function OriginalImageModal({ src, isPdf, onClose, t }: OriginalImageModalProps) {
  if (!src) return null;
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.78)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        animation: "fadeUp 0.2s ease-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          width: isPdf ? "92vw" : "auto",
          height: isPdf ? "92vh" : "auto",
          maxWidth: "92vw",
          maxHeight: "92vh",
          background: T.paper,
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "rgba(0,0,0,0.55)",
            border: "none",
            color: "#fff",
            cursor: "pointer",
            fontSize: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1,
          }}
          title={String(t.close ?? "Đóng")}
        >
          ×
        </button>
        {isPdf ? (
          <object
            data={src}
            type="application/pdf"
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              background: "#fff",
            }}
          >
            <iframe
              src={src}
              title={String(t.originalImage ?? "Bài làm gốc của học sinh")}
              loading="eager"
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                border: "none",
                background: "#fff",
              }}
            />
          </object>
        ) : (
          <img
            src={src}
            alt={String(t.originalImage ?? "Bài làm gốc của học sinh")}
            decoding="async"
            loading="eager"
            style={{
              display: "block",
              maxWidth: "92vw",
              maxHeight: "92vh",
              objectFit: "contain",
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main StepReview
// ---------------------------------------------------------------------------
interface StepReviewProps {
  grade: Grade | null;
  pipeline: UseAgentPipelineResult;
  feedbackHook: UseFeedbackResult;
  onApprove: () => void;
  backendSubject: BackendSubject | null;
  task: string;
  t: I18nStrings;
  essayImage: EssayFile | null;
}

export function StepReview({
  grade,
  pipeline,
  feedbackHook,
  onApprove,
  backendSubject,
  task,
  t,
  essayImage,
}: StepReviewProps) {
  const [commentThreads, setCommentThreads] = useState<CommentThreads>({});
  const [analyzingQ, setAnalyzingQ] = useState<number | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [essayBlobUrl, setEssayBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const src = essayImage?.dataUrl;
    if (!src) {
      setEssayBlobUrl(null);
      return undefined;
    }
    const match = /^data:([^;]+);base64,(.+)$/.exec(src);
    if (!match) {
      setEssayBlobUrl(src);
      return undefined;
    }
    let url: string | null = null;
    try {
      const binary = atob(match[2]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      url = URL.createObjectURL(new Blob([bytes], { type: match[1] }));
      setEssayBlobUrl(url);
    } catch {
      setEssayBlobUrl(src);
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [essayImage?.dataUrl]);

  // IMPORTANT: hooks must be called before any conditional return. These
  // `useMemo`s used to live AFTER the `if (!grade) return null` check, which
  // was a legacy JS pattern TS/React would flag as a rule-of-hooks violation
  // once the component becomes typed.
  const studentParts = useMemo(
    () => parseIntoQuestions(grade?.transcript),
    [grade?.transcript],
  );
  const commentParts = useMemo(
    () => parseIntoQuestions(grade?.comment),
    [grade?.comment],
  );
  const questionPairs = useMemo(
    () => alignByQuestionNumber(studentParts, commentParts),
    [studentParts, commentParts],
  );

  const handleSendComment = useCallback(
    async (qIdx: number, text: string) => {
      setCommentThreads((prev) => ({
        ...prev,
        [qIdx]: [...(prev[qIdx] || []), { type: "teacher", text }],
      }));

      setAnalyzingQ(qIdx);
      try {
        const pair = questionPairs[qIdx];
        const data = await analyzeComment({
          question: buildAnalyzeQuestionContext(task, pair),
          student_answer: (pair?.student?.body || "").slice(0, 2000),
          teacher_comment: text,
        });
        setCommentThreads((prev) => ({
          ...prev,
          [qIdx]: [
            ...(prev[qIdx] || []),
            {
              type: "ai",
              text: normalizeAiAnalysisText(data.analysis, t),
              lesson: (data.lesson || "").trim(),
              verdict: data.verdict,
            },
          ],
        }));
      } catch (err) {
        console.error("Comment analysis failed:", err);
      }
      setAnalyzingQ(null);
    },
    [task, questionPairs, t],
  );

  /**
   * Teacher decides whether to apply or skip a disputed AI lesson.
   * Mutates the message in-place by index — the dispute UI only renders
   * decision buttons when ``disputeDecision`` is undefined, so subsequent
   * clicks are inert.
   */
  const handleDisputeDecide = useCallback(
    (qIdx: number, msgIdx: number, decision: "apply" | "skip") => {
      setCommentThreads((prev) => {
        const msgs = prev[qIdx];
        if (!msgs || !msgs[msgIdx]) return prev;
        const next = msgs.slice();
        next[msgIdx] = { ...next[msgIdx], disputeDecision: decision };
        return { ...prev, [qIdx]: next };
      });
    },
    [],
  );

  if (!grade) return null;

  const questionCount = questionPairs.length;

  const weaknesses = Array.isArray(grade.weaknesses) ? grade.weaknesses : [];
  const isSalvaged =
    Boolean(grade.salvaged) ||
    weaknesses.some(
      (w) => typeof w === "string" && w.toLowerCase().includes("unparseable"),
    );

  // ``subject`` is still threaded into QuestionBox for math-aware transcript
  // formatting (formatTranscript). The user-facing badge that used to show
  // subjectName has been removed — Sidebar already displays the subject
  // selection, and grade.subject is hard-stamped to "stem" so the badge was
  // surfacing the wrong label anyway.
  const subject: Subject | string = grade.subject || "literature";

  const refForIdx = (idx: number | string) =>
    questionPairs[Number(idx)]?.num ?? Number(idx) + 1;

  const stagedLessons: StagedLesson[] = Object.entries(commentThreads).flatMap(
    ([idx, msgs]) => {
      // getStageableLesson returns "" for disputed lessons that the
      // teacher hasn't explicitly applied — that's the anti-poison guard.
      const lessonText = getStageableLesson(msgs);
      if (!lessonText) return [];
      return [
        {
          lesson_text: lessonText,
          question_ref: `Câu ${refForIdx(idx)}`,
        },
      ];
    },
  );

  const aggregatedNote = Object.entries(commentThreads)
    .flatMap(([idx, msgs]) =>
      msgs
        .filter((m) => m.type === "teacher")
        .map((m) => `[Câu ${refForIdx(idx)}] ${m.text}`),
    )
    .join("\n");

  const handleApproveClick = async () => {
    if (feedbackHook.isSubmitting || pipeline.phase === "generating") return;
    const res = await feedbackHook.submit({
      action: "approve",
      comment: aggregatedNote || "",
      stagedLessons,
      task: task || "",
      wrongCode: pipeline.code || "",
      runId: pipeline.runId,
      subject: backendSubject,
    });
    if (res && onApprove) onApprove();
  };

  const canApprove =
    !feedbackHook.isSubmitting && pipeline.phase !== "generating";

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        animation: "fadeUp 0.4s ease-out",
      }}
    >
      {/* Top toolbar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          minHeight: 28,
        }}
      >
        {/* Left side intentionally empty — both meta-controls (lightbulb +
            view-original) cluster on the right per design 2026-04-26. The
            empty div keeps justifyContent: "space-between" pushing the
            right cluster to the edge without restructuring the flex parent. */}
        <div />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {stagedLessons.length > 0 && (
            // Lightbulb-with-counter: ``key`` set to the count so React
            // remounts the wrapper on every increment, replaying the
            // ``lessonPop`` keyframe — gives the teacher a quick visual
            // cue that a new lesson was just staged from their last comment.
            <span
              key={stagedLessons.length}
              title={`${stagedLessons.length} ${
                t.lessonsStaged ?? "bài học chờ lưu khi duyệt"
              }`}
              aria-label={`${stagedLessons.length} ${
                t.lessonsStaged ?? "bài học chờ lưu khi duyệt"
              }`}
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                animation: "lessonPop 0.32s ease-out",
              }}
            >
              <Icon.Lightbulb size={20} color={T.amber} />
              <span
                style={{
                  position: "absolute",
                  top: -4,
                  right: -6,
                  minWidth: 16,
                  height: 16,
                  padding: "0 4px",
                  borderRadius: 8,
                  background: T.amber,
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 700,
                  fontFamily: T.mono,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: 1,
                  boxShadow: T.shadowSoft,
                }}
              >
                {stagedLessons.length}
              </span>
            </span>
          )}
          {essayImage?.dataUrl && (
            <button
              onClick={() => setShowOriginal(true)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                fontFamily: T.mono,
                color: T.textSoft,
                padding: "4px 12px",
                background: T.bgCard,
                borderRadius: 20,
                border: `1px solid ${T.border}`,
                cursor: "pointer",
                transition: "all 0.15s",
                letterSpacing: "0.04em",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = T.accent;
                e.currentTarget.style.color = T.accent;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = T.border;
                e.currentTarget.style.color = T.textSoft;
              }}
              title={String(
                t.originalImageHint ??
                  "Mở bài làm gốc để đối chiếu với phần AI đã chép",
              )}
            >
              <Icon.FileText size={11} />
              {essayImage?.isPdf
                ? String(t.viewOriginalPdf ?? "Xem PDF gốc")
                : String(t.viewOriginal ?? "Xem ảnh gốc")}
            </button>
          )}
        </div>
      </div>

      {showOriginal && (
        <OriginalImageModal
          src={essayBlobUrl}
          isPdf={!!essayImage?.isPdf}
          onClose={() => setShowOriginal(false)}
          t={t}
        />
      )}

      {isSalvaged && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 12,
            background: T.amberSoft,
            borderLeft: `4px solid ${T.amber}`,
            borderRadius: 8,
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            fontSize: 13,
            color: T.textSoft,
            lineHeight: 1.55,
          }}
        >
          <Icon.AlertTriangle
            size={14}
            color={T.amber}
            style={{ marginTop: 2, flexShrink: 0 }}
          />
          <div>
            <div style={{ fontWeight: 700, color: T.amber, marginBottom: 2 }}>
              {String(t.salvagedTitle ?? "Kết quả chấm chưa đầy đủ")}
            </div>
            {String(
              t.salvagedBody ??
                "Mô hình đã trả về JSON không hợp lệ — nội dung bên dưới được trích xuất từng phần. Hãy kiểm tra kỹ trước khi duyệt, hoặc chấm lại bài.",
            )}
          </div>
        </div>
      )}

      {/* Column Headers */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          marginBottom: 8,
          padding: "0 4px",
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: T.textFaint,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {String(t.studentAnswer ?? "Câu trả lời học sinh")}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: T.textFaint,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          {String(t.aiComment ?? "Nhận xét & Ghi chú")}
        </span>
      </div>

      {/* Per-Question Boxes */}
      {questionCount === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 40,
            color: T.textFaint,
            fontSize: 15,
            fontStyle: "italic",
            background: T.bgCard,
            borderRadius: 12,
            border: `1px solid ${T.border}`,
          }}
        >
          {String(t.noContent ?? "Không có nội dung để hiển thị.")}
        </div>
      ) : (
        questionPairs.map((pair, i) => (
          <QuestionBox
            key={pair.num}
            studentAnswer={
              pair.student.body || pair.student.label
                ? pair.student
                : { idx: i, label: `Câu ${pair.num}`, num: pair.num, body: "" }
            }
            aiComment={pair.ai}
            questionIdx={i}
            comments={commentThreads[i] || []}
            onSendComment={(text) => handleSendComment(i, text)}
            onDisputeDecide={(msgIdx, decision) =>
              handleDisputeDecide(i, msgIdx, decision)
            }
            isAnalyzing={analyzingQ === i}
            t={t}
            subject={subject}
            isSalvaged={isSalvaged}
          />
        ))
      )}

      {/* Approve Button */}
      <div
        style={{
          marginTop: 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
        }}
      >
        {feedbackHook.error && (
          <div
            style={{
              padding: "8px 12px",
              background: T.redSoft,
              borderRadius: 6,
              fontSize: 14,
              color: T.red,
              width: "100%",
              maxWidth: 480,
              textAlign: "center",
            }}
          >
            <Icon.AlertTriangle
              size={12}
              color={T.red}
              style={{ marginRight: 4 }}
            />
            {feedbackHook.error}
          </div>
        )}
        <button
          onClick={handleApproveClick}
          disabled={!canApprove}
          style={{
            padding: "14px 56px",
            fontSize: 16,
            color: canApprove ? "#fff" : T.textFaint,
            background: canApprove ? T.green : T.bgElevated,
            border: "none",
            borderRadius: 10,
            cursor: canApprove ? "pointer" : "not-allowed",
            transition: "all 0.2s",
            display: "flex",
            alignItems: "center",
            gap: 8,
            opacity: canApprove ? 1 : 0.5,
            fontWeight: 600,
            boxShadow: canApprove ? T.shadowSoft : "none",
          }}
        >
          <Icon.Check size={16} color={canApprove ? "#fff" : T.textFaint} />
          {feedbackHook.isSubmitting
            ? String(t.feedbackSaving ?? "Đang lưu...")
            : String(t.approveAndFinish ?? "Duyệt & Hoàn Thành")}
        </button>
      </div>
    </div>
  );
}
