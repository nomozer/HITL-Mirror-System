/**
 * Barrel — re-exports every type so consumers keep writing
 *   `import type { Grade, Lang } from "../types";`
 *
 * Organized by file: domain (primitives), grade, api, tabs, review, i18n.
 */

export type {
  Subject,
  Lang,
  PipelinePhase,
  FeedbackAction,
  TeacherCommentType,
} from "./domain";

export type {
  RubricScores,
  PerQuestionFeedback,
  Grade,
  TaskFile,
  EssayFile,
  FinalizedResult,
} from "./grade";

export type {
  Lesson,
  StagedLesson,
  Critique,
  GenerateResponse,
  FeedbackResponse,
  AnalyzeCommentResponse,
  FinalizeGradeResponse,
} from "./api";

export type { Tab, TabMeta, TabsAction, TabsState } from "./tabs";

export type { ThreadMessage, CommentThreads } from "./review";

export type {
  SubjectLabelSet,
  SubjectLabels,
  I18nStrings,
  I18nDict,
} from "./i18n";
