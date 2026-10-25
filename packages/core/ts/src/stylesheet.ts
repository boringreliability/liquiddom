/**
 * Injected stylesheet, stacking and canvas mount (spec §4, D7, D8; W66 D66-3, D66-15).
 * One <style id="liquiddom-styles"> per document, refcounted across instances.
 * All rules live in `@layer liquiddom` with !important so they beat author
 * rules (including :hover and inline styles). D66-15 (amended): the paint,
 * stacking and text rules are scoped to `@media screen and (forced-colors: none)`,
 * so print and forced colours simply never apply them and the author styles
 * show unchanged. No `revert-layer`: inside a layer, Chromium reverts it to
 * the UA default, not the author background. Print and forced colours hide
 * the canvas.
 * W74 (D74-6): the text rule hides the glyphs of the element and its descendants with -webkit-text-fill-color, so `color` (read by the atlas, used by currentColor icons) is untouched.
 * W78 (D78-1): `liquid-away` hides a dragged element's glyphs under Canvas2D with the same declarations; screen + forced-colors: none only.
 * W75 (D75-3): the sheet also holds one halo rule per observed element (`liquid-halo` + `data-liquid-id`), rewritten when an element is observed, re-coloured or unobserved; never per frame.
 * W82 (D82-1, D82-3): the canvas sits at z-index -1, under the page, and no element needs the D7 rules. An instance whose page or container cannot take that (stacking.ts) mounts its canvas at 0 and holds `data-liquid-stack` on its elements (holdStacking); the rules key on the attribute, so the sheet is the same for both.
 * W84 (D84-5): observed elements get `-webkit-touch-callout: none` (no iOS callout or link preview on a long-press), except those every observing instance opted out of drag (`data-liquid-drag="off"`, holdDragMode), which get `default` back (the property inherits).
 */
import type { RGBA } from "./color";

export const STYLE_ELEMENT_ID = "liquiddom-styles";
export const ELEMENT_CLASS = "liquid-element";
export const TEXT_CLASS = "liquid-text";
export const CANVAS_CLASS = "liquid-canvas";
export const STACK_ATTR = "data-liquid-stack";
/** W84 (D84-2, D84-5): "off" on an observed element while every instance that observes it opted out of drag; the callout rule skips it. */
export const DRAG_ATTR = "data-liquid-drag";
/** W75 (D75-3): the Canvas2D halo class, set by the runtime while an element moves under Canvas2D. */
export const HALO_CLASS = "liquid-halo";
/** W75 (D75-3): the document-unique key of an element's halo rule (`h<n>`); never the slot id (the sheet is shared). */
export const HALO_ID_ATTR = "data-liquid-id";
/** W75 (D75-3): blur radii of the halo's text-shadow layers, in px. */
export const HALO_BLUR_PX: readonly number[] = Object.freeze([1, 2, 4, 8]);
/** W78 (D78-1): the Canvas2D drag label class: the runtime hides a dragged element's DOM glyphs while its liquid is away. */
export const AWAY_CLASS = "liquid-away";
/** W88 (D88-1): while an element's liquid is away the runtime hides its own box-shadow. W88.1 stub: no rule yet. */
export const SHADOW_AWAY_CLASS = "liquid-shadow-away";

/** W88.1 stub (W88.2 refcounts it like the other toggle classes). */
export function addShadowAwayClass(_el: HTMLElement): void {}

/** W88.1 stub. */
export function removeShadowAwayClass(_el: HTMLElement): void {}

/** W88.1 stub (W88.2: the computed transition test). */
export function runsBoxShadowTransition(_el: HTMLElement): boolean {
  return false;
}

export type StackMode = "relative" | "z";
/** W82 (D82-1): the canvas under the page; every page box and its text paint above escaped liquid. */
export const CANVAS_Z_UNDER = "-1";
/** W82 (D82-1, D82-2): an instance whose page or container cannot take the canvas under it keeps W81's z-index 0, with the D7 rules. */
export const CANVAS_Z_FALLBACK = "0";
export type CanvasZ = typeof CANVAS_Z_UNDER | typeof CANVAS_Z_FALLBACK;

