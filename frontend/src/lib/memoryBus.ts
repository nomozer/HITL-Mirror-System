/**
 * Cross-window pub/sub for HITL memory mutations.
 *
 * The Memory Panel and the Workspace usually live in two different browser
 * windows (the panel is opened via `window.open` — see
 * `features/memory/MemoryPanel.tsx` `window.opener` check). Because the
 * memory list is cached locally, the panel would otherwise miss lessons
 * created by a grade/feedback/finalize round in the other window until the
 * user hit F5.
 *
 * `BroadcastChannel` is the primary transport (same-origin, all open
 * documents, including popups). The `storage` event is a fallback for
 * environments where `BroadcastChannel` is missing (older WebViews) — it
 * also delivers cross-tab even when the channel is present, so listeners
 * naturally dedupe on the message payload's `at` timestamp.
 *
 * Sender semantics: BroadcastChannel does NOT deliver back to the same
 * instance that called `postMessage`. The `storage` event does NOT fire
 * in the same tab that wrote the key. So the emitter never receives its
 * own event — callers can freely call `emitMemoryChanged()` after a
 * mutation without re-fetching themselves.
 */

const CHANNEL_NAME = "hitl.memory";
const STORAGE_KEY = "hitl.memory.bus";

export type MemoryEvent = { type: "lesson-changed"; at: number };
type Listener = (event: MemoryEvent) => void;

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export function emitMemoryChanged(): void {
  if (typeof window === "undefined") return;
  const event: MemoryEvent = { type: "lesson-changed", at: Date.now() };
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage(event);
    } catch {
      // Channel closed / serialization failure — fall through to storage.
    }
  }
  // Always write the storage marker too: it covers browsers without
  // BroadcastChannel AND wakes other tabs even when BC is available.
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(event));
  } catch {
    // Quota or privacy mode — best-effort signal, drop it.
  }
}

export function subscribeMemoryChanged(listener: Listener): () => void {
  if (typeof window === "undefined") return () => undefined;

  // Coalesce duplicates that arrive via BOTH BroadcastChannel and the
  // storage event (cross-tab fan-out delivers via both). Drop any event
  // whose `at` matches the most recently delivered timestamp.
  let lastAt = 0;
  const deliver = (event: MemoryEvent) => {
    if (event.at === lastAt) return;
    lastAt = event.at;
    listener(event);
  };

  const ch = getChannel();
  const onMessage = (ev: MessageEvent) => {
    const data = ev.data as MemoryEvent | undefined;
    if (data && data.type === "lesson-changed" && typeof data.at === "number") {
      deliver(data);
    }
  };
  if (ch) ch.addEventListener("message", onMessage);

  const onStorage = (ev: StorageEvent) => {
    if (ev.key !== STORAGE_KEY || !ev.newValue) return;
    try {
      const data = JSON.parse(ev.newValue) as MemoryEvent;
      if (data && data.type === "lesson-changed" && typeof data.at === "number") {
        deliver(data);
      }
    } catch {
      // Corrupt payload — ignore.
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    if (ch) ch.removeEventListener("message", onMessage);
    window.removeEventListener("storage", onStorage);
  };
}
