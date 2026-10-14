/**
 * W82 (D82-1, D82-2): may the canvas sit under the page (`z-index: -1`)?
 *
 * Body mode: the canvas sits at `z-index: -1` in the root stacking context, so every page box and
 * its text paint above escaped liquid. Any ancestor box between an observed element and the root
 * with an opaque background would paint over the canvas too, and since `.liquid-element` makes the
 * element's own background transparent the element would vanish (W82.0 Q1b). `<html>`'s background
 * never counts (it paints the root canvas, below everything), and `<body>`'s counts only when
 * `<html>` has its own (otherwise it propagates to the root canvas).
 *
 * Container mode: the canvas sits at `z-index: -1` inside the container, which must be a stacking
 * context (`isolation: isolate`, a `z-index` on a positioned container, …); otherwise the canvas
 * escapes to an outer context, under the container's own background (W82.0 Q1d). Inside it the
 * same ancestor rule applies up to the container (its own background paints below the canvas).
 *
 * The first hit gives one `console.warn` and the instance falls back to `z-index: 0` with the D7
 * stacking rules for the rest of its life (one-way). Pure helpers over computed styles plus two
 * small DOM walks; called at `create()` and `observe()`, never per frame.
 */
import { ELEMENT_CLASS } from "./stylesheet";

/** D82-1: the one console.warn when a container is not a stacking context (the instance falls back to z-index 0). */
export const CONTAINER_STACKING_WARNING =
  "[liquiddom] the container is not a stacking context, so the liquid cannot go under its content; it is drawn at z-index 0 instead (over unobserved content). Give the container `isolation: isolate` (or a z-index).";
/** D82-2: prefix of the one console.warn when an opaque background would hide the liquid; the element and the fix follow. */
export const OPAQUE_BACKGROUND_WARNING = "[liquiddom] an opaque background would hide the liquid under the page:";

/** The computed-style properties `formsStackingContext` reads; a missing one (jsdom) counts as its initial value. */
export interface StackingStyle {
  position?: string;
  zIndex?: string;
  opacity?: string;
  transform?: string;
  translate?: string;
  rotate?: string;
  scale?: string;
  filter?: string;
  perspective?: string;
  clipPath?: string;
  maskImage?: string;
  backdropFilter?: string;
  isolation?: string;
  mixBlendMode?: string;
  willChange?: string;
  contain?: string;
  containerType?: string;
}

const val = (v: string | undefined): string => (typeof v === "string" ? v.trim().toLowerCase() : "");
/** `will-change` values that make a stacking context (they would at a non-initial value). */
const WILL_CHANGE_STACKING: ReadonlySet<string> = new Set([
  "transform", "translate", "rotate", "scale", "opacity", "filter", "perspective", "isolation",
  "mix-blend-mode", "clip-path", "mask", "mask-image", "backdrop-filter", "contain",
]);
const isNone = (v: string | undefined): boolean => {
  const s = val(v);
  return s === "" || s === "none";
};

/**
 * D82-1: true when an element with computed style `cs` (its parent's computed `display` in
 * `parentDisplay`) forms a stacking context (CSS 2.2 §9.9.1, Positioned Layout, Compositing):
 * fixed or sticky; absolute or relative with a `z-index`; a flex or grid item with a `z-index`;
 * opacity < 1; transform (or translate, rotate, scale), filter, perspective, clip-path, mask,
 * backdrop-filter; `isolation:
 * isolate`; a blend mode; `will-change` naming one of those; `contain` layout/paint/strict/content;
 * a size container.
 */
export function formsStackingContext(cs: StackingStyle, parentDisplay = ""): boolean {
  const position = val(cs.position);
  const z = val(cs.zIndex);
  const hasZ = z !== "" && z !== "auto";
  if (position === "fixed" || position === "sticky") return true;
  if (hasZ && (position === "absolute" || position === "relative")) return true;
  if (hasZ && /^(inline-)?(flex|grid)$/.test(val(parentDisplay))) return true;
  const opacity = Number.parseFloat(val(cs.opacity));
  if (Number.isFinite(opacity) && opacity < 1) return true;
  for (const v of [cs.transform, cs.translate, cs.rotate, cs.scale, cs.filter, cs.perspective, cs.clipPath, cs.maskImage, cs.backdropFilter]) if (!isNone(v)) return true;
  if (val(cs.isolation) === "isolate") return true;
  const blend = val(cs.mixBlendMode);
  if (blend !== "" && blend !== "normal") return true;
  if (val(cs.willChange).split(",").some((t) => WILL_CHANGE_STACKING.has(t.trim()))) return true;
  if (/\b(layout|paint|strict|content)\b/.test(val(cs.contain))) return true;
  return /^(size|inline-size)$/.test(val(cs.containerType));
}

