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

/**
 * `rgb()/rgba()` (comma or space syntax, % allowed) and `#rgb[a]`/`#rrggbb[aa]`.
 * Transparent, alpha 0 or unparseable → `null` (the caller falls back).
 */
export function parseCssColor(raw: string | null | undefined): RGBA | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (s === "" || s === "transparent") return null;
  let rgba: [number, number, number, number] | null = null;
  if (s.startsWith("#")) {
    rgba = parseHex(s.slice(1));
  } else {
    const m = /^rgba?\((.*)\)$/.exec(s);
    if (m) rgba = parseFunctional(m[1] ?? "");
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
  if (!el.classList.contains(className)) return snapshotColors(el);
  // Restore the exact attribute strings (class order, style text), not just the class.
  const prevClass = el.getAttribute("class");
  const prevStyle = el.getAttribute("style");
  el.style.setProperty("transition", "none", "important");
  el.classList.remove(className);
  try {
    return snapshotColors(el);
  } finally {
    if (prevClass === null) el.removeAttribute("class");
    else el.setAttribute("class", prevClass);
    // Flush style while `transition: none` still holds: the next style change
    // event then sees no background change, so restoring the author transition
    // starts nothing. Without this flush Chromium starts a red→transparent
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
