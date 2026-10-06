/**
 * Ward 069: pure state for the material playground (port of the W49 mechanism).
 *
 * Tweakpane-free and free of runtime imports from "liquiddom" (type imports
 * only), so jsdom tests load it without a built core. Persists under
 * `liquiddom-playground-v2` (D69-1). Schema-1 data from the soft-body physics
 * playground is discarded, never migrated.
 */
import type { LiquidDOMInstance, Material } from "liquiddom";

export const PLAYGROUND_STORAGE_KEY = "liquiddom-playground-v2";
/** Keys of earlier playground schemas. Removed on every load (D69-1). */
export const LEGACY_STORAGE_KEYS: readonly string[] = ["liquiddom-playground-v1"];
export const PLAYGROUND_SCHEMA = 2;

/** D66-6 bounds for `particles`; `seed` is a u32. */
export const PARTICLES_MIN = 256;
export const PARTICLES_MAX = 65536;
export const SEED_MAX = 0xffff_ffff;

/** Spec §2 material ranges. Must agree with core `validateMaterial` (tested). */
export const MATERIAL_BOUNDS: Readonly<Record<keyof Material, { readonly min: number; readonly max: number }>> = {
  viscosity: { min: 0, max: 1 },
  cohesion: { min: 0, max: 1 },
  recovery: { min: 0.2, max: 3 },
};
export const MATERIAL_KEYS: readonly (keyof Material)[] = ["viscosity", "cohesion", "recovery"];

/**
 * Mirror of core DEFAULT_MATERIAL (spec §2: 0.5, 0.5, 0.7). Kept local because
 * DEFAULT_MATERIAL is not on the public export whitelist; a test asserts equality.
 */
export const PLAYGROUND_DEFAULT_MATERIAL: Readonly<Material> = Object.freeze({
  viscosity: 0.5,
  cohesion: 0.5,
  recovery: 0.7,
});

export type PlaygroundRenderer = "auto" | "canvas2d" | "webgpu";

export interface PlaygroundInit {
  particles: number;
  seed: number;
  renderer: PlaygroundRenderer;
  forceReducedMotion: boolean;
}

export interface PlaygroundState {
  schema: 2;
  material: Material;
  init: PlaygroundInit;
}

export type PresetName = "water" | "honey" | "jelly";
export type PresetChoice = PresetName | "custom";
export const PRESET_NAMES: readonly PresetName[] = ["water", "honey", "jelly"];
/** Slider rounding tolerance for preset detection (slider steps are 0.01 / 0.05). */
export const PRESET_MATCH_EPSILON = 0.005;

export const DEFAULT_PLAYGROUND_INIT: Readonly<PlaygroundInit> = Object.freeze({
  particles: 8000,
  seed: 1,
  renderer: "auto",
  forceReducedMotion: false,
});

export interface UrlParamOverrides {
  particles?: number;
  seed?: number;
  renderer?: PlaygroundRenderer;
  forceReducedMotion?: boolean;
}

export type MaterialTarget = Pick<LiquidDOMInstance, "setMaterial" | "getMaterial">;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function inRange(v: unknown, min: number, max: number): boolean {
  return isFiniteNumber(v) && v >= min && v <= max;
}

function isRenderer(v: unknown): v is PlaygroundRenderer {
  return v === "auto" || v === "canvas2d" || v === "webgpu";
}

export function isValidMaterial(m: unknown): m is Material {
  if (typeof m !== "object" || m === null || Array.isArray(m)) return false;
  const r = m as Record<string, unknown>;
  return MATERIAL_KEYS.every((k) => inRange(r[k], MATERIAL_BOUNDS[k].min, MATERIAL_BOUNDS[k].max));
}

export function isValidInit(i: unknown): i is PlaygroundInit {
  if (typeof i !== "object" || i === null || Array.isArray(i)) return false;
  const r = i as Record<string, unknown>;
  return (
    Number.isInteger(r.particles) &&
    inRange(r.particles, PARTICLES_MIN, PARTICLES_MAX) &&
    Number.isInteger(r.seed) &&
    inRange(r.seed, 0, SEED_MAX) &&
    isRenderer(r.renderer) &&
    typeof r.forceReducedMotion === "boolean"
  );
}

function pickMaterial(m: Material): Material {
  return { viscosity: m.viscosity, cohesion: m.cohesion, recovery: m.recovery };
}

function pickInit(i: PlaygroundInit): PlaygroundInit {
  return { particles: i.particles, seed: i.seed, renderer: i.renderer, forceReducedMotion: i.forceReducedMotion };
}

/** `localStorage` itself can throw (blocked site data, sandboxed iframes). */
function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function safeGet(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeRemove(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Blocked storage: nothing to clean up.
  }
}