export const LIQUID_CSS = [
  "@layer liquiddom {",
  "  @media screen and (forced-colors: none) {",
  "    .liquid-element { background: transparent !important; border-color: transparent !important; box-shadow: none !important; }",
  `    .liquid-element[${STACK_ATTR}="relative"] { position: relative !important; z-index: 1 !important; }`,
  `    .liquid-element[${STACK_ATTR}="z"] { z-index: 1 !important; }`,
  "    .liquid-text, .liquid-text * { -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; text-shadow: none !important; }",
  // Ward-review M7: a halo held by a Canvas2D instance (`.liquid-halo[data-liquid-id="…"]`, 0,2,0)
  // must never draw around glyphs a WebGPU instance hides; this override (0,3,0) wins over it.
  `    .${TEXT_CLASS}.${HALO_CLASS}[${HALO_ID_ATTR}], .${TEXT_CLASS} .${HALO_CLASS}[${HALO_ID_ATTR}] { text-shadow: none !important; }`,
  // W78 (D78-1): the Canvas2D drag label, the liquid-text declarations under their own class (Canvas2D never sets liquid-text, D74-6).
  `    .${AWAY_CLASS}, .${AWAY_CLASS} * { -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; text-shadow: none !important; }`,
  // A halo held by another Canvas2D instance (0,2,0) never draws around glyphs liquid-away hides (M7's pattern).
  `    .${AWAY_CLASS}.${HALO_CLASS}[${HALO_ID_ATTR}], .${AWAY_CLASS} .${HALO_CLASS}[${HALO_ID_ATTR}] { text-shadow: none !important; }`,
  // W84 (D84-5): no long-press callout on a draggable observed element; `drag: false` keeps the browser's.
  `    .${ELEMENT_CLASS}:not([${DRAG_ATTR}="off"]) { -webkit-touch-callout: none !important; }`,
  // WebKit inherits the callout property, so an opted-out element nested in a draggable one restores the
  // browser's (without !important, so the author's own rule still wins; W84.2 review I1).
  `    .${ELEMENT_CLASS}[${DRAG_ATTR}="off"] { -webkit-touch-callout: default; }`,
  "  }",
  "  @media print, (forced-colors: active) {",
  "    canvas.liquid-canvas { display: none !important; }",
  "  }",
  "}",
].join("\n");

interface StyleEntry {
  count: number;
  readonly el: HTMLStyleElement;
}
const entries = new WeakMap<Document, StyleEntry>();

/** Adds a reference to the document's liquiddom stylesheet. Returns an idempotent release function. */
export function acquireLiquidStyles(doc: Document = document): () => void {
  let entry = entries.get(doc);
  if (!entry) {
    const el = doc.createElement("style");
    el.id = STYLE_ELEMENT_ID;
    el.textContent = composeSheet(doc);
    entry = { count: 0, el };
    entries.set(doc, entry);
  }
  if (!entry.el.isConnected) (doc.head ?? doc.documentElement).appendChild(entry.el);
  entry.count += 1;
  const held = entry;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.count -= 1;
    if (held.count <= 0) {
      held.el.remove();
      if (entries.get(doc) === held) entries.delete(doc);
    }
  };
}

/** W75 (D75-3): per document, the halo rule text by key, in claim order. */
const haloRules = new WeakMap<Document, Map<string, string>>();

/** `LIQUID_CSS` plus every halo rule of the document; exactly `LIQUID_CSS` when there is none. */
function composeSheet(doc: Document): string {
  const rules = haloRules.get(doc);
  if (!rules || rules.size === 0) return LIQUID_CSS;
  return [LIQUID_CSS, ...rules.values()].join("\n");
}

function rewriteSheet(doc: Document): void {
  const entry = entries.get(doc);
  if (entry) entry.el.textContent = composeSheet(doc);
}

/**
 * W75 (D75-3): one rule per element. Layered and `!important` like every liquiddom rule, and
 * scoped to `screen and (forced-colors: none)` (D66-15), so print and forced colours never see it.
 */
