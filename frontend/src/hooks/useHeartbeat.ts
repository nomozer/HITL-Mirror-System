import { useEffect } from "react";
import { sendHeartbeat } from "../api";

/**
 * Ping the backend every `intervalMs` (default 10s) so it knows the
 * frontend is still alive. Without a heartbeat the backend will
 * auto-shutdown after ~30s (see main.py HEARTBEAT_TIMEOUT).
 */
export function useHeartbeat(intervalMs: number = 10000): void {
  useEffect(() => {
    sendHeartbeat();
    const id = setInterval(sendHeartbeat, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
