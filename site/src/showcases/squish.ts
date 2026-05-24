// Ward 059: Squish showcase.
//
// Observes 3 buttons inside `root`. Hover causes the soft-body to squish
// toward the cursor; click fires `impulse()` for a shake. Works on both
// renderers — the toggle effect is subtle (smoother SDF AA on WebGPU).

import { LiquidDOM } from "liquiddom";
import type { RendererPreference } from "../lib/renderer-store";
import type { Showcase } from "./types";

export const createSquishShowcase = async (
  root: HTMLElement,
  renderer: RendererPreference,
): Promise<Showcase> => {
  /* @snippet:start */
  const liquid = await LiquidDOM.create({
    capacity: 8,
    autoObserve: true,
    container: root,
    renderer,
    // Note: rgba() is the safe format for both Canvas2D and WebGPU renderers.
    // oklch() works on Canvas2D but the WebGPU shader's color parser only
    // accepts rgb()/rgba() — using oklch makes the WebGPU blob invisible.
    colorDefault: "rgba(45, 100, 200, 0.75)",
    colorHover: "rgba(233, 100, 90, 0.85)",
  });

  for (const btn of root.querySelectorAll<HTMLButtonElement>("button[data-liquid]")) {
    btn.addEventListener("click", () => liquid.impulse(btn, {
      magnitude: 150,           // px/s — visible "pop" without being chaotic
      direction: [0, -1],       // shake upward
      duration: 400,
    }));
  }
  /* @snippet:end */

  return {
    instance: liquid,
    activeRenderer: liquid.activeRenderer,
    destroy: () => liquid.destroy(),
  };
};
