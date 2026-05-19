export { ApiError, apiPost, apiPostQuiet, apiGet, apiDelete, API_BASE } from "./client";
export type { RequestOptions } from "./client";
export { generate, regrade } from "./pipeline";
export type { GenerateRequest, RegradeRequest } from "./pipeline";
export { submitFeedback, analyzeComment } from "./feedback";
export type { FeedbackRequest, AnalyzeCommentRequest } from "./feedback";
export { finalizeGrade } from "./finalize";
export type { FinalizeGradeRequest } from "./finalize";
export { sendHeartbeat } from "./heartbeat";
export { detectSubject } from "./detect";
export type {
  DetectSubjectRequest,
  DetectSubjectResponse,
  DetectConfidence,
} from "./detect";
export { listLessons, getMemoryStats, deleteLesson } from "./memory";
export type {
  ListLessonsQuery,
  ListLessonsResponse,
  MemoryStats,
  DeleteLessonResponse,
} from "./memory";
