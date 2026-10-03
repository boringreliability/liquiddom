/**
 * FFI layout mirror of `src/fluid/layout.rs` (spec §2 "FFI contract", plan
 * resolution B14). MUST match the Rust constants: `fluid-layout.test.ts`
 * parses layout.rs, and `FluidBridge` checks the strides of the live core.
 */

/** Element buffer (TS writes): 10 floats per element. */
export const ELEMENT_STRIDE = 10;
/** Element state view (Rust writes every step): 4 floats per element. */
export const STATE_STRIDE = 4;
/** Dynamic particle view (Rust writes every tick): SoA, 7 fields. */
export const DYNAMIC_FIELDS = 7;
/** Static particle view (Rust writes at redistribution): SoA, 3 fields. */
export const STATIC_FIELDS = 3;

export const El = {
  X: 0,
  Y: 1,
  W: 2,
  H: 3,
  RADIUS: 4,
  INTERACTION: 5,
  HOME_DX: 6,
  HOME_DY: 7,
  VISCOSITY: 8,
  RECOVERY: 9,
} as const;

export const St = { S: 0, MAX_DEV: 1, REST_ALPHA: 2, RESERVED: 3 } as const;

export const Dyn = { X: 0, Y: 1, F00: 2, F01: 3, F10: 4, F11: 5, FLAGS: 6 } as const;

export const Stat = { HOME: 0, REST_U: 1, REST_V: 2 } as const;

export const Interaction = { IDLE: 0, HOVER: 1, FOCUSED: 2, DRAGGED: 3 } as const;

export const HOME_NONE = -1;
export const FLAG_TORN = 1;
/** Plan resolution B1: hover swell of the home rect around its centre. */
export const HOVER_SWELL = 0.02;

export interface HomeRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

const finiteOr0 = (v: number | undefined): number =>
  v !== undefined && Number.isFinite(v) ? v : 0;

/** Rounded-rect area with the radius clamped to `[0, min(w, h) / 2]` (same as Rust). */
export function roundedRectArea(w: number, h: number, r: number): number {
  if (!(Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0)) return 0;
  const rr = Number.isFinite(r) && r > 0 ? Math.min(r, w / 2, h / 2) : 0;
  return w * h - (4 - Math.PI) * rr * rr;
}

/**
 * B1: the rest contour geometry. DOM rect + `(home_dx, home_dy)`, swelled by
 * `HOVER_SWELL` around its centre while hovered and not under reduced
 * motion. Same rule as `Elements::home_rect` in Rust. `null` = inactive slot.
 */
export function homeRect(
  elementView: Float32Array,
  id: number,
  reducedMotion: boolean,
): HomeRect | null {
  const o = id * ELEMENT_STRIDE;
  if (!Number.isInteger(id) || id < 0 || o + ELEMENT_STRIDE > elementView.length) return null;
  const x = elementView[o + El.X];
  const y = elementView[o + El.Y];
  const w = elementView[o + El.W];
  const h = elementView[o + El.H];
  const active =
    Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0;
  if (!active) return null;
  const rawR = elementView[o + El.RADIUS];
  const r = Number.isFinite(rawR) && rawR > 0 ? Math.min(rawR, w / 2, h / 2) : 0;
  const out: HomeRect = {
    x: x + finiteOr0(elementView[o + El.HOME_DX]),
    y: y + finiteOr0(elementView[o + El.HOME_DY]),
    w,
    h,
    r,
  };
  const hovered = Math.abs(elementView[o + El.INTERACTION] - Interaction.HOVER) < 0.5;
  if (hovered && !reducedMotion) {
    const k = 1 + HOVER_SWELL;
    out.x -= (w * k - w) / 2;
    out.y -= (h * k - h) / 2;
    out.w = w * k;
    out.h = h * k;
    out.r = r * k;
  }
  return out;
}
