import { useState, useCallback, useMemo, useEffect } from "react";
import { T } from "../../theme/tokens";
import { Icon } from "../../components/ui/Icon";
import { formatTranscript } from "../../lib/mathFormat";
import { analyzeComment } from "../../api";
import type {
  CommentThreads,
  EssayFile,
  Grade,
  I18nStrings,
  StagedLesson,
  Subject,
  ThreadMessage,
} from "../../types";
import type { UseAgentPipelineResult } from "../../hooks/useAgentPipeline";
import type { UseFeedbackResult } from "../../hooks/useFeedback";

// ---------------------------------------------------------------------------
// Minimal Markdown → HTML parser (no external lib needed)
// ---------------------------------------------------------------------------
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

interface QuestionPair {
  num: number;
  student: QuestionPart;
  ai: QuestionPart;
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
  isLoading: boolean;
  t: I18nStrings;
}

function CommentThread({ comments, onSend, isLoading, t }: CommentThreadProps) {
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
            maxHeight: 240,
            overflowY: "auto",
            paddingRight: 4,
          }}
        >
          {comments.map((c, i) => {
            const isTeacher = c.type === "teacher";
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 8,
                  padding: "8px 10px",
                  background: isTeacher ? T.amberSoft : T.accentSoft,
                  borderLeft: `3px solid ${isTeacher ? T.amber : T.accent}`,
                  borderRadius: "0 8px 8px 0",
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: isTeacher ? T.amber : T.accent,
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
                  {isTeacher ? "GV" : "AI"}
                </div>
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
  isAnalyzing: boolean;
  t: I18nStrings;
  subject: Subject | string;
}

function QuestionBox({
  studentAnswer,
  aiComment,
  questionIdx,
  comments,
  onSendComment,
  isAnalyzing,
  t,
  subject,
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
  task: string;
  t: I18nStrings;
  essayImage: EssayFile | null;
}

export function StepReview({
  grade,
  pipeline,
  feedbackHook,
  onApprove,
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
        const data = await analyzeComment({
          question: task || "",
          student_answer: (questionPairs[qIdx]?.student?.body || "").slice(
            0,
            2000,
          ),
          teacher_comment: text,
          lang: "vi",
        });
        setCommentThreads((prev) => ({
          ...prev,
          [qIdx]: [
            ...(prev[qIdx] || []),
            {
              type: "ai",
              text: data.analysis,
              lesson: (data.lesson || "").trim(),
            },
          ],
        }));
      } catch (err) {
        console.error("Comment analysis failed:", err);
      }
      setAnalyzingQ(null);
    },
    [task, questionPairs],
  );

  if (!grade) return null;

  const questionCount = Math.max(questionPairs.length, 1);

  const weaknesses = Array.isArray(grade.weaknesses) ? grade.weaknesses : [];
  const isSalvaged =
    Boolean(grade.salvaged) ||
    weaknesses.some(
      (w) => typeof w === "string" && w.toLowerCase().includes("unparseable"),
    );

  const subject: Subject | string = grade.subject || "literature";
  const subjectName =
    (t.subjectNames?.[subject as Subject] as string | undefined) ||
    (t.subjectNames?.literature as string | undefined) ||
    String(subject);

  const refForIdx = (idx: number | string) =>
    questionPairs[Number(idx)]?.num ?? Number(idx) + 1;

  const stagedLessons: StagedLesson[] = Object.entries(commentThreads).flatMap(
    ([idx, msgs]) =>
      msgs
        .filter((m) => m.type === "ai" && m.lesson)
        .map((m) => ({
          lesson_text: m.lesson as string,
          question_ref: `Câu ${refForIdx(idx)}`,
        })),
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
      subject,
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {stagedLessons.length > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                fontFamily: T.mono,
                color: T.accent,
                padding: "4px 12px",
                background: T.accentSoft,
                borderRadius: 20,
                border: `1px solid ${T.accent}`,
                letterSpacing: "0.04em",
              }}
              title="Các quy tắc đã chưng cất từ nhận xét của bạn — sẽ lưu khi duyệt."
            >
              <Icon.Award size={11} color={T.accent} />
              {stagedLessons.length}{" "}
              {String(t.lessonsStaged ?? "bài học đang chờ lưu")}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              fontFamily: T.mono,
              color: T.accent,
              padding: "4px 12px",
              background: T.accentSoft,
              borderRadius: 20,
              border: `1px solid ${T.accent}`,
              letterSpacing: "0.04em",
            }}
            title={String(t.subjectLabel ?? "Subject")}
          >
            <Icon.Award size={11} color={T.accent} />
            {String(t.subjectLabel ?? "Môn")}: {subjectName}
          </span>
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
            isAnalyzing={analyzingQ === i}
            t={t}
            subject={subject}
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
