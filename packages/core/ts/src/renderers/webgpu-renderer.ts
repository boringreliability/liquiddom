// Ward 037 — WebGPU Pipeline Scaffolding.
// Implements .wdd/wards/ward-037.md r2 §Specification. Renders soft-body and
// FreeDrop blobs as triangle fans from each entity's centroid through its 16
// perimeter particles. Matches Canvas2D output at visual rest (with documented
// drift during deformation per Decision §3 / Risk R3). W38 replaces the
// geometry with SDF rendering; W37 establishes the pipeline scaffolding.

import {
  FLOATS_PER_ENTITY,
  PARTICLES_PER_BODY,
  type RenderFrame,
  type Renderer,
} from "./renderer";
import { BLOB_WGSL } from "./shaders/blob.wgsl";

const PARTICLE_FLOATS_PER_BODY = PARTICLES_PER_BODY * 2;
const FLOATS_PER_ENTITY_GPU = 8; // vec4 color + vec2 centroid + vec2 pad
const BYTES_PER_ENTITY_GPU = FLOATS_PER_ENTITY_GPU * 4; // 32 bytes
const VERTICES_PER_BLOB = PARTICLES_PER_BODY * 3; // 48 (W38 may change)

const PREMUL_BLEND: GPUBlendComponent = {
  srcFactor: "one",
  dstFactor: "one-minus-src-alpha",
  operation: "add",
};

export class WebGPUUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WebGPUUnavailableError";
  }
}

/**
 * Parse a CSS `rgb()` / `rgba()` color into a premultiplied `[r, g, b, a]`
 * tuple in [0, 1]. Hex (`#fff`), HSL, named colors, and `color()` functional
 * notation are NOT supported — they fall through to `[0, 0, 0, 0]` (invisible
 * blob) with a one-time console.warn so the parity gap with Canvas2D is
 * surfaced instead of silently rendering nothing.
 */
let warnedUnparseableColor = false;
function parseColor(raw: string): [number, number, number, number] {
  const m = raw.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (!m) {
    if (!warnedUnparseableColor) {
      console.warn(
        `[liquiddom] WebGPU renderer accepts only rgb()/rgba() color strings; got ${JSON.stringify(raw)}. Blob will render invisible. Canvas2D accepts more CSS color forms.`,
      );
      warnedUnparseableColor = true;
    }
    return [0, 0, 0, 0];
  }
  const r = Number(m[1]) / 255;
  const g = Number(m[2]) / 255;
  const b = Number(m[3]) / 255;
  const a = m[4] !== undefined ? Number(m[4]) : 1;
  return [r * a, g * a, b * a, a];
}

