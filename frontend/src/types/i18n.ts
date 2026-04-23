import type { Subject } from "./domain";

export interface SubjectLabelSet {
  content: string;
  argument: string;
  expression: string;
  creativity: string;
}

export type SubjectLabels = Record<Subject, SubjectLabelSet>;

/**
 * i18n dictionaries have ~100 optional UI keys. Typing as a loose
 * Record keeps call sites flexible (t.someKey || "fallback") without
 * blocking new keys being added. The few keys used structurally
 * (rubricBySubject, subjectNames) are typed explicitly.
 */
export interface I18nStrings {
  title: string;
  subtitle: string;
  langSwitch: string;
  rubricBySubject?: SubjectLabels;
  subjectNames?: Record<Subject, string>;
  [key: string]: unknown;
}

export interface I18nDict {
  en: I18nStrings;
  vi: I18nStrings;
}
