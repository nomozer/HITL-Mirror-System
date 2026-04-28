import { useEffect } from "react";
import { sendHeartbeat } from "../api";

/**
 * Ping the backend every `intervalMs` (default 10s) so it knows the
 * frontend is still alive. Without a heartbeat the backend will
 * auto-shutdown after ~30s (see main.py HEARTBEAT_TIMEOUT).
 */
export function useHeartbeat(intervalMs: number = 10000): void {
  useEffect(() => {
    const doHeartbeat = () => {
      sendHeartbeat(document.visibilityState === "hidden" ? "sleeping" : "active");
    };

    doHeartbeat();
    const id = setInterval(doHeartbeat, intervalMs);

    document.addEventListener("visibilitychange", doHeartbeat);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", doHeartbeat);
    };
  }, [intervalMs]);
}
