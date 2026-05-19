import { useCallback, useMemo, useState } from "react";
import { T } from "../../theme/tokens";
import { Icon } from "../../components/ui/Icon";
import { OriginalImageModal } from "../../components/ui/OriginalImageModal";
import {
  buildSyntheticAnnotations,
  parseCauHeader,
  splitTranscriptByCau,
} from "../../lib/grade";
import { i18n } from "../../i18n";
import type {
  EssayFile,
  Grade,
  SelectionAnnotation,
} from "../../types";

// ---------------------------------------------------------------------------
// RegradeMockup — Step 4 "Chốt điểm".
//
// Layout: single-column paper. Per-câu blocks list AI's annotations + a
// score editor row. The teacher's "đối soát" notes from step 3 are
// surfaced read-only above each câu's score row so prior judgment stays
// visible while the score is locked. No AI chat surface — the per-câu
// /api/analyze-comment loop was removed in favour of step 3 annotations
// feeding the HITL memory directly.
//
// Wired vs still-mock:
//   ✓ Per-câu rows come from grade.per_question_feedback.
//   ✓ Lines come from splitTranscriptByCau(grade.transcript).
//   ✓ Score edits propagate up via finalScores / maxOverrides props.
//   ✓ Teacher annotations come from workspace state (step 3 input).
//
// Annotations: Gemini doesn't emit line-level annotations yet, so we
// synthesise two badges per câu — green "good" pinned to line 1 and
// red "error" pinned to the last line.
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
  /** Forward action — moves to Step 5. HITL memory is saved atomically
   *  with the final grade from Step 5, not from this review screen. */
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
  /** Read-only mirror of teacher's step 3 Word-style annotations
   *  (highlight + comment anchored to a quote). Surfaced next to each
   *  câu's score input so the teacher can recall their independent
   *  judgment when finalizing. Step 5 saves them with the final grade. */
  teacherAnnotations?: SelectionAnnotation[];
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
  teacherAnnotations,
}: RegradeMockupProps) {
  // Derive the review payload: real grade data when the pipeline produced
  // scored per-câu, else the legacy mock so the UI still renders for
  // dev-time visual review or salvaged grades.
  const review = useMemo(() => deriveReview(grade), [grade]);
  // OriginalImageModal toggle. Lifted here (instead of inside PaperRegrade)
  // so the modal renders at the RegradeMockup root.
  const [showOriginal, setShowOriginal] = useState(false);
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

  // "Hoàn tất bài này" is now pure navigation. Saving HITL lessons in Step
  // 4 used to mark the AI's original grade as approved before the teacher
  // finalized score edits. Step 5 has the complete final grade, so it owns
  // the single atomic save to /api/finalize-grade.
  const handleFinish = useCallback(() => {
    onFinish?.();
  }, [onFinish]);

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

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto" }}>
      <PaperRegrade
        review={review}
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
        teacherAnnotations={teacherAnnotations}
      />

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
              Mỗi thay đổi sẽ lưu khi bạn xác nhận điểm.
            </>
          ) : (
            "Nhận xét và điểm sẽ lưu khi bạn xác nhận điểm ở bước cuối."
          )}
        </div>
        <button
          type="button"
          onClick={handleFinish}
          disabled={!onFinish}
          style={{
            padding: "12px 22px",
            fontSize: 14,
            color: "#fff",
            background: T.red,
            border: "none",
            borderRadius: 10,
            cursor: !onFinish ? "not-allowed" : "pointer",
            transition: "all 0.2s",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontWeight: 600,
            boxShadow: T.shadowSoft,
            opacity: !onFinish ? 0.5 : 1,
            whiteSpace: "nowrap",
          }}
          title="Sang bước Hoàn thành. Nhận xét HITL sẽ lưu khi bạn xác nhận điểm."
        >
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
        </button>
      </div>

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
  teacherAnnotations,
}: {
  review: typeof MOCK_REGRADE;
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
  onViewOriginal?: () => void;
  teacherAnnotations?: SelectionAnnotation[];
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
            Chốt điểm từng câu — đối chiếu với ghi chú của bạn ở bước trước
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
            expanded={expandedQs.has(q.num)}
            onToggleExpand={() => toggleExpanded(q.num)}
            isLast={i === review.questions.length - 1}
            myScore={finalScores[q.num] ?? q.aiScore}
            teacherNotes={
              (teacherAnnotations ?? []).filter((a) => a.cau === q.num)
            }
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
          />
        ))}
      </div>
    </div>
  );
}

// Normalize a string for quote matching across NFC/NFD + nbsp variants.
// Mirrors the helper in StepReview so step 3 highlights and step 4
// highlights match the same teacher quotes.
function normalizeForMatch(s: string): string {
  return s.normalize("NFC").replace(/\u00A0/g, " ");
}

