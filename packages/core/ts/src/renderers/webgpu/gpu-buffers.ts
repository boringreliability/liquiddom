/**
 * W71: pure packing from `RenderFrame` views into typed arrays for `queue.writeBuffer`
 * (slice-3 design §2 "Per-frame data"). No GPU, no DOM.
 * - particles: `x, y` interleaved for `[0, activeParticles)`; a non-finite position goes far
 *   off-screen;
 * - homes: the element id per particle, −1 when unassigned, fractional, out of range or
 *   unpainted (Review Focus 3); the renderer uploads it only when `generation`, `paints` or the
 *   particle count changes. An inactive slot (w == 0) keeps its id: it is not drawn because its
 *   element record has flags 0 (W71 ward-review I1), so the homes stay right when it reappears;
 * - elements: one 16-float record per slot (WGSL `struct Element`), written every frame.
 *   Colour stays straight (rgb 0–1, a 0–1); the shaders premultiply.
 */
import { Dyn, ELEMENT_STRIDE, homeRectInto, type HomeRect, St, STATE_STRIDE, Stat } from "../../fluid-layout";
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

/** `x, y` of particle i at `out[2i], out[2i + 1]`; returns the instance count. */
export function packParticles(frame: RenderFrame, out: Float32Array): number {
  const n = particleCount(frame);
  if (out.length < n * 2) throw new RangeError(`[liquiddom] packParticles: out holds ${out.length} floats, needs ${n * 2}`);
  const cap = frame.particleCapacity;
  const dyn = frame.dynamicView;
  const xs = Dyn.X * cap;
  const ys = Dyn.Y * cap;
  for (let i = 0; i < n; i++) {
    const x = dyn[xs + i] as number;
    const y = dyn[ys + i] as number;
    const ok = Number.isFinite(x) && Number.isFinite(y);
    out[2 * i] = ok ? x : OFFSCREEN_PX;
    out[2 * i + 1] = ok ? y : OFFSCREEN_PX;
  }
  return n;
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