export class WebGPURenderer implements Renderer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private pipeline: GPURenderPipeline | null = null;
  private particleBuffer: GPUBuffer | null = null;
  private entityBuffer: GPUBuffer | null = null;
  private projectionBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private sRgbFormat: GPUTextureFormat | null = null;
  private capacity = 0;
  private readonly projMatrix = new Float32Array(16);
  private entityScratch: Float32Array | null = null;
  private warnedPreserveBg = false;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;

    // Path A: navigator.gpu missing (Firefox/Safari/non-secure context).
    if (typeof navigator === "undefined" || !navigator.gpu) {
      throw new WebGPUUnavailableError("navigator.gpu is undefined");
    }

    // Path B: requestAdapter rejects or returns null.
    let adapter: GPUAdapter | null;
    try {
      adapter = await navigator.gpu.requestAdapter();
    } catch (cause) {
      throw new WebGPUUnavailableError("requestAdapter threw", { cause });
    }
    if (!adapter) {
      throw new WebGPUUnavailableError("requestAdapter returned null");
    }

    // Path C: requestDevice rejects.
    let device: GPUDevice;
    try {
      device = await adapter.requestDevice();
    } catch (cause) {
      throw new WebGPUUnavailableError("requestDevice rejected", { cause });
    }

    // Wrap the remaining init in try/catch so a path D/E failure still
    // releases the acquired GPU device (would otherwise leak — review finding).
    try {
      // Path D: canvas.getContext('webgpu') returns null (e.g., canvas already
      // used for "2d" — Decision §17).
      const ctx = canvas.getContext("webgpu");
      if (!ctx) {
        throw new WebGPUUnavailableError("canvas.getContext('webgpu') returned null");
      }

      const format = navigator.gpu.getPreferredCanvasFormat();
      const sRgbFormat = `${format}-srgb` as GPUTextureFormat;
      ctx.configure({
        device,
        format,
        alphaMode: "premultiplied",
        viewFormats: [sRgbFormat],
      });

      // Path E: shader compile or pipeline validation fails. Wrap creation in a
      // validation error scope so we can surface the actual GPUError as cause.
      device.pushErrorScope("validation");
      const shaderModule = device.createShaderModule({ code: BLOB_WGSL });
      const pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vs_main" },
        fragment: {
          module: shaderModule,
          entryPoint: "fs_main",
          targets: [{ format: sRgbFormat, blend: { color: PREMUL_BLEND, alpha: PREMUL_BLEND } }],
        },
        primitive: { topology: "triangle-list" },
      });
      const validationError = await device.popErrorScope();
      if (validationError) {
        throw new WebGPUUnavailableError(
          "shader compile or pipeline create failed",
          { cause: validationError },
        );
      }

      // Projection uniform buffer (mat4x4<f32>, 64 bytes). Updated each frame.
      const projectionBuffer = device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // All init steps succeeded — commit state. Attaching `device.lost` AFTER
      // commit prevents spurious post-destroy warnings on path-D/E failures
      // (the device is destroyed in the catch below, but its lost-promise
      // resolves later; without this gate it would fire console.warn after the
      // consumer's catch handler already cleaned up).
      this.device = device;
      this.ctx = ctx;
      this.pipeline = pipeline;
      this.projectionBuffer = projectionBuffer;
      this.sRgbFormat = sRgbFormat;
      const ownedDevice = device;
      device.lost.then((info) => {
        if (this.device !== ownedDevice) return; // already destroyed locally
        console.warn(`[liquiddom] WebGPU device lost: ${info.message}`);
        this.device = null;
      });
    } catch (err) {
      // Release the acquired device on any post-acquisition failure.
      device.destroy();
      throw err;
    }
  }

  resize(_widthPx: number, _heightPx: number, _dpr: number): void {
    // Projection is rebuilt from frame.viewport in render(); the canvas
    // backing-store resize is the caller's responsibility (W36 Decision §15).
  }

  render(frame: RenderFrame): void {
    const device = this.device;
    const ctx = this.ctx;
    const pipeline = this.pipeline;
    const projBuf = this.projectionBuffer;
    const sRgbFormat = this.sRgbFormat;
    if (!device || !ctx || !pipeline || !projBuf || !sRgbFormat) return;
    if (!frame.particles) return; // Decision §13: mock-mode no-op

    if (frame.viewport.preserveBackgrounds && !this.warnedPreserveBg) {
      console.warn(
        "[liquiddom] WebGPU renderer does not support preserveBackgrounds in W37 — blobs will render on top of element backgrounds. Use renderer: 'canvas2d' for clip support.",
      );
      this.warnedPreserveBg = true;
    }

    // Lazy GPU-buffer allocation on first render or capacity change.
    if (frame.capacity !== this.capacity) {
      this.particleBuffer?.destroy();
      this.entityBuffer?.destroy();
      this.particleBuffer = device.createBuffer({
        size: frame.capacity * PARTICLE_FLOATS_PER_BODY * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.entityBuffer = device.createBuffer({
        size: frame.capacity * BYTES_PER_ENTITY_GPU,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      this.entityScratch = new Float32Array(frame.capacity * FLOATS_PER_ENTITY_GPU);
      this.capacity = frame.capacity;
      this.bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: projBuf } },
          { binding: 1, resource: { buffer: this.particleBuffer } },
          { binding: 2, resource: { buffer: this.entityBuffer } },
        ],
      });
    }

    // Update projection matrix from viewport CSS px → clip space [-1, 1].
    this.updateProjectionMatrix(frame.viewport.widthCss, frame.viewport.heightCss);
    device.queue.writeBuffer(
      projBuf, 0,
      this.projMatrix.buffer, this.projMatrix.byteOffset, 64,
    );

    // Upload particle data verbatim.
    device.queue.writeBuffer(
      this.particleBuffer!, 0,
      frame.particles.buffer, frame.particles.byteOffset, frame.particles.byteLength,
    );

    // Pack per-entity (color + centroid) into scratch.
    const colorDefault = parseColor(frame.theme.colorDefault);
    const colorHover = parseColor(frame.theme.colorHover);
    const scratch = this.entityScratch!;
    scratch.fill(0);
    for (const id of frame.softBodyIds) {
      const off = id * FLOATS_PER_ENTITY;
      if (frame.entities[off + 2] === 0) continue;
      const lt = Math.round(frame.entities[off + 5]);
      if (lt === 6) continue; // FreeDrop leaker (W56 defense-in-depth)
      const isHover = frame.entities[off + 4] === 1.0;
      const color = isHover ? colorHover : colorDefault;
      const sOff = id * FLOATS_PER_ENTITY_GPU;
      scratch[sOff] = color[0];
      scratch[sOff + 1] = color[1];
      scratch[sOff + 2] = color[2];
      scratch[sOff + 3] = color[3];
      scratch[sOff + 4] = frame.entities[off] + frame.entities[off + 2] * 0.5;
      scratch[sOff + 5] = frame.entities[off + 1] + frame.entities[off + 3] * 0.5;
    }
    for (const id of frame.dropletIds) {
      const off = id * FLOATS_PER_ENTITY;
      if (frame.entities[off + 2] === 0) continue;
      const sOff = id * FLOATS_PER_ENTITY_GPU;
      scratch[sOff] = colorDefault[0];
      scratch[sOff + 1] = colorDefault[1];
      scratch[sOff + 2] = colorDefault[2];
      scratch[sOff + 3] = colorDefault[3];
      scratch[sOff + 4] = frame.entities[off];
      scratch[sOff + 5] = frame.entities[off + 1];
    }
    device.queue.writeBuffer(
      this.entityBuffer!, 0,
      scratch.buffer, scratch.byteOffset, scratch.byteLength,
    );

    // Render pass with sRGB view for gamma-correct framebuffer write.
    const encoder = device.createCommandEncoder();
    const view = ctx.getCurrentTexture().createView({ format: sRgbFormat });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view,
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
      }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.bindGroup!);
    pass.draw(VERTICES_PER_BLOB, frame.capacity, 0, 0);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  destroy(): void {
    this.particleBuffer?.destroy();
    this.entityBuffer?.destroy();
    this.projectionBuffer?.destroy();
    this.device?.destroy();
    this.canvas = null;
    this.ctx = null;
    this.device = null;
    this.pipeline = null;
    this.particleBuffer = null;
    this.entityBuffer = null;
    this.projectionBuffer = null;
    this.bindGroup = null;
    this.sRgbFormat = null;
    this.capacity = 0;
    this.entityScratch = null;
  }

  /**
   * Orthographic CSS-px → clip space [-1, 1] with Y flipped. Column-major:
   *   [[2/w, 0,    0, 0],
   *    [0,   -2/h, 0, 0],
   *    [0,    0,   1, 0],
   *    [-1,   1,   0, 1]]
   * Test: (w, h) → (1, -1); (0, 0) → (-1, 1).
   */
  private updateProjectionMatrix(widthCss: number, heightCss: number): void {
    const m = this.projMatrix;
    m.fill(0);
    m[0] = 2 / widthCss;
    m[5] = -2 / heightCss;
    m[10] = 1;
    m[12] = -1;
    m[13] = 1;
    m[15] = 1;
  }
}
