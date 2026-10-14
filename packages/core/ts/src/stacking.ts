/**
 * W82 (D82-1, D82-2): may the canvas sit under the page (`z-index: -1`)? W82.1 red stub: the
 * constants are final; every helper answers "nothing blocks" until W82.3.
 */

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

export function formsStackingContext(cs: StackingStyle, parentDisplay = ""): boolean {
  void cs;
  void parentDisplay;
  return true;
}

export function isTransparentColor(raw: string | undefined): boolean {
  void raw;
  return true;
}

export function hasOwnBackground(cs: { backgroundColor?: string; backgroundImage?: string }): boolean {
  void cs;
  return false;
}

export function opaqueAncestor(from: Element | null, stop: Element | null): Element | null {
  void from;
  void stop;
  return null;
}

export function describeElement(el: Element): string {
  void el;
  return "";
}

export function opaqueBackgroundWarning(el: Element): string {
  void el;
  return OPAQUE_BACKGROUND_WARNING;
}

export function canvasBlocker(container: HTMLElement | undefined, doc: Document = document): string | null {
  void container;
  void doc;
  return null;
}
