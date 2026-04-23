import type { Subject } from "./domain";

/** A 4-dimension rubric score. Values may be empty strings while the
 *  teacher is editing (controlled <input type="number">). */
export interface RubricScores {
  content: number | string;
  argument: number | string;
  expression: number | string;
  creativity: number | string;
}

export interface PerQuestionFeedback {
  question?: string;
  good_points?: string;
  errors?: string;
}

/** Normalized grade payload returned by `parseGrade` — always the same
 *  shape even when the backend produced a salvage-mode output. */
export interface Grade {
  scores: RubricScores;
  overall: number | string;
  strengths: string[];
  weaknesses: string[];
  comment: string;
  transcript: string;
  per_question_feedback: PerQuestionFeedback[];
  salvaged: boolean;
  subject: Subject | string;
}

export interface TaskFile {
  dataUrl: string;
  name: string;
}

export interface EssayFile {
  dataUrl: string;
  name: string;
  isPdf: boolean;
}

export interface FinalizedResult {
  scores: RubricScores;
  overall: number | string;
  finalizedAt: string;
}
