import { apiPost, type RequestOptions } from "./client";
import { emitMemoryChanged } from "../lib/memoryBus";
import type { BackendSubject, FeedbackAction, GenerateResponse } from "../types";

export interface GenerateRequest {
  task: string;
  lang?: string;
  feedback?: string | null;
  wrong_code?: string | null;
  image_b64?: string | null;
  task_pdf_b64?: string | null;
  subject?: BackendSubject | null;
}

export interface RegradeRequest {
  task: string;
  lang?: string;
  action: Extract<FeedbackAction, "revise" | "reject">;
  comment: string;
  wrong_code?: string | null;
  image_b64?: string | null;
  task_pdf_b64?: string | null;
  run_id?: number | null;
  subject?: BackendSubject | null;
}

export function generate(
  req: GenerateRequest,
  options?: RequestOptions,
): Promise<GenerateResponse> {
  return apiPost<GenerateRequest, GenerateResponse>("/generate", req, options);
}

export function regrade(req: RegradeRequest, options?: RequestOptions): Promise<GenerateResponse> {
  // /regrade is "save feedback then regrade" — the save-feedback step
  // always writes a lesson (revise → 4.0 or reject → 5.0). /generate
  // (first grade) is NOT wired because it never writes a lesson.
  return apiPost<RegradeRequest, GenerateResponse>("/regrade", req, options).then((res) => {
    emitMemoryChanged();
    return res;
  });
}
