/**
 * W71: pure packing from `RenderFrame` views into typed arrays for `queue.writeBuffer`
 * (slice-3 design §2 "Per-frame data"). No GPU, no DOM.
 * - particles: W74 (D74-4) 8 floats per active particle (`x, y, f00, f01, f10, f11, flags, pad`);
 *   a non-finite position goes far off-screen, a non-finite F becomes the identity with FLAG_TORN;
 * - rest UVs (W74): `rest_u, rest_v` per active particle, uploaded with the homes;
 * - text info (W74): one 8-float record per slot (atlas rect, rest size, valid);
 * - homes: the element id per particle, −1 when unassigned, fractional, out of range or
 *   unpainted (Review Focus 3); the renderer uploads it only when `generation`, `paints` or the
 *   particle count changes. An inactive slot (w == 0) keeps its id: it is not drawn because its
 *   element record has flags 0 (W71 ward-review I1), so the homes stay right when it reappears;
 * - elements: one 16-float record per slot (WGSL `struct Element`), written every frame.
 *   Colour stays straight (rgb 0–1, a 0–1); the shaders premultiply.
 */
import { Dyn, ELEMENT_STRIDE, FLAG_TORN, homeRectInto, type HomeRect, St, STATE_STRIDE, Stat } from "../../fluid-layout";
import type { RenderFrame } from "../frame";
import { kernelRadiusPx } from "../kernel-params";

/** Floats per element record: rect (4), radius, restAlpha, mass, kernel radius, rgba (4), flags, 3 × pad = 64 bytes. */
export const ELEMENT_GPU_FLOATS = 16;
/** Offsets in one element record; mirrors WGSL `struct Element` (shaders.ts). */
export const EG = {
  X: 0, Y: 1, W: 2, H: 3, RADIUS: 4, REST_ALPHA: 5, MASS: 6, KERNEL_R: 7, R: 8, G: 9, B: 10, A: 11, FLAGS: 12,
} as const;
/** Written for a particle whose x or y is not finite: its quad lands far outside the viewport. */
export const OFFSCREEN_PX = -1e6;
/** W74 (D74-4): floats per particle — x, y, f00, f01, f10, f11, flags, pad — WGSL `struct Particle` (2 × vec4f, 32 bytes). */
export const PARTICLE_GPU_FLOATS = 8;
/** W74 (D74-4): floats per slot — atlas u0, v0, us, vs; rest w, h (CSS px); valid; pad — WGSL `struct TextInfo` (32 bytes). */
export const TEXT_INFO_FLOATS = 8;
/** Slack for an atlas rect touching the page edge (atlas px). */
const ATLAS_EDGE_EPS = 1e-3;

/** The atlas facts packTextInfo needs (a TextAtlasFrame without its canvas). */
export interface AtlasSize {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

const clamp01 = (v: number): number => (v > 0 ? (v < 1 ? v : 1) : 0);
/** An 8-bit colour channel as a finite 0–1 float (NaN → 0, out of range clamped). */
const channel01 = (v: number): number => clamp01(v / 255);
const rect: HomeRect = { x: 0, y: 0, w: 0, h: 0, r: 0 };

function particleCount(frame: RenderFrame): number {
  return Math.max(0, Math.min(frame.activeParticles, frame.particleCapacity));
}

function slotCount(frame: RenderFrame): number {
  return Math.min(frame.paints.length, Math.floor(frame.elementView.length / ELEMENT_STRIDE));
}

/**
 * W74 (D74-4): one 8-float record per active particle at `out[8i…8i+7]`: `x, y` (a non-finite
 * position goes far off-screen), `f00, f01, f10, f11`, `flags` (a non-finite F becomes the
 * identity with FLAG_TORN, so its text coverage is 0) and a zero pad. Returns the instance count.
 */
export function packParticles(frame: RenderFrame, out: Float32Array): number {
  const n = particleCount(frame);
  const need = n * PARTICLE_GPU_FLOATS;
  if (out.length < need) throw new RangeError(`[liquiddom] packParticles: out holds ${out.length} floats, needs ${need}`);
  const cap = frame.particleCapacity;
  const dyn = frame.dynamicView;
  for (let i = 0; i < n; i++) {
    const o = i * PARTICLE_GPU_FLOATS;
    const x = dyn[Dyn.X * cap + i] as number;
    const y = dyn[Dyn.Y * cap + i] as number;
    const ok = Number.isFinite(x) && Number.isFinite(y);
    out[o] = ok ? x : OFFSCREEN_PX;
    out[o + 1] = ok ? y : OFFSCREEN_PX;
    const f00 = dyn[Dyn.F00 * cap + i] as number;
    const f01 = dyn[Dyn.F01 * cap + i] as number;
    const f10 = dyn[Dyn.F10 * cap + i] as number;
    const f11 = dyn[Dyn.F11 * cap + i] as number;
    const raw = dyn[Dyn.FLAGS * cap + i] as number;
    const flags = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0;
    const fOk = Number.isFinite(f00) && Number.isFinite(f01) && Number.isFinite(f10) && Number.isFinite(f11);
    out[o + 2] = fOk ? f00 : 1;
    out[o + 3] = fOk ? f01 : 0;
    out[o + 4] = fOk ? f10 : 0;
    out[o + 5] = fOk ? f11 : 1;
    out[o + 6] = fOk ? flags : flags | FLAG_TORN;
    out[o + 7] = 0;
  }
  return n;
}

/** W74 (D74-4): `rest_u, rest_v` per active particle at `out[2i], out[2i + 1]`; non-finite → −1 (outside [0,1]²: no text). */
export function packRestUV(frame: RenderFrame, out: Float32Array): void {
  const n = particleCount(frame);
  if (out.length < n * 2) throw new RangeError(`[liquiddom] packRestUV: out holds ${out.length} floats, needs ${n * 2}`);
  const cap = frame.particleCapacity;
  const st = frame.staticView;
  for (let i = 0; i < n; i++) {
    const u = st[Stat.REST_U * cap + i] as number;
    const v = st[Stat.REST_V * cap + i] as number;
    out[2 * i] = Number.isFinite(u) ? u : -1;
    out[2 * i + 1] = Number.isFinite(v) ? v : -1;
  }
}

/**
 * W74 (D74-4, Review Focus 4): one 8-float record per slot in `[0, min(ok.length, out.length / 8))`:
 * the atlas rect normalised to the page (u0, v0, us, vs), the rest size in CSS px (atlas px / dpr)
 * and a valid flag; `ok[id] = 1` for a valid record. Valid only for a painted slot whose finite,
 * non-empty rect lies inside the page; every other record is all zero. Returns the slots written.
 */
export function packTextInfo(frame: RenderFrame, atlas: AtlasSize, out: Float32Array, ok: Uint8Array): number {
  const slots = Math.min(ok.length, Math.floor(out.length / TEXT_INFO_FLOATS));
  out.fill(0, 0, slots * TEXT_INFO_FLOATS);
  ok.fill(0, 0, slots);
  const { width, height } = atlas;
  if (!(Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1)) return slots;
  const dpr = Number.isFinite(atlas.dpr) && atlas.dpr > 0 ? atlas.dpr : 1;
  const n = Math.min(slots, frame.paints.length);
  for (let id = 0; id < n; id++) {
    const r = frame.paints[id]?.atlasRect;
    if (!r) continue;
    const finite = Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.w) && Number.isFinite(r.h);
    if (!finite || !(r.w > 0 && r.h > 0)) continue;
    if (r.x < 0 || r.y < 0 || r.x + r.w > width + ATLAS_EDGE_EPS || r.y + r.h > height + ATLAS_EDGE_EPS) continue;
    const o = id * TEXT_INFO_FLOATS;
    out[o] = r.x / width;
    out[o + 1] = r.y / height;
    out[o + 2] = r.w / width;
    out[o + 3] = r.h / height;
    out[o + 4] = r.w / dpr;
    out[o + 5] = r.h / dpr;
    out[o + 6] = 1;
    out[o + 7] = 0;
    ok[id] = 1;
  }
  return slots;
}