export function haloRule(key: string, background: RGBA): string {
  const [r, g, b, a] = background;
  const c = `rgba(${r}, ${g}, ${b}, ${a})`;
  const shadow = HALO_BLUR_PX.map((px) => `0 0 ${px}px ${c}`).join(", ");
  return [
    "@layer liquiddom {",
    "  @media screen and (forced-colors: none) {",
    `    .${HALO_CLASS}[${HALO_ID_ATTR}="${key}"] { text-shadow: ${shadow} !important; }`,
    "  }",
    "}",
  ].join("\n");
}

interface HaloClaim {
  count: number;
  readonly key: string;
  readonly prevAttr: string | null;
}
const haloClaims = new WeakMap<HTMLElement, HaloClaim>();
let nextHaloKey = 1;

function writeHaloRule(doc: Document, key: string, background: RGBA): void {
  let rules = haloRules.get(doc);
  if (!rules) {
    rules = new Map<string, string>();
    haloRules.set(doc, rules);
  }
  const rule = haloRule(key, background);
  // Amendment B (D75-2): an unchanged background rewrites nothing (a sheet write is a
  // document-wide style change).
  if (rules.get(key) === rule) return;
  rules.set(key, rule);
  rewriteSheet(doc);
}

/**
 * W75 (D75-3): claims the element's halo rule (refcounted across instances, like the
 * decoration). The first claim gives it a document-unique `data-liquid-id`; every claim writes
 * the rule in `background`.
 */
export function acquireHaloRule(el: HTMLElement, background: RGBA): void {
  const claim = haloClaims.get(el);
  if (claim) {
    claim.count += 1;
    writeHaloRule(el.ownerDocument, claim.key, background);
    return;
  }
  const key = `h${nextHaloKey++}`;
  haloClaims.set(el, { count: 1, key, prevAttr: el.getAttribute(HALO_ID_ATTR) });
  el.setAttribute(HALO_ID_ATTR, key);
  writeHaloRule(el.ownerDocument, key, background);
}

/** W75 (D75-2): rewrites a claimed element's rule after a colour re-snapshot; no-op otherwise, and no sheet write when the background is unchanged (amendment B). */
export function updateHaloRule(el: HTMLElement, background: RGBA): void {
  const claim = haloClaims.get(el);
  if (claim) writeHaloRule(el.ownerDocument, claim.key, background);
}

/** W75 (D75-3): releases one claim; the last one removes the rule and restores the attribute. */
export function releaseHaloRule(el: HTMLElement): void {
  const claim = haloClaims.get(el);
  if (!claim) return;
  claim.count -= 1;
  if (claim.count > 0) return;
  haloClaims.delete(el);
  const doc = el.ownerDocument;
  haloRules.get(doc)?.delete(claim.key);
  rewriteSheet(doc);
  if (claim.prevAttr === null) el.removeAttribute(HALO_ID_ATTR);
  else el.setAttribute(HALO_ID_ATTR, claim.prevAttr);
}

/** The liquid canvas element, not yet inserted: aria-hidden, no pointer events, at `zIndex` (W82: -1 under the page, 0 in the fallback). */
function createLiquidCanvas(container: HTMLElement | undefined, zIndex: CanvasZ): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.className = CANVAS_CLASS;
  canvas.setAttribute("aria-hidden", "true");
  const s = canvas.style;
  s.pointerEvents = "none";
  s.zIndex = zIndex;
  s.top = "0";
  s.left = "0";
  if (container) {
    s.position = "absolute";
    s.width = "100%";
    s.height = "100%";
  } else {
    s.position = "fixed";
    s.width = "100vw";
    s.height = "100vh";
  }
  return canvas;
}

/**
 * The liquid canvas: aria-hidden, no pointer events, last in body (or inside the container). W82
 * (D82-1): at z-index -1, under the page, or at 0 for an instance in the fallback (stacking.ts).
 */
export function mountLiquidCanvas(container?: HTMLElement, zIndex: CanvasZ = CANVAS_Z_UNDER): HTMLCanvasElement {
  const canvas = createLiquidCanvas(container, zIndex);
  (container ?? document.body).appendChild(canvas);
  return canvas;
}

