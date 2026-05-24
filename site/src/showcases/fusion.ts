// Ward 059: Fusion showcase.
//
// Observes 5 colored blobs in a tight cluster. WebGPU renders them as a merged
// metaball via `theme.fusionRadius`; Canvas2D shows 5 distinct shapes (the
// fusion shader is WebGPU-only — Canvas2D ignores the option). This is the
// renderer toggle's killer demo — visible behavior diff confirms the
// WebGPU value proposition.

import { LiquidDOM } from "liquiddom";
import type { RendererPreference } from "../lib/renderer-store";
import type { Showcase } from "./types";

export const createFusionShowcase = async (
  root: HTMLElement,
  renderer: RendererPreference,
): Promise<Showcase> => {
  /* @snippet:start */
  const liquid = await LiquidDOM.create({
    capacity: 8,
    autoObserve: true,
    container: root,
    renderer,
    // rgba() is the safe format for both Canvas2D and WebGPU renderers.
    // (WebGPU shader does not parse oklch.)
    colorDefault: "rgba(140, 95, 220, 0.85)",
    theme: { fusionRadius: 60 },  // WebGPU only — Canvas2D ignores
  });
  /* @snippet:end */

  return {
    instance: liquid,
    activeRenderer: liquid.activeRenderer,
    destroy: () => liquid.destroy(),
  };
};
