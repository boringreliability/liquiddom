/**
 * W51 Test #9 fixture — verifies the published-shape type graph of all three
 * packages resolves end-to-end via the workspace symlink. Each symbol is
 * referenced once so `tsc` cannot tree-shake the import away before checking.
 */
import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
import { LiquidProvider } from "@liquiddom/react";
import { LiquidElement as VueLiquidElement } from "@liquiddom/vue";

export const _smoke: {
  LiquidDOM: typeof LiquidDOM;
  Instance: LiquidDOMInstance | null;
  LiquidProvider: typeof LiquidProvider;
  VueLiquidElement: typeof VueLiquidElement;
} = {
  LiquidDOM,
  Instance: null,
  LiquidProvider,
  VueLiquidElement,
};
