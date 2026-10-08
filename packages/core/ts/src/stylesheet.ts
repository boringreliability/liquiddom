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
 */
export const STYLE_ELEMENT_ID = "liquiddom-styles";
export const ELEMENT_CLASS = "liquid-element";
export const TEXT_CLASS = "liquid-text";
export const CANVAS_CLASS = "liquid-canvas";
export const STACK_ATTR = "data-liquid-stack";
export type StackMode = "relative" | "z";

export const LIQUID_CSS = [
  "@layer liquiddom {",
  "  @media screen and (forced-colors: none) {",
  "    .liquid-element { background: transparent !important; border-color: transparent !important; box-shadow: none !important; }",
  `    .liquid-element[${STACK_ATTR}="relative"] { position: relative !important; z-index: 1 !important; }`,
  `    .liquid-element[${STACK_ATTR}="z"] { z-index: 1 !important; }`,
  "    .liquid-text { color: transparent !important; }",
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
    el.textContent = LIQUID_CSS;
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
