// useAgentPipeline.js — Hook điều khiển Coder→Critic pipeline.
// Quản lý phase transitions và kết quả generate qua useReducer.

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
 * Hook quản lý Coder→Critic pipeline.
 *
 * @returns {{
 *   phase: 'idle'|'generating'|'reviewing'|'done',
 *   code: string|null,
 *   critique: {issues: Array, severity: string, suggestion: string}|null,
 *   lessonsUsed: Array,
 *   runId: number|null,
 *   error: string|null,
 *   generate: (task: string) => Promise<void>,
 *   reset: () => void
 * }}
 */
export function useAgentPipeline() {
  const [state, dispatch] = useReducer(reducer, initialState);

  const generate = useCallback(async (task, lang = "en", feedback = null) => {
    dispatch({ type: ACTIONS.PIPELINE_START });

    try {
      // Phase: generating → backend runs Coder then Critic internally.
      // debug=true asks backend to return the full coder/critic PromptBundles
      // for the UI Prompt Inspector.
      // feedback (optional) is injected into the coder prompt by the backend
      // PromptOrchestrator for a retry round.
      const res = await fetch(`${API_BASE}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, lang, feedback, debug: true }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server error ${res.status}`);
      }

      const data = await res.json();
      dispatch({ type: ACTIONS.PIPELINE_SUCCESS, payload: data });
    } catch (err) {
      dispatch({ type: ACTIONS.PIPELINE_ERROR, payload: err.message });
    }
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: ACTIONS.RESET });
  }, []);

  return { ...state, generate, reset };
}
