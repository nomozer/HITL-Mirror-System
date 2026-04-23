/**
 * Base HTTP client for the HITL backend.
 *
 * One place to centralize:
 *   - API base URL
 *   - JSON headers
 *   - AbortSignal handling (caller can cancel long requests)
 *   - Error mapping: non-2xx → Error(detail || "Server error N")
 *
 * Hooks and features should NOT call `fetch` directly — they call the
 * typed helpers in `api/pipeline.ts`, `api/feedback.ts`, etc. which all
 * route through `apiPost` here.
 */

export const API_BASE = "/api";

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;

  constructor(status: number, detail: string) {
    super(detail || `Server error ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export interface RequestOptions {
  /** Forwarded to fetch — caller owns cancellation and timeout. */
  signal?: AbortSignal;
}

export async function apiPost<TReq, TRes>(
  path: string,
  body: TReq,
  options: RequestOptions = {},
): Promise<TRes> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    const detail = await res
      .json()
      .then((b) => (b && typeof b.detail === "string" ? b.detail : ""))
      .catch(() => "");
    throw new ApiError(res.status, detail);
  }

  return (await res.json()) as TRes;
}

/**
 * Fire-and-forget POST — swallows all errors. Used only for the
 * heartbeat where a missed ping is not a user-facing concern.
 */
export function apiPostQuiet(path: string): Promise<void> {
  return fetch(`${API_BASE}${path}`, { method: "POST" })
    .then(() => undefined)
    .catch(() => undefined);
}
