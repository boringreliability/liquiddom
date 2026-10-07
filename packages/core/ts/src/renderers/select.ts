/**
 * Renderer selection. W66 (D66-2) introduced it; W71 (D71-2): 'webgpu' draws the liquid
 * (splat, composite, rest SDF overlay) and no longer warns; 'auto' still means Canvas2D without
 * probing until W72 (D72-1). Init errors propagate unchanged: WebGPUUnavailableError = no
 * WebGPU; anything else is a bug (spec §3) and rejects create().
 */
import type { Renderer } from "./frame";
import { FluidCanvas2DRenderer } from "./fluid-canvas2d";
import { WebGPURenderer } from "./webgpu/webgpu-renderer";

export type RendererChoice = "auto" | "webgpu" | "canvas2d";
export type ActiveRenderer = "canvas2d" | "webgpu";
export interface SelectedRenderer {
  readonly renderer: Renderer;
  readonly active: ActiveRenderer;
}

/** W71: the T0 scale only. W72 (README "Shared interfaces") adds silentFallback, remountCanvas and onDeviceLost. */
export interface SelectRendererOptions {
  /** D71-4 (@internal `webgpuT0Scale`). Undefined = T0_SCALE_DEFAULT. */
  readonly t0Scale?: number;
}

export async function selectRenderer(
  choice: RendererChoice,
  canvas: HTMLCanvasElement,
  opts: SelectRendererOptions = {},
): Promise<SelectedRenderer> {
  if (choice === "webgpu") {
    const gpu = new WebGPURenderer({ t0Scale: opts.t0Scale });
    try {
      await gpu.init(canvas);
    } catch (err) {
      gpu.destroy();
      throw err;
    }
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
