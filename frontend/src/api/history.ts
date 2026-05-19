import { apiGet, type RequestOptions } from "./client";
import type { GradeHistoryResponse } from "../types";

export function listGradeHistory(
  query: { limit?: number } = {},
  options?: RequestOptions,
): Promise<GradeHistoryResponse> {
  return apiGet<GradeHistoryResponse>("/history/grades", query, options);
}