// Render a single transcript line with the teacher's step 3 quotes
// highlighted inline. Read-only — no click handlers, no verdict colors;
// just a peach background + the teacher's comment as a hover title so
// the marker carries meaning without a separate notes block.
function renderLineWithTeacherHighlights(
  line: string,
  lineIdx: number,
  anns: SelectionAnnotation[],
): React.ReactNode[] {
  type Seg = { text: string; ann: SelectionAnnotation | null };
  let segs: Seg[] = [{ text: line, ann: null }];
  for (const ann of anns) {
    const endIdx = ann.endLineIdx ?? ann.lineIdx;
    if (lineIdx < ann.lineIdx || lineIdx > endIdx) continue;
    const isMultiline = endIdx > ann.lineIdx;
    let needleSource: string;
    if (!isMultiline) {
      needleSource = ann.quote;
    } else if (lineIdx === ann.lineIdx) {
      needleSource = ann.quote.split("\n")[0] ?? ann.quote;
    } else if (lineIdx === endIdx) {
      const parts = ann.quote.split("\n");
      needleSource = parts[parts.length - 1] ?? ann.quote;
    } else {
      needleSource = line;
    }
    const needle = normalizeForMatch(needleSource);
    const next: Seg[] = [];
    let placed = false;
    for (const seg of segs) {
      if (seg.ann || placed) {
        next.push(seg);
        continue;
      }
      const haystack = normalizeForMatch(seg.text);
      const idx = haystack.indexOf(needle);
      if (idx === -1) {
        next.push(seg);
        continue;
      }
      if (idx > 0) next.push({ text: seg.text.slice(0, idx), ann: null });
      next.push({ text: seg.text.slice(idx, idx + needleSource.length), ann });
      const tail = seg.text.slice(idx + needleSource.length);
      if (tail.length > 0) next.push({ text: tail, ann: null });
      placed = true;
    }
    segs = next;
  }
  return segs.map((seg, i) => {
    if (!seg.ann) return <span key={i}>{seg.text}</span>;
    const ann = seg.ann;
    const tooltip = ann.comment
      ? `Nhận xét: ${ann.comment}`
      : `“${ann.quote}” (chưa có nhận xét)`;
    return (
      <mark
        key={i}
        title={tooltip}
        style={{
          background: "#FBEEEA",
          color: T.text,
          padding: 0,
          borderRadius: 0,
        }}
      >
        {seg.text}
      </mark>
    );
  });
}

function RegradeQuestionBlock({
  q,
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
  teacherNotes,
}: {
  q: RegradeQuestion;
  expanded: boolean;
  onToggleExpand: () => void;
  isLast: boolean;
  myScore: number;
  isEdited: boolean;
  cap: number | undefined;
  capEditable: boolean;
  maxOverride: number | undefined;
  onMaxOverrideChange: (v: number | undefined) => void;
  onScoreChange: (s: number) => void;
  /** Teacher's step 3 "đối soát" annotations for this câu — read-only
   *  here. Rendered above the score editor so the teacher sees their
   *  own prior reasoning before locking the score. Each entry has a
   *  quoted snippet + comment. */
  teacherNotes: SelectionAnnotation[];
}) {
  const delta = myScore - q.aiScore;
  const hasError = q.annotations.some((a) => a.kind === "error");
  return (
    <div
      style={{
        borderBottom: isLast ? "none" : `1px solid ${T.borderLight}`,
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
              fontSize: 16,
              color: T.textSoft,
              lineHeight: 1.8,
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
              <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {renderLineWithTeacherHighlights(line, i, teacherNotes)}
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

          {/* Score editor row — compact horizontal: AI score → teacher
              input → delta, all on one line so the teacher can compare
              at a glance. Grid layout used to waste the full width on
              two narrow values. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              padding: "10px 16px",
              background: T.bgMuted,
              border: `1px solid ${T.borderLight}`,
              borderRadius: 8,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: T.textFaint,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                AI
              </span>
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 16,
                  fontWeight: 600,
                  color: T.textSoft,
                }}
              >
                {q.aiScore.toFixed(1)}
                {cap != null && (
                  <span
                    style={{ color: T.textMute, fontSize: 12, fontWeight: 400 }}
                  >
                    /{cap.toFixed(1)}
                  </span>
                )}
              </span>
            </div>

            <span
              style={{
                color: T.textFaint,
                fontSize: 14,
                fontWeight: 600,
                userSelect: "none",
              }}
            >
              →
            </span>

            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: T.textFaint,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                }}
              >
                Bạn
              </span>
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
                  width: 68,
                  fontFamily: T.mono,
                  fontSize: 16,
                  fontWeight: 600,
                  padding: "4px 10px",
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
        </div>
      )}
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
