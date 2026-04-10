// useAgentPipeline.js — Hook điều khiển Grader→Reviewer (VLM) pipeline.
// Quản lý phase transitions và kết quả grading qua useReducer.

import { useReducer, useCallback } from "react";

const API_BASE = "/api";

// ── State & actions ─────────────────────────────────────────────────

const ACTIONS = {
  PIPELINE_START: "PIPELINE_START",
  PIPELINE_SUCCESS: "PIPELINE_SUCCESS",
  PIPELINE_ERROR: "PIPELINE_ERROR",
  RESET: "RESET",
};

const initialState = {
  phase: "idle", // idle | generating | reviewing | done
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
  // Transparency: full PromptBundles returned by backend when debug=true
  coderPrompt: null,
  criticPrompt: null,
};

function reducer(state, action) {
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
        coderPrompt: null,
        criticPrompt: null,
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
        coderPrompt: action.payload.coder_prompt || null,
        criticPrompt: action.payload.critic_prompt || null,
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

/**
 * Hook quản lý Grader→Reviewer (VLM) pipeline.
 *
 * @returns {{
 *   phase: 'idle'|'generating'|'reviewing'|'done',
 *   code: string|null,                               // Grader JSON output
 *   critique: {issues: Array, severity: string, suggestion: string}|null,
 *   lessonsUsed: Array,
 *   runId: number|null,
 *   error: string|null,
 *   generate: (task, lang, feedback, wrongCode, imageB64) => Promise<void>,
 *   reset: () => void
 * }}
 */
export function useAgentPipeline() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const generate = useCallback(async (
    task,
    lang = "en",
    feedback = null,
    wrongCode = null,
    imageB64 = null,
  ) => {
    dispatch({ type: ACTIONS.PIPELINE_START });

    const controller = new AbortController();
    // 180 second timeout. Backend retry can take:
    // - 5 retries with exponential backoff (~8 + 13 + 18 + 23 + 60s)
    // - Plus Gemini timeout (~60s per attempt)
    // Total worst-case ~130s, so 180s provides safe headroom.
    const timeoutId = setTimeout(() => controller.abort(), 180000);

    try {
      const res = await fetch(`${API_BASE}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task,
          lang,
          feedback,
          wrong_code: wrongCode,
          image_b64: imageB64,
          debug: true,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server error ${res.status}`);
      }

      const data = await res.json();
      dispatch({ type: ACTIONS.PIPELINE_SUCCESS, payload: data });
    } catch (err) {
      clearTimeout(timeoutId);
      const msg = err.name === "AbortError" 
        ? "Request timed out (server took too long to respond)."
        : err.message;
      dispatch({ type: ACTIONS.PIPELINE_ERROR, payload: msg });
    }
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: ACTIONS.RESET });
  }, []);

  return { ...state, generate, reset };
}
