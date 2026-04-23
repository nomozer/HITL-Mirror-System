import { apiPost, type RequestOptions } from "./client";
import type { FinalizeGradeResponse, Subject } from "../types";

export interface FinalizeGradeRequest {
  task: string;
  lang?: string;
  ai_overall: number | null;
  teacher_overall: number | null;
  ai_scores: Record<string, number>;
  teacher_scores: Record<string, number>;
  approved_grade_json: string;
  run_id: number | null;
  subject?: Subject | string | null;
}

export function finalizeGrade(
  req: FinalizeGradeRequest,
  options?: RequestOptions,
): Promise<FinalizeGradeResponse> {
  return apiPost<FinalizeGradeRequest, FinalizeGradeResponse>(
    "/finalize-grade",
    req,
    options,
  );
}
