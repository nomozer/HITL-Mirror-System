// useFeedback.js — Hook for the HITL right-panel feedback loop.
// POSTs structured feedback to /api/feedback so the backend persists the
// comment as a lesson (for revise/reject). The returned lesson_id lets the
// UI show "✅ New lesson added" before kicking off a rerun of /api/generate.

import { useState, useCallback } from "react";

const API_BASE = "/api";

export function useFeedback() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lastAction, setLastAction] = useState(null); // approve | revise | reject
  const [lastLessonId, setLastLessonId] = useState(null);
  const [error, setError] = useState(null);

  const submit = useCallback(
    async ({ action, comment, task, wrongCode, runId }) => {
      setIsSubmitting(true);
      setError(null);
      setLastAction(null);
      setLastLessonId(null);

      try {
        const res = await fetch(`${API_BASE}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            comment,
            task,
            wrong_code: wrongCode,
            run_id: runId,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Server error ${res.status}`);
        }

        const data = await res.json();
        setLastAction(data.action);
        setLastLessonId(data.lesson_id);
        return data;
      } catch (err) {
        setError(err.message);
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setIsSubmitting(false);
    setLastAction(null);
    setLastLessonId(null);
    setError(null);
  }, []);

  return { isSubmitting, lastAction, lastLessonId, error, submit, reset };
}
