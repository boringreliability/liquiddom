/**
 * W88 (D88-4, D88-6, D88-11): which elements cast a renderer shadow this frame, and how the WebGPU
 * renderer groups their layers into passes. Pure: no DOM, no GPU.
 *
 * `ShadowCasters.collect()` finds every painted, active element with outer layers whose liquid is
 * away (`liquidAway`, the rule the toggle uses), skips parked particles (W81) and inactive slots,
 * and buckets the casters' particles by slot (a counting sort) with their bounds. Both renderers use
 * it; an element without a shadow costs one array read per frame.
 *
 * `planShadows()` (WebGPU) assigns density sources and radius groups:
 * - one density source per element and distinct spread (spread 0 always, for the knockout), four per
 *   `rgba16float` layer, at most SHADOW_MAX_SOURCES; an element whose sources do not fit draws no
 *   renderer shadow this frame (its toggle then keeps the browser's shadow);
 * - one group per distinct exact blur radius (D88-6 amended), half resolution, quarter for blur ≥ 32 px;
 *   past SHADOW_MAX_EXACT_GROUPS distinct radii a radius goes to its log-nearest bucket {4, 8, 16, 32, 64};
 * - one record per layer: its source, its offset (applied in the resolve, D88-11) and its colour.
 */
import { Dyn, El, ELEMENT_STRIDE, FLAG_PARKED, St, STATE_STRIDE, Stat } from "../fluid-layout";
import { liquidAway } from "../shadow";
import type { RenderFrame } from "./frame";
import { KERNEL_RADIUS_CAP_PX, kernelRadiusPx } from "./kernel-params";