/**
 * Load saved state. Returns null when nothing is saved, the JSON is corrupt,
 * the schema is not 2, or any field is out of range. Bad entries and every
 * legacy key are removed as a side effect.
 */
export function loadPlaygroundState(storage: Storage | null = defaultStorage()): PlaygroundState | null {
  if (storage === null) return null;
  for (const key of LEGACY_STORAGE_KEYS) safeRemove(storage, key);

  const raw = safeGet(storage, PLAYGROUND_STORAGE_KEY);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeRemove(storage, PLAYGROUND_STORAGE_KEY);
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    safeRemove(storage, PLAYGROUND_STORAGE_KEY);
    return null;
  }
  const p = parsed as { schema?: unknown; material?: unknown; init?: unknown };
  if (p.schema !== PLAYGROUND_SCHEMA || !isValidMaterial(p.material) || !isValidInit(p.init)) {
    safeRemove(storage, PLAYGROUND_STORAGE_KEY);
    return null;
  }
  return { schema: 2, material: pickMaterial(p.material), init: pickInit(p.init) };
}

/** Persist state. Returns false when storage is unavailable or full. */
export function savePlaygroundState(state: PlaygroundState, storage: Storage | null = defaultStorage()): boolean {
  if (storage === null) return false;
  const payload: PlaygroundState = { schema: 2, material: pickMaterial(state.material), init: pickInit(state.init) };
  try {
    storage.setItem(PLAYGROUND_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

const DIGITS = /^\d+$/;

function parseDigits(raw: string | null): number | undefined {
  // parseInt("128abc", 10) === 128, so require pure digits first (W49 rule).
  if (raw === null || !DIGITS.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

function parseStrictBool(raw: string | null): boolean | undefined {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return undefined;
}

/**
 * Init-only overrides from `window.location.search`, validated one by one.
 * Invalid values are ignored. If any known key is present (valid or not), the
 * query string is stripped (the hash is kept) with `history.replaceState` so a reload uses the saved state (W49).
 */
const KNOWN_URL_KEYS: readonly string[] = ["particles", "seed", "renderer", "forceReducedMotion"];

export function parseUrlParams(): UrlParamOverrides {
  const params = new URLSearchParams(window.location.search);
  const out: UrlParamOverrides = {};

  const particles = parseDigits(params.get("particles"));
  if (particles !== undefined && particles >= PARTICLES_MIN && particles <= PARTICLES_MAX) out.particles = particles;

  const seed = parseDigits(params.get("seed"));
  if (seed !== undefined && seed <= SEED_MAX) out.seed = seed;

  const renderer = params.get("renderer");
  if (isRenderer(renderer)) out.renderer = renderer;

  const frm = parseStrictBool(params.get("forceReducedMotion"));
  if (frm !== undefined) out.forceReducedMotion = frm;

  if (KNOWN_URL_KEYS.some((k) => params.has(k))) {
    window.history.replaceState({}, "", window.location.pathname + window.location.hash);
  }
  return out;
}

/** Merge order: URL overrides > saved state > defaults. Always returns fresh objects. */
export function buildInitialState(
  saved: PlaygroundState | null,
  url: UrlParamOverrides,
  defaultMaterial: Readonly<Material>,
): PlaygroundState {
  const baseInit = saved?.init ?? DEFAULT_PLAYGROUND_INIT;
  return {
    schema: 2,
    material: pickMaterial(saved?.material ?? defaultMaterial),
    init: {
      particles: url.particles ?? baseInit.particles,
      seed: url.seed ?? baseInit.seed,
      renderer: url.renderer ?? baseInit.renderer,
      forceReducedMotion: url.forceReducedMotion ?? baseInit.forceReducedMotion,
    },
  };
}

export function detectPreset(
  material: Readonly<Material>,
  table: Readonly<Record<PresetName, Readonly<Material>>>,
): PresetChoice {
  for (const name of PRESET_NAMES) {
    const preset = table[name];
    if (MATERIAL_KEYS.every((k) => Math.abs(material[k] - preset[k]) <= PRESET_MATCH_EPSILON)) return name;
  }
  return "custom";
}

/**
 * Push one changed material field to the instance. Tweakpane has already
 * written `state.material[key]`. On a validation TypeError, revert the state
 * to the instance's material and return false. Other errors propagate.
 */
export function applyMaterialChange(instance: MaterialTarget, state: PlaygroundState, key: keyof Material): boolean {
  const partial: Partial<Material> = {};
  partial[key] = state.material[key];
  try {
    instance.setMaterial(partial);
    return true;
  } catch (err) {
    if (!(err instanceof TypeError)) throw err;
    Object.assign(state.material, instance.getMaterial());
    return false;
  }
}
