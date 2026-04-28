import { apiPostQuiet } from "./client";

/**
 * Ping the backend so it knows the frontend is still alive.
 * Fire-and-forget — errors are swallowed (the browser may be offline
 * for a moment, and the backend's grace period handles that).
 */
export function sendHeartbeat(state: "active" | "sleeping" = "active"): Promise<void> {
  return apiPostQuiet("/heartbeat", { state });
}
