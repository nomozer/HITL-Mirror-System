import { apiPost, type RequestOptions } from "./client";
import type {
  AnalyzeCommentResponse,
  FeedbackAction,
  FeedbackResponse,
  StagedLesson,
  Subject,
} from "../types";

export interface FeedbackRequest {
  action: FeedbackAction;
  comment: string;
  task: string;
  wrong_code: string;
  run_id: number | null;
  staged_lessons: StagedLesson[];
  subject?: Subject | string | null;
}

export interface AnalyzeCommentRequest {
  question: string;
  student_answer: string;
  teacher_comment: string;
  lang?: string;
}

export function submitFeedback(
  req: FeedbackRequest,
  options?: RequestOptions,
): Promise<FeedbackResponse> {
  return apiPost<FeedbackRequest, FeedbackResponse>(
    "/feedback",
    req,
    options,
  );
}

export function analyzeComment(
  req: AnalyzeCommentRequest,
  options?: RequestOptions,
): Promise<AnalyzeCommentResponse> {
  return apiPost<AnalyzeCommentRequest, AnalyzeCommentResponse>(
    "/analyze-comment",
    req,
    options,
  );
}
