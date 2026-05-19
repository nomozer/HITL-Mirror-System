import type { BackendSubject } from "../types";

// Single source of truth for the human-readable Vietnamese label of each
// backend subject code. Imported by SubjectChip (dropdown options),
// EssayWorkspace (task-context string), and anywhere else the UI needs to
// show a subject by name. Keep in sync with `BackendSubject` — adding a
// new subject means adding both a row here and a backend prompts entry.
const SUBJECT_LABEL: Record<BackendSubject, string> = {
  math: "Toán",
  cs:   "Tin học",
  phys: "Vật lý",
  chem: "Hoá học",
  bio:  "Sinh học",
};

export function subjectLabelOf(code: BackendSubject | null | undefined): string {
  if (!code) return "—";
  return SUBJECT_LABEL[code] ?? code;
}

export interface SubjectOption {
  code: BackendSubject;
  label: string;
}

export const SUBJECT_OPTIONS: SubjectOption[] = (
  Object.entries(SUBJECT_LABEL) as Array<[BackendSubject, string]>
).map(([code, label]) => ({ code, label }));
