/** CSS colour parsing for the liquid fill (spec §3 "Colour"). */
export type RGBA = readonly [r: number, g: number, b: number, a: number];

/** Used when an element's background is transparent (the soft-body default, opaque). */
export const DEFAULT_LIQUID_COLOR: RGBA = Object.freeze([83, 52, 131, 1] as const);
export const DEFAULT_TEXT_COLOR: RGBA = Object.freeze([0, 0, 0, 1] as const);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function parseChannel(token: string): number | null {
  if (token.endsWith("%")) {
    const v = Number(token.slice(0, -1));
    return token.length > 1 && Number.isFinite(v) ? clamp(Math.round(v * 2.55), 0, 255) : null;
  }
  const v = Number(token);
  return token !== "" && Number.isFinite(v) ? clamp(Math.round(v), 0, 255) : null;
}

function parseAlpha(token: string): number | null {
  if (token.endsWith("%")) {
    const v = Number(token.slice(0, -1));
    return token.length > 1 && Number.isFinite(v) ? clamp(v / 100, 0, 1) : null;
  }
  const v = Number(token);
  return token !== "" && Number.isFinite(v) ? clamp(v, 0, 1) : null;
}

function parseFunctional(args: string): [number, number, number, number] | null {
  let channels: string[];
  let alpha: string | undefined;
  if (args.includes(",")) {
    const parts = args.split(",").map((t) => t.trim());
    if (parts.length !== 3 && parts.length !== 4) return null;
    channels = parts.slice(0, 3);
    alpha = parts[3];
  } else {
    const [rgb = "", a, extra] = args.split("/").map((t) => t.trim());
    if (extra !== undefined) return null;
    channels = rgb.split(/\s+/).filter((t) => t.length > 0);
    alpha = a;
  }
  if (channels.length !== 3) return null;
  const r = parseChannel(channels[0]);
  const g = parseChannel(channels[1]);
  const b = parseChannel(channels[2]);
  const a = alpha === undefined ? 1 : parseAlpha(alpha);
  if (r === null || g === null || b === null || a === null) return null;
  return [r, g, b, a];
}

function parseHex(hex: string): [number, number, number, number] | null {
  if (!/^[0-9a-f]+$/.test(hex)) return null;
  const full = hex.length === 3 || hex.length === 4 ? [...hex].map((c) => c + c).join("") : hex;
  if (full.length !== 6 && full.length !== 8) return null;
  const byte = (i: number): number => parseInt(full.slice(i, i + 2), 16);
  return [byte(0), byte(2), byte(4), full.length === 8 ? byte(6) / 255 : 1];
}

/** @internal W86 (D86-9): turns a CSS colour string the parser does not read into RGBA, or null. */
export type ColorProbe = (raw: string) => RGBA | null;

const PROBE_CACHE_MAX = 256;
const probeCache = new Map<string, RGBA | null>();

/** @internal W86 (D86-9): a colour the parser does not read, painted into a 1 × 1 canvas and read back as sRGB. */
export const canvasColorProbe: ColorProbe = (raw) => {
  try {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!ctx || typeof ctx.getImageData !== "function") return null;
    // A string the canvas rejects leaves fillStyle unchanged; test against two sentinels.
    ctx.fillStyle = "#000000";
    ctx.fillStyle = raw;
    const a = ctx.fillStyle;
    ctx.fillStyle = "#ffffff";
    ctx.fillStyle = raw;
    if (a === "#000000" && ctx.fillStyle === "#ffffff") return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  } catch {
    return null;
  }
};

let probe: ColorProbe = canvasColorProbe;

/** @internal Test seam: replace the probe (null restores the default) and clear the cache. */
export function setColorProbe(next: ColorProbe | null): void {
  probe = next ?? canvasColorProbe;
  probeCache.clear();
}

function probed(raw: string): RGBA | null {
  if (probeCache.has(raw)) return probeCache.get(raw) ?? null;
  const v = typeof document === "undefined" ? null : probe(raw);
  if (probeCache.size >= PROBE_CACHE_MAX) probeCache.clear();
  probeCache.set(raw, v);
  return v;
}

