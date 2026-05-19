import type { TeacherCommentType } from "./domain";

/** AI's judgment of the teacher comment vs the student work. */
export type CommentVerdict = "agree" | "partial" | "dispute";

export interface ThreadMessage {
  type: TeacherCommentType;
  text: string;
  lesson?: string;
  /** Only set on AI messages — undefined on teacher messages. */
  verdict?: CommentVerdict;
  /**
   * Teacher's decision on a disputed AI lesson:
   *   - undefined: pending decision (UI shows confirm buttons)
   *   - "apply":   teacher overrides AI, lesson WILL be staged
   *   - "skip":    teacher accepts AI dispute, lesson NOT staged
   * Ignored when verdict !== "dispute" (lesson always stages).
   */
  disputeDecision?: "apply" | "skip";
}

/** Map of question-index → messages for that question. */
export type CommentThreads = Record<number, ThreadMessage[]>;

/**
 * Word-style annotation: teacher selects a passage in the AI transcript at
 * step 3 and attaches a comment to it. The (cau, lineIdx, quote) triple is
 * the anchor — quote is matched case-sensitively against the line text to
 * render the inline highlight. Two annotations sharing the same quote on
 * the same line both render — but only the first occurrence in the source
 * text gets the highlight wrapper (acceptable for prototype).
 *
 * Verdict + anti-poisoning fields are populated asynchronously after the
 * teacher saves a comment: the frontend POSTs to /api/analyze-comment and
 * stores the AI's verdict so the HITL memory only ingests corrections AI
 * concurs with (or that the teacher explicitly overrides on a dispute).
 */
export interface SelectionAnnotation {
  id: string;
  cau: number;
  /** Index of the first line the selection covers (within its câu). The
   *  AnnotationBubble anchors against this line. */
  lineIdx: number;
  /** Index of the last line the selection covers. Equal to ``lineIdx``
   *  for single-line selections; renderer highlights every line in the
   *  inclusive range. */
  endLineIdx?: number;
  quote: string;
  comment: string;
  /** AI's judgment of teacher's comment vs the student work. Undefined =
   *  not yet analyzed (either freshly created or still in flight). */
  verdict?: CommentVerdict;
  /** AI's reasoning (≤80 words). Rendered as a sub-blurb under the
   *  verdict pill so the teacher sees WHY AI agreed/disagreed. */
  analysis?: string;
  /** Distilled reusable grading rule returned by /api/analyze-comment.
   *  Finalize saves this into HITL memory instead of the raw teacher note
   *  when available. */
  lesson?: string;
  /** Teacher's override for ``verdict === "dispute"``:
   *   • undefined: pending decision (UI shows confirm buttons)
   *   • "apply":   teacher overrides AI, lesson WILL be staged
   *   • "skip":    teacher accepts AI dispute, lesson NOT staged
   * Ignored for non-dispute verdicts (those stage automatically). */
  disputeDecision?: "apply" | "skip";
}
