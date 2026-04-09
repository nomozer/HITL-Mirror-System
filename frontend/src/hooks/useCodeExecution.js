// useCodeExecution.js — Hook chạy Python code qua /api/execute.
// Quản lý stdout/stderr/exitCode và timeout handling.

import { useState, useCallback } from "react";

const API_BASE = "/api";

// ── Hook ────────────────────────────────────────────────────────────

/**
 * Hook thực thi Python code trên server (subprocess, timeout 5s).
 *
 * @returns {{
 *   stdout: string,
 *   stderr: string,
 *   exitCode: number|null,
 *   isRunning: boolean,
 *   execute: (code: string) => Promise<void>
 * }}
 */
export function useCodeExecution() {
  const [stdout, setStdout] = useState("");
  const [stderr, setStderr] = useState("");
  const [exitCode, setExitCode] = useState(null);
  const [isRunning, setIsRunning] = useState(false);

  const execute = useCallback(async (code) => {
    setIsRunning(true);
    setStdout("");
    setStderr("");
    setExitCode(null);

    try {
      const res = await fetch(`${API_BASE}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (res.status === 408) {
        setStderr("Execution timed out (5s limit)");
        setExitCode(124);
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStderr(body.detail || `Server error ${res.status}`);
        setExitCode(1);
        return;
      }

      const data = await res.json();
      setStdout(data.stdout);
      setStderr(data.stderr);
      setExitCode(data.exit_code);
    } catch (err) {
      setStderr(`Network error: ${err.message}`);
      setExitCode(1);
    } finally {
      setIsRunning(false);
    }
  }, []);

  return { stdout, stderr, exitCode, isRunning, execute };
}