/**
 * W72 (D72-1, D72-3): a canvas that handed out a 'webgpu' context can never give a '2d' one,
 * so an 'auto' fallback and a device-lost rebuild replace it. The new canvas takes the old
 * one's place (same parent, same position, same markup as a fresh mount); a detached old
 * canvas is mounted like a new one. The backing-store size is the runtime's job (resize). W82
 * (D82-1): the new canvas keeps the old one's z-index, so an instance in the fallback stays at 0.
 */
export function remountLiquidCanvas(old: HTMLCanvasElement, container?: HTMLElement): HTMLCanvasElement {
  const fresh = createLiquidCanvas(container, old.style.zIndex === CANVAS_Z_FALLBACK ? CANVAS_Z_FALLBACK : CANVAS_Z_UNDER);
  if (old.parentNode) old.replaceWith(fresh);
  else (container ?? document.body).appendChild(fresh);
  return fresh;
}

/** Spec §4: static → relative + z 1; positioned with z auto → z 1; explicit z → untouched. */
export function stackingFor(position: string, zIndex: string): StackMode | null {
  if (position === "" || position === "static") return "relative";
  if (zIndex === "" || zIndex === "auto") return "z";
  return null;
}

interface Decoration {
  readonly hadClassAttr: boolean;
  readonly hadClass: boolean;
}

/**
 * W66.5 fix 1: decorations are refcounted per element across ALL instances, so
 * an element observed by two instances stays decorated until the last one lets
 * go, and the recorded state is always the pre-liquid state (taken by the first
 * decorate only). Each caller must pair one decorate with one undecorate.
 */
const decorated = new WeakMap<HTMLElement, { count: number; decoration: Decoration }>();

/** Call AFTER the colour snapshot (the class makes the background transparent). */
export function decorateElement(el: HTMLElement): void {
  const entry = decorated.get(el);
  if (entry) {
    entry.count += 1;
    return;
  }
  const decoration: Decoration = {
    hadClassAttr: el.hasAttribute("class"),
    hadClass: el.classList.contains(ELEMENT_CLASS),
  };
  el.classList.add(ELEMENT_CLASS);
  decorated.set(el, { count: 1, decoration });
}

/** Releases one decorate; the last release restores exactly what the first decorate changed. */
export function undecorateElement(el: HTMLElement): void {
  const entry = decorated.get(el);
  if (!entry) return;
  entry.count -= 1;
  if (entry.count > 0) return;
  decorated.delete(el);
  const d = entry.decoration;
  if (!d.hadClass) el.classList.remove(ELEMENT_CLASS);
  if (!d.hadClassAttr && el.getAttribute("class") === "") el.removeAttribute("class");
}

/**
 * W74 (D74-6) / W75 (D75-3) / W78 (D78-1): the classes the runtime toggles per frame (`liquid-text`,
 * `liquid-halo`, `liquid-away`) are held per element across ALL instances, like decorations: the class stays
 * while any instance holds it, and the last release restores what the first hold found (an
 * author's own class is never removed). Each instance keeps its own `held` set (text-toggle.ts,
 * halo-toggle.ts), so one instance holds an element at most once.
 */
function classHolds(cls: string): { add(el: HTMLElement): void; remove(el: HTMLElement): void } {
  const holds = new WeakMap<HTMLElement, { count: number; readonly hadClass: boolean }>();
  return {
    add(el) {
      const hold = holds.get(el);
      if (hold) {
        hold.count += 1;
        return;
      }
      holds.set(el, { count: 1, hadClass: el.classList.contains(cls) });
      el.classList.add(cls);
    },
    remove(el) {
      const hold = holds.get(el);
      if (!hold) return; // an unbalanced release is a no-op
      hold.count -= 1;
      if (hold.count > 0) return;
      holds.delete(el);
      if (!hold.hadClass) el.classList.remove(cls);
    },
  };
}

interface StackHold {
  count: number;
  /** The attribute the first hold found (the author's own, or null). */
  readonly prev: string | null;
}
const stackHolds = new WeakMap<HTMLElement, StackHold>();