/**
 * `rgb()/rgba()` (comma or space syntax, % allowed) and `#rgb[a]`/`#rrggbb[aa]`.
 * Any other colour the browser paints (oklch, lab, color(), named) goes through
 * the colour probe (W86, D86-9), cached per string.
 * Transparent, alpha 0 or unparseable → `null` (the caller falls back).
 */
export function parseCssColor(raw: string | null | undefined): RGBA | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (s === "" || s === "transparent") return null;
  let rgba: RGBA | null = null;
  if (s.startsWith("#")) {
    rgba = parseHex(s.slice(1));
  } else {
    const m = /^rgba?\((.*)\)$/.exec(s);
    if (m) rgba = parseFunctional(m[1] ?? "");
    else rgba = probed(s);
  }
  if (rgba === null || !(rgba[3] > 0)) return null;
  return Object.freeze(rgba);
}

/**
 * Reads the computed `background-color` and `color`. W64 calls it in
 * `observe()`; W66 makes sure it runs BEFORE `liquid-element` is applied.
 */
export function snapshotColors(el: HTMLElement): { background: RGBA; text: RGBA } {
  const cs = getComputedStyle(el);
  return {
    background: parseCssColor(cs.backgroundColor) ?? DEFAULT_LIQUID_COLOR,
    text: parseCssColor(cs.color) ?? DEFAULT_TEXT_COLOR,
  };
}

/**
 * W66 (spec §3 "Colour"): re-read colours of an element that carries the
 * liquid class by lifting the class for the duration of the read.
 *
 * Ward-fix I1: an author `transition: background-color …` would make the
 * same-task read return the transition's start value (transparent, so the
 * default purple). While the class is lifted the element also carries inline
 * `transition: none !important`. Both attributes are then restored to their
 * exact original strings (class first, then style; an absent style attribute
 * is removed), so no inline style persists (D66-3).
 */
export function snapshotColorsWithout(el: HTMLElement, className: string): { background: RGBA; text: RGBA } {
  return withClassLifted(el, className, () => snapshotColors(el));
}

/**
 * W88 (D88-3): the lift of `snapshotColorsWithout`, for any read: `read()` runs with `className`
 * removed and inline `transition: none !important`, then both attributes are restored to their exact
 * strings (the same flush rules). Without the class on `el`, `read()` runs as is.
 */
export function withClassLifted<T>(el: HTMLElement, className: string, read: () => T): T {
  if (!el.classList.contains(className)) return read();
  // Restore the exact attribute strings (class order, style text), not just the class.
  const prevClass = el.getAttribute("class");
  return withTransitionsOff(el, () => {
    el.classList.remove(className);
    try {
      return read();
    } finally {
      if (prevClass === null) el.removeAttribute("class");
      else el.setAttribute("class", prevClass);
    }
  });
}

/**
 * W88 (resolution 12): runs `change()` with inline `transition: none !important` on `el`, flushes the
 * style while it holds (so the change starts no CSS transition), then restores the style attribute's
 * exact string (an absent one is removed). W66's lift; `withClassLifted` and the shadow toggle use it.
 */
export function withTransitionsOff<T>(el: HTMLElement, change: () => T): T {
  const prevStyle = el.getAttribute("style");
  el.style.setProperty("transition", "none", "important");
  try {
    return change();
  } finally {
    // Flush style while `transition: none` still holds: the next style change
    // event then sees no change, so restoring the author transition starts
    // nothing. Without this flush Chromium starts a red→transparent
    // transition on the restored element (verified by e2e/colour-refresh.spec.ts).
    try {
      void getComputedStyle(el).backgroundColor;
    } finally {
      // Chromium serialises a CSSOM-mutated style attribute lazily; without first
      // syncing it (the getAttribute read), removeAttribute is later undone as style="".
      el.getAttribute("style");
      if (prevStyle === null) el.removeAttribute("style");
      else el.setAttribute("style", prevStyle);
    }
  }
}
