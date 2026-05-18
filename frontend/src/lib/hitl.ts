import type { ThreadMessage } from "../types";

/**
 * Pick the lesson string to stage from a câu's chat thread.
 *
 * Walks newest → oldest looking for the most recent AI message with a
 * non-empty ``lesson`` field. Returns that lesson, EXCEPT when the AI
 * flagged the teacher comment as ``"dispute"`` and the teacher hasn't
 * explicitly chosen ``disputeDecision === "apply"`` — that case
 * returns "" so the disputed lesson never reaches HITL memory.
 *
 * Verdict gating:
 *   - "agree" / "partial":  always stageable
 *   - "dispute":            only stageable when teacher explicitly chose
 *                           ``disputeDecision === "apply"``. This is the
 *                           anti-poison guard — AI flagged the teacher
 *                           comment as wrong, so we won't write a lesson
 *                           into HITL memory unless the teacher overrides.
 */
export function getStageableLesson(messages: ThreadMessage[]): string {
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
