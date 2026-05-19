import { apiPost, type RequestOptions } from "./client";
import type { BackendSubject } from "../types";

export interface DetectSubjectRequest {
  task_pdf_b64: string;
}

/** Confidence buckets mirror the backend rule in `/api/detect-subject`:
 *   - `high` → top1 ≥ 5 hits AND beats top2 by ≥ 3. Safe to auto-apply.
 *   - `low`  → some signal but ambiguous. Chip should require confirmation.
 *   - `none` → zero matches. `detected` falls back to backend DEFAULT_SUBJECT.
 *              Treat as "ask the teacher to pick manually". */
export type DetectConfidence = "high" | "low" | "none";

export interface DetectSubjectResponse {
  detected: BackendSubject;
  confidence: DetectConfidence;
  scores: Record<string, number>;
}

export function detectSubject(
  req: DetectSubjectRequest,
  options?: RequestOptions,
): Promise<DetectSubjectResponse> {
  return apiPost<DetectSubjectRequest, DetectSubjectResponse>(
    "/detect-subject",
    req,
    options,
  );
}