/** D88-6: the shadow targets' scale against the canvas backing size. */
export const SHADOW_SCALE_HALF = 0.5;
export const SHADOW_SCALE_QUARTER = 0.25;
/** D88-6 (spike W88.0 Q2): blur radii from this many CSS px on use the quarter-resolution targets. */
export const SHADOW_QUARTER_FROM_PX = 32;
/** D88-6 (amended): distinct exact radii per frame; the rest go to a bucket. */
export const SHADOW_MAX_EXACT_GROUPS = 6;
/** D88-6: the overflow buckets (CSS px). */
export const SHADOW_BUCKETS_PX: readonly number[] = Object.freeze([4, 8, 16, 32, 64]);
/** D88-11: density channels per `rgba16float` layer and layers per frame. */
export const SHADOW_CHANNELS = 4;
export const SHADOW_MAX_DENSITY_LAYERS = 4;
export const SHADOW_MAX_SOURCES = SHADOW_CHANNELS * SHADOW_MAX_DENSITY_LAYERS;
/** D88-10 (amended, resolution 3): the knockout closes holes narrower than about 2 × this × the kernel radius (both renderers). */
export const KNOCKOUT_CLOSE_PER_KERNEL = 1.5;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class ShadowCasters {
  /** Slots that cast a renderer shadow this frame (painted, active, outer layers, liquid away, ≥ 1 particle), ascending. */
  readonly ids: number[] = [];
  /** Per slot: the particle-centre bounds `x0, y0, x1, y1` in CSS px (valid for `ids`). */
  bounds = new Float64Array(0);
  /** Per slot: the caster's particles are `order[start[id]] … order[start[id] + count[id] − 1]`. */
  start = new Int32Array(0);
  count = new Int32Array(0);
  order = new Int32Array(0);
  private want = new Uint8Array(0);
  private cursor = new Int32Array(0);

  private ensure(slots: number, cap: number): void {
    if (this.want.length < slots) {
      this.want = new Uint8Array(slots);
      this.bounds = new Float64Array(slots * 4);
      this.start = new Int32Array(slots);
      this.count = new Int32Array(slots);
      this.cursor = new Int32Array(slots);
    }
    if (this.order.length < cap) this.order = new Int32Array(cap);
  }

  /** The casters of `frame`; 0 (and no particle pass) when none. */
  collect(frame: RenderFrame): number {
    this.ids.length = 0;
    if (frame.suppressShadows === true || frame.reducedMotion) return 0;
    const ev = frame.elementView;
    const sv = frame.stateView;
    const slots = Math.min(frame.paints.length, Math.floor(ev.length / ELEMENT_STRIDE), Math.floor(sv.length / STATE_STRIDE));
    if (slots <= 0) return 0;
    this.ensure(slots, frame.particleCapacity);
    const want = this.want;
    want.fill(0, 0, slots);
    let any = false;
    for (let id = 0; id < slots; id++) {
      const layers = frame.paints[id]?.shadows;
      if (!layers || layers.length === 0) continue;
      const o = id * ELEMENT_STRIDE;
      if (!((ev[o + El.W] as number) > 0)) continue; // inactive (w == 0): no shadow (D88-4)
      if (!liquidAway(false, sv[id * STATE_STRIDE + St.REST_ALPHA] as number, ev[o + El.INTERACTION] as number)) continue;
      want[id] = 1;
      any = true;
    }
    if (!any) return 0;
    const b = this.bounds;
    const count = this.count;
    for (let id = 0; id < slots; id++) {
      count[id] = 0;
      b[4 * id] = Number.POSITIVE_INFINITY;
      b[4 * id + 1] = Number.POSITIVE_INFINITY;
      b[4 * id + 2] = Number.NEGATIVE_INFINITY;
      b[4 * id + 3] = Number.NEGATIVE_INFINITY;
    }
    const cap = frame.particleCapacity;
    const n = Math.max(0, Math.min(frame.activeParticles, cap));
    const dyn = frame.dynamicView;
    const st = frame.staticView;
    const casterOf = (i: number): number => {
      const h = st[Stat.HOME * cap + i] as number;
      if (!(h >= 0)) return -1;
      const id = h | 0;
      if (id >= slots || want[id] !== 1) return -1;
      if (((dyn[Dyn.FLAGS * cap + i] as number) & FLAG_PARKED) !== 0) return -1; // W81: parked
      const x = dyn[Dyn.X * cap + i] as number;
      const y = dyn[Dyn.Y * cap + i] as number;
      return Number.isFinite(x) && Number.isFinite(y) ? id : -1;
    };
    for (let i = 0; i < n; i++) {
      const id = casterOf(i);
      if (id < 0) continue;
      count[id] += 1;
      const x = dyn[Dyn.X * cap + i] as number;
      const y = dyn[Dyn.Y * cap + i] as number;
      if (x < b[4 * id]) b[4 * id] = x;
      if (y < b[4 * id + 1]) b[4 * id + 1] = y;
      if (x > b[4 * id + 2]) b[4 * id + 2] = x;
      if (y > b[4 * id + 3]) b[4 * id + 3] = y;
    }
    let at = 0;
    for (let id = 0; id < slots; id++) {
      this.start[id] = at;
      this.cursor[id] = at;
      at += count[id];
      if (want[id] === 1 && count[id] > 0) this.ids.push(id);
    }
    for (let i = 0; i < n; i++) {
      const id = casterOf(i);
      if (id < 0) continue;
      this.order[this.cursor[id]++] = i;
    }
    return this.ids.length;
  }
}

/** D88-6: the log-nearest bucket of `blur` (CSS px); 0 stays 0. */
export function nearestBucket(blur: number): number {
  if (!(blur > 0)) return 0;
  let best = SHADOW_BUCKETS_PX[0] ?? blur;
  for (const b of SHADOW_BUCKETS_PX) if (Math.abs(Math.log(b / blur)) < Math.abs(Math.log(best / blur))) best = b;
  return best;
}

/** The exact radius a group is keyed by: half-px steps, so float noise never splits a group. */
export function groupBlur(blur: number): number {
  return blur > 0 ? Math.round(blur * 2) / 2 : 0;
}

/** Share of the 2D kernel (1 − r²)² beyond a line at signed distance t (in kernel radii) from its centre. */
function kernelTail(t: number): number {
  if (t >= 1) return 0;
  if (t <= -1) return 1;
  // 1D marginal of the normalised kernel: (16 / 5π)(1 − u²)^{5/2}; Simpson over [t, 1].
  const steps = 128;
  const h = (1 - t) / steps;
  const p = (u: number): number => (16 / (5 * Math.PI)) * Math.pow(Math.max(0, 1 - u * u), 2.5);
  let s = p(t) + p(1);
  for (let k = 1; k < steps; k++) s += (k % 2 === 1 ? 4 : 2) * p(t + k * h);
  return (s * h) / 3;
}

