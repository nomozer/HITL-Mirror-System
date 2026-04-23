import type { TeacherCommentType } from "./domain";

export interface ThreadMessage {
  type: TeacherCommentType;
  text: string;
  lesson?: string;
}

/** Map of question-index → messages for that question. */
export type CommentThreads = Record<number, ThreadMessage[]>;
