import type { Subject } from "../../types";

/**
 * Pure helpers for EssayWorkspace — step transition logic.
 */

/** Map internal 5-step to the visible wizard progression. */
export function deriveDisplayStep(step: number): number {
  if (step <= 3) return step;
  if (step === 4) return 3; // re-grading shows as "Review"
  return 5;
}

/** Compute next step when pipeline phase changes. */
export function nextStepOnPhaseChange(
  step: number,
  phase: string,
  error: string | null,
): number {
  if (phase === "generating") {
    if (step === 1) return 2;
    if (step === 3) return 4;
  }
  if (phase === "idle" && error) {
    if (step === 2) return 1;
    if (step === 4) return 3;
  }
  return step;
}

/** After a grade is parsed, jump back to review if we were loading. */
export function stepAfterGrade(step: number): number {
  return step === 2 || step === 4 ? 3 : step;
}

/** Derive a short task label from the PDF filename. */
export function taskFromPdfName(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
}

/** Stable task descriptor used for backend retrieval/logging. */
export function buildTaskContext(
  name: string | null | undefined,
  selectedSubject: string,
  selectedClass: string,
): string {
  const label = taskFromPdfName(name);
  const parts = [selectedSubject, selectedClass, label].filter(Boolean);
  return parts.join(" · ");
}

/** Map UI subject labels to backend subject codes. */
export function subjectCodeFromSelection(
  selectedSubject: string,
): Subject | null {
  const folded = String(selectedSubject || "").toLowerCase();
  if (
    folded.includes("tin") ||
    folded.includes("toán") ||
    folded.includes("toan") ||
    folded.includes("lý") ||
    folded.includes("ly") ||
    folded.includes("stem")
  ) {
    return "stem";
  }
  if (
    folded.includes("ngoại ngữ") ||
    folded.includes("ngoai ngu") ||
    folded.includes("english") ||
    folded.includes("language")
  ) {
    return "language";
  }
  if (
    folded.includes("lịch sử") ||
    folded.includes("lich su") ||
    folded.includes("gdcd") ||
    folded.includes("history")
  ) {
    return "history";
  }
  if (
    folded.includes("văn") ||
    folded.includes("van") ||
    folded.includes("literature")
  ) {
    return "literature";
  }
  return null;
}
