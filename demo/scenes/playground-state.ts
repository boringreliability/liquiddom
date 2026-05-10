/**
 * Ward 049: pure state functions for the visual playground.
 * Tweakpane-free so this module is importable from jsdom tests.
 *
 * Persists tweak state in localStorage under `liquiddom-playground-v1`.
 * Schema mismatches → discard old state and fall back to defaults.
 */

import type { LiquidPhysicsConfig } from "../../ts/src/index";

export interface PlaygroundState {
  schema: 1;
  physics: Required<LiquidPhysicsConfig>;
  theme: {
    colorDefault: string;
    colorHover: string;
  };
}

export const PLAYGROUND_STORAGE_KEY = "liquiddom-playground-v1";

/**
 * Load saved playground state from localStorage. Returns null if nothing saved,
 * the stored data is unparseable, the schema version is wrong, or required
 * fields are missing. Caller falls back to defaults.
 *
 * Corrupt entries are cleared from localStorage as a side effect.
 */
export function loadPlaygroundState(): PlaygroundState | null {
  const raw = localStorage.getItem(PLAYGROUND_STORAGE_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    localStorage.removeItem(PLAYGROUND_STORAGE_KEY);
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { schema?: unknown }).schema !== 1 ||
    typeof (parsed as { physics?: unknown }).physics !== "object" ||
    (parsed as { physics?: unknown }).physics === null ||
    typeof (parsed as { theme?: unknown }).theme !== "object" ||
    (parsed as { theme?: unknown }).theme === null
  ) {
    localStorage.removeItem(PLAYGROUND_STORAGE_KEY);
    return null;
  }

  return parsed as PlaygroundState;
}

export interface UrlParamOverrides {
  capacity?: number;
  forceReducedMotion?: boolean;
  preserveBackgrounds?: boolean;
}

/**
 * Parse init-only overrides from `window.location.search`. Each parameter is
 * validated independently. Invalid values are silently ignored (caller falls
 * back to localStorage or defaults).
 *
 * On any successful parse, strips the params from the address bar via
 * `history.replaceState` to avoid confusion on subsequent reloads.
 */
function parseStrictBool(raw: string | null): boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

export function parseUrlParams(): UrlParamOverrides {
  const params = new URLSearchParams(window.location.search);
  const out: UrlParamOverrides = {};
  let anyValid = false;

  const capRaw = params.get("capacity");
  // parseInt("128abc", 10) → 128, so require pure digits before accepting.
  if (capRaw !== null && /^\d+$/.test(capRaw)) {
    const n = parseInt(capRaw, 10);
    if (Number.isInteger(n) && n > 0) {
      out.capacity = n;
      anyValid = true;
    }
  }

  const frm = parseStrictBool(params.get("forceReducedMotion"));
  if (frm !== undefined) {
    out.forceReducedMotion = frm;
    anyValid = true;
  }

  const pb = parseStrictBool(params.get("preserveBackgrounds"));
  if (pb !== undefined) {
    out.preserveBackgrounds = pb;
    anyValid = true;
  }

  if (anyValid) {
    history.replaceState({}, "", window.location.pathname);
  }

  return out;
}
