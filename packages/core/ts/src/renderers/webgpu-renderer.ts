/**
 * WebGPU renderer, infrastructure only (W66, D66-2). Adapter/device/context,
 * configure(alphaMode 'premultiplied'), one clear pass per frame, resize,
 * destroy, device.lost. The splat/composite passes arrive in slice 3, which
 * also adds isFallbackAdapter handling and the Canvas2D rebuild on device.lost.
 */
import type { RenderFrame, Renderer } from "./frame";

export class WebGPUUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WebGPUUnavailableError";
  }
}

export const WEBGPU_INFRA_ONLY_WARNING =
  "[liquiddom] renderer 'webgpu' is infrastructure-only until slice 3: the canvas is cleared every frame and no liquid is drawn. Use renderer 'auto' or 'canvas2d' to see the liquid.";

export class WebGPURenderer implements Renderer {
  private device: GPUDevice | null = null;
  private ctx: GPUCanvasContext | null = null;
  private lost = false;
  private warnedLost = false;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (typeof navigator === "undefined" || !navigator.gpu) {
      throw new WebGPUUnavailableError("navigator.gpu is undefined");
    }
    let adapter: GPUAdapter | null;
    try {
      adapter = await navigator.gpu.requestAdapter();
    } catch (cause) {
      throw new WebGPUUnavailableError("requestAdapter threw", { cause });
    }
    if (!adapter) throw new WebGPUUnavailableError("requestAdapter returned null");
    let device: GPUDevice;
    try {
      device = await adapter.requestDevice();
    } catch (cause) {
      throw new WebGPUUnavailableError("requestDevice rejected", { cause });
    }
    try {
      const ctx = canvas.getContext("webgpu");
      if (!ctx) throw new WebGPUUnavailableError("canvas.getContext('webgpu') returned null");
      ctx.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: "premultiplied" });
      this.device = device;
      this.ctx = ctx;
      this.lost = false;
      const owned = device;
      void device.lost.then((info) => {
        if (this.device !== owned) return; // destroyed locally
        this.lost = true;
        if (!this.warnedLost) {
          this.warnedLost = true;
          console.warn(`[liquiddom] WebGPU device lost (${info.message}); the canvas stays empty until slice 3 adds the Canvas2D rebuild.`);
        }
      });
    } catch (err) {
      device.destroy();
      throw err;
    }
  }

  render(_frame: RenderFrame): void {
    const device = this.device;
    const ctx = this.ctx;
    if (!device || !ctx || this.lost) return;
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" },
      ],
    });
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  resize(_widthPx: number, _heightPx: number, _dpr: number): void {
    // The runtime writes the canvas backing store before calling this; the
    // configured context follows the canvas size. Nothing to rebuild without passes.
  }

  destroy(): void {
    const device = this.device;
    this.device = null;
    this.ctx = null;
    this.lost = false;
    device?.destroy();
  }
}
