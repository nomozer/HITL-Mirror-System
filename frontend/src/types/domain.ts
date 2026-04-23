/**
 * Primitive domain enums — small string-unions used across the app.
 * No runtime values, no dependencies.
 */

export type Subject = "literature" | "stem" | "language" | "history";

export type Lang = "en" | "vi";

export type PipelinePhase = "idle" | "generating" | "reviewing" | "done";

export type FeedbackAction = "approve" | "revise" | "reject";

export type TeacherCommentType = "teacher" | "ai";
