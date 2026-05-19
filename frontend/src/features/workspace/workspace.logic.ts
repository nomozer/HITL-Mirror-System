/**
 * Pure helpers for EssayWorkspace — step transition logic.
 */

/** Map internal 5-step to the visible wizard progression.
 *  Previously collapsed step 4 → 3 when step 4 was just a transient
 *  re-grading loader. Step 4 now has its own RegradeMockup UI ("Chấm lại")
 *  so the stepper should reflect the actual position, otherwise the
 *  teacher sees a CHẤM LẠI page while the stepper still highlights XEM XÉT. */
export function deriveDisplayStep(step: number): number {
  return step;
}

/** Compute next step when pipeline phase changes. */
export function nextStepOnPhaseChange(step: number, phase: string, error: string | null): number {
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

/** Stable task descriptor used for backend retrieval/logging.
 *  Format: ``"<Môn> · <tên đề>"`` (no class — that prefix was removed
 *  with the header class pill). ``parseTaskContext`` in
 *  ``features/history/GradeHistoryDropdown`` is the canonical decoder
 *  for both this format and the legacy 3-part ``"Môn · Lớp · tên"``
 *  still present in older cached entries. */
export function buildTaskContext(
  name: string | null | undefined,
  selectedSubject: string,
): string {
  const label = taskFromPdfName(name);
  const parts = [selectedSubject, label].filter(Boolean);
  return parts.join(" · ");
}

