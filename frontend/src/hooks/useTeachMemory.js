// useTeachMemory.js — Hook lưu lesson + lấy stats từ memory.
// Hai action: teach (POST /api/teach) và fetchStats (GET /api/research/stats).

import { useState, useCallback } from "react";

const API_BASE = "/api";

// ── Hook ────────────────────────────────────────────────────────────

/**
 * Hook quản lý teaching (lưu lesson) và research stats.
 *
 * @returns {{
 *   isSaving: boolean,
 *   saved: boolean,
 *   lessonId: number|null,
 *   error: string|null,
 *   stats: { total: number, avg_score: number|null, recent_5: Array }|null,
 *   teach: (params: {
 *     runId: number,
 *     task: string,
 *     wrongCode: string,
 *     correctCode: string,
 *     lesson: string,
 *     score: number
 *   }) => Promise<void>,
 *   fetchStats: () => Promise<void>,
 *   resetTeach: () => void
 * }}
 */
export function useTeachMemory() {
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lessonId, setLessonId] = useState(null);
  const [error, setError] = useState(null);
  const [stats, setStats] = useState(null);

  const teach = useCallback(async ({ runId, task, wrongCode, correctCode, lesson, score }) => {
    setIsSaving(true);
    setSaved(false);
    setError(null);
    setLessonId(null);

    try {
      const res = await fetch(`${API_BASE}/teach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: runId,
          task,
          wrong_code: wrongCode,
          correct_code: correctCode,
          lesson,
          score,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server error ${res.status}`);
      }

      const data = await res.json();
      setLessonId(data.lesson_id);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsSaving(false);
    }
  }, []);

  const fetchStats = useCallback(async () => {
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/research/stats`);

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Server error ${res.status}`);
      }

      const data = await res.json();
      setStats(data);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const resetTeach = useCallback(() => {
    setIsSaving(false);
    setSaved(false);
    setLessonId(null);
    setError(null);
  }, []);

  return { isSaving, saved, lessonId, error, stats, teach, fetchStats, resetTeach };
}
