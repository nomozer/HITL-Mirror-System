import { useCallback, useMemo, useState } from "react";
import { T } from "../../theme/tokens";
import { Icon } from "../../components/ui/Icon";
import { OriginalImageModal } from "../../components/ui/OriginalImageModal";
import {
  buildSyntheticAnnotations,
  parseCauHeader,
  splitTranscriptByCau,
} from "../../lib/grade";
import { getStageableLesson } from "../../lib/hitl";
import { analyzeComment } from "../../api";
import { i18n } from "../../i18n";
import type { UseFeedbackResult } from "../../hooks/useFeedback";
import type {
  BackendSubject,
  CommentVerdict,
  EssayFile,
  Grade,
  StagedLesson,
  ThreadMessage,
} from "../../types";

// ---------------------------------------------------------------------------
// RegradeMockup — Step 4 "Chấm lại".
//
// Reference behavior the teacher locked:
//   • Default: just the paper showing student work, AI annotations, and a
//     score editor row per câu. The "Chat với AI" button sits in that row
//     but the chat surface itself is HIDDEN.
//   • Click "Chat với AI" on any câu → focused chat rail slides in on the
//     right; the câu the button belongs to becomes the active context.
//   • Closing the rail (X) goes back to single-column document.
//
// Wired vs still-mock:
//   ✓ Per-câu rows come from grade.per_question_feedback (max_points,
//     score, good_points, errors).
//   ✓ Lines come from splitTranscriptByCau(grade.transcript).
//   ✓ Score edits propagate up via finalScores / maxOverrides props so
//     step 5 ResultCard can read the teacher's per-câu numbers.
//   ✗ Chat is still cosmetic (no /api/analyze-comment round-trip).
//   ✗ "Xem PDF gốc" button still shows an alert.
//
// Annotations: Gemini doesn't emit line-level annotations yet, so we
// synthesise two badges per câu — a green "good" tag pinned to line 1
// (header) and a red "error" tag pinned to the last line. Crude but
// preserves the visual idea while we wait on a backend prompt change.
// ---------------------------------------------------------------------------

interface MockAnn {
  line: number;
  kind: "good" | "error";
  text: string;
}

interface RegradeQuestion {
  num: number;
  label: string;
  prompt: string;
  /** Per-câu cap from the exam paper, when the đề explicitly partitions
   *  points (e.g. "Câu 1 (3.0đ)"). Optional because many K-12 đề only
   *  give an overall total — in that case the UI hides the "/X.Y"
   *  denominator and skips per-câu max validation, falling back to the
   *  exam-level cap (``MOCK_REGRADE.maxTotal``) at the header. */
  maxPoints?: number;
  aiScore: number;
  /** Short rubric note — surfaced as the gợi-ý seed message in chat. */
  summary: string;
  lines: string[];
  annotations: MockAnn[];
  /** Per-câu suggested questions the teacher can one-click to autofill the
   *  chat textarea. Reference prototype hard-codes them per câu so each
   *  câu's seed prompts feel grounded in its own marking. */
  chatSuggestions: string[];
}


const MOCK_REGRADE = {
  aiOverall: 8.5,
  maxTotal: 10.0,
  questions: [
    {
      num: 1,
      label: "Câu 1",
      prompt: "Giải phương trình x² - 5x + 6 = 0",
      maxPoints: 3.0,
      aiScore: 3.0,
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
      chatSuggestions: [
        "Bài làm có cần trừ điểm nào không?",
        "Đáp án đã đúng, không cần sửa.",
      ],
    },
    {
      num: 2,
      label: "Câu 2",
      prompt: "Tìm m để phương trình x² - 2(m+1)x + m² - 3 = 0 có hai nghiệm phân biệt.",
      maxPoints: 4.0,
      aiScore: 3.0,
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
      chatSuggestions: [
        "Tại sao trừ điểm câu này?",
        "Đáp án đã đúng, không cần trừ.",
        "Học sinh thiếu kết luận miền m.",
      ],
    },
    {
      num: 3,
      label: "Câu 3",
      prompt: "Cho phương trình x² + bx + c = 0 có hai nghiệm là 2 và -5. Tìm b, c.",
      // ``maxPoints`` intentionally omitted to demo the "đề không quy định"
      // case — teacher gets a free-form input, exam-level cap (10đ) is
      // enforced at the header total only.
      aiScore: 2.5,
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
      chatSuggestions: [
        "Tại sao trừ điểm câu này?",
        "Đáp án đã đúng, không cần trừ.",
        "Học sinh thiếu kết luận miền m.",
      ],
    },
  ] as RegradeQuestion[],
};

/** Derive the regrade panel's `review` payload from a live grade. Falls
 *  through to MOCK_REGRADE when the grade has no scored per-câu data —
 *  preserves the UI for salvaged / legacy grades + dev runs without a
 *  real backend call. parseCauHeader + buildSyntheticAnnotations come
 *  from lib/grade so step 3 + step 5 share the same logic. */
function deriveReview(grade: Grade | null | undefined): typeof MOCK_REGRADE {
  const pqf = grade?.per_question_feedback ?? [];
  const hasReal =
    pqf.length > 0 && pqf.some((q) => typeof q.score === "number");
  if (!hasReal) return MOCK_REGRADE;

  const linesByCau = splitTranscriptByCau(grade?.transcript ?? "");
  const questions: RegradeQuestion[] = pqf.map((q, i) => {
    const parsed = parseCauHeader(q.question ?? "", i + 1);
    const lines = linesByCau.get(parsed.num) ?? [];
    const maxPoints =
      typeof q.max_points === "number" && isFinite(q.max_points)
        ? q.max_points
        : undefined;
    const score =
      typeof q.score === "number" && isFinite(q.score) ? q.score : 0;
    return {
      num: parsed.num,
      label: `Câu ${parsed.num}`,
      prompt: parsed.prompt,
      maxPoints,
      aiScore: score,
      summary: q.good_points || q.errors || "",
      lines:
        lines.length > 0
          ? lines
          : [`Câu ${parsed.num}.`, "(không có nội dung trong transcript)"],
      annotations: buildSyntheticAnnotations(q, lines.length),
      chatSuggestions: [
        "Tại sao chấm điểm câu này như vậy?",
        "Đáp án đã đúng, không cần trừ.",
        "Có cần điều chỉnh lại không?",
      ],
    };
  });

  const totalMax = questions.reduce((s, q) => s + (q.maxPoints ?? 0), 0);
  return {
    aiOverall: typeof grade?.overall === "number" ? grade.overall : 0,
    maxTotal: totalMax > 0 ? totalMax : 10,
    questions,
  };
}

