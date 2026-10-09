/**
 * Public options (spec §5) and their validation (W66: D66-1, D66-6, D66-7, D66-14, B11, B13, C3).
 * `ElementOptions` was created in W64 (A5) and is unchanged.
 */
import type { FrameClock } from "./clock";
import type { FluidBackend } from "./wasm-loader";
import type { RendererChoice } from "./renderers/select";
import { DEFAULT_MATERIAL, MATERIAL_RANGES, mergeMaterial, validateMaterial, type Material } from "./material";

/** Per-element overrides (FFI slots 8–9). Omitted = material default. */
export interface ElementOptions {
  /** [0, 1]. */
  viscosity?: number;
  /** Seconds, [0.2, 3]. */
  recovery?: number;
}

/** W46 shape. Accepted and validated; no effect until slice 6. */
export interface GravityOptions {
  source: "none" | "fixed" | "orientation";
  /** px/s² for `source: 'fixed'`. Default [0, 0]. */
  vector?: [number, number];
  /** px/s² multiplier for `source: 'orientation'`. Default 980. */
  strength?: number;
}

export interface LiquidOptions {
  /** Fixed particle pool, integer in [256, 65536]. Default 8000. */
  particles?: number;
  /** Fixed element slots, integer in [1, 256]. Default 32. observe() beyond it throws RangeError. */
  maxElements?: number;
  /** Container mode: canvas inside this element, coordinates relative to it. */
  container?: HTMLElement;
  /** Default 'auto': WebGPU on a hardware adapter, else Canvas2D (W72, D72-1). 'webgpu' also accepts a software adapter and rejects create() with WebGPUUnavailableError when WebGPU is missing. */
  renderer?: RendererChoice;
  /** Partial material, merged over the defaults (viscosity 0.5, cohesion 0.5, recovery 0.7). */
  material?: Partial<Material>;
  gravity?: GravityOptions;
  /** u32. Default: random. Same seed + inputs + viewport = same positions. */
  seed?: number;
  /** Observe `[data-liquid]` elements at create. Default true. */
  autoObserve?: boolean;
  /** Force reduced motion regardless of the OS setting. Default false. */
  forceReducedMotion?: boolean;
  /** Hides the one console.info logged when 'auto' falls back to Canvas2D. Default false. */
  silentFallback?: boolean;
  /** @internal jsdom/test backend instead of the WASM loader. */
  testBackend?: FluidBackend;
  /** @internal WASM loader override (the stress scene's counting loader). */
  loader?: () => Promise<FluidBackend>;
  /** @internal frame clock (W65 manual or counting clock). */
  clock?: FrameClock;
  /** @internal W71 (D71-4): WebGPU T0 render scale in [0.25, 1] (W72, M2) for the demo's ?t0 comparison. Default 0.5. */
  webgpuT0Scale?: number;
}

export interface ResolvedGravity {
  source: GravityOptions["source"];
  vector: [number, number];
  strength: number;
}

export interface ResolvedOptions {
  particles: number;
  maxElements: number;
  renderer: RendererChoice;
  material: Material;
  gravity: ResolvedGravity;
  seed: number;
  autoObserve: boolean;
  forceReducedMotion: boolean;
  silentFallback: boolean;
  container: HTMLElement | undefined;
  testBackend: FluidBackend | undefined;
  loader: (() => Promise<FluidBackend>) | undefined;
  clock: FrameClock | undefined;
  webgpuT0Scale: number | undefined;
}

export const DEFAULT_PARTICLES = 8000;
export const DEFAULT_MAX_ELEMENTS = 32;
export const PARTICLES_MIN = 256;
export const PARTICLES_MAX = 65536;
export const MAX_ELEMENTS_MIN = 1;
export const MAX_ELEMENTS_MAX = 256;
export const DEFAULT_GRAVITY_STRENGTH = 980;

export const OPTION_KEYS = [
  "particles", "maxElements", "container", "renderer", "material", "gravity", "seed",
  "autoObserve", "forceReducedMotion", "silentFallback", "testBackend", "loader", "clock", "webgpuT0Scale",
] as const satisfies readonly (keyof LiquidOptions)[];

