import { useState, useCallback, useMemo } from "react";
import { T } from "../../theme/tokens";
import { Icon } from "../../components/ui/Icon";
import { OriginalImageModal } from "../../components/ui/OriginalImageModal";
import { formatTranscript } from "../../lib/mathFormat";
import {
  buildSyntheticAnnotations,
  parseCauHeader,
  splitTranscriptByCau,
} from "../../lib/grade";
import { getStageableLesson } from "../../lib/hitl";
import { analyzeComment } from "../../api";
import { useIsMobile } from "../../hooks/useIsMobile";
import type {
  BackendSubject,
  CommentThreads,
  CommentVerdict,
  EssayFile,
  Grade,
  I18nStrings,
  Lesson,
  PerQuestionFeedback,
  StagedLesson,
  Subject,
  ThreadMessage,
} from "../../types";
import type { UseAgentPipelineResult } from "../../hooks/useAgentPipeline";
import type { UseFeedbackResult } from "../../hooks/useFeedback";

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

function normalizeAiAnalysisText(value: string | null | undefined, t: I18nStrings): string {
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
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
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
  const questionLabel = clipText(pair?.student?.label || pair?.ai?.label || "", 60);
  const aiSummary = clipText(pair?.ai?.body, 500);

  if (taskLine) parts.push(`Bối cảnh bài: ${taskLine}`);
  if (questionLabel) parts.push(`Câu đang xét: ${questionLabel}`);
  if (aiSummary) parts.push(`Nhận xét AI hiện tại: ${aiSummary}`);

  return parts.join("\n");
}

// getStageableLesson lifted to lib/hitl.ts so step 4 (RegradeMockup) can
// reuse the anti-poison gating when staging chat lessons on "Hoàn tất bài
// này".

