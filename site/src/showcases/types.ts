// Ward 059: Showcase contract. All showcase modules (squish, fusion, future)
// implement this factory shape so DemoEmbed can drive them uniformly.

import type { LiquidDOMInstance } from "liquiddom";
import type { RendererPreference } from "../lib/renderer-store";

export interface Showcase {
  /** Live instance. May be destroyed + re-created on renderer change. */
  instance: LiquidDOMInstance;
  /** Resolves to the chosen backend; matches `instance.activeRenderer`. */
  activeRenderer: "canvas2d" | "webgpu";
  /** Idempotent teardown. */
  destroy(): void;
}

export type ShowcaseFactory = (
  root: HTMLElement,
  renderer: RendererPreference,
) => Promise<Showcase>;
