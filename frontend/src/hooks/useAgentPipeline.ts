// useAgentPipeline.ts — Hook điều khiển Grader→Reviewer (VLM) pipeline.
// Quản lý phase transitions và kết quả grading qua useReducer.
// Tất cả fetch đã được tách vào src/api/pipeline.ts.

import { useReducer, useCallback, useEffect, useRef } from "react";
import { ApiError, generate as apiGenerate, regrade as apiRegrade } from "../api";
import type {
  BackendSubject,
  FeedbackAction,
  GenerateResponse,
  Lesson,
  PipelinePhase,
} from "../types";

// Intentionally generous so the client does not need to mirror backend retry math.
const PIPELINE_TIMEOUT_MS = 10 * 60 * 1000;

// ── Grade history cache ─────────────────────────────────────────────
//
// Every successful pipeline response is appended to a rolling history in
// localStorage so the teacher can re-enter the Review/Result UI without
// spending another Gemini call. The header's "Bài đã chấm" dropdown reads
// from this array; selecting an entry dispatches PIPELINE_SUCCESS with
// the cached payload and the rest of the app reacts as if a real call
// returned. Capped at 15 to keep localStorage well under its ~5 MB limit
// (a typical response is ~5-15 KB without the essay image).
const HISTORY_STORAGE_KEY = "hitl.gradeHistory";
// 50 fits a 30-45 student class with a few re-grades and still leaves
// localStorage well under the 5 MB cap (50 × ~15 KB ≈ 750 KB worst case).
// Beyond this, search + recency grouping in the dropdown does the
// findability work — a flat list of 50 was already painful at 15.
const HISTORY_MAX = 50;

export interface CachedGrade {
  /** Unique id — uses ``run_id`` from backend when available, falls back to
   *  the wallclock at cache time. */
  id: string;
  /** Cache timestamp (ms since epoch) — used for "x phút trước" labels. */
  ts: number;
  /** Task context the grade was generated for. Carries "Môn X · Lớp Y ·
   *  ĐỀ NAME" prefix from ``buildTaskContext`` so the dropdown can show a
   *  human-readable row label without re-parsing the response. */
  task: string;
  /** Backend subject code (``"cs" | "math" | "phys"``) or null when unknown. */
  subject: string | null;
  /** Full response payload — passed straight to PIPELINE_SUCCESS on load. */
  response: GenerateResponse;
}

function readHistory(): CachedGrade[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CachedGrade[]) : [];
  } catch {
    return [];
  }
}

function writeHistory(items: CachedGrade[]): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // localStorage full / disabled / private mode — best-effort only.
  }
}

export function getCachedGrades(): CachedGrade[] {
  return readHistory();
}

export function clearCachedGrades(): void {
  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // best-effort
  }
}

function appendToHistory(meta: { task: string; subject: string | null }, data: GenerateResponse): void {
  const id = data.run_id != null ? String(data.run_id) : `ts-${Date.now()}`;
  const entry: CachedGrade = {
    id,
    ts: Date.now(),
    task: meta.task,
    subject: meta.subject,
    response: data,
  };
  // Dedupe by id (a regrade reusing the same run_id should overwrite, not
  // pile up). Newest first, oldest trimmed off the tail.
  const existing = readHistory().filter((e) => e.id !== id);
  const next = [entry, ...existing].slice(0, HISTORY_MAX);
  writeHistory(next);
}

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
        lessonsUsed: [],
        newLessonIds: [],
        runId: null,
        error: null,
        previousLessonIds: state.lessonsUsed.map((l) => l.id),
      };

    case ACTIONS.PIPELINE_SUCCESS: {
      const lessons = action.payload.lessons_used || [];
      const prev = new Set(state.previousLessonIds);
      const newLessonIds = lessons.map((l) => l.id).filter((id) => !prev.has(id));
      return {
        ...state,
        phase: "done",
        code: action.payload.code,
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
  subject?: BackendSubject | null;
}

export interface UseAgentPipelineResult extends State {
  generate: (
    task: string,
    lang?: string,
    feedback?: string | null,
    wrongCode?: string | null,
    imageB64?: string | null,
    taskPdfB64?: string | null,
    subject?: BackendSubject | null,
  ) => Promise<void>;
  regrade: (input: RegradeInput) => Promise<void>;
  reset: () => void;
  /**
   * Hydrate pipeline state from a cached grade by id — no network call.
   * Returns true if the id was found in history and loaded. Used by the
   * "Bài đã chấm" header dropdown.
   */
  loadCachedById: (id: string) => boolean;
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
    const timeoutId = setTimeout(() => controller.abort(), PIPELINE_TIMEOUT_MS);
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
      subject: BackendSubject | null = null,
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
        appendToHistory({ task, subject }, data);
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
        appendToHistory({ task, subject }, data);
        dispatch({ type: ACTIONS.PIPELINE_SUCCESS, payload: data });
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        releaseIfCurrent();
        dispatch({ type: ACTIONS.PIPELINE_ERROR, payload: toErrorMessage(err) });
      }
    },
    [beginRequest],
  );

  const loadCachedById = useCallback(
    (id: string): boolean => {
      const entry = readHistory().find((e) => e.id === id);
      if (!entry || typeof entry.response?.code !== "string") return false;
      // Cancel any in-flight call so its eventual response can't overwrite
      // the cached state we're about to install.
      requestIdRef.current += 1;
      clearInFlight();
      dispatch({ type: ACTIONS.PIPELINE_SUCCESS, payload: entry.response });
      return true;
    },
    [clearInFlight],
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

  return { ...state, generate, regrade, reset, loadCachedById };
}