/** W74 (D74-4): true when a slot with a valid text record has restAlpha < 1 this frame (the text pass runs). */
export function hasMovingText(frame: RenderFrame, ok: Uint8Array): boolean {
  const n = Math.min(ok.length, frame.paints.length, Math.floor(frame.stateView.length / STATE_STRIDE));
  for (let id = 0; id < n; id++) {
    if (ok[id] === 1 && (frame.stateView[id * STATE_STRIDE + St.REST_ALPHA] as number) < 1) return true;
  }
  return false;
}

/**
 * Home slot id per particle, −1 when it has no painted home (Review Focus 3). Visibility per frame
 * (w == 0) is the element record's job, not this cached upload's (W71 ward-review I1).
 */
export function packHomes(frame: RenderFrame, out: Int32Array): void {
  const n = particleCount(frame);
  if (out.length < n) throw new RangeError(`[liquiddom] packHomes: out holds ${out.length} ids, needs ${n}`);
  const base = Stat.HOME * frame.particleCapacity;
  const slots = slotCount(frame);
  for (let i = 0; i < n; i++) {
    const h = frame.staticView[base + i] as number;
    const drawable = Number.isInteger(h) && h >= 0 && h < slots && frame.paints[h] !== undefined;
    out[i] = drawable ? h : -1;
  }
}

/**
 * One record per slot in `[0, n)`, where n is 1 + the last drawable slot (0 when none: the
 * renderer then skips the rest pass). Slots without a paint or with an inactive rect get an
 * all-zero record (flags 0). The rect is the home rect incl. `home_dx/dy` and the hover swell.
 */
export function packElements(frame: RenderFrame, out: Float32Array): number {
  const slots = slotCount(frame);
  if (out.length < slots * ELEMENT_GPU_FLOATS) {
    throw new RangeError(`[liquiddom] packElements: out holds ${out.length} floats, needs ${slots * ELEMENT_GPU_FLOATS}`);
  }
  let count = 0;
  for (let id = 0; id < slots; id++) {
    const o = id * ELEMENT_GPU_FLOATS;
    const paint = frame.paints[id];
    if (!paint || !homeRectInto(rect, frame.elementView, id, frame.reducedMotion)) {
      out.fill(0, o, o + ELEMENT_GPU_FLOATS);
      continue;
    }
    const bg = paint.background;
    const mass = paint.areaPerParticle;
    out[o + EG.X] = rect.x;
    out[o + EG.Y] = rect.y;
    out[o + EG.W] = rect.w;
    out[o + EG.H] = rect.h;
    out[o + EG.RADIUS] = rect.r;
    out[o + EG.REST_ALPHA] = clamp01(frame.stateView[id * STATE_STRIDE + St.REST_ALPHA] as number);
    out[o + EG.MASS] = Number.isFinite(mass) && mass > 0 ? mass : 0;
    out[o + EG.KERNEL_R] = kernelRadiusPx(paint.spacingPx);
    out[o + EG.R] = channel01(bg[0]);
    out[o + EG.G] = channel01(bg[1]);
    out[o + EG.B] = channel01(bg[2]);
    out[o + EG.A] = clamp01(bg[3]);
    out[o + EG.FLAGS] = 1;
    out[o + 13] = 0;
    out[o + 14] = 0;
    out[o + 15] = 0;
    count = id + 1;
  }
  return count;
}
