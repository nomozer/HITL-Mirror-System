import type { Grade, PerQuestionFeedback } from "../types";

/** Split a backend "question" string ("Câu 1: Giải phương trình…") into
 *  the câu number + the trailing prompt text. Tolerant of variants
 *  ("Cau 1", "Câu 1.", "Câu 1 -", missing separator) so we don't lose
 *  data when Gemini emits slightly off format. ResultCard / RegradeMockup
 *  / StepReview all need this. */
export function parseCauHeader(
  raw: string,
  fallbackNum: number,
): { num: number; prompt: string } {
  const m = /^C[âa]u\s+(\d+)\s*[:.\-–]?\s*(.*)$/iu.exec((raw || "").trim());
  if (m) {
    const num = parseInt(m[1], 10) || fallbackNum;
    return { num, prompt: (m[2] ?? "").trim() };
  }
  return { num: fallbackNum, prompt: (raw || "").trim() };
}

export interface SyntheticAnnotation {
  /** Zero-based index into the câu's lines[] array. */
  line: number;
  kind: "good" | "error";
  text: string;
}

// "Nothing to report" sentinels the AI emits when good_points / errors is
// empty in spirit but the prompt requires a string. Without filtering, the
// synthesizer pinned a red × badge whose text said "Không có lỗi", giving
// teachers an icon-says-bad / text-says-good contradiction (real screenshot
// 2026-05-18). Conservative match: only catch sentences that *start* with
// a denial — "Em thiếu khẳng định a ≠ 0" is NOT a sentinel, it's a real
// error that happens to contain "thiếu". The /iu flag handles Vietnamese
// diacritics without per-character normalisation. Punctuation-only inputs
// ("—", "--", "n/a") also count as absent.
// Anchor at the start only — we want "Không có lỗi, em làm rất tốt" to also
// count as a sentinel (the comment opens with a denial; the trailing praise
// doesn't change the fact that pinning a red × here is misleading). Same
// applies for good_points sentinels like "Không có gì đáng khen thêm" —
// the AI is saying "nothing to flag", not "here's a green tag".
const _ABSENT_SENTINEL_RE =
  /^\s*(?:không\s+(?:có|phát\s+hiện|thấy)\s+(?:lỗi|sai\s+sót|sai|điểm\s+cần|vấn\s+đề|điều\s+cần\s+sửa|gì\s+(?:sai|cần|đáng))|hoàn\s+toàn\s+đúng|đúng\s+hoàn\s+toàn|bài\s+làm\s+đúng|tất\s+cả\s+đúng|n\/a|—+|-+|\.+)\b/iu;

function isAbsentSentinel(text: string | undefined): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  return _ABSENT_SENTINEL_RE.test(trimmed);
}

/** Synthesise per-line annotations from câu-level good_points / errors
 *  text. Backend doesn't emit line-anchored annotations yet, so we pin
 *  the green badge to the câu header (line 0) and the red badge to the
 *  last line. Crude but keeps the visual story visible. Returns [] when
 *  the câu has neither feedback nor lines.
 *
 *  Skips fields whose value is an "absent" sentinel (e.g. "Không có
 *  lỗi") — pinning a red × to a câu the AI explicitly said was clean
 *  reads as a bug, not a feature. */
export function buildSyntheticAnnotations(
  pqf: PerQuestionFeedback,
  lineCount: number,
): SyntheticAnnotation[] {
  if (lineCount <= 0) return [];
  const out: SyntheticAnnotation[] = [];
  if (pqf.good_points && !isAbsentSentinel(pqf.good_points)) {
    out.push({ line: 0, kind: "good", text: pqf.good_points });
  }
  if (pqf.errors && !isAbsentSentinel(pqf.errors)) {
    out.push({
      line: Math.max(0, lineCount - 1),
      kind: "error",
      text: pqf.errors,
    });
  }
  return out;
}

/**
 * Split a Grader transcript ("Câu 1: …\nstep…\nstep…\nCâu 2: …") into a
 * map of câu-number → lines[]. Used by step 4 / step 5 to render the
 * student work paper without a separate backend call. The "Câu N:"
 * header line itself is included as the first entry of each section so
 * the visual layout matches what teachers expect (header + body).
 *
 * Tolerant of variants: "Cau 1", "Câu 1.", "Câu 1 -", etc. Returns an
 * empty map for empty / unparseable transcripts so callers can fall
 * back to mock or a "no transcript" placeholder safely.
 */
export function splitTranscriptByCau(
  transcript: string,
): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (!transcript || typeof transcript !== "string") return result;
  const headerRe = /^\s*C[âa]u\s+(\d+)\s*[:.\-–]?/iu;
  let current: number | null = null;
  for (const line of transcript.split(/\r?\n/)) {
    const m = headerRe.exec(line);
    if (m) {
      current = parseInt(m[1], 10);
      if (isFinite(current)) {
        result.set(current, []);
      } else {
        current = null;
      }
    }
    if (current != null) {
      result.get(current)!.push(line);
    }
  }
  return result;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (isFinite(n)) return n;
  }
  return undefined;
}

function normalizePqf(raw: unknown): PerQuestionFeedback[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const o = item as Record<string, unknown>;
    return {
      question: typeof o.question === "string" ? o.question : "",
      // Backend started emitting per-câu scores alongside the text fields.
      // Coerce to number defensively — Gemini occasionally returns the
      // value as a JSON string like "3.0" instead of a number.
      max_points: toFiniteNumber(o.max_points),
      score: toFiniteNumber(o.score),
      good_points: typeof o.good_points === "string" ? o.good_points : "",
      errors: typeof o.errors === "string" ? o.errors : "",
    };
  });
}

/**
 * Parse a raw Grader JSON payload (either string or object) into a
 * normalized grade shape. Returns null if parsing fails.
 */
export function parseGrade(raw: unknown): Grade | null {
  if (!raw) return null;
  try {
    const p =
      typeof raw === "string"
        ? (JSON.parse(raw) as Record<string, any>)
        : (raw as Record<string, any>);
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
      comment:
        typeof p.comment === "string" ? p.comment : p.comment ? JSON.stringify(p.comment) : "",
      transcript:
        typeof p.transcript === "string"
          ? p.transcript
          : p.transcript
            ? JSON.stringify(p.transcript)
            : "",
      per_question_feedback: normalizePqf(p.per_question_feedback),
      salvaged: Boolean(p.salvaged),
      subject: p.subject || "literature",
    };
  } catch {
    return null;
  }
}
