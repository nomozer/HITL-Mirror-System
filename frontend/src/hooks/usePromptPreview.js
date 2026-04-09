// usePromptPreview.js — Debounced live preview of the assembled PromptBundle.
// Calls POST /api/prompt/preview without invoking the LLM, so the user can
// see exactly how their task + feedback + retrieved lessons will be wrapped
// into a system/memory/dynamic prompt before running the pipeline.

import { useState, useEffect, useRef } from "react";

const API_BASE = "/api";
const DEBOUNCE_MS = 350;

/**
 * @param {object} params
 * @param {string} params.role      - "coder" | "critic"
 * @param {string} params.task      - Natural-language task
 * @param {string=} params.code     - Optional code (for critic previews)
 * @param {string=} params.feedback - Optional human feedback
 * @param {string=} params.lang     - "en" | "vi"
 * @param {boolean=} params.enabled - Turn the hook on/off (default true)
 *
 * @returns {{
 *   bundle: object|null,
 *   loading: boolean,
 *   error: string|null
 * }}
 */
export function usePromptPreview({
  role = "coder",
  task,
  code = "",
  feedback = "",
  lang = "en",
  enabled = true,
}) {
  const [bundle, setBundle] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    if (!enabled || !task || !task.trim()) {
      setBundle(null);
      setError(null);
      setLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      // Abort any in-flight request
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/prompt/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, task, code, feedback, lang }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Server error ${res.status}`);
        }
        const data = await res.json();
        setBundle(data);
      } catch (err) {
        if (err.name !== "AbortError") {
          setError(err.message);
          setBundle(null);
        }
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [role, task, code, feedback, lang, enabled]);

  return { bundle, loading, error };
}
