import { apiPost, type RequestOptions } from "./client";
import { emitMemoryChanged } from "../lib/memoryBus";
import type { BackendSubject, FinalizeGradeResponse } from "../types";

export interface FinalizeGradeRequest {
  task: string;
  lang?: string;
  ai_overall: number | null;
  teacher_overall: number | null;
  ai_scores: Record<string, number>;
  teacher_scores: Record<string, number>;
  /** Per-câu AI scores keyed by câu number as string ("1","2",...).
   *  Backend computes per-câu deltas alongside rubric ones — required for
   *  HITL to learn from step-4 per-câu edits (the only path the current UI
   *  actually exposes for score corrections). */
  ai_per_question?: Record<string, number>;
  /** Per-câu teacher overrides, same shape as ai_per_question. */
  teacher_per_question?: Record<string, number>;
  approved_grade_json: string;
  run_id: number | null;
  subject?: BackendSubject | null;
}

export function finalizeGrade(
  req: FinalizeGradeRequest,
  options?: RequestOptions,
): Promise<FinalizeGradeResponse> {
  // /finalize-grade may or may not create a delta lesson (depends on
  // threshold), but it always writes an approved_grade row and may
  // back-fill correct_code on prior lessons — either way the panel's
  // stats and rows can shift, so we refresh regardless.
  return apiPost<FinalizeGradeRequest, FinalizeGradeResponse>("/finalize-grade", req, options).then(
    (res) => {
      emitMemoryChanged();
      return res;
    },
  );
}