const COLOUR_HINT = "the liquid colour is each element's computed background-color (call refresh(el) after a theme change)";

/** D66-1: removed 0.2 options and the hint each TypeError carries. */
export const REMOVED_OPTIONS: Readonly<Record<string, string>> = Object.freeze({
  capacity: 'use "maxElements" (fixed element slots; observe() beyond it throws RangeError)',
  physics: 'use "material": { viscosity, cohesion, recovery }',
  colorDefault: COLOUR_HINT,
  colorHover: COLOUR_HINT,
  colorSource: COLOUR_HINT,
  theme: "fusion and refraction are gone; colour comes from computed style",
  refraction: "removed together with the soft-body WebGPU shaders",
  preserveBackgrounds: "the element background is always carried by the liquid; border and box-shadow are dropped (D8)",
  snapDurationMs: "the scroll lerp is gone; the liquid follows scroll through its targets",
  canvasZIndex: "stacking is handled by the injected stylesheet (canvas z-index 0, observed elements z-index 1)",
  maxDt: "the engine clamps dt to 100 ms internally",
});

function fail(message: string): never {
  throw new TypeError(`[liquiddom] ${message}`);
}

function show(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean" || v === null || v === undefined) return String(v);
  if (Array.isArray(v)) return "an array";
  return `a ${typeof v}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function integerIn(name: string, v: unknown, lo: number, hi: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) {
    fail(`${name} must be an integer in [${lo}, ${hi}], got ${show(v)}`);
  }
  return v;
}

function booleanOr(name: string, v: unknown, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  if (typeof v !== "boolean") fail(`${name} must be a boolean, got ${show(v)}`);
  return v;
}

function checkFiniteIn(name: string, v: unknown, lo: number, hi: number): void {
  if (v === undefined) return;
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) {
    fail(`${name} must be a finite number in [${lo}, ${hi}], got ${show(v)}`);
  }
}

/** D66-7: a random u32 when the caller gives no seed. */
function randomSeed(): number {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") return c.getRandomValues(new Uint32Array(1))[0] as number;
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
}

function resolveGravity(v: unknown): ResolvedGravity {
  if (v === undefined) return { source: "none", vector: [0, 0], strength: DEFAULT_GRAVITY_STRENGTH };
  if (!isPlainObject(v)) fail(`gravity must be an object, got ${show(v)}`);
  for (const key of Object.keys(v)) {
    if (key !== "source" && key !== "vector" && key !== "strength") fail(`unknown gravity option "${key}" (allowed: source, vector, strength)`);
  }
  const source = v.source;
  if (source !== "none" && source !== "fixed" && source !== "orientation") {
    fail(`gravity.source must be "none", "fixed" or "orientation", got ${show(source)}`);
  }
  let vector: [number, number] = [0, 0];
  if (v.vector !== undefined) {
    const vec: unknown = v.vector;
    if (!Array.isArray(vec) || vec.length !== 2 || !vec.every((n: unknown) => typeof n === "number" && Number.isFinite(n))) {
      fail(`gravity.vector must be [x, y] with finite numbers (px/s²), got ${show(vec)}`);
    }
    vector = [vec[0] as number, vec[1] as number];
  }
  let strength = DEFAULT_GRAVITY_STRENGTH;
  if (v.strength !== undefined) {
    if (typeof v.strength !== "number" || !Number.isFinite(v.strength) || v.strength < 0) {
      fail(`gravity.strength must be a finite number >= 0 (px/s²), got ${show(v.strength)}`);
    }
    strength = v.strength;
  }
  return { source, vector, strength };
}

function resolveContainer(v: unknown): HTMLElement | undefined {
  if (v === undefined) return undefined;
  if (typeof HTMLElement === "undefined" || !(v instanceof HTMLElement)) fail(`container must be an HTMLElement, got ${show(v)}`);
  return v;
}

function resolveTestBackend(v: unknown): FluidBackend | undefined {
  if (v === undefined) return undefined;
  if (!isPlainObject(v) || typeof v.FluidCore !== "function" || typeof v.memory !== "object" || v.memory === null || !("buffer" in v.memory)) {
    fail("testBackend (@internal) must be { memory: { buffer }, FluidCore }");
  }
  return v as unknown as FluidBackend;
}

function resolveLoader(v: unknown): (() => Promise<FluidBackend>) | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "function") fail(`loader (@internal) must be a function returning Promise<FluidBackend>, got ${show(v)}`);
  return v as () => Promise<FluidBackend>;
}

function resolveClock(v: unknown): FrameClock | undefined {
  if (v === undefined) return undefined;
  if (!isPlainObject(v) || typeof v.now !== "function" || typeof v.request !== "function" || typeof v.cancel !== "function") {
    fail("clock (@internal) must be a FrameClock { now, request, cancel }");
  }
  return v as unknown as FrameClock;
}

function resolveWebgpuT0Scale(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  // W72 (W71 ward-review M2): the floor matches the renderer's T0_SCALE_MIN (0.25).
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0.25 || v > 1) {
    fail(`webgpuT0Scale (@internal) must be a finite number in [0.25, 1], got ${show(v)}`);
  }
  return v;
}

export function resolveOptions(input?: LiquidOptions): ResolvedOptions {
  const given: unknown = input === undefined ? {} : input;
  if (!isPlainObject(given)) fail(`LiquidDOM.create(options): options must be an object, got ${show(given)}`);
  for (const key of Object.keys(given)) {
    if (Object.hasOwn(REMOVED_OPTIONS, key)) fail(`option "${key}" was removed in 0.3: ${REMOVED_OPTIONS[key]}`);
    if (!(OPTION_KEYS as readonly string[]).includes(key)) fail(`unknown option "${key}" (allowed: ${OPTION_KEYS.join(", ")})`);
  }
  const particles = given.particles === undefined ? DEFAULT_PARTICLES : integerIn("particles", given.particles, PARTICLES_MIN, PARTICLES_MAX);
  const maxElements = given.maxElements === undefined ? DEFAULT_MAX_ELEMENTS : integerIn("maxElements", given.maxElements, MAX_ELEMENTS_MIN, MAX_ELEMENTS_MAX);
  const renderer = given.renderer === undefined ? "auto" : given.renderer;
  if (renderer !== "auto" && renderer !== "webgpu" && renderer !== "canvas2d") fail(`renderer must be "auto", "webgpu" or "canvas2d", got ${show(renderer)}`);
  // D66-14: always a fresh, complete Material.
  let material: Material = mergeMaterial(DEFAULT_MATERIAL, {});
  if (given.material !== undefined) {
    validateMaterial(given.material as Partial<Material>);
    material = mergeMaterial(DEFAULT_MATERIAL, given.material as Partial<Material>);
  }
  return {
    particles,
    maxElements,
    renderer,
    material,
    gravity: resolveGravity(given.gravity),
    seed: given.seed === undefined ? randomSeed() : integerIn("seed", given.seed, 0, 0xffff_ffff),
    autoObserve: booleanOr("autoObserve", given.autoObserve, true),
    forceReducedMotion: booleanOr("forceReducedMotion", given.forceReducedMotion, false),
    silentFallback: booleanOr("silentFallback", given.silentFallback, false),
    container: resolveContainer(given.container),
    testBackend: resolveTestBackend(given.testBackend),
    loader: resolveLoader(given.loader),
    clock: resolveClock(given.clock),
    webgpuT0Scale: resolveWebgpuT0Scale(given.webgpuT0Scale),
  };
}

/** C3: validates observe(el, opts). A number is the removed 0.2 liquidType. */
export function validateElementOptions(opts: unknown): asserts opts is ElementOptions | undefined {
  if (opts === undefined) return;
  if (typeof opts === "number") {
    fail("observe(el, liquidType) was removed in 0.3: liquidType is gone; pass element options { viscosity?, recovery? }");
  }
  if (!isPlainObject(opts)) fail(`element options must be an object, got ${show(opts)}`);
  for (const key of Object.keys(opts)) {
    if (key === "liquidType") fail('element option "liquidType" was removed in 0.3: the liquid behaviour is uniform; use { viscosity?, recovery? }');
    if (key !== "viscosity" && key !== "recovery") fail(`unknown element option "${key}" (allowed: viscosity, recovery)`);
  }
  checkFiniteIn("viscosity", opts.viscosity, MATERIAL_RANGES.viscosity[0], MATERIAL_RANGES.viscosity[1]);
  checkFiniteIn("recovery", opts.recovery, MATERIAL_RANGES.recovery[0], MATERIAL_RANGES.recovery[1]);
}

// ---- W67: splash() / shake() options (spec §5; D67-4, D67-8; B9) -----------

/**
 * Options for `instance.splash(el, opts)`.
 *
 * Changed shape in 0.3: the 0.2 fields `threshold`, `count`, `jitter`,
 * `speedScale`, `lifetimeMs` and `radius` are gone and throw a `TypeError`.
 */
export interface SplashOptions {
  /** Splash strength, 0–2. Default 1. 0 is a no-op. */
  strength?: number;
  /** Splash origin in client px (like `MouseEvent.clientX/Y`). Default: the element's rect centre. */
  at?: { x: number; y: number };
}

export const STRENGTH_MIN = 0;
export const STRENGTH_MAX = 2;
export const DEFAULT_STRENGTH = 1;

const SPLASH_OPTION_KEYS: ReadonlySet<string> = new Set(["strength", "at"]);
const REMOVED_SPLASH_OPTION_KEYS: ReadonlySet<string> = new Set([
  "threshold",
  "count",
  "jitter",
  "speedScale",
  "lifetimeMs",
  "radius",
  "magnitude",
  "direction",
  "splash",
]);

export interface ResolvedSplash {
  readonly strength: number;
  readonly at: { readonly x: number; readonly y: number } | null;
}

function checkStrength(method: "splash" | "shake", value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < STRENGTH_MIN || value > STRENGTH_MAX) {
    throw new TypeError(
      `[liquiddom] ${method}(): strength must be a finite number in [${STRENGTH_MIN}, ${STRENGTH_MAX}], got ${String(value)}.`,
    );
  }
  return value;
}

/** @internal Validates `shake(strength?)` (D67-4). */
export function validateShakeStrength(strength: unknown): number {
  return strength === undefined ? DEFAULT_STRENGTH : checkStrength("shake", strength);
}

/** @internal Validates `splash(el, opts?)` options: whitelist, D67-4, B9. */
export function validateSplashOptions(opts: unknown): ResolvedSplash {
  if (opts === undefined) return { strength: DEFAULT_STRENGTH, at: null };
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) {
    throw new TypeError("[liquiddom] splash(el, opts): opts must be an object { strength?, at? }.");
  }
  for (const key of Object.keys(opts)) {
    if (REMOVED_SPLASH_OPTION_KEYS.has(key)) {
      throw new TypeError(
        `[liquiddom] splash(): option "${key}" was removed in 0.3 — SplashOptions changed shape. ` +
          "Use { strength?: number /* 0–2 */, at?: { x, y } /* client px */ }.",
      );
    }
    if (!SPLASH_OPTION_KEYS.has(key)) {
      throw new TypeError(`[liquiddom] splash(): unknown option "${key}". Allowed: strength, at.`);
    }
  }
  const o = opts as { strength?: unknown; at?: unknown };
  const strength = o.strength === undefined ? DEFAULT_STRENGTH : checkStrength("splash", o.strength);
  if (o.at === undefined) return { strength, at: null };
  const at = o.at as { x?: unknown; y?: unknown } | null;
  if (
    at === null ||
    typeof at !== "object" ||
    Array.isArray(at) ||
    typeof at.x !== "number" ||
    typeof at.y !== "number" ||
    !Number.isFinite(at.x) ||
    !Number.isFinite(at.y)
  ) {
    throw new TypeError("[liquiddom] splash(): at must be { x: number, y: number } in client px with finite values.");
  }
  return { strength, at: { x: at.x, y: at.y } };
}
