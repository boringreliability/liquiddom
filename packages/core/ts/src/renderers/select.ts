/**
 * Renderer selection (W66 D66-2; W72 D72-1, D72-2).
 * - 'canvas2d': the Canvas2D fluid renderer; WebGPU is never probed.
 * - 'auto' (the option default): WebGPU on a hardware adapter. WebGPUUnavailableError —
 *   including a fallback (software) adapter and a device lost during init — falls back to
 *   Canvas2D on a remounted canvas (a canvas that handed out a 'webgpu' context never gives
 *   a '2d' one), with one console.info unless silentFallback.
 * - 'webgpu': WebGPU, a fallback adapter accepted (SwiftShader in CI); unavailable rejects.
 * Any other init error is a bug (spec §3) and rejects create() for both.
 */
import type { Renderer } from "./frame";
import { FluidCanvas2DRenderer } from "./fluid-canvas2d";
import { WebGPUUnavailableError } from "./webgpu/errors";
import { WebGPURenderer } from "./webgpu/webgpu-renderer";

export type RendererChoice = "auto" | "webgpu" | "canvas2d";
export type ActiveRenderer = "canvas2d" | "webgpu";

export interface SelectRendererOptions {
  /** D72-1: hides the fallback console.info. */
  readonly silentFallback: boolean;
  /** Replaces the runtime's canvas in place and returns the new one (used only on an 'auto' fallback). */
  readonly remountCanvas: () => HTMLCanvasElement;
  /** D72-3: a WebGPU device lost after init (never for reason 'destroyed'). */
  readonly onDeviceLost: (info: GPUDeviceLostInfo) => void;
  /** D71-4: T0 render scale for the WebGPU renderer. */
  readonly t0Scale?: number;
}

export interface SelectedRenderer {
  readonly renderer: Renderer;
  readonly active: ActiveRenderer;
  /** The canvas the renderer draws on: the input canvas, or the remounted one after a fallback. */
  readonly canvas: HTMLCanvasElement;
}

export const FALLBACK_INFO_PREFIX = "[liquiddom] WebGPU is not available";

/** D72-1: the one console.info of an 'auto' fallback. */
export function fallbackInfo(reason: string): string {
  return `${FALLBACK_INFO_PREFIX} (${reason}); using the Canvas2D renderer. Pass silentFallback: true to hide this message.`;
}

/** Initialises Canvas2D on `canvas`; destroys it again when init fails (D64-5: no silent mode). */
export async function initCanvas2D(canvas: HTMLCanvasElement): Promise<FluidCanvas2DRenderer> {
  const c2d = new FluidCanvas2DRenderer();
  try {
    await c2d.init(canvas);
  } catch (err) {
    c2d.destroy();
    throw err;
  }
  return c2d;
}

export async function selectRenderer(
  choice: RendererChoice,
  canvas: HTMLCanvasElement,
  opts: SelectRendererOptions,
): Promise<SelectedRenderer> {
  if (choice === "canvas2d") {
    return { renderer: await initCanvas2D(canvas), active: "canvas2d", canvas };
  }
  const gpu = new WebGPURenderer({
    acceptFallbackAdapter: choice === "webgpu",
    onDeviceLost: opts.onDeviceLost,
    ...(opts.t0Scale === undefined ? {} : { t0Scale: opts.t0Scale }),
  });
  try {
    await gpu.init(canvas);
    return { renderer: gpu, active: "webgpu", canvas };
  } catch (err) {
    gpu.destroy();
    if (choice === "webgpu" || !(err instanceof WebGPUUnavailableError)) throw err;
    const fresh = opts.remountCanvas();
    const c2d = await initCanvas2D(fresh);
    if (!opts.silentFallback) console.info(fallbackInfo(err.message));
    return { renderer: c2d, active: "canvas2d", canvas: fresh };
  }
}
