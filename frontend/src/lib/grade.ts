import type { Grade } from "../types";

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
        typeof p.comment === "string"
          ? p.comment
          : p.comment
            ? JSON.stringify(p.comment)
            : "",
      transcript:
        typeof p.transcript === "string"
          ? p.transcript
          : p.transcript
            ? JSON.stringify(p.transcript)
            : "",
      per_question_feedback: Array.isArray(p.per_question_feedback)
        ? p.per_question_feedback
        : [],
      salvaged: Boolean(p.salvaged),
      subject: p.subject || "literature",
    };
  } catch {
    return null;
  }
}
