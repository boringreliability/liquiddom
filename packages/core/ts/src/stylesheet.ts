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
 * W75 (D75-3): the sheet also holds one halo rule per observed element (`liquid-halo` + `data-liquid-id`), rewritten when an element is observed, re-coloured or unobserved; never per frame.
 */
import type { RGBA } from "./color";

export const STYLE_ELEMENT_ID = "liquiddom-styles";
export const ELEMENT_CLASS = "liquid-element";
export const TEXT_CLASS = "liquid-text";
export const CANVAS_CLASS = "liquid-canvas";
export const STACK_ATTR = "data-liquid-stack";
/** W75 (D75-3): the Canvas2D halo class, set by the runtime while an element moves under Canvas2D. */
export const HALO_CLASS = "liquid-halo";
/** W75 (D75-3): the document-unique key of an element's halo rule (`h<n>`); never the slot id (the sheet is shared). */
export const HALO_ID_ATTR = "data-liquid-id";
/** W75 (D75-3): blur radii of the halo's text-shadow layers, in px. */
export const HALO_BLUR_PX: readonly number[] = Object.freeze([1, 2, 4, 8]);
export type StackMode = "relative" | "z";

export const LIQUID_CSS = [
  "@layer liquiddom {",
  "  @media screen and (forced-colors: none) {",
  "    .liquid-element { background: transparent !important; border-color: transparent !important; box-shadow: none !important; }",
  `    .liquid-element[${STACK_ATTR}="relative"] { position: relative !important; z-index: 1 !important; }`,
  `    .liquid-element[${STACK_ATTR}="z"] { z-index: 1 !important; }`,
  "    .liquid-text, .liquid-text * { -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; text-shadow: none !important; }",
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
  rules.set(key, haloRule(key, background));
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

/** W75 (D75-2): rewrites a claimed element's rule after a colour re-snapshot; no-op otherwise. */
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

/** The liquid canvas element, not yet inserted: aria-hidden, no pointer events, z-index 0. */
function createLiquidCanvas(container?: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.className = CANVAS_CLASS;
  canvas.setAttribute("aria-hidden", "true");
  const s = canvas.style;
  s.pointerEvents = "none";
  s.zIndex = "0";
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

/** The liquid canvas: aria-hidden, no pointer events, z-index 0, last in body (or inside the container). */
export function mountLiquidCanvas(container?: HTMLElement): HTMLCanvasElement {
  const canvas = createLiquidCanvas(container);
  (container ?? document.body).appendChild(canvas);
  return canvas;
}

/**
 * W72 (D72-1, D72-3): a canvas that handed out a 'webgpu' context can never give a '2d' one,
 * so an 'auto' fallback and a device-lost rebuild replace it. The new canvas takes the old
 * one's place (same parent, same position, same markup as a fresh mount); a detached old
 * canvas is mounted like a new one. The backing-store size is the runtime's job (resize).
 */
export function remountLiquidCanvas(old: HTMLCanvasElement, container?: HTMLElement): HTMLCanvasElement {
  const fresh = createLiquidCanvas(container);
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
  readonly prevStack: string | null;
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
    prevStack: el.getAttribute(STACK_ATTR),
  };
  const view = el.ownerDocument.defaultView;
  const cs = view ? view.getComputedStyle(el) : null;
  const mode = cs ? stackingFor(cs.position, cs.zIndex) : "relative";
  el.classList.add(ELEMENT_CLASS);
  if (mode !== null) el.setAttribute(STACK_ATTR, mode);
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
  if (d.prevStack === null) el.removeAttribute(STACK_ATTR);
  else el.setAttribute(STACK_ATTR, d.prevStack);
}

/**
 * W74 (D74-6) / W75 (D75-3): the classes the runtime toggles per frame (`liquid-text`,
 * `liquid-halo`) are held per element across ALL instances, like decorations: the class stays
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

const textHolds = classHolds(TEXT_CLASS);
const haloHolds = classHolds(HALO_CLASS);

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