/** A computed colour with alpha 0: "", "transparent", `rgba(…, 0)`, `rgb(… / 0)`, `oklch(… / 0%)`, … */
export function isTransparentColor(raw: string | undefined): boolean {
  const s = val(raw);
  if (s === "" || s === "transparent") return true;
  const m = /^[a-z-]+\((.*)\)$/.exec(s);
  if (!m) return false;
  const inner = m[1] ?? "";
  let alpha: string | undefined;
  if (inner.includes("/")) alpha = inner.slice(inner.lastIndexOf("/") + 1);
  else {
    const parts = inner.split(",");
    if (parts.length === 4) alpha = parts[3];
  }
  return alpha !== undefined && /^0*(\.0*)?%?$/.test(alpha.trim()) && /0/.test(alpha);
}

/** D82-2: a non-transparent `background-color` (any alpha > 0, any colour syntax) or a `background-image`. */
export function hasOwnBackground(cs: { backgroundColor?: string; backgroundImage?: string }): boolean {
  return !isTransparentColor(cs.backgroundColor) || !isNone(cs.backgroundImage);
}

function computed(el: Element): CSSStyleDeclaration | null {
  const view = el.ownerDocument.defaultView;
  return view ? view.getComputedStyle(el) : null;
}

/**
 * D82-2: the first box from `from` up to (not including) `stop` and `<html>` whose opaque
 * background would paint over a `z-index: -1` canvas, or null. `<body>` counts only when `<html>`
 * has its own background; an observed element (`.liquid-element`, its background is the liquid)
 * never counts.
 */
export function opaqueAncestor(from: Element | null, stop: Element | null): Element | null {
  const root = from?.ownerDocument.documentElement ?? null;
  for (let el = from; el !== null && el !== stop && el !== root; el = el.parentElement) {
    if (el.classList.contains(ELEMENT_CLASS)) continue;
    const cs = computed(el);
    if (cs === null || !hasOwnBackground(cs)) continue;
    if (el === el.ownerDocument.body) {
      const html = root ? computed(root) : null;
      if (html === null || !hasOwnBackground(html)) continue; // body's background propagates to the root
    }
    return el;
  }
  return null;
}

/** `<tag#id.class1.class2>` (liquiddom's own classes left out), for the D82-2 warning. */
export function describeElement(el: Element): string {
  const id = el.id ? `#${el.id}` : "";
  const classes = Array.from(el.classList)
    .filter((c) => !c.startsWith("liquid-"))
    .map((c) => `.${c}`)
    .join("");
  return `<${el.tagName.toLowerCase()}${id}${classes}>`;
}

/** D82-2: the warning for `el`, naming it and the fix. */
export function opaqueBackgroundWarning(el: Element): string {
  return `${OPAQUE_BACKGROUND_WARNING} ${describeElement(el)}. The liquid is drawn at z-index 0 instead (over unobserved page content). Make that background transparent, or give liquiddom a container with \`isolation: isolate\`.`;
}

/**
 * D82-1, D82-2 at `create()`: the warning when the canvas cannot sit under the page, else null.
 * Container mode: the container must be a stacking context. Body mode: the canvas's ancestor chain
 * (`<body>`, which counts only when `<html>` has its own background).
 */
export function canvasBlocker(container: HTMLElement | undefined, doc: Document = document): string | null {
  if (container) {
    const cs = computed(container);
    const parent = container.parentElement ? computed(container.parentElement) : null;
    return cs !== null && formsStackingContext(cs, parent?.display ?? "") ? null : CONTAINER_STACKING_WARNING;
  }
  const hit = opaqueAncestor(doc.body, null);
  return hit === null ? null : opaqueBackgroundWarning(hit);
}