export const SHADOW_SPREAD_CAP_PX = 128;

/**
 * Final review I1 (saga dec_ffc55d76): |spread| is capped at SHADOW_SPREAD_CAP_PX (CSS px), keeping
 * the sign. A CSS overlay idiom such as `0 0 0 9999px` would otherwise size Canvas2D's spread scratch
 * canvas and every WebGPU particle quad to the spread; in motion it draws smaller, and the browser
 * draws the full shadow at rest.
 */
export function clampSpread(spread: number): number {
  return Math.sign(spread) * Math.min(Math.abs(spread), SHADOW_SPREAD_CAP_PX);
}

const spreadCache = new Map<string, { readonly radius: number; readonly weightScale: number }>();

/**
 * D88-11: the widened, mass-scaled kernel of a spread layer (WebGPU). Radius R + |spread|; the
 * weight scale moves the 0.5 threshold `spread` px out of (or into) a straight edge of the particle
 * distribution: k · tail(spread / R') = 0.5. Spread 0 is the liquid's own kernel (scale 1).
 */
export function spreadKernel(kernelR: number, spread: number): { readonly radius: number; readonly weightScale: number } {
  if (spread === 0 || !Number.isFinite(spread)) return { radius: kernelR, weightScale: 1 };
  const key = `${kernelR}:${spread}`;
  const hit = spreadCache.get(key);
  if (hit) return hit;
  const radius = kernelR + Math.abs(spread);
  const tail = kernelTail(spread / radius);
  const out = { radius, weightScale: tail > 1e-6 ? 0.5 / tail : 0 };
  if (spreadCache.size > 256) spreadCache.clear();
  spreadCache.set(key, out);
  return out;
}

export interface ShadowSource {
  readonly id: number;
  readonly spread: number;
  /** Density layer and channel (4 channels per layer). */
  readonly layer: number;
  readonly channel: number;
  /** Kernel radius (CSS px) and the per-particle weight `mass · k / (π R² / 3)`. */
  readonly radius: number;
  readonly weight: number;
  /** The particle bounds grown by the kernel radius (CSS px): where the source's density can be > 0. */
  readonly rect: Rect;
}

export interface ShadowRecord {
  readonly source: number;
  readonly dx: number;
  readonly dy: number;
  /** Premultiplied colour, 0–1. */
  readonly color: readonly [number, number, number, number];
  /** `rect` of the source shifted by the offset (CSS px): where the resolved layer can be > 0. */
  readonly rect: Rect;
}

export interface ShadowGroup {
  /** CSS px; 0: no blur passes. */
  readonly blur: number;
  readonly scale: number;
  /** `records[first] … records[first + count − 1]`. */
  readonly first: number;
  readonly count: number;
  /** The records' rects grown by 3σ = 1.5 × blur (CSS px): where the group's result can be > 0. */
  readonly reach: Rect;
}

export interface ShadowPlan {
  readonly sources: readonly ShadowSource[];
  readonly records: readonly ShadowRecord[];
  readonly groups: readonly ShadowGroup[];
  /** Slots whose shadows the frame draws, ascending. */
  readonly drawn: readonly number[];
  readonly densityLayers: number;
}

export const EMPTY_PLAN: ShadowPlan = Object.freeze({ sources: [], records: [], groups: [], drawn: [], densityLayers: 0 });

const grow = (r: Rect, d: number): Rect => ({ x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d });

/**
 * D88-6, D88-11: sources, records and groups for the casters of `frame`. `texelCss` is one shadow
 * texel in CSS px (the splat's floor, as SPLAT_WGSL's T0 texel).
 */