/**
 * W82 (D82-3): the D7 stacking (spec §4: static → relative + z 1; positioned with z auto → z 1; an
 * explicit z-index → untouched) for an element observed by an instance in the z-index 0 fallback.
 * Refcounted per element across instances like the decoration: the first hold reads the computed
 * position and z-index and writes `data-liquid-stack`; the last release restores what it found. An
 * instance under the page (z-index -1) never holds it.
 */
export function holdStacking(el: HTMLElement): void {
  const hold = stackHolds.get(el);
  if (hold) {
    hold.count += 1;
    return;
  }
  stackHolds.set(el, { count: 1, prev: el.getAttribute(STACK_ATTR) });
  const view = el.ownerDocument.defaultView;
  const cs = view ? view.getComputedStyle(el) : null;
  const mode = cs ? stackingFor(cs.position, cs.zIndex) : "relative";
  if (mode !== null) el.setAttribute(STACK_ATTR, mode);
}

/** W82 (D82-3): releases one hold; the last one restores the attribute; an unbalanced release is a no-op. */
export function releaseStacking(el: HTMLElement): void {
  const hold = stackHolds.get(el);
  if (!hold) return;
  hold.count -= 1;
  if (hold.count > 0) return;
  stackHolds.delete(el);
  if (hold.prev === null) el.removeAttribute(STACK_ATTR);
  else el.setAttribute(STACK_ATTR, hold.prev);
}

interface DragHold {
  draggable: number;
  optedOut: number;
  /** The attribute the first hold found (the author's own, or null). */
  readonly prev: string | null;
}
const dragHolds = new WeakMap<HTMLElement, DragHold>();

function writeDragMode(el: HTMLElement, hold: DragHold): void {
  if (hold.draggable === 0) el.setAttribute(DRAG_ATTR, "off");
  else if (hold.prev === null) el.removeAttribute(DRAG_ATTR);
  else el.setAttribute(DRAG_ATTR, hold.prev);
}

/**
 * W84 (D84-2, D84-5): one observing instance's drag mode for `el` (`drag: false` → not draggable),
 * refcounted per element across instances like the decoration. `data-liquid-drag="off"` (the
 * callout rule skips it) holds while every observing instance opted out; while any one drags the
 * element the first hold's attribute stands (none for an element without one), and the last release
 * restores it.
 */
export function holdDragMode(el: HTMLElement, draggable: boolean): void {
  let hold = dragHolds.get(el);
  if (!hold) {
    hold = { draggable: 0, optedOut: 0, prev: el.getAttribute(DRAG_ATTR) };
    dragHolds.set(el, hold);
  }
  if (draggable) hold.draggable += 1;
  else hold.optedOut += 1;
  writeDragMode(el, hold);
}

/** W84 (D84-2, D84-5): releases one hold; an unbalanced release is a no-op. */
export function releaseDragMode(el: HTMLElement, draggable: boolean): void {
  const hold = dragHolds.get(el);
  if (!hold) return;
  if (draggable) {
    if (hold.draggable === 0) return;
    hold.draggable -= 1;
  } else {
    if (hold.optedOut === 0) return;
    hold.optedOut -= 1;
  }
  if (hold.draggable + hold.optedOut > 0) {
    writeDragMode(el, hold);
    return;
  }
  dragHolds.delete(el);
  if (hold.prev === null) el.removeAttribute(DRAG_ATTR);
  else el.setAttribute(DRAG_ATTR, hold.prev);
}

const textHolds = classHolds(TEXT_CLASS);
const haloHolds = classHolds(HALO_CLASS);
const awayHolds = classHolds(AWAY_CLASS);

export function addTextClass(el: HTMLElement): void {
  textHolds.add(el);
}

/** Releases one add; an unbalanced release is a no-op. */
export function removeTextClass(el: HTMLElement): void {
  textHolds.remove(el);
}

export function addHaloClass(el: HTMLElement): void {
  haloHolds.add(el);
}

/** Releases one add; an unbalanced release is a no-op. */
export function removeHaloClass(el: HTMLElement): void {
  haloHolds.remove(el);
}

export function addAwayClass(el: HTMLElement): void {
  awayHolds.add(el);
}

/** Releases one add; an unbalanced release is a no-op. */
export function removeAwayClass(el: HTMLElement): void {
  awayHolds.remove(el);
}