// ---------------------------------------------------------------------------
// Align transcript parts with AI comment parts BY QUESTION NUMBER.
// ---------------------------------------------------------------------------
function alignByQuestionNumber(
  studentParts: QuestionPart[],
  commentParts: QuestionPart[],
): QuestionPair[] {
  const studentNumbered = studentParts.length > 0 && studentParts.every((p) => p.num !== null);
  const commentNumbered = commentParts.length > 0 && commentParts.every((p) => p.num !== null);

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
  const nums = Array.from(new Set([...studentMap.keys(), ...commentMap.keys()])).sort(
    (a, b) => a - b,
  );

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

function CommentThread({ comments, onSend, onDisputeDecide, isLoading, t }: CommentThreadProps) {
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
                        {String(t.verdictDisputeSkip ?? "Bỏ qua, không lưu bài học")}
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
                        {String(t.verdictDisputeApply ?? "Vẫn áp dụng nhận xét")}
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
                      t.verdictDisputeApplied ?? "Đã chọn áp dụng — bài học sẽ lưu khi duyệt.",
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
                    {String(t.verdictDisputeSkipped ?? "Đã bỏ qua — bài học KHÔNG lưu vào bộ nhớ.")}
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
          placeholder={String(t.teacherNotePlaceholder ?? "Nhập nhận xét cho câu này…")}
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
          <Icon.MessageCircle size={12} color={canSend ? "#fff" : T.textFaint} />
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
  stacked: boolean;
  /**
   * Structured per-question feedback from ``grade.per_question_feedback``.
   * The AI emits ``good_points`` (✓ điểm tốt) and ``errors`` (× cần sửa)
   * as separate prose fields — we split each on newlines / bullets so the
   * review renders them as Word-style annotation lines below the student
   * work, like a printed teacher's mark-up. Falls back to the overall
   * ``aiComment.body`` when both are empty (legacy responses without
   * structured feedback).
   */
  feedback?: PerQuestionFeedback;
}

// Split a chunk of prose into individual annotation lines. Handles the
// most common shapes the prompt emits: explicit newlines, dashes/bullets,
// numbered lists, semicolons. Strips list-marker prefixes so the rendered
// row can prepend its own ✓ / × glyph without duplicate symbols.
function splitAnnotationLines(text: string | null | undefined): string[] {
  const raw = String(text || "").trim();
  if (!raw) return [];
  // First split on newlines, then on " · " or "; " when single-line. This
  // covers both the "one bullet per line" and "comma-separated note"
  // styles that show up in Gemini outputs.
  let parts = raw.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length === 1 && /[;·]/.test(parts[0])) {
    parts = parts[0].split(/\s*[;·]\s*/).filter(Boolean);
  }
  return parts.map((line) =>
    line
      // Strip common bullet markers so the glyph in the row template is
      // the only visual prefix.
      .replace(/^[-•·*+]+\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/^[✓✔×✗]\s*/, "")
      .trim(),
  ).filter(Boolean);
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
  stacked,
  feedback,
}: QuestionBoxProps) {
  const [bodyExpanded, setBodyExpanded] = useState(true);
  const [teacherOpen, setTeacherOpen] = useState(false);

  // ``stacked`` no longer changes layout (the box is single-column now), so
  // the prop is intentionally unread. Kept on the interface in case a
  // future mobile-only behavior wants it; silenced for the linter.
  void stacked;

  // Parse the structured per-question feedback into ✓ / × annotation lines.
  // When the structured fields are empty (older responses or salvaged
  // outputs), fall back to splitting the freeform aiComment body on the
  // first paragraph that looks like a strength list vs. an error list —
  // crude but better than dropping the AI's signal entirely.
  const goodLines = splitAnnotationLines(feedback?.good_points);
  const errorLines = splitAnnotationLines(feedback?.errors);
  const fallbackComment = aiComment.body?.trim() || "";
  const hasAnnotations = goodLines.length > 0 || errorLines.length > 0;
  const showFallback = !hasAnnotations && !!fallbackComment;

  return (
    // Word-style document page. Each câu renders as a paper card:
    //   1. header with circle number + label
    //   2. student work in mono (the proof / answer)
    //   3. AI annotations rendered inline as ✓ điểm tốt / × cần sửa lines,
    //      always visible (no toggle) — mirrors a teacher's red-pen markup
    //      on a printed exam
    //   4. teacher reply box, collapsed by default behind a "Thêm nhận
    //      xét" link to keep the page clean until needed
    <div
      style={{
        marginBottom: 16,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        boxShadow: T.shadowSoft,
        background: T.paper,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "18px 20px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div
            style={{
              width: 26,
              height: 26,
              flexShrink: 0,
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
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {studentAnswer.label || `Câu ${questionIdx + 1}`}
          </span>
        </div>

        <button
          onClick={() => setBodyExpanded((v) => !v)}
          aria-label={bodyExpanded ? "Thu gọn bài làm" : "Mở bài làm"}
          title={bodyExpanded ? "Thu gọn" : "Mở"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: T.textFaint,
            padding: 4,
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
          }}
        >
          {bodyExpanded ? (
            <Icon.ArrowDown size={14} color={T.textFaint} />
          ) : (
            <Icon.ChevronRight size={14} color={T.textFaint} />
          )}
        </button>
      </div>

      {bodyExpanded && (
        <div
          style={{
            padding: "12px 20px 0",
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

      {/* Inline AI annotations — ✓ good points and × errors, always
          visible. Each line gets its own row with the glyph + tinted text
          so the teacher can skim the AI's marks like a margin note. */}
      {bodyExpanded && (hasAnnotations || showFallback || isSalvaged) && (
        <div
          style={{
            margin: "14px 20px 0",
            padding: "10px 14px",
            background: T.bgCard,
            border: `1px solid ${T.borderLight}`,
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {goodLines.map((line, i) => (
            <AnnotationRow key={`g-${i}`} kind="good" text={line} />
          ))}
          {errorLines.map((line, i) => (
            <AnnotationRow key={`e-${i}`} kind="error" text={line} />
          ))}
          {showFallback && (
            // Legacy / unstructured response — emit the freeform comment
            // as a single neutral row so we don't drop the AI signal.
            <AnnotationRow kind="note" text={fallbackComment} />
          )}
          {!hasAnnotations && !showFallback && isSalvaged && (
            <AnnotationRow
              kind="warn"
              text={String(
                t.noCommentSalvaged ??
                  "Phản hồi cho câu này bị cắt — hãy đối chiếu bài làm hoặc chấm lại.",
              )}
            />
          )}
        </div>
      )}

      {/* Teacher reply — folded behind a thin link by default so the page
          stays focused on the AI's mark-up. Click "Thêm nhận xét" to
          reveal the textarea + thread. Once any teacher message exists,
          we auto-open so prior threads aren't hidden mid-conversation. */}
      {bodyExpanded && (
        <div style={{ padding: "14px 20px 18px" }}>
          {(teacherOpen || comments.length > 0) ? (
            <>
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
            </>
          ) : (
            <button
              type="button"
              onClick={() => setTeacherOpen(true)}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: T.textMute,
                fontFamily: T.font,
                fontSize: 13,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = T.accent)}
              onMouseLeave={(e) => (e.currentTarget.style.color = T.textMute)}
            >
              <Icon.Edit size={11} />
              Thêm nhận xét cho câu này
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// One row of inline AI markup — ✓ điểm tốt (green), × cần sửa (red),
// or a neutral fallback for unstructured prose / salvage warnings.
// Mirrors a teacher's red-pen mark on a printed exam: glyph + italic
// short phrase, sitting just under the body it refers to.
function AnnotationRow({
  kind,
  text,
}: {
  kind: "good" | "error" | "note" | "warn";
  text: string;
}) {
  const palette: Record<typeof kind, { color: string; glyph: string; weight: number }> = {
    good:  { color: T.green, glyph: "✓", weight: 600 },
    error: { color: T.red,   glyph: "×", weight: 600 },
    note:  { color: T.textSoft, glyph: "•", weight: 500 },
    warn:  { color: T.amber, glyph: "⚠", weight: 600 },
  };
  const p = palette[kind];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        fontSize: 13.5,
        lineHeight: 1.55,
        color: T.textSoft,
        fontStyle: "italic",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          color: p.color,
          fontWeight: p.weight,
          fontFamily: T.mono,
          fontStyle: "normal",
          flexShrink: 0,
          minWidth: 12,
          textAlign: "center",
          lineHeight: 1.55,
        }}
      >
        {p.glyph}
      </span>
      <span style={{ color: p.color, fontWeight: 500 }}>{text}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ReviewMockup — UI-first visual design (hardcoded sample data).
//
// Matches the reference Trần Minh Khôi mockup the teacher locked: header
// strip with student identity + AI run metadata, a left "document" column
// with a peach-tinted card per câu showing inline ✓ / × annotations next
// to the lines they refer to and a red italic score footer, and a right
// sticky summary panel with the overall estimated grade plus per-câu
// score cards (one highlighted as the active câu). Pure presentational —
// no props from real grade state yet. Wiring comes after sign-off.
// ---------------------------------------------------------------------------

// Schema mirrors the reference prototype's MOCK_AI_GRADE.byQuestion shape:
// student work is a flat string[], annotations live in a separate array and
// reference their target line by index. Keeps the data minimal and lets the
// renderer place ✓ / × glyphs inline with whatever line they describe.
interface MockAnnotation {
  /** Zero-based index into the parent question's ``lines`` array. */
  line: number;
  kind: "good" | "error";
  text: string;
}

interface MockQuestion {
  num: number;
  earned: number;
  max: number;
  /** Short rubric note shown in the right-side "TỪNG CÂU" summary card. */
  summary: string;
  /** Raw student work, one entry per visual line. Whitespace is preserved
   *  so indented continuation lines line up under their parent expression. */
  lines: string[];
  annotations: MockAnnotation[];
}

interface MockReferencedLesson {
  id: string;
  subject: string;
  score: number;
  text: string;
  similarity: number;
  date: string;
}

const MOCK_REVIEW = {
  studentName: "Trần Minh Khôi",
  studentClass: "Lớp 10A1",
  runNumber: 1,
  lessonsUsed: 3,
  modelName: "gemini-3-flash-preview",
  durationSec: 4.8,
  overallScore: 8.5,
  overallMax: 10.0,
  correctCount: 1,
  needsReviewCount: 2,
  /** Default focus on mount — Câu 1 mirrors the reference screenshot. */
  initialActiveQuestionNum: 1,
  referencedLessons: [
    {
      id: "L-0247",
      subject: "Toán",
      score: 4.0,
      text: "Khi học sinh giải pt bậc hai bằng Δ, không trừ điểm vì thiếu khẳng định a ≠ 0 nếu hệ số đã hiển nhiên bằng 1.",
      similarity: 0.91,
      date: "2026-04-22",
    },
    {
      id: "L-0193",
      subject: "Toán",
      score: 3.5,
      text: "Với câu hỏi 'tìm m để có 2 nghiệm phân biệt', cần kết luận miền m, KHÔNG chỉ ghi bất phương trình kết quả.",
      similarity: 0.88,
      date: "2026-04-15",
    },
    {
      id: "L-0166",
      subject: "Toán",
      score: 3.0,
      text: "Vi-ét chỉ áp dụng được khi pt có nghiệm (Δ ≥ 0). Bài đề cho biết đã có 2 nghiệm thì không cần nhắc lại điều kiện.",
      similarity: 0.74,
      date: "2026-03-30",
    },
  ] as MockReferencedLesson[],
  questions: [
    {
      num: 1,
      earned: 3.0,
      max: 3.0,
      summary: "Trình bày đầy đủ, tính Δ và nghiệm chính xác.",
      lines: [
        "Câu 1.",
        "x² - 5x + 6 = 0",
        "Δ = 25 - 24 = 1",
        "x = (5 ± 1) / 2",
        "→ x = 3  hoặc  x = 2",
        "Vậy phương trình có hai nghiệm  x = 2, x = 3.",
      ],
      annotations: [
        { line: 1, kind: "good", text: "Tính Δ đúng" },
        { line: 4, kind: "good", text: "Kết luận đầy đủ" },
      ],
    },
    {
      num: 2,
      earned: 3.0,
      max: 4.0,
      summary: "Tính toán đúng nhưng chưa loại trừ điều kiện a ≠ 0 và chưa nói rõ pt bậc hai.",
      lines: [
        "Câu 2.",
        "Để pt có 2 nghiệm phân biệt → Δ' > 0",
        "Δ' = (m+1)² - (m² - 3)",
        "    = m² + 2m + 1 - m² + 3",
        "    = 2m + 4",
        "2m + 4 > 0  →  m > -2",
        "Vậy m > -2 thì pt có 2 nghiệm phân biệt.",
      ],
      annotations: [
        { line: 1, kind: "error", text: "Thiếu khẳng định a = 1 ≠ 0 (pt bậc hai)" },
        { line: 5, kind: "good", text: "Biến đổi đúng" },
        { line: 6, kind: "error", text: "Cần KẾT LUẬN miền m ⇒ trừ 0.5đ" },
      ],
    },
    {
      num: 3,
      earned: 2.5,
      max: 3.0,
      summary: "Dùng Vi-ét hợp lý, nhưng cần ghi rõ điều kiện áp dụng và thử lại.",
      lines: [
        "Câu 3.",
        "Theo Vi-ét:",
        "x₁ + x₂ = -b   →   2 + (-5) = -b   →   b = 3",
        "x₁ · x₂ = c     →   2 · (-5) = c     →   c = -10",
        "Vậy b = 3, c = -10.",
      ],
      annotations: [
        { line: 2, kind: "error", text: "Thiếu điều kiện Δ ≥ 0 để áp dụng Vi-ét" },
        { line: 3, kind: "good", text: "Tính b đúng" },
        { line: 4, kind: "good", text: "Tính c đúng" },
      ],
    },
  ] as MockQuestion[],
};

/** Build the review payload (MOCK_REVIEW shape) from a live grade +
 *  pipeline state. Falls through to MOCK_REVIEW when the grade has no
 *  scored per-câu data, so dev runs and salvaged grades still render.
 *
 *  Fields still mocked (no source yet):
 *    - studentName / studentClass — no upload-form field for them.
 *    - durationSec — pipeline doesn't measure VLM call time yet.
 *    - similarity — backend doesn't expose semantic-distance per lesson.
 *  When those sources land, replace the placeholders here without
 *  changing the layout. */
function deriveStepReviewData(
  grade: Grade | null,
  lessonsUsed: Lesson[],
  runNumber: number,
): typeof MOCK_REVIEW {
  const pqf = grade?.per_question_feedback ?? [];
  const hasReal =
    pqf.length > 0 && pqf.some((q) => typeof q.score === "number");
  if (!hasReal) return MOCK_REVIEW;

  const linesByCau = splitTranscriptByCau(grade?.transcript ?? "");
  const questions: MockQuestion[] = pqf.map((q, i) => {
    const parsed = parseCauHeader(q.question ?? "", i + 1);
    const lines = linesByCau.get(parsed.num) ?? [];
    const max =
      typeof q.max_points === "number" && isFinite(q.max_points)
        ? q.max_points
        : 0;
    const earned =
      typeof q.score === "number" && isFinite(q.score) ? q.score : 0;
    return {
      num: parsed.num,
      earned,
      max,
      summary: q.good_points || q.errors || parsed.prompt || "",
      lines: lines.length > 0 ? lines : [`Câu ${parsed.num}.`],
      annotations: buildSyntheticAnnotations(q, lines.length),
    };
  });

  const overallMax = questions.reduce((s, q) => s + q.max, 0) || 10;
  const correctCount = questions.filter(
    (q) => q.max > 0 && Math.abs(q.earned - q.max) < 0.001,
  ).length;
  const needsReviewCount = questions.length - correctCount;

  const referencedLessons: MockReferencedLesson[] = lessonsUsed.map((l) => ({
    id: `L-${String(l.id).padStart(4, "0")}`,
    subject: l.subject || "—",
    score: l.feedback_score,
    text: l.lesson_text,
    similarity: 0, // Backend doesn't expose semantic distance yet.
    date: l.timestamp ? l.timestamp.slice(0, 10) : "—",
  }));

  return {
    studentName: MOCK_REVIEW.studentName, // No upload-form field yet.
    studentClass: MOCK_REVIEW.studentClass,
    runNumber,
    lessonsUsed: lessonsUsed.length,
    modelName: "gemini-3-flash-preview",
    durationSec: 0, // Not measured by pipeline yet.
    overallScore: typeof grade?.overall === "number" ? grade.overall : 0,
    overallMax,
    correctCount,
    needsReviewCount,
    initialActiveQuestionNum: questions[0]?.num ?? 1,
    referencedLessons,
    questions,
  };
}

function ReviewMockup({
  isMobile,
  review = MOCK_REVIEW,
}: {
  isMobile: boolean;
  /** Derived review payload from grade + pipeline. When omitted we keep
   *  the legacy MOCK_REVIEW so design iteration / Storybook-style use
   *  still works without a real backend call. */
  review?: typeof MOCK_REVIEW;
}) {
  // Active câu drives BOTH the paper highlight (peach behind the q-block)
  // and the rail's selected qcard border. Click on either side updates
  // this state — the two panels mirror each other.
  const [activeQ, setActiveQ] = useState<number>(review.initialActiveQuestionNum);
  return (
    <div
      style={{
        display: isMobile ? "block" : "grid",
        gridTemplateColumns: isMobile ? undefined : "minmax(0, 1fr) 380px",
        gap: 18,
        alignItems: "start",
      }}
    >
      <PaperContainer
        review={review}
        activeQ={activeQ}
        setActiveQ={setActiveQ}
      />
      <Rail
        review={review}
        activeQ={activeQ}
        setActiveQ={setActiveQ}
        isMobile={isMobile}
      />
    </div>
  );
}

// PaperHead — title section INSIDE the paper card. Mirrors the reference's
// ``.paper-head`` (slightly elevated bg, bottom border separator) so the
// student identity reads as the document's title, not as a floating header
// disconnected from the body. Eyebrow → student name on the left, lessons
// pill + model/time on the right.
function PaperHead({ review }: { review: typeof MOCK_REVIEW }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 16,
        padding: "14px 20px",
        background: T.bgElevated,
        borderBottom: `1px solid ${T.border}`,
        flexWrap: "wrap",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: T.textFaint,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 4,
          }}
        >
          Bản chấm AI · Lần {review.runNumber}
        </div>
        <div
          style={{
            // Reference uses body serif, not the display Fraunces. Keep
            // weight at 600 so the student identity reads as the page's
            // subject without competing with the right-column big score.
            fontFamily: T.font,
            fontSize: 18,
            fontWeight: 600,
            color: T.text,
            letterSpacing: "-0.005em",
            lineHeight: 1.25,
          }}
        >
          {review.studentName} · {review.studentClass}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}
      >
        {/* Two pills side-by-side — share the exact same MetaPill style so
            they line up at the same height + corner radius. The lessons
            pill is informational (span), the PDF one is an action (button
            with hover). The visual treatment otherwise has to be identical
            or the row looks lopsided. */}
        <MetaPill
          icon={<Icon.Lightbulb size={11} color={T.amber} />}
          title={`AI: ${review.modelName} · ${review.durationSec}s`}
        >
          {review.lessonsUsed} lessons dùng
        </MetaPill>
        <MetaPill
          icon={<Icon.FileText size={11} />}
          title="Mở bài làm gốc để đối chiếu với phần AI đã chép"
          onClick={() => {
            // Mockup phase — wired to real essayImage + modal once the
            // visual design is locked. For now surface an explicit hint
            // so a teacher clicking during a demo isn't confused.
            window.alert(
              "Mockup: nút này sẽ mở PDF gốc (hoặc ảnh chụp) bài làm học sinh khi được wire với backend.",
            );
          }}
        >
          Xem PDF gốc
        </MetaPill>
      </div>
    </div>
  );
}

// MetaPill — shared visual primitive for the two pills in the paper-head
// (lessons-used badge + Xem PDF gốc action). Centralized so a span and a
// button render at pixel-identical height / padding / radius, and the row
// reads as a unified cluster instead of two slightly-misaligned chips.
// Behavior differs by ``onClick`` presence: no-op pills render as <span>,
// actionable pills render as <button> with hover-to-accent.
function MetaPill({
  children,
  icon,
  title,
  onClick,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  const baseStyle: React.CSSProperties = {
    padding: "4px 10px",
    background: T.bgCard,
    border: `1px solid ${T.border}`,
    borderRadius: 999,
    fontSize: 12,
    fontFamily: T.font,
    fontWeight: 400,
    lineHeight: 1.45,
    color: T.textSoft,
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    // ``margin: 0`` overrides the button user-agent margin on Safari/Firefox
    // so the two pills sit at the exact same baseline.
    margin: 0,
  };
  if (!onClick) {
    return (
      <span style={baseStyle} title={title}>
        {icon}
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        ...baseStyle,
        cursor: "pointer",
        transition: "color 0.12s, border-color 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = T.accent;
        e.currentTarget.style.borderColor = T.accent;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = T.textSoft;
        e.currentTarget.style.borderColor = T.border;
      }}
    >
      {icon}
      {children}
    </button>
  );
}

// Common eyebrow label for rail sections ("TỔNG QUAN AI", "TỪNG CÂU",
// "BÀI HỌC AI ĐÃ THAM CHIẾU"). Centralized so all three keep the same
// tracked-uppercase treatment. Inline content (right-aligned counter,
// icon prefix) is composed via the optional `right` and `icon` slots.
function RailEyebrow({
  children,
  right,
  icon,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 10,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: T.textFaint,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {icon}
        {children}
      </div>
      {right && (
        <span style={{ fontSize: 11, color: T.textMute, fontFamily: T.mono }}>
          {right}
        </span>
      )}
    </div>
  );
}

// PaperContainer — single "sheet of paper" wrapping every câu. Matches the
// reference's ``.paper`` card: one bordered surface with a head section
// (student identity + AI run meta) and a body section (annotated answer).
// q-blocks separated by spacing alone — no per-câu cards. Clicking inside
// a q-block sets that câu as active (peach tint follows the click); the
// rail mirrors the same state in its qcards.
function PaperContainer({
  review,
  activeQ,
  setActiveQ,
}: {
  review: typeof MOCK_REVIEW;
  activeQ: number;
  setActiveQ: (n: number) => void;
}) {
  return (
    <div
      style={{
        background: T.paper,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        boxShadow: T.shadowSoft,
        minWidth: 0,
        // overflow:hidden keeps the elevated paper-head bg clipped to the
        // outer rounded corners — without it the head bleeds past the radius.
        overflow: "hidden",
      }}
    >
      <PaperHead review={review} />
      <div style={{ padding: "16px 20px 4px" }}>
        <AnnotatedAnswer
          questions={review.questions}
          activeQ={activeQ}
          setActiveQ={setActiveQ}
        />
      </div>
    </div>
  );
}

// AnnotatedAnswer — student work rendered as a single mono stream, with
// AI ✓ / × notes attached to whichever line they describe. Mirrors the
// reference's ``AnnotatedAnswer``: each q-block is clickable and the
// active one gets a peach background; annotations are matched to lines
// by index, NOT inlined into the source data — keeps the line text clean.
function AnnotatedAnswer({
  questions,
  activeQ,
  setActiveQ,
}: {
  questions: MockQuestion[];
  activeQ: number;
  setActiveQ: (n: number) => void;
}) {
  return (
    <div
      style={{
        fontFamily: T.mono,
        fontSize: 14.5,
        color: T.textSoft,
        lineHeight: 1.85,
      }}
    >
      {questions.map((q) => {
        const active = q.num === activeQ;
        return (
          <div
            key={q.num}
            onClick={() => setActiveQ(q.num)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActiveQ(q.num);
              }
            }}
            role="button"
            tabIndex={0}
            aria-pressed={active}
            style={{
              cursor: "pointer",
              padding: "14px 16px",
              // Negative side margins let the active highlight reach the
              // paper's inner padding edge so the peach band feels like a
              // proper section, not a chip floating in the middle.
              margin: "0 -16px 18px",
              borderRadius: 8,
              background: active ? "#FBEEEA" : "transparent",
              transition: "background 0.15s",
              outline: "none",
            }}
          >
            {q.lines.map((line, i) => {
              const ann = q.annotations.find((a) => a.line === i);
              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 14,
                    flexWrap: "wrap",
                    // pre-wrap (not pre): keeps leading-space indentation for
                    // multi-line math steps AND wraps long prose lines like
                    // ``[Hình vẽ: …]`` instead of letting them run off the
                    // paper edge. Geometry transcripts mix both shapes so we
                    // need the hybrid.
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    minWidth: 0,
                  }}
                >
                  <span style={{ minWidth: 0, maxWidth: "100%" }}>{line}</span>
                  {ann && (
                    <span
                      style={{
                        color: T.red,
                        fontStyle: "italic",
                        fontFamily: T.font,
                        fontSize: 13.5,
                        fontWeight: 500,
                        // Annotation re-enables normal wrapping so it
                        // doesn't push the row width past the column.
                        whiteSpace: "normal",
                      }}
                    >
                      {ann.kind === "good" ? "✓" : "×"} {ann.text}
                    </span>
                  )}
                </div>
              );
            })}
            <div
              style={{
                marginTop: 10,
                color: T.red,
                fontStyle: "italic",
                fontFamily: T.font,
                fontSize: 14,
              }}
            >
              — {q.earned.toFixed(1)}/{q.max.toFixed(1)}đ
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Rail — right-side summary card. Sticky + internally scrollable so the
// "Tổng quan / Từng câu / Bài học tham chiếu" stack stays in view while
// the teacher scrolls the long student work in the paper next to it.
function Rail({
  review,
  activeQ,
  setActiveQ,
  isMobile,
}: {
  review: typeof MOCK_REVIEW;
  activeQ: number;
  setActiveQ: (n: number) => void;
  isMobile: boolean;
}) {
  return (
    <aside
      style={{
        background: T.bgCard,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        boxShadow: T.shadowSoft,
        display: "flex",
        flexDirection: "column",
        // Sticky inside a grid item requires alignSelf:start, otherwise the
        // grid stretches the rail to the row's full height and sticky has
        // no slack to slide along.
        position: isMobile ? "static" : "sticky",
        top: 16,
        alignSelf: "start",
        maxHeight: isMobile ? "none" : "calc(100vh - 32px)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${T.borderLight}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: T.textFaint,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
          }}
        >
          Tổng quan AI
        </div>
      </div>
      <div
        style={{
          padding: "16px 18px",
          overflowY: "auto",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <OverallCard review={review} />
        <PerQuestionList
          questions={review.questions}
          activeQ={activeQ}
          setActiveQ={setActiveQ}
        />
        <LessonsList lessons={review.referencedLessons} />
      </div>
    </aside>
  );
}

function OverallCard({ review }: { review: typeof MOCK_REVIEW }) {
  return (
    <div
      style={{
        background: T.bgMuted,
        border: `1px solid ${T.borderLight}`,
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      {/* "điểm dự kiến" eyebrow removed — the section header "Tổng quan
          AI" above + the big 8.5 / 10.0 already say what this number is.
          The extra label was just panel noise for long essays. */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 38,
            fontWeight: 600,
            color: T.text,
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {review.overallScore.toFixed(1)}
        </span>
        <span style={{ fontSize: 16, color: T.textMute, fontFamily: T.mono }}>
          / {review.overallMax.toFixed(1)}
        </span>
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 12.5,
          color: T.textSoft,
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: T.green, fontWeight: 600 }}>
          {review.correctCount} đúng
        </span>
        <span style={{ color: T.textFaint }}>·</span>
        <span style={{ color: T.red, fontWeight: 600 }}>
          {review.needsReviewCount} cần xem
        </span>
        <span style={{ color: T.textFaint }}>·</span>
        <span style={{ fontFamily: T.mono, color: T.textMute }}>
          {review.durationSec.toFixed(2)}s
        </span>
      </div>
    </div>
  );
}

function PerQuestionList({
  questions,
  activeQ,
  setActiveQ,
}: {
  questions: MockQuestion[];
  activeQ: number;
  setActiveQ: (n: number) => void;
}) {
  return (
    <div>
      <RailEyebrow>Từng câu</RailEyebrow>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {questions.map((q) => (
          <RailQCard
            key={q.num}
            q={q}
            active={q.num === activeQ}
            onClick={() => setActiveQ(q.num)}
          />
        ))}
      </div>
    </div>
  );
}

function RailQCard({
  q,
  active,
  onClick,
}: {
  q: MockQuestion;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        textAlign: "left",
        width: "100%",
        background: active ? "#FBEEEA" : T.bgCard,
        border: active ? `1.5px solid ${T.red}` : `1px solid ${T.border}`,
        borderRadius: 10,
        padding: "12px 14px",
        cursor: "pointer",
        transition: "border-color 0.15s, background 0.15s",
        fontFamily: "inherit",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>
          Câu {q.num}
        </span>
        <span style={{ fontFamily: T.mono, fontSize: 14 }}>
          <span
            style={{
              fontWeight: 700,
              color:
                q.earned < q.max
                  ? T.red
                  : T.text,
            }}
          >
            {q.earned.toFixed(1)}
          </span>
          <span style={{ color: T.textMute }}>/{q.max.toFixed(1)}</span>
        </span>
      </div>
      <div
        style={{
          marginTop: 5,
          fontSize: 12.5,
          color: T.textSoft,
          lineHeight: 1.5,
        }}
      >
        {q.summary}
      </div>
    </button>
  );
}

function LessonsList({ lessons }: { lessons: MockReferencedLesson[] }) {
  // Default collapsed: long essays (8–10 câu) would push the panel scroll
  // deep past these cards before the teacher could even see the per-câu
  // list. The count itself ("3 kết quả") on the toggle still telegraphs
  // that lessons exist — teacher clicks to inspect.
  const [open, setOpen] = useState(false);

  return (
    <div
      style={{
        borderTop: `1px dashed ${T.border}`,
        paddingTop: 14,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: open ? 10 : 0,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: T.textFaint,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon.Lightbulb size={11} color={T.amber} />
            Bài học AI đã tham chiếu
          </div>
          {/* Right cluster: count + toggle affordance. Chevron lives on
              the right because mixing it with the topic icon on the left
              made the two icons (9px chevron + 11px lightbulb) read as
              misaligned — Notion / Material accordions both keep the
              toggle on the trailing edge. */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 11,
              color: T.textMute,
              fontFamily: T.mono,
            }}
          >
            {lessons.length} kết quả
            <span
              aria-hidden="true"
              style={{
                display: "inline-flex",
                color: T.textFaint,
                transform: `rotate(${open ? 90 : 0}deg)`,
                transition: "transform 0.15s",
              }}
            >
              <svg
                width={10}
                height={10}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </span>
        </div>
      </button>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lessons.map((lesson) => (
            <LessonItem key={lesson.id} lesson={lesson} />
          ))}
        </div>
      )}
    </div>
  );
}

function LessonItem({ lesson }: { lesson: MockReferencedLesson }) {
  return (
    <div
      style={{
        background: T.bgMuted,
        border: `1px solid ${T.borderLight}`,
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 11,
            color: T.textMute,
          }}
        >
          {lesson.id} · {lesson.subject}
        </span>
        <span
          style={{
            fontFamily: T.mono,
            fontSize: 11,
            color: T.red,
            fontWeight: 600,
          }}
        >
          score {lesson.score.toFixed(1)}
        </span>
      </div>
      <div
        style={{
          fontSize: 12.5,
          color: T.textSoft,
          lineHeight: 1.5,
        }}
      >
        {lesson.text}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: lesson.similarity > 0 ? "space-between" : "flex-end",
          fontFamily: T.mono,
          fontSize: 10,
          color: T.textFaint,
        }}
      >
        {/* Backend doesn't expose semantic distance per lesson yet — when
            similarity is 0 we hide the span rather than print "0%", which
            would mislead the teacher into thinking the match was poor. */}
        {lesson.similarity > 0 && (
          <span>similarity {Math.round(lesson.similarity * 100)}%</span>
        )}
        <span>{lesson.date}</span>
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
  /** Legacy rubber-stamp callback. Kept on the props so the workspace
   *  still wires it (for the eventual backend rewire of an "approve"
   *  verdict). Currently no UI surfaces it — every grade now flows
   *  through step 4 → step 5 finalize, and the approve semantics are
   *  expected to be derived from "no scores changed" at step 5. */
  onApprove: () => void;
  /** Primary forward action — go to step 4 (Chấm lại) for per-câu
   *  review. */
  onGoToRegrade?: () => void;
  /** Back action — go to step 1 so the teacher can re-upload / swap
   *  files. "Đọc lại" reads as "đọc lại đề + bài làm" in this flow. */
  onPrev?: () => void;
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
  onGoToRegrade,
  onPrev,
  backendSubject,
  task,
  t,
  essayImage,
}: StepReviewProps) {
  const [commentThreads, setCommentThreads] = useState<CommentThreads>({});
  const [analyzingQ, setAnalyzingQ] = useState<number | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const isMobile = useIsMobile();
  // dataUrl→blob conversion + revoke lifecycle now lives inside
  // OriginalImageModal (shared with step 4) — caller just owns the
  // open/close toggle.

  // IMPORTANT: hooks must be called before any conditional return. These
  // `useMemo`s used to live AFTER the `if (!grade) return null` check, which
  // was a legacy JS pattern TS/React would flag as a rule-of-hooks violation
  // once the component becomes typed.
  const studentParts = useMemo(() => parseIntoQuestions(grade?.transcript), [grade?.transcript]);
  const commentParts = useMemo(() => parseIntoQuestions(grade?.comment), [grade?.comment]);
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

  // Derive the "Word-print" review payload from grade + pipeline state.
  // useMemo so we don't re-build the questions array on every render
  // when the active câu changes inside ReviewMockup. ``runCount`` from
  // pipeline starts at 0 on first PIPELINE_SUCCESS, so +1 reads as
  // "Lần 1" to the teacher. MUST live before the `if (!grade) return`
  // early return — react-hooks/rules-of-hooks.
  const reviewData = useMemo(
    () =>
      deriveStepReviewData(
        grade,
        pipeline.lessonsUsed,
        pipeline.runCount + 1,
      ),
    [grade, pipeline.lessonsUsed, pipeline.runCount],
  );

  if (!grade) return null;

  const questionCount = questionPairs.length;

  const weaknesses = Array.isArray(grade.weaknesses) ? grade.weaknesses : [];
  const isSalvaged =
    Boolean(grade.salvaged) ||
    weaknesses.some((w) => typeof w === "string" && w.toLowerCase().includes("unparseable"));

  // ``subject`` is still threaded into QuestionBox for math-aware transcript
  // formatting (formatTranscript). The user-facing badge that used to show
  // subjectName has been removed — Sidebar already displays the subject
  // selection, and grade.subject is hard-stamped to "stem" so the badge was
  // surfacing the wrong label anyway.
  const subject: Subject | string = grade.subject || "literature";

  const refForIdx = (idx: number | string) => questionPairs[Number(idx)]?.num ?? Number(idx) + 1;

  const stagedLessons: StagedLesson[] = Object.entries(commentThreads).flatMap(([idx, msgs]) => {
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
  });

  const aggregatedNote = Object.entries(commentThreads)
    .flatMap(([idx, msgs]) =>
      msgs.filter((m) => m.type === "teacher").map((m) => `[Câu ${refForIdx(idx)}] ${m.text}`),
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

  const canApprove = !feedbackHook.isSubmitting && pipeline.phase !== "generating";

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
      }}
    >
      {/* Top toolbar — horizontal padding matches the QuestionBox card's
          internal padding (20 px) so the "Xem PDF gốc" button right-aligns
          with the card's content right-edge, not the wider page maxWidth.
          Stops the button from kissing the viewport edge on narrow windows. */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
          minHeight: 28,
          padding: "0 20px",
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
              title={`${stagedLessons.length} ${t.lessonsStaged ?? "bài học chờ lưu khi duyệt"}`}
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
                t.originalImageHint ?? "Mở bài làm gốc để đối chiếu với phần AI đã chép",
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

      <OriginalImageModal
        open={showOriginal}
        essayImage={essayImage}
        onClose={() => setShowOriginal(false)}
        t={t}
      />

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
          <Icon.AlertTriangle size={14} color={T.amber} style={{ marginTop: 2, flexShrink: 0 }} />
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

      {/* "Word-print" review layout. The data is now derived from the
          live grade + pipeline state — student-identity fields stay
          mocked until the upload form gains them. Falls back to the
          full mock when grade has no scored per-câu data (salvaged /
          legacy) so the layout never breaks. The legacy QuestionBox +
          questionPairs plumbing below is suspended via void-references
          while we phase it out. */}
      <ReviewMockup
        isMobile={isMobile}
        review={reviewData}
      />
      {/* Acknowledge the legacy plumbing as "intentionally suspended" so
          the compiler doesn't complain about unused locals while we wait
          for the design to be approved. These all come back once we wire
          the mockup to real data. */}
      {(() => {
        void questionPairs;
        void questionCount;
        void commentThreads;
        void analyzingQ;
        void isSalvaged;
        void subject;
        void handleSendComment;
        void handleDisputeDecide;
        void QuestionBox;
        return null;
      })()}

      {/* Bottom action bar — back / disclaimer / forward.
          Approve shortcut intentionally removed: every grade now flows
          through step 4 (Chấm lại) so the teacher engages per-câu before
          committing. "Approve" semantics will be derived at step 5
          finalize ("no scores changed" → approve verdict) when backend
          is re-wired. The disclaimer text reminds the teacher of their
          role in the HITL loop. */}
      {feedbackHook.error && (
        <div
          style={{
            marginTop: 16,
            padding: "8px 12px",
            background: T.redSoft,
            borderRadius: 6,
            fontSize: 14,
            color: T.red,
            textAlign: "center",
          }}
        >
          <Icon.AlertTriangle size={12} color={T.red} style={{ marginRight: 4 }} />
          {feedbackHook.error}
        </div>
      )}
      <div
        style={{
          marginTop: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={onPrev}
          disabled={!onPrev}
          style={{
            padding: "10px 18px",
            fontSize: 14,
            color: T.textSoft,
            background: T.bgCard,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            cursor: onPrev ? "pointer" : "not-allowed",
            transition: "color 0.15s, border-color 0.15s",
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            opacity: onPrev ? 1 : 0.5,
          }}
          onMouseEnter={(e) => {
            if (!onPrev) return;
            e.currentTarget.style.color = T.text;
            e.currentTarget.style.borderColor = T.textMute;
          }}
          onMouseLeave={(e) => {
            if (!onPrev) return;
            e.currentTarget.style.color = T.textSoft;
            e.currentTarget.style.borderColor = T.border;
          }}
        >
          ← Đọc lại
        </button>
        <div
          style={{
            fontSize: 13,
            color: T.textMute,
            textAlign: "center",
            flex: "1 1 200px",
            minWidth: 0,
          }}
        >
          Bạn là người chấm cuối. AI chỉ đề xuất.
        </div>
        <button
          onClick={onGoToRegrade}
          disabled={pipeline.phase === "generating" || !onGoToRegrade}
          style={{
            padding: "12px 22px",
            fontSize: 14,
            color: "#fff",
            background: T.red,
            border: "none",
            borderRadius: 10,
            cursor:
              pipeline.phase === "generating" || !onGoToRegrade
                ? "not-allowed"
                : "pointer",
            transition: "all 0.2s",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            opacity:
              pipeline.phase === "generating" || !onGoToRegrade ? 0.5 : 1,
            fontWeight: 600,
            boxShadow:
              pipeline.phase === "generating" ? "none" : T.shadowSoft,
            whiteSpace: "nowrap",
          }}
          title="Mở bảng chấm lại — sửa điểm từng câu, chat với AI về phần chưa chắc."
        >
          Chấm lại / Phản hồi
          <Icon.ChevronRight size={14} color="#fff" />
        </button>
      </div>
      {/* Suspend the approve plumbing we no longer render but want to
          keep alive for the eventual backend rewire (mirrors the legacy
          QuestionBox suspension a few hundred lines up). */}
      {(() => {
        void handleApproveClick;
        void canApprove;
        void onApprove;
        return null;
      })()}
    </div>
  );
}