export function planShadows(casters: ShadowCasters, frame: RenderFrame, texelCss: number): ShadowPlan {
  if (casters.ids.length === 0) return EMPTY_PLAN;
  const sources: ShadowSource[] = [];
  const drawn: number[] = [];
  const exact: number[] = [];
  const byGroup = new Map<number, Array<Omit<ShadowRecord, "rect"> & { rect: Rect }>>();
  const groupOrder: number[] = [];
  for (const id of casters.ids) {
    const paint = frame.paints[id];
    const layers = paint?.shadows;
    if (!paint || !layers || layers.length === 0) continue;
    const spreads = [0];
    for (const l of layers) {
      const sp = clampSpread(l.spread);
      if (sp !== 0 && !spreads.includes(sp)) spreads.push(sp);
    }
    if (sources.length + spreads.length > SHADOW_MAX_SOURCES) continue; // D88-11: no room this frame
    const base = Math.min(Math.max(kernelRadiusPx(paint.spacingPx), texelCss), KERNEL_RADIUS_CAP_PX);
    const mass = Number.isFinite(paint.areaPerParticle) && paint.areaPerParticle > 0 ? paint.areaPerParticle : 0;
    const b = casters.bounds;
    const bounds: Rect = { x0: b[4 * id] ?? 0, y0: b[4 * id + 1] ?? 0, x1: b[4 * id + 2] ?? 0, y1: b[4 * id + 3] ?? 0 };
    const sourceOf = new Map<number, number>();
    for (const spread of spreads) {
      const k = spreadKernel(base, spread);
      const s = sources.length;
      sourceOf.set(spread, s);
      sources.push({
        id,
        spread,
        layer: Math.floor(s / SHADOW_CHANNELS),
        channel: s % SHADOW_CHANNELS,
        radius: k.radius,
        weight: (mass * k.weightScale) / ((Math.PI * k.radius * k.radius) / 3),
        rect: grow(bounds, k.radius),
      });
    }
    drawn.push(id);
    // CSS paints the first layer on top: the last layer is recorded first, and OVER keeps that order within a
    // group. Across groups (and between the half- and quarter-resolution accumulators) the order is the
    // groups' creation order, so CSS layer order is kept only approximately when the layers' radii differ.
    for (let li = layers.length - 1; li >= 0; li--) {
      const l = layers[li];
      if (!l) continue;
      let key = groupBlur(l.blur);
      if (key > 0 && !exact.includes(key)) {
        if (exact.length < SHADOW_MAX_EXACT_GROUPS) exact.push(key);
        else key = nearestBucket(key);
      }
      let list = byGroup.get(key);
      if (!list) {
        list = [];
        byGroup.set(key, list);
        groupOrder.push(key);
      }
      const src = sourceOf.get(clampSpread(l.spread)) ?? 0;
      const a = Math.min(1, Math.max(0, l.color[3]));
      const srcRect = sources[src]?.rect ?? bounds;
      list.push({
        source: src,
        dx: l.dx,
        dy: l.dy,
        color: [((l.color[0] / 255) * a), ((l.color[1] / 255) * a), ((l.color[2] / 255) * a), a],
        rect: { x0: srcRect.x0 + l.dx, y0: srcRect.y0 + l.dy, x1: srcRect.x1 + l.dx, y1: srcRect.y1 + l.dy },
      });
    }
  }
  const records: ShadowRecord[] = [];
  const groups: ShadowGroup[] = [];
  for (const key of groupOrder) {
    const list = byGroup.get(key) ?? [];
    if (list.length === 0) continue;
    const first = records.length;
    let reach: Rect | null = null;
    for (const r of list) {
      records.push(r);
      const g = grow(r.rect, 1.5 * key);
      reach = reach === null ? g : { x0: Math.min(reach.x0, g.x0), y0: Math.min(reach.y0, g.y0), x1: Math.max(reach.x1, g.x1), y1: Math.max(reach.y1, g.y1) };
    }
    groups.push({
      blur: key,
      scale: key >= SHADOW_QUARTER_FROM_PX ? SHADOW_SCALE_QUARTER : SHADOW_SCALE_HALF,
      first,
      count: list.length,
      reach: reach ?? { x0: 0, y0: 0, x1: 0, y1: 0 },
    });
  }
  return { sources, records, groups, drawn, densityLayers: Math.ceil(sources.length / SHADOW_CHANNELS) };
}
