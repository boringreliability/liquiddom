/**
 * Renderer selection (W66, D66-2). Slices 1–2 have no WebGPU fluid passes, so
 * 'auto' means Canvas2D and never probes WebGPU. 'webgpu' initialises the
 * infra-only renderer (clears the canvas) and warns once per instance. Init
 * errors propagate unchanged: WebGPUUnavailableError = no WebGPU; anything
 * else is a bug (spec §3) and rejects create().
 */
import type { Renderer } from "./frame";
import { FluidCanvas2DRenderer } from "./fluid-canvas2d";
import { WEBGPU_INFRA_ONLY_WARNING, WebGPURenderer } from "./webgpu-renderer";

export type RendererChoice = "auto" | "webgpu" | "canvas2d";
export type ActiveRenderer = "canvas2d" | "webgpu";
export interface SelectedRenderer {
  readonly renderer: Renderer;
  readonly active: ActiveRenderer;
}

export async function selectRenderer(choice: RendererChoice, canvas: HTMLCanvasElement): Promise<SelectedRenderer> {
  if (choice === "webgpu") {
    const gpu = new WebGPURenderer();
    try {
      await gpu.init(canvas);
    } catch (err) {
      gpu.destroy();
      throw err;
    }
    console.warn(WEBGPU_INFRA_ONLY_WARNING);
    return { renderer: gpu, active: "webgpu" };
  }
  const c2d = new FluidCanvas2DRenderer();
  try {
    await c2d.init(canvas);
  } catch (err) {
    c2d.destroy();
    throw err;
  }
  return { renderer: c2d, active: "canvas2d" };
}