export interface RegradeMockupProps {
  /** Back action — go to step 3 to re-read AI's review. */
  onPrev?: () => void;
  /** Forward action — fired ONLY after the feedback POST succeeds (or
   *  is no-op-skipped) so step 5 never opens on a half-saved HITL
   *  state. Caller navigates to step 5 here. */
  onFinish?: () => void;
  /** Live grade payload from the agent pipeline. Used to derive per-câu
   *  rows (max_points, score, good_points, errors) + the student work
   *  lines via transcript splitting. Falls back to a built-in mock when
   *  the grade has no scored per-câu data (legacy / salvaged). */
  grade?: Grade | null;
  /** Original student bài làm (image or PDF). When present the "Xem PDF
   *  gốc" button opens a lightbox over the page. Optional so dev / mock
   *  renders without a real upload still work. */
  essayImage?: EssayFile | null;
  /** Teacher's per-câu score overrides. Lifted to the caller so step 5
   *  can read them on transition. Keyed by câu num. */
  finalScores: Record<number, number>;
  setFinalScores: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  /** Teacher's per-câu max overrides (only when đề didn't allocate
   *  points). Same lift rationale as finalScores. */
  maxOverrides: Record<number, number>;
  setMaxOverrides: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  /** HITL feedback hook shared with step 3 — owns POST /api/feedback.
   *  Step 4 fires action="approve" with staged chat lessons +
   *  aggregated teacher notes on "Hoàn tất bài này" so the HITL memory
   *  learns from this review round even though the teacher never
   *  pressed an explicit "Duyệt" button. */
  feedbackHook: UseFeedbackResult;
  /** Inputs threaded through to the feedback POST body — the workspace
   *  is the source of truth for all of these (task context, the AI
   *  grade JSON the teacher is reacting to, the pipeline run id, and
   *  the resolved backend subject code). */
  task: string;
  pipelineCode: string | null;
  runId: number | null;
  subject: BackendSubject | null;
}

