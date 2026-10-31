/**
 * W88 (Epic 16, D88-1 … D88-3): the author's `box-shadow`, read for the renderers. The browser
 * draws it at rest; while the element's liquid is away the runtime hides it (`liquid-shadow-away`,
 * shadow-toggle.ts) and the renderer draws the outer layers from the liquid's shape.
 *
 * `parseBoxShadow` reads a computed value: browsers serialise every layer as
 * `<color> <dx>px <dy>px <blur>px <spread>px [inset]` (`none` without a shadow; jsdom returns the
 * specified text, so the parser takes the parts in any order and a unitless 0). Colours go through
 * `parseCssColor` and the W86 colour probe, so oklch works; `currentColor` and CSS variables arrive
 * resolved as `rgb(...)` (Review Focus 5). A layer that does not parse, or whose colour is
 * transparent, is dropped. Pure apart from `snapshotShadow`, which reads the computed style.
 */
import { parseCssColor, withClassLifted, type RGBA } from "./color";
import { Interaction } from "./fluid-layout";
import { SHADOW_AWAY_CLASS } from "./stylesheet";

/** One `box-shadow` layer in CSS px (D88-3). */
export interface ShadowLayer {
  readonly color: RGBA;
  readonly dx: number;
  readonly dy: number;
  /** ≥ 0. */
  readonly blur: number;
  /** May be negative. */
  readonly spread: number;
  readonly inset: boolean;
}

/** D88-2: the renderer draws at most this many outer layers per element (the first ones in CSS order). */
export const MAX_SHADOW_LAYERS = 4;

const NONE: readonly ShadowLayer[] = Object.freeze([]);

/** Top-level commas only (a colour function holds commas of its own). */
function splitTopLevel(s: string, sep: (c: string) => boolean): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] ?? "";
    if (c === "(") depth += 1;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && sep(c)) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((t) => t.trim()).filter((t) => t.length > 0);
}

const LENGTH = /^(-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?)(px)?$/i;

function parseLayer(text: string): ShadowLayer | null {
  const tokens = splitTopLevel(text, (c) => c === " " || c === "\t" || c === "\n");
  const lengths: number[] = [];
  const colour: string[] = [];
  let inset = false;
  for (const t of tokens) {
    if (t.toLowerCase() === "inset") {
      if (inset) return null;
      inset = true;
      continue;
    }
    const m = LENGTH.exec(t);
    if (m) {
      const v = Number(m[1]);
      // Only px (or a bare 0) is a computed length; a bare non-zero number is invalid CSS.
      if (!Number.isFinite(v) || (m[2] === undefined && v !== 0)) return null;
      lengths.push(v);
      continue;
    }
    colour.push(t);
  }
  if (lengths.length < 2 || lengths.length > 4 || colour.length !== 1) return null;
  const [dx = 0, dy = 0, blur = 0, spread = 0] = lengths;
  if (blur < 0) return null;
  const color = parseCssColor(colour[0]);
  if (color === null) return null; // transparent or unreadable: nothing to draw
  return Object.freeze({ color, dx, dy, blur, spread, inset });
}

/** D88-3: every layer of a computed `box-shadow`, in CSS order (the first paints on top); `none`, empty or garbage → none. */
export function parseBoxShadow(computed: string | null | undefined): readonly ShadowLayer[] {
  if (typeof computed !== "string") return NONE;
  const s = computed.trim();
  if (s === "" || s.toLowerCase() === "none") return NONE;
  const layers: ShadowLayer[] = [];
  for (const part of splitTopLevel(s, (c) => c === ",")) {
    const layer = parseLayer(part);
    if (layer) layers.push(layer);
  }
  return layers.length === 0 ? NONE : Object.freeze(layers);
}

const outerCache = new WeakMap<readonly ShadowLayer[], readonly ShadowLayer[]>();

/** D88-2: the layers the renderer draws: outer only, the first MAX_SHADOW_LAYERS in CSS order. Memoised per array. */
export function outerShadows(layers: readonly ShadowLayer[]): readonly ShadowLayer[] {
  if (layers.length === 0) return NONE;
  const hit = outerCache.get(layers);
  if (hit) return hit;
  const outer = layers.filter((l) => !l.inset).slice(0, MAX_SHADOW_LAYERS);
  const frozen = outer.length === 0 ? NONE : Object.freeze(outer);
  outerCache.set(layers, frozen);
  return frozen;
}

/** True when any layer is an outer one (the renderer has something to draw). */
export function hasOuterLayer(layers: readonly ShadowLayer[]): boolean {
  for (const l of layers) if (!l.inset) return true;
  return false;
}

/**
 * D88-3: the element's computed `box-shadow`, parsed. While another instance (or this one) holds
 * `liquid-shadow-away` on it, the class is lifted for the read (inline `transition: none` meanwhile,
 * both attributes restored to their exact strings: W66's colour-snapshot lift), so the author's
 * shadow is read, never `none`.
 */
export function snapshotShadow(el: HTMLElement): readonly ShadowLayer[] {
  return withClassLifted(el, SHADOW_AWAY_CLASS, () => parseBoxShadow(getComputedStyle(el).boxShadow));
}

/**
 * D88-1: an element's liquid is away while its restAlpha < 1 or it is dragged, never under reduced
 * motion. NaN counts as rest (W74's rule). Shared by the toggle and both renderers, so the class and
 * the drawn shadow always agree.
 */
export function liquidAway(reducedMotion: boolean, restAlpha: number, interaction: number): boolean {
  if (reducedMotion) return false;
  return restAlpha < 1 || Math.abs(interaction - Interaction.DRAGGED) < 0.5;
}
