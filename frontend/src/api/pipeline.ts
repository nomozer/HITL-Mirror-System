import { apiPost, type RequestOptions } from "./client";
import type {
  FeedbackAction,
  GenerateResponse,
  Subject,
} from "../types";

export interface GenerateRequest {
  task: string;
  lang?: string;
  feedback?: string | null;
  wrong_code?: string | null;
  image_b64?: string | null;
  task_pdf_b64?: string | null;
  subject?: Subject | string | null;
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
  subject?: Subject | string | null;
}

export function generate(
  req: GenerateRequest,
  options?: RequestOptions,
): Promise<GenerateResponse> {
  return apiPost<GenerateRequest, GenerateResponse>("/generate", req, options);
}

export function regrade(
  req: RegradeRequest,
  options?: RequestOptions,
): Promise<GenerateResponse> {
  return apiPost<RegradeRequest, GenerateResponse>("/regrade", req, options);
}
