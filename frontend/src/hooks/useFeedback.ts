// useFeedback.ts — Hook for the HITL teacher-feedback loop.
// POSTs structured feedback (approve/revise/reject + comment) so the
// backend persists the teacher's correction as a grading lesson. The
// returned lesson_id lets the UI show "New lesson added" before kicking
// off a re-grade via /api/generate.
//
// All fetch logic lives in `src/api/feedback.ts`; this hook only owns
// in-flight cancellation + the React state machine.

import { useState, useCallback, useEffect, useRef } from "react";
import { ApiError, submitFeedback } from "../api";
import type {
  FeedbackAction,
  FeedbackResponse,
  StagedLesson,
  Subject,
} from "../types";

const FEEDBACK_TIMEOUT_MS = 30000;

export interface FeedbackSubmitInput {
  action: FeedbackAction;
  comment: string;
  task: string;
  wrongCode: string;
  runId: number | null;
  stagedLessons?: StagedLesson[];
  subject?: Subject | string | null;
}

export interface UseFeedbackResult {
  isSubmitting: boolean;
  lastAction: FeedbackAction | null;
  lastLessonId: number | null;
  error: string | null;
  submit: (input: FeedbackSubmitInput) => Promise<FeedbackResponse | null>;
  reset: () => void;
}

export function useFeedback(): UseFeedbackResult {
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [lastAction, setLastAction] = useState<FeedbackAction | null>(null);
  const [lastLessonId, setLastLessonId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitIdRef = useRef<number>(0);

  const clearInFlight = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (controllerRef.current) {
      controllerRef.current.abort();
      controllerRef.current = null;
    }
  }, []);

  const submit = useCallback(
    async ({
      action,
      comment,
      task,
      wrongCode,
      runId,
      stagedLessons = [],
      subject = null,
    }: FeedbackSubmitInput): Promise<FeedbackResponse | null> => {
      const submitId = submitIdRef.current + 1;
      submitIdRef.current = submitId;
      clearInFlight();
      setIsSubmitting(true);
      setError(null);
      setLastAction(null);
      setLastLessonId(null);
      const controller = new AbortController();
      controllerRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), FEEDBACK_TIMEOUT_MS);
      timeoutRef.current = timeoutId;

      const releaseIfCurrent = () => {
        if (submitIdRef.current !== submitId) return;
        if (timeoutRef.current !== null) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      };

      try {
        const data = await submitFeedback(
          {
            action,
            comment,
            task,
            wrong_code: wrongCode,
            run_id: runId,
            staged_lessons: stagedLessons,
            subject,
          },
          { signal: controller.signal },
        );
        if (submitIdRef.current !== submitId) return null;
        releaseIfCurrent();
        setLastAction(data.action);
        setLastLessonId(data.lesson_id);
        return data;
      } catch (err) {
        if (submitIdRef.current !== submitId) return null;
        releaseIfCurrent();
        let msg: string;
        if (err instanceof ApiError) {
          msg = err.detail || err.message;
        } else {
          const e = err as Error;
          msg =
            e?.name === "AbortError"
              ? "Feedback request timed out. Please try again."
              : e?.message || "Unknown error";
        }
        setError(msg);
        return null;
      } finally {
        if (submitIdRef.current === submitId) {
          setIsSubmitting(false);
        }
      }
    },
    [clearInFlight],
  );

  const reset = useCallback(() => {
    submitIdRef.current += 1;
    clearInFlight();
    setIsSubmitting(false);
    setLastAction(null);
    setLastLessonId(null);
    setError(null);
  }, [clearInFlight]);

  useEffect(
    () => () => {
      submitIdRef.current += 1;
      clearInFlight();
    },
    [clearInFlight],
  );

  return { isSubmitting, lastAction, lastLessonId, error, submit, reset };
}
