// Ward 058: single-source-of-truth for the renderer preference.
//
// localStorage + CustomEvent bus. The ONLY place in `site/` that touches
// `localStorage[STORAGE_KEY]` and the ONLY emitter of `EVENT_NAME`. Other
// modules subscribe via `subscribePreference()` or call `setPreference()`.
//
// SSR-safe: every entry point guards `typeof window !== "undefined"`. Astro
// renders pages at build time in a Node context where `window` is absent;
// these functions must not crash there.

export type RendererPreference = "auto" | "webgpu" | "canvas2d";

const STORAGE_KEY = "liquiddom-renderer-preference";
const EVENT_NAME = "liquiddom:renderer-change";

function isPreference(value: unknown): value is RendererPreference {
  return value === "auto" || value === "webgpu" || value === "canvas2d";
}

/**
 * Read the current preference. Returns `"auto"` on SSR, when nothing is stored,
 * when the stored value is invalid, or when `localStorage.getItem` itself
 * throws (private mode / quota / disabled).
 */
export function getPreference(): RendererPreference {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isPreference(raw)) return raw;
  } catch {
    // Private mode / disabled storage — fall through to default.
  }
  return "auto";
}

/**
 * Write the preference and dispatch the change event. If `localStorage.setItem`
 * throws (private mode / quota), the persistence failure is swallowed — the
 * event still fires so the toggle UI updates for the session.
 *
 * SSR no-op.
 */
export function setPreference(value: RendererPreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Persistence failure must not block UI state change.
  }
  window.dispatchEvent(
    new CustomEvent<{ preference: RendererPreference }>(EVENT_NAME, {
      detail: { preference: value },
    }),
  );
}

/**
 * Subscribe to preference changes. Returns an unsubscribe function. SSR-safe:
 * returns a no-op unsubscribe so callers don't need to guard their own usage.
 */
export function subscribePreference(
  cb: (value: RendererPreference) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ preference: RendererPreference }>).detail;
    cb(detail.preference);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
