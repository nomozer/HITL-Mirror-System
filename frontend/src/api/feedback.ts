import { apiPost, type RequestOptions } from "./client";
import { emitMemoryChanged } from "../lib/memoryBus";
import type {
  AnalyzeCommentResponse,
  BackendSubject,
  FeedbackAction,
  FeedbackResponse,
  StagedLesson,
} from "../types";

export interface FeedbackRequest {
  action: FeedbackAction;
  comment: string;
  task: string;
  wrong_code: string;
  run_id: number | null;
  staged_lessons: StagedLesson[];
  subject?: BackendSubject | null;
}

export interface AnalyzeCommentRequest {
  question: string;
  student_answer: string;
  teacher_comment: string;
}

export function submitFeedback(
  req: FeedbackRequest,
  options?: RequestOptions,
): Promise<FeedbackResponse> {
  // Every successful /feedback writes at least one lesson (approve → 3.0
  // or 3.5, revise → 4.0, reject → 5.0), so emit unconditionally on
  // success. The Memory Panel listens and refetches.
  return apiPost<FeedbackRequest, FeedbackResponse>("/feedback", req, options).then((res) => {
    emitMemoryChanged();
    return res;
  });
}

export function analyzeComment(
  req: AnalyzeCommentRequest,
  options?: RequestOptions,
): Promise<AnalyzeCommentResponse> {
  return apiPost<AnalyzeCommentRequest, AnalyzeCommentResponse>("/analyze-comment", req, options);
}