export function RegradeMockup({
  onPrev,
  onFinish,
  grade,
  essayImage,
  finalScores,
  setFinalScores,
  maxOverrides,
  setMaxOverrides,
  feedbackHook,
  task,
  pipelineCode,
  runId,
  subject,
}: RegradeMockupProps) {
  // Derive the review payload: real grade data when the pipeline produced
  // scored per-câu, else the legacy mock so the UI still renders for
  // dev-time visual review or salvaged grades.
  const review = useMemo(() => deriveReview(grade), [grade]);
  // null = chat rail hidden. Setting it to a câu number opens the rail and
  // pins it to that câu. Clicking "Chat với AI" on a different câu just
  // re-targets the same rail. Closing (X) sets back to null.
  const [activeQ, setActiveQ] = useState<number | null>(null);
  // Per-câu chat thread (teacher ↔ AI). Keyed by câu num. Persists across
  // open/close cycles of the chat rail so the teacher can flip between
  // câu without losing history. Wiped on grade change via the parent's
  // parseGrade effect — see EssayWorkspace's finalScores reset.
  const [chatThreads, setChatThreads] = useState<Record<number, ThreadMessage[]>>({});
  const [analyzingQ, setAnalyzingQ] = useState<number | null>(null);
  // OriginalImageModal toggle. Lifted here (instead of inside PaperRegrade)
  // so the modal renders at the RegradeMockup root, sitting on top of
  // both the paper column and the chat rail without re-parenting issues.
  const [showOriginal, setShowOriginal] = useState(false);
  // Send the teacher's draft to /api/analyze-comment. Optimistic-append
  // the teacher bubble first, then await the AI response and append it
  // (or a fallback error bubble). Lesson staging / dispute decisions are
  // intentionally NOT wired here — that's a follow-up tied to the step 3
  // "Approve" feedback round-trip, which still uses MOCK data.
  const handleSend = useCallback(
    async (qNum: number, text: string) => {
      const q = review.questions.find((qq) => qq.num === qNum);
      if (!q) return;
      setChatThreads((prev) => ({
        ...prev,
        [qNum]: [...(prev[qNum] || []), { type: "teacher", text }],
      }));
      setAnalyzingQ(qNum);
      try {
        const data = await analyzeComment({
          // Keep the question context compact — /api/analyze-comment is
          // a lightweight call, no need to thread the full task PDF.
          question: `${q.label}: ${q.prompt}`,
          student_answer: q.lines.join("\n").slice(0, 2000),
          teacher_comment: text,
        });
        setChatThreads((prev) => ({
          ...prev,
          [qNum]: [
            ...(prev[qNum] || []),
            {
              type: "ai",
              text: (data.analysis || "").trim() ||
                "AI chưa phân tích được — thử lại với câu cụ thể hơn.",
              lesson: (data.lesson || "").trim(),
              verdict: data.verdict as CommentVerdict,
            },
          ],
        }));
      } catch (err) {
        console.error("[regrade] analyze-comment failed:", err);
        setChatThreads((prev) => ({
          ...prev,
          [qNum]: [
            ...(prev[qNum] || []),
            {
              type: "ai",
              text: "Mất kết nối với AI — bạn kiểm tra lại mạng rồi gửi lại.",
            },
          ],
        }));
      } finally {
        setAnalyzingQ((curr) => (curr === qNum ? null : curr));
      }
    },
    [review.questions],
  );
  // Per-câu expand/collapse state. Default: expand câu where AI lost points
  // OR has any "error" annotation — those are the ones the teacher actually
  // needs to look at. Câu that AI nailed start collapsed so the page scales
  // from 3 to 10+ câu without becoming a wall. Teacher can override either
  // direction; opening chat on a câu also forces it expanded (see openChat).
  const [expandedQs, setExpandedQs] = useState<Set<number>>(() => {
    const init = new Set<number>();
    for (const q of review.questions) {
      const hasError = q.annotations.some((a) => a.kind === "error");
      const lostPoints =
        q.maxPoints != null && q.aiScore < q.maxPoints - 0.001;
      if (hasError || lostPoints) init.add(q.num);
    }
    return init;
  });

  const toggleExpanded = (n: number) =>
    setExpandedQs((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  const expandAll = () =>
    setExpandedQs(new Set(review.questions.map((q) => q.num)));
  const collapseAll = () => setExpandedQs(new Set());
  const allExpanded = expandedQs.size === review.questions.length;

  // "Hoàn tất bài này" → submit HITL feedback (approve) BEFORE navigating
  // to step 5, so the chat lessons + score-override notes the teacher
  // produced in this step actually reach the memory store. Backend
  // priorities (from CLAUDE.md):
  //   • staged per-câu lessons (3.5) > aggregated comment (3.0) > raw text
  //   • approve also back-fills correct_code on earlier lessons for the
  //     same task — useful even if there were no chat messages
  // So we POST even when stagedLessons is empty: the back-fill alone is
  // worth recording. Score deltas separately persist via /api/finalize-
  // grade on step 5 (delta-lesson threshold = 0.10 overall).
  const handleFinish = useCallback(async () => {
    if (feedbackHook.isSubmitting) return;

    const stagedLessons: StagedLesson[] = Object.entries(chatThreads).flatMap(
      ([numStr, msgs]) => {
        const lessonText = getStageableLesson(msgs);
        if (!lessonText) return [];
        return [{ lesson_text: lessonText, question_ref: `Câu ${numStr}` }];
      },
    );

    const aggregatedNote = Object.entries(chatThreads)
      .flatMap(([numStr, msgs]) =>
        msgs
          .filter((m) => m.type === "teacher")
          .map((m) => `[Câu ${numStr}] ${m.text}`),
      )
      .join("\n");

    const res = await feedbackHook.submit({
      action: "approve",
      comment: aggregatedNote,
      task,
      wrongCode: pipelineCode || "",
      runId,
      stagedLessons,
      subject,
    });

    // Only advance if the POST returned (succeeded or was cancelled
    // cleanly). On error, feedbackHook.error renders below the action
    // bar so the teacher sees what went wrong — they can retry without
    // losing chat state.
    if (res && onFinish) onFinish();
  }, [
    chatThreads,
    feedbackHook,
    onFinish,
    pipelineCode,
    runId,
    subject,
    task,
  ]);

  // Open chat AND ensure the câu is expanded — without the expand step,
  // closing the chat would snap the câu back to collapsed and hide the
  // score editor the teacher likely wants to adjust next.
  const openChat = (n: number) => {
    setActiveQ(n);
    setExpandedQs((prev) => {
      if (prev.has(n)) return prev;
      const next = new Set(prev);
      next.add(n);
      return next;
    });
  };

  // Resolve the cap for a câu: đề-specified first, teacher override
  // second, else undefined (free input).
  const effectiveMax = (q: RegradeQuestion): number | undefined =>
    q.maxPoints ?? maxOverrides[q.num];

  // Total = sum across all câu, falling back to AI score where teacher hasn't
  // touched yet. We always have a number here so the header always shows a
  // value; the "—" sentinel from the reference appears only when nothing is
  // set, but in our flow defaulting to AI matches the teacher's mental model.
  const teacherTotal = review.questions.reduce(
    (s, q) => s + (finalScores[q.num] ?? q.aiScore),
    0,
  );
  const anyEdited =
    Object.keys(finalScores).length > 0 || Object.keys(maxOverrides).length > 0;

  const activeQuestion =
    activeQ != null
      ? review.questions.find((q) => q.num === activeQ) ?? null
      : null;
  const chatOpen = activeQuestion != null;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <div
        style={{
          display: chatOpen ? "grid" : "block",
          gridTemplateColumns: chatOpen ? "minmax(0, 1fr) 420px" : undefined,
          gap: 18,
          alignItems: "start",
        }}
      >
        <PaperRegrade
          review={review}
          activeQ={activeQ}
          openChat={openChat}
          finalScores={finalScores}
          setFinalScores={setFinalScores}
          maxOverrides={maxOverrides}
          setMaxOverrides={setMaxOverrides}
          effectiveMax={effectiveMax}
          teacherTotal={teacherTotal}
          anyEdited={anyEdited}
          expandedQs={expandedQs}
          toggleExpanded={toggleExpanded}
          expandAll={expandAll}
          collapseAll={collapseAll}
          allExpanded={allExpanded}
          essayImage={essayImage}
          onViewOriginal={() => setShowOriginal(true)}
        />
        {chatOpen && (
          <ChatRail
            question={activeQuestion}
            messages={chatThreads[activeQuestion.num] || []}
            analyzing={analyzingQ === activeQuestion.num}
            onSend={(text) => handleSend(activeQuestion.num, text)}
            onClose={() => setActiveQ(null)}
          />
        )}
      </div>

      {/* Bottom action bar — mirrors step 3's pattern: back / status /
          forward. Status text uses the live teacher total when anything
          has been edited, otherwise the "lessons sẽ lưu" disclaimer so
          the teacher knows what committing means. */}
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
          type="button"
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
          ← Xem lại bản chấm
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
          {anyEdited ? (
            <>
              Điểm cuối:{" "}
              <span
                style={{
                  fontFamily: T.mono,
                  fontWeight: 700,
                  color: T.text,
                }}
              >
                {teacherTotal.toFixed(1)}
              </span>
              <span style={{ color: T.textFaint }}>
                {" "}
                / {review.maxTotal.toFixed(1)}đ
              </span>
              <span style={{ color: T.textFaint }}> · </span>
              Mỗi thay đổi sẽ lưu thành lesson cho lần chấm tiếp.
            </>
          ) : (
            "Tất cả thay đổi sẽ lưu thành lessons cho lần chấm tiếp."
          )}
        </div>
        <button
          type="button"
          onClick={handleFinish}
          disabled={!onFinish || feedbackHook.isSubmitting}
          style={{
            padding: "12px 22px",
            fontSize: 14,
            color: "#fff",
            background: feedbackHook.isSubmitting ? T.textMute : T.red,
            border: "none",
            borderRadius: 10,
            cursor:
              !onFinish || feedbackHook.isSubmitting
                ? "not-allowed"
                : "pointer",
            transition: "all 0.2s",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 600,
            boxShadow: feedbackHook.isSubmitting ? "none" : T.shadowSoft,
            opacity: !onFinish ? 0.5 : 1,
            whiteSpace: "nowrap",
          }}
          title={
            feedbackHook.isSubmitting
              ? "Đang lưu phản hồi HITL…"
              : "Lưu phản hồi HITL và sang bước Hoàn thành."
          }
        >
          {feedbackHook.isSubmitting ? (
            <>
              <Icon.RefreshCw size={14} color="#fff" />
              Đang lưu…
            </>
          ) : (
            <>
              Hoàn tất bài này
              <svg
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </>
          )}
        </button>
      </div>

      {/* Feedback POST error — surfaces here (not as a toast) so the
          teacher sees the failure in the same eyeline as the button they
          just clicked. Retry works in place; their chat state and score
          edits are still in component state. */}
      {feedbackHook.error && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: T.redSoft,
            border: `1px solid ${T.red}`,
            borderRadius: 8,
            fontSize: 13,
            color: T.red,
            lineHeight: 1.5,
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
          }}
        >
          <Icon.AlertTriangle size={14} color={T.red} style={{ marginTop: 2 }} />
          <span>
            Không lưu được phản hồi HITL: {feedbackHook.error} — bạn thử lại
            bằng nút "Hoàn tất bài này".
          </span>
        </div>
      )}

      <OriginalImageModal
        open={showOriginal}
        essayImage={essayImage ?? null}
        onClose={() => setShowOriginal(false)}
        t={i18n.vi}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paper column
