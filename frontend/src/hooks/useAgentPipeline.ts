// useAgentPipeline.ts — Hook điều khiển Grader→Reviewer (VLM) pipeline.
// Quản lý phase transitions và kết quả grading qua useReducer.
// Tất cả fetch đã được tách vào src/api/pipeline.ts.

import { useReducer, useCallback, useEffect, useRef } from "react";
import { ApiError, generate as apiGenerate, regrade as apiRegrade } from "../api";
import type {
  Critique,
  FeedbackAction,
  GenerateResponse,
  Lesson,
  PipelinePhase,
  Subject,
} from "../types";

// Intentionally generous so the client does not need to mirror backend retry math.
const PIPELINE_TIMEOUT_MS = 10 * 60 * 1000;

// ── State & actions ─────────────────────────────────────────────────

const ACTIONS = {
  PIPELINE_START: "PIPELINE_START",
  PIPELINE_SUCCESS: "PIPELINE_SUCCESS",
  PIPELINE_ERROR: "PIPELINE_ERROR",
  RESET: "RESET",
} as const;

type Action =
  | { type: typeof ACTIONS.PIPELINE_START }
  | { type: typeof ACTIONS.PIPELINE_SUCCESS; payload: GenerateResponse }
  | { type: typeof ACTIONS.PIPELINE_ERROR; payload: string }
  | { type: typeof ACTIONS.RESET };

interface State {
  phase: PipelinePhase;
  code: string | null;
  critique: Critique | null;
  lessonsUsed: Lesson[];
  runCount: number;
  previousLessonIds: number[];
  newLessonIds: number[];
  runId: number | null;
  error: string | null;
}

const initialState: State = {
  phase: "idle",
  code: null,
  critique: null,
  lessonsUsed: [],
  // runCount + previousLessonIds let the UI highlight NEW lessons appearing
  // on a rerun — the core visual cue of the HITL learning loop.
  runCount: 0,
  previousLessonIds: [],
  newLessonIds: [],
  runId: null,
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case ACTIONS.PIPELINE_START:
      // Preserve previous lesson IDs & runCount across the start→success
      // transition so SUCCESS can compute the diff (new lessons = evidence
      // the AI learned from the last round of human feedback).
      return {
        ...state,
        phase: "generating",
        code: null,
        critique: null,
        lessonsUsed: [],
        newLessonIds: [],
        runId: null,
        error: null,
        previousLessonIds: state.lessonsUsed.map((l) => l.id),
      };

    case ACTIONS.PIPELINE_SUCCESS: {
      const lessons = action.payload.lessons_used || [];
      const prev = new Set(state.previousLessonIds);
      const newLessonIds = lessons
        .map((l) => l.id)
        .filter((id) => !prev.has(id));
      return {
        ...state,
        phase: "done",
        code: action.payload.code,
        critique: action.payload.critique,
        lessonsUsed: lessons,
        runCount: state.runCount + 1,
        newLessonIds,
        runId: action.payload.run_id,
        error: null,
      };
    }

    case ACTIONS.PIPELINE_ERROR:
      return { ...state, phase: "idle", error: action.payload };

    case ACTIONS.RESET:
      return { ...initialState };

    default:
      return state;
  }
}

// ── Hook ────────────────────────────────────────────────────────────

export interface RegradeInput {
  task: string;
  lang?: string;
  action: Extract<FeedbackAction, "revise" | "reject">;
  comment: string;
  wrongCode?: string | null;
  imageB64?: string | null;
  taskPdfB64?: string | null;
  runId?: number | null;
  subject?: Subject | string | null;
}

export interface UseAgentPipelineResult extends State {
  generate: (
    task: string,
    lang?: string,
    feedback?: string | null,
    wrongCode?: string | null,
    imageB64?: string | null,
    taskPdfB64?: string | null,
    subject?: Subject | string | null,
  ) => Promise<void>;
  regrade: (input: RegradeInput) => Promise<void>;
  reset: () => void;
}

/**
 * Normalize an error from `api/pipeline` into a user-facing message.
 * AbortError → "timed out"; ApiError keeps detail; anything else surfaces
 * its `.message`.
 */
function toErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.detail || err.message;
  const e = err as Error;
  if (e?.name === "AbortError") {
    return "Request timed out (server took too long to respond).";
  }
  return e?.message || "Unknown error";
}

export function useAgentPipeline(): UseAgentPipelineResult {
  const [state, dispatch] = useReducer(reducer, initialState);
  const controllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef<number>(0);

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

  /**
   * Guard against stale completions (a slow first request resolving after
   * the user has already kicked off a second one). Each call bumps
   * `requestIdRef`; the handlers bail out if IDs no longer match.
   */
  const beginRequest = useCallback(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    clearInFlight();
    dispatch({ type: ACTIONS.PIPELINE_START });

    const controller = new AbortController();
    controllerRef.current = controller;
    const timeoutId = setTimeout(
      () => controller.abort(),
      PIPELINE_TIMEOUT_MS,
    );
    timeoutRef.current = timeoutId;

    const releaseIfCurrent = () => {
      if (requestIdRef.current !== requestId) return;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };

    return { requestId, controller, releaseIfCurrent };
  }, [clearInFlight]);

  const generate = useCallback(
    async (
      task: string,
      lang: string = "en",
      feedback: string | null = null,
      wrongCode: string | null = null,
      imageB64: string | null = null,
      taskPdfB64: string | null = null,
      subject: Subject | string | null = null,
    ): Promise<void> => {
      const { requestId, controller, releaseIfCurrent } = beginRequest();

      try {
        const data = await apiGenerate(
          {
            task,
            lang,
            feedback,
            wrong_code: wrongCode,
            image_b64: imageB64,
            task_pdf_b64: taskPdfB64,
            subject,
          },
          { signal: controller.signal },
        );
        if (requestIdRef.current !== requestId) return;
        releaseIfCurrent();
        dispatch({ type: ACTIONS.PIPELINE_SUCCESS, payload: data });
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        releaseIfCurrent();
        dispatch({ type: ACTIONS.PIPELINE_ERROR, payload: toErrorMessage(err) });
      }
    },
    [beginRequest],
  );

  // Atomic HITL re-grade: saves teacher feedback as a lesson then re-runs
  // the pipeline in a single /api/regrade call.
  const regrade = useCallback(
    async ({
      task,
      lang = "en",
      action,
      comment,
      wrongCode = null,
      imageB64 = null,
      taskPdfB64 = null,
      runId = null,
      subject = null,
    }: RegradeInput): Promise<void> => {
      const { requestId, controller, releaseIfCurrent } = beginRequest();

      try {
        const data = await apiRegrade(
          {
            task,
            lang,
            action,
            comment,
            wrong_code: wrongCode,
            image_b64: imageB64,
            task_pdf_b64: taskPdfB64,
            run_id: runId,
            subject,
          },
          { signal: controller.signal },
        );
        if (requestIdRef.current !== requestId) return;
        releaseIfCurrent();
        dispatch({ type: ACTIONS.PIPELINE_SUCCESS, payload: data });
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        releaseIfCurrent();
        dispatch({ type: ACTIONS.PIPELINE_ERROR, payload: toErrorMessage(err) });
      }
    },
    [beginRequest],
  );

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    clearInFlight();
    dispatch({ type: ACTIONS.RESET });
  }, [clearInFlight]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
      clearInFlight();
    },
    [clearInFlight],
  );

  return { ...state, generate, regrade, reset };
}
