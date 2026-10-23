/** W86 (D86-6): the five docs pages, in reading order (the sidebar and /docs/ list them). */
export interface DocPage {
  readonly href: string;
  readonly title: string;
  readonly summary: string;
}

export const DOC_PAGES: readonly DocPage[] = [
  { href: "/docs/getting-started/", title: "Getting started", summary: "Install, five lines of vanilla, data-liquid and the one stacking rule." },
  { href: "/docs/api/", title: "API", summary: "Every create() option, every instance member, element options, presets, gravity and the errors." },
  { href: "/docs/adapters/", title: "React and Vue", summary: "LiquidProvider, LiquidPlugin, useLiquid, useLiquidError, <LiquidElement drag> and the onError pattern." },
  { href: "/docs/accessibility/", title: "Accessibility", summary: "The aria-hidden canvas, focus and Enter, reduced motion, print and forced colours." },
  { href: "/docs/limitations/", title: "Limitations", summary: "What the alpha does not do yet, and what to do about it." },
];