// ---------------------------------------------------------------------------

function PaperRegrade({
  review,
  activeQ,
  openChat,
  finalScores,
  setFinalScores,
  maxOverrides,
  setMaxOverrides,
  effectiveMax,
  teacherTotal,
  anyEdited,
  expandedQs,
  toggleExpanded,
  expandAll,
  collapseAll,
  allExpanded,
  essayImage,
  onViewOriginal,
}: {
  review: typeof MOCK_REGRADE;
  activeQ: number | null;
  /** Opens the chat rail pinned to a câu AND ensures that câu is
   *  expanded — see RegradeMockup.openChat for the wiring. */
  openChat: (n: number) => void;
  finalScores: Record<number, number>;
  setFinalScores: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  maxOverrides: Record<number, number>;
  setMaxOverrides: React.Dispatch<React.SetStateAction<Record<number, number>>>;
  effectiveMax: (q: RegradeQuestion) => number | undefined;
  teacherTotal: number;
  anyEdited: boolean;
  expandedQs: Set<number>;
  toggleExpanded: (n: number) => void;
  expandAll: () => void;
  collapseAll: () => void;
  allExpanded: boolean;
  essayImage: EssayFile | null | undefined;
  /** Called when the teacher clicks "Xem PDF gốc" — parent opens the
   *  OriginalImageModal. Undefined ⇒ button renders disabled. */
  onViewOriginal?: () => void;
}) {
  // Exam-level cap check. When per-câu maxPoints isn't supplied by the đề
  // we let the input run free; this is where the safety net catches it.
  // Tiny tolerance avoids triggering on float noise (1.0 + 2.0 + 7.0 == 10
  // can wobble to 10.0000000004 in JS).
  const overCap = anyEdited && teacherTotal - review.maxTotal > 0.001;
  return (
    <div
      style={{
        background: T.paper,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        boxShadow: T.shadowSoft,
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      {/* paper-head — "Chấm lại" eyebrow + subtitle on left, score
          comparison on right. Bg is elevated to read as a title bar. */}
      <div
        style={{
          padding: "14px 20px",
          background: T.bgElevated,
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
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
            Chấm lại
          </div>
          <div
            style={{
              fontFamily: T.font,
              fontSize: 18,
              fontWeight: 600,
              color: T.text,
              letterSpacing: "-0.005em",
            }}
          >
            Sửa điểm hoặc chat với AI về từng câu
          </div>
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontFamily: T.mono,
              color: T.textMute,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>điểm AI: {review.aiOverall.toFixed(1)}</span>
            <span style={{ color: T.textFaint }}>→</span>
            <span
              style={{
                color: overCap ? T.red : anyEdited ? T.text : T.textMute,
                fontWeight: 600,
              }}
            >
              bạn: {anyEdited ? teacherTotal.toFixed(1) : "—"}
              <span style={{ color: T.textFaint, fontWeight: 400 }}>
                {" "}
                / {review.maxTotal.toFixed(1)}
              </span>
            </span>
          </div>
          {overCap && (
            // Cap-overrun chip — only appears when teacher total exceeds
            // the exam cap. Uses red softfill (consistent with other
            // warning chips in the app) so it reads as a soft alert,
            // not a blocking error. Teacher can still proceed; this is
            // a heads-up not a gate.
            <span
              style={{
                padding: "3px 9px",
                background: T.redSoft,
                border: `1px solid ${T.red}`,
                color: T.red,
                fontFamily: T.font,
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 999,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                lineHeight: 1.4,
              }}
              title={`Tổng điểm vượt mức tối đa ${review.maxTotal.toFixed(1)}đ — kiểm tra lại từng câu.`}
            >
              <Icon.AlertTriangle size={11} color={T.red} />
              Vượt {(teacherTotal - review.maxTotal).toFixed(2)}đ
            </span>
          )}
          {/* Expand/collapse-all — sized as a sibling pill of "Xem PDF gốc"
              so the header reads as a single controls cluster. Only one of
              the two states shows at a time; clicking flips the bulk state
              of expandedQs. With 3 câu this is mild convenience; with 10+
              câu (real đề kiểm tra) it's the difference between scrolling
              once and clicking ten times. */}
          <ExpandAllToggle
            allExpanded={allExpanded}
            onClick={allExpanded ? collapseAll : expandAll}
          />
          {/* "Xem PDF gốc" — lets the teacher pop open the raw student PDF
              to spot-check that AI's transcription matches the original
              before locking down a score change. Same affordance ships on
              Step 3 (Xem xét) for visual + functional consistency. */}
          <ViewOriginalButton
            onClick={onViewOriginal}
            disabled={!essayImage?.dataUrl}
          />
        </div>
      </div>

      {/* Per-câu blocks stack inside the same paper. Border-bottom between
          them keeps the document-flow feel — no individual cards. */}
      <div>
        {review.questions.map((q, i) => (
          <RegradeQuestionBlock
            key={q.num}
            q={q}
            active={activeQ === q.num}
            expanded={expandedQs.has(q.num) || activeQ === q.num}
            onToggleExpand={() => toggleExpanded(q.num)}
            isLast={i === review.questions.length - 1}
            myScore={finalScores[q.num] ?? q.aiScore}
            // "Edited" = teacher set a value that's MATERIALLY different
            // from AI's. Just touching the input (e.g. clicking it then
            // tabbing away) used to flip this true with a 0.00 delta —
            // which then surfaced as a misleading "Đã sửa" pill / red
            // input border on a câu the teacher hadn't really changed.
            isEdited={
              finalScores[q.num] != null &&
              Math.abs(finalScores[q.num] - q.aiScore) > 0.001
            }
            // Effective max: đề-supplied when present, else teacher's
            // manual override (or undefined when neither is set yet).
            cap={effectiveMax(q)}
            // Whether teacher needs to fill in the cap themselves —
            // controls the editable max input in the câu header.
            capEditable={q.maxPoints == null}
            maxOverride={maxOverrides[q.num]}
            onMaxOverrideChange={(v) =>
              setMaxOverrides((prev) => {
                const next = { ...prev };
                if (v == null || Number.isNaN(v)) delete next[q.num];
                else next[q.num] = v;
                return next;
              })
            }
            onScoreChange={(s) =>
              setFinalScores((prev) => ({ ...prev, [q.num]: s }))
            }
            onClickChat={() => openChat(q.num)}
          />
        ))}
      </div>
    </div>
  );
}

function RegradeQuestionBlock({
  q,
  active,
  expanded,
  onToggleExpand,
  isLast,
  myScore,
  isEdited,
  cap,
  capEditable,
  maxOverride,
  onMaxOverrideChange,
  onScoreChange,
  onClickChat,
}: {
  q: RegradeQuestion;
  active: boolean;
  /** Whether this câu's body (image slots, transcript, score editor) is
   *  visible. The header is always rendered. */
  expanded: boolean;
  /** Toggle expand/collapse. Fired by clicking the header chrome or by
   *  Enter/Space while the header div has focus. Interactive descendants
   *  inside the header (the cap editor input) stopPropagation to avoid
   *  spurious toggles while typing. */
  onToggleExpand: () => void;
  isLast: boolean;
  myScore: number;
  isEdited: boolean;
  /** Effective per-câu cap: đề-supplied or teacher-overridden. Undefined
   *  when the đề doesn't quy định AND the teacher hasn't filled it in. */
  cap: number | undefined;
  /** When true, the header renders an editable input next to "Tối đa:"
   *  instead of a read-only label. */
  capEditable: boolean;
  /** Teacher's current override value (raw input state). */
  maxOverride: number | undefined;
  /** Fires when teacher edits the cap input. Pass undefined to clear. */
  onMaxOverrideChange: (v: number | undefined) => void;
  onScoreChange: (s: number) => void;
  onClickChat: () => void;
}) {
  const delta = myScore - q.aiScore;
  const hasError = q.annotations.some((a) => a.kind === "error");
  return (
    <div
      style={{
        borderBottom: isLast ? "none" : `1px solid ${T.borderLight}`,
        background: active ? "#FBEEEA" : "transparent",
        transition: "background 0.15s",
      }}
    >
      {/* Câu header — always visible. Clicking anywhere in the chrome
          (chevron / label / prompt / score chip / cap label) toggles
          expand; the cap editor input stops propagation so typing
          doesn't fire a toggle. */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={`câu-${q.num}-body`}
        onClick={onToggleExpand}
        onKeyDown={(e) => {
          // Only handle keyboard activation when focus is on the header
          // itself, not on a nested input/button. Otherwise typing a
          // space in the cap editor would collapse the câu.
          if (
            (e.key === "Enter" || e.key === " ") &&
            e.target === e.currentTarget
          ) {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        style={{
          padding: "14px 24px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <Chevron expanded={expanded} />
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <span style={{ fontWeight: 600, marginRight: 10, color: T.text }}>
            {q.label}
          </span>
          <span style={{ fontSize: 13, color: T.textMute }}>{q.prompt}</span>
          {hasError && !expanded && (
            // Collapsed-only marker — tells the teacher this câu has AI-
            // flagged issues without forcing them to expand. Mirrors the
            // auto-expand heuristic in RegradeMockup's initializer so the
            // signal is consistent: if it earns this marker, it would
            // have been expanded by default until the teacher collapsed.
            <span
              style={{
                marginLeft: 8,
                fontSize: 11,
                fontFamily: T.font,
                color: T.red,
                fontStyle: "italic",
              }}
              title="AI đã đánh dấu lỗi ở câu này"
            >
              · cần xem
            </span>
          )}
        </div>
        <HeaderScoreChip
          aiScore={q.aiScore}
          cap={cap}
          isEdited={isEdited}
        />
        {capEditable ? (
          // Đề không quy định — render an inline editable input so the
          // teacher decides this câu's cap themselves. Empty = "chưa đặt"
          // (no cap → input below runs free, header total catches it).
          <label
            style={{
              fontSize: 11,
              fontFamily: T.mono,
              color: T.textMute,
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
            title="Đề bài không quy định điểm — bạn tự đặt mức tối đa cho câu này."
            onClick={(e) => e.stopPropagation()}
          >
            Tối đa:
            <input
              type="number"
              step={0.25}
              min={0}
              max={10}
              placeholder="—"
              value={maxOverride ?? ""}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === "") {
                  onMaxOverrideChange(undefined);
                  return;
                }
                const v = parseFloat(raw);
                if (Number.isNaN(v)) return;
                onMaxOverrideChange(Math.max(0, Math.min(10, v)));
              }}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 54,
                padding: "3px 6px",
                fontFamily: T.mono,
                fontSize: 12,
                fontWeight: 600,
                color: T.text,
                background: T.bgCard,
                border: `1px solid ${maxOverride != null ? T.accent : T.border}`,
                borderRadius: 4,
                outline: "none",
                textAlign: "center",
              }}
            />
            đ
          </label>
        ) : (
          <span
            style={{
              fontSize: 11,
              fontFamily: T.mono,
              color: T.textMute,
              flexShrink: 0,
            }}
          >
            tối đa {(cap ?? 0).toFixed(1)}đ
          </span>
        )}
      </div>

      {expanded && (
        <div
          id={`câu-${q.num}-body`}
          style={{ padding: "0 24px 18px 24px" }}
        >
          {/* Per-câu đề figure / student-answer image slots were removed:
              they required per-câu bounding boxes the backend doesn't
              emit (Gemini reads the PDF natively but doesn't return
              coordinates), so rendering a permanent "placeholder" card
              just confused teachers without delivering value. Header's
              "Xem PDF gốc" button already shows the whole bài làm for
              spot-check. Re-add cropped slots here when the backend
              starts returning per-câu regions. */}

          {/* AI transcript (mono) with annotations stacked below the
              lines. Kept as-is from prior design — still useful for
              searchability and as a fallback when the image is hard to
              read. The "AI đã đọc" eyebrow makes the relationship to
              the image above explicit. */}
          <div
            style={{
              fontFamily: T.mono,
              fontSize: 13.5,
              color: T.textSoft,
              lineHeight: 1.75,
              padding: "12px 16px",
              background: T.bgCard,
              border: `1px solid ${T.borderLight}`,
              borderRadius: 8,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: T.textFaint,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 8,
                fontFamily: T.font,
              }}
            >
              AI đã đọc
            </div>
            {q.lines.map((line, i) => (
              <div key={i} style={{ whiteSpace: "pre" }}>
                {line}
              </div>
            ))}
            {q.annotations.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: `1px dashed ${T.borderLight}`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {q.annotations.map((a, i) => (
                  <div
                    key={i}
                    style={{
                      color: T.red,
                      fontStyle: "italic",
                      fontFamily: T.font,
                      fontSize: 13,
                    }}
                  >
                    {a.kind === "good" ? "✓" : "×"} {a.text}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Score editor row — AI score | teacher input | Chat button */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) auto",
              gap: 12,
              alignItems: "center",
              padding: "12px 16px",
              background: T.bgMuted,
              border: `1px solid ${T.borderLight}`,
              borderRadius: 8,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: T.textFaint,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                AI chấm
              </div>
              <div
                style={{
                  fontFamily: T.mono,
                  fontSize: 18,
                  fontWeight: 600,
                  color: T.text,
                }}
              >
                {q.aiScore.toFixed(1)}
                {cap != null && (
                  <span
                    style={{ color: T.textMute, fontSize: 13, fontWeight: 400 }}
                  >
                    /{cap.toFixed(1)}
                  </span>
                )}
              </div>
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: T.textFaint,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  marginBottom: 4,
                }}
              >
                Điểm của bạn
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="number"
                  step={0.25}
                  min={0}
                  // Per-câu cap is the effective max (đề-supplied OR teacher
                  // override). When the teacher hasn't filled in the
                  // override for a non-quy-định câu, no upper constraint
                  // applies and the exam-level cap (10đ) catches it at
                  // the header.
                  max={cap}
                  value={myScore}
                  onChange={(e) => {
                    const raw = parseFloat(e.target.value || "0");
                    if (Number.isNaN(raw)) {
                      onScoreChange(q.aiScore);
                      return;
                    }
                    const clamped =
                      cap != null
                        ? Math.max(0, Math.min(cap, raw))
                        : Math.max(0, raw);
                    onScoreChange(clamped);
                  }}
                  style={{
                    width: 72,
                    fontFamily: T.mono,
                    fontSize: 17,
                    fontWeight: 600,
                    padding: "5px 10px",
                    border: `1px solid ${isEdited ? T.red : T.border}`,
                    borderRadius: 6,
                    background: T.bgCard,
                    color: T.text,
                    outline: "none",
                  }}
                />
                {Math.abs(delta) > 0.001 && (
                  <span
                    style={{
                      fontFamily: T.mono,
                      fontSize: 12,
                      color: T.red,
                      fontWeight: 600,
                    }}
                  >
                    {delta > 0 ? "+" : ""}
                    {delta.toFixed(2)}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClickChat}
              aria-pressed={active}
              style={{
                background: active ? T.text : T.bgCard,
                color: active ? T.bgCard : T.text,
                border: `1px solid ${active ? T.text : T.border}`,
                borderRadius: 8,
                padding: "8px 14px",
                fontFamily: T.font,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
                transition:
                  "background 0.15s, color 0.15s, border-color 0.15s",
              }}
            >
              <SparkleIcon size={12} />
              Chat với AI
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat rail (right column, conditional)
// ---------------------------------------------------------------------------

function ChatRail({
  question,
  messages,
  analyzing,
  onSend,
  onClose,
}: {
  question: RegradeQuestion;
  messages: ThreadMessage[];
  /** True when an /api/analyze-comment request for this câu is in
   *  flight. Disables the send button + textarea and shows a typing
   *  bubble so the teacher doesn't double-fire. */
  analyzing: boolean;
  /** Caller owns the API call + message-list mutation — the rail just
   *  pipes the trimmed text up. */
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");

  const send = () => {
    const trimmed = draft.trim();
    if (!trimmed || analyzing) return;
    onSend(trimmed);
    setDraft("");
  };

  return (
    <aside
      style={{
        background: T.bgCard,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        boxShadow: T.shadowSoft,
        display: "flex",
        flexDirection: "column",
        position: "sticky",
        top: 16,
        alignSelf: "start",
        maxHeight: "calc(100vh - 32px)",
        overflow: "hidden",
      }}
    >
      {/* rail-head */}
      <div
        style={{
          padding: "14px 18px",
          background: T.bgElevated,
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 6,
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
            Chat với AI · {question.label}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng chat"
            title="Đóng"
            style={{
              background: "transparent",
              border: "none",
              padding: 4,
              cursor: "pointer",
              color: T.textMute,
              display: "inline-flex",
              alignItems: "center",
              borderRadius: 4,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = T.text)}
            onMouseLeave={(e) => (e.currentTarget.style.color = T.textMute)}
          >
            <Icon.X size={14} />
          </button>
        </div>
        <div
          style={{
            fontSize: 13,
            color: T.textSoft,
            lineHeight: 1.5,
          }}
        >
          Hỏi AI lý do, đề xuất sửa điểm — câu trả lời sẽ ảnh hưởng các lần
          chấm tiếp.
        </div>
      </div>

      {/* chat-feed (scrollable). Seed-suggestion bubble shows ONLY when
          the thread is empty — once a real message exists, the seed
          collapses out so the conversation is the focus. */}
      <div
        style={{
          padding: "16px 18px",
          overflowY: "auto",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              background: T.bgMuted,
              border: `1px solid ${T.borderLight}`,
              borderRadius: 10,
              padding: "12px 14px",
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: T.textFaint,
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              MIRROR · Gợi ý
            </div>
            <div style={{ color: T.text, fontWeight: 500 }}>
              {question.summary}
            </div>
            <div
              style={{
                marginTop: 4,
                color: T.textMute,
                fontSize: 12.5,
              }}
            >
              Hãy cho mình biết bạn nghĩ gì về câu này.
            </div>
            {question.chatSuggestions.length > 0 && (
              <div
                style={{
                  marginTop: 10,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {question.chatSuggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setDraft(s)}
                    style={{
                      background: T.bgCard,
                      border: `1px solid ${T.border}`,
                      borderRadius: 6,
                      padding: "7px 10px",
                      fontSize: 12.5,
                      fontFamily: T.font,
                      color: T.textSoft,
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "border-color 0.12s, color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = T.text;
                      e.currentTarget.style.color = T.text;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = T.border;
                      e.currentTarget.style.color = T.textSoft;
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m, idx) => (
          <ChatBubble key={idx} message={m} />
        ))}

        {analyzing && <ChatTyping />}
      </div>

      {/* chat-compose */}
      <div
        style={{
          padding: "12px 16px 14px",
          borderTop: `1px solid ${T.borderLight}`,
          display: "flex",
          gap: 8,
          alignItems: "flex-end",
          flexShrink: 0,
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            analyzing ? "AI đang trả lời…" : `Hỏi AI về ${question.label}…`
          }
          rows={2}
          disabled={analyzing}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          style={{
            flex: 1,
            resize: "vertical",
            minHeight: 40,
            maxHeight: 120,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            padding: "9px 12px",
            background: analyzing ? T.bgMuted : T.bgInput,
            color: T.text,
            fontFamily: T.font,
            fontSize: 13,
            outline: "none",
            opacity: analyzing ? 0.7 : 1,
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = T.accent)}
          onBlur={(e) => (e.currentTarget.style.borderColor = T.border)}
        />
        <button
          type="button"
          onClick={send}
          disabled={!draft.trim() || analyzing}
          aria-label="Gửi"
          title="Gửi (Enter)"
          style={{
            background: draft.trim() && !analyzing ? T.red : T.bgMuted,
            color: draft.trim() && !analyzing ? "#FFFDF8" : T.textFaint,
            border: "none",
            borderRadius: 8,
            padding: "10px 14px",
            cursor: draft.trim() && !analyzing ? "pointer" : "not-allowed",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.15s, color 0.15s",
          }}
        >
          <SendIcon size={14} />
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Chat helpers (bubble + typing indicator)
// ---------------------------------------------------------------------------

const VERDICT_TONE: Record<CommentVerdict, { color: string; bg: string; label: string }> = {
  agree:   { color: "#1F7A4C", bg: "#E3F4EA", label: "Đồng ý" },
  partial: { color: "#A8770A", bg: "#FCF1D8", label: "Một phần"  },
  dispute: { color: "#A1392A", bg: "#FBE3DF", label: "Phản biện" },
};

function ChatBubble({ message }: { message: ThreadMessage }) {
  const isTeacher = message.type === "teacher";
  if (isTeacher) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div
          style={{
            background: T.accentSoft,
            color: T.text,
            borderRadius: "10px 10px 2px 10px",
            padding: "9px 12px",
            fontSize: 13,
            lineHeight: 1.55,
            maxWidth: "85%",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {message.text}
        </div>
      </div>
    );
  }

  const verdict = message.verdict;
  const tone = verdict ? VERDICT_TONE[verdict] : null;
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div style={{ maxWidth: "92%", display: "flex", flexDirection: "column", gap: 6 }}>
        {tone && (
          // Verdict badge sits above the bubble so the analysis text
          // doesn't compete with it. Keep colours desaturated — Gemini
          // can be wrong about dispute, no need to scream.
          <span
            style={{
              alignSelf: "flex-start",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: tone.color,
              background: tone.bg,
              padding: "2px 8px",
              borderRadius: 999,
            }}
          >
            {tone.label}
          </span>
        )}
        <div
          style={{
            background: T.bgMuted,
            color: T.text,
            border: `1px solid ${T.borderLight}`,
            borderRadius: "10px 10px 10px 2px",
            padding: "9px 12px",
            fontSize: 13,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {message.text}
          {message.lesson && (
            <div
              style={{
                marginTop: 8,
                paddingTop: 8,
                borderTop: `1px dashed ${T.border}`,
                fontSize: 12.5,
                color: T.textSoft,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: T.textFaint,
                  marginRight: 6,
                }}
              >
                Quy tắc rút ra
              </span>
              {message.lesson}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatTyping() {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start" }}>
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: T.bgMuted,
          border: `1px solid ${T.borderLight}`,
          borderRadius: "10px 10px 10px 2px",
          padding: "8px 12px",
          fontSize: 12,
          color: T.textMute,
          fontStyle: "italic",
        }}
      >
        <Icon.RefreshCw size={11} color={T.textMute} />
        AI đang phân tích…
      </div>
    </div>
  );
}

// ViewOriginalButton — pop the raw student PDF for spot-checking AI's
// transcription. Same shape + padding + radius as the lessons pill on
// Step 3 so the two surfaces look like siblings, not cousins. Wired via
// the `onClick` prop — parent owns the modal-toggle state so the same
// click handler can be reused / disabled centrally.
function ViewOriginalButton({
  onClick,
  disabled = false,
}: {
  onClick?: () => void;
  /** True when no essayImage is available — the button shows greyed
   *  out instead of disappearing, so the affordance doesn't flicker
   *  when the upload finishes mid-render. */
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      title={
        disabled
          ? "Chưa có bài làm gốc trong phiên này."
          : "Mở bài làm gốc để đối chiếu với phần AI đã chép"
      }
      style={{
        // Style values mirror StepReview's MetaPill 1:1. Kept inline here
        // (not imported) so this file stays self-contained; if we ship
        // a third pill anywhere we'll lift MetaPill into components/ui.
        padding: "4px 10px",
        background: T.bgCard,
        border: `1px solid ${T.border}`,
        borderRadius: 999,
        fontSize: 12,
        fontFamily: T.font,
        fontWeight: 400,
        lineHeight: 1.45,
        color: disabled ? T.textFaint : T.textSoft,
        cursor: disabled || !onClick ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        margin: 0,
        transition: "color 0.12s, border-color 0.12s",
      }}
      onMouseEnter={(e) => {
        if (disabled || !onClick) return;
        e.currentTarget.style.color = T.accent;
        e.currentTarget.style.borderColor = T.accent;
      }}
      onMouseLeave={(e) => {
        if (disabled || !onClick) return;
        e.currentTarget.style.color = T.textSoft;
        e.currentTarget.style.borderColor = T.border;
      }}
    >
      <Icon.FileText size={11} />
      Xem PDF gốc
    </button>
  );
}

// ---------------------------------------------------------------------------
// Collapsible header helpers
// ---------------------------------------------------------------------------

// Chevron — rotates 90° on expand. Inline SVG so the block doesn't reach
// into the shared Icon set for a single-use glyph (the existing
// `Icon.ChevronRight` is a different stroke weight and doesn't support
// the rotate transition cleanly).
function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        color: T.textMute,
        transform: `rotate(${expanded ? 90 : 0}deg)`,
        transition: "transform 0.15s",
        flexShrink: 0,
      }}
    >
      <svg
        width={12}
        height={12}
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
  );
}

// HeaderScoreChip — compact AI score read-out for the collapsed header.
//
// Intentionally NOT a summary statement. Previous version showed
// "AI 2.5 → 2.5 (0.00)" which mirrored the overall tổng kết pattern at
// the top of the paper too closely — teachers reading the bottom-most
// câu's chip could mistake it for the final grade. Fix: collapsed chip
// shows ONLY the AI's per-câu score (with denominator iff the đề
// specified per-câu maxPoints), plus a discrete "đã sửa" pill when the
// teacher has materially overridden it. The full AI-vs-teacher
// comparison with delta lives in the expanded score editor row, where
// it's clearly per-câu by context.
function HeaderScoreChip({
  aiScore,
  cap,
  isEdited,
}: {
  aiScore: number;
  cap: number | undefined;
  isEdited: boolean;
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 6,
        fontFamily: T.mono,
        fontSize: 12.5,
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          color: T.textFaint,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        AI
      </span>
      <span style={{ color: T.text, fontWeight: 600 }}>
        {aiScore.toFixed(1)}
        {cap != null && (
          <span style={{ color: T.textFaint, fontWeight: 400 }}>
            /{cap.toFixed(1)}
          </span>
        )}
      </span>
      {isEdited && (
        // Pill, not a number — clearly a status indicator, not a second
        // score in a comparison. Teacher opens the expanded view to see
        // the actual override value.
        <span
          style={{
            marginLeft: 2,
            padding: "1px 7px",
            borderRadius: 999,
            background: T.redSoft,
            color: T.red,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            fontFamily: T.font,
          }}
          title="Bạn đã chỉnh điểm câu này — mở rộng để xem giá trị."
        >
          Đã sửa
        </span>
      )}
    </div>
  );
}

// ExpandAllToggle — pill in the paper-head that flips between "Mở rộng
// tất cả" and "Thu gọn tất cả". Same dimensions as ViewOriginalButton so
// the two read as a paired controls cluster.
function ExpandAllToggle({
  allExpanded,
  onClick,
}: {
  allExpanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={allExpanded ? "Thu gọn tất cả câu" : "Mở rộng tất cả câu"}
      style={{
        padding: "4px 10px",
        background: T.bgCard,
        border: `1px solid ${T.border}`,
        borderRadius: 999,
        fontSize: 12,
        fontFamily: T.font,
        fontWeight: 400,
        lineHeight: 1.45,
        color: T.textSoft,
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        margin: 0,
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
      <span
        style={{
          display: "inline-flex",
          transform: `rotate(${allExpanded ? 90 : 0}deg)`,
          transition: "transform 0.15s",
        }}
      >
        <svg
          width={11}
          height={11}
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
      {allExpanded ? "Thu gọn tất cả" : "Mở rộng tất cả"}
    </button>
  );
}

// ExamFigureSlot + StudentAnswerSlot removed (2026-05-18): both rendered
// permanent "backend will fill this" placeholder cards that confused
// teachers without delivering value, because the backend doesn't emit
// per-câu bounding boxes (Gemini reads the PDF natively but doesn't
// return coordinates). Header's "Xem PDF gốc" already shows the whole
// bài làm. Re-add when the prompt + parser learn to emit per-câu regions.

// ---------------------------------------------------------------------------
// Inline SVGs — the project's Icon set doesn't ship a sparkle or paper-plane
// glyph. Defined here so RegradeMockup stays self-contained; if either glyph
// gets reused elsewhere we'll lift them into components/ui/Icon.tsx.
// ---------------------------------------------------------------------------

function SparkleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </svg>
  );
}

function SendIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4z" />
    </svg>
  );
}
