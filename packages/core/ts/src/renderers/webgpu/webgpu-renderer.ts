/**
 * W71: the WebGPU liquid renderer (slice-3 design §2; D71-3, D71-4, D71-6). Two render passes
 * per frame:
 * 1. splat: one instanced quad per particle of a moving element into T0 (`rgba16float`:
 *    Σw·rgb, Σw) and T0a (`r16float`: Σw·a), additive, at `t0Scale` × the canvas backing size;
 * 2. screen: a full-screen triangle composites T0 into the swapchain (threshold 0.5 with an
 *    `fwidth` edge, colour Σw·rgb/Σw, premultiplied by coverage × Σw·a/Σw), then one
 *    rounded-rect SDF quad per element is drawn over it at `restAlpha` × colour alpha.
 * An element's particles splat at full weight while its `restAlpha < 1` and are skipped at 1
 * (D71-6, the D70-4 rule). No 32-bit float targets; T2 is deferred to slice 4 (D71-3).
 * Rendering never touches the DOM; the canvas element belongs to the runtime.
 */
import { ELEMENT_STRIDE } from "../../fluid-layout";
import type { RenderFrame, Renderer } from "../frame";
import { WebGPUUnavailableError } from "./errors";
import { ELEMENT_GPU_FLOATS, packElements, packHomes, packParticles } from "./gpu-buffers";
import { COMPOSITE_WGSL, REST_WGSL, SPLAT_WGSL } from "./shaders";

/** D71-4: T0 render scale relative to the canvas backing size. */
export const T0_SCALE_DEFAULT = 0.5;
export const T0_FORMAT: GPUTextureFormat = "rgba16float";
export const T0_ALPHA_FORMAT: GPUTextureFormat = "r16float";
/** WGSL `struct View`: size_css (2), size_px (2), dpr, t0_scale, 2 × pad. */
export const VIEW_UNIFORM_FLOATS = 8;
/** WebGPU rejects zero-size storage bindings; no buffer is smaller than this (bytes). */
export const MIN_BUFFER_BYTES = 16;
const ELEMENT_GPU_BYTES = ELEMENT_GPU_FLOATS * 4;
const CLEAR: GPUColorDict = { r: 0, g: 0, b: 0, a: 0 };

export const ADDITIVE_BLEND: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
};
/** Premultiplied "over". */
export const OVER_BLEND: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

export interface WebGPURendererOptions {
  /** D71-4: T0 render scale relative to the canvas backing size, in (0, 1]. Default 0.5. */
  readonly t0Scale?: number;
}

export interface LiquidPipelines {
  readonly modules: readonly GPUShaderModule[];
  readonly splatLayout: GPUBindGroupLayout;
  readonly compositeLayout: GPUBindGroupLayout;
  readonly restLayout: GPUBindGroupLayout;
  readonly splat: GPURenderPipeline;
  readonly composite: GPURenderPipeline;
  readonly rest: GPURenderPipeline;
}

/**
 * The splat, composite and rest pipelines with explicit bind group layouts (no `layout:
 * "auto"`). Creates GPU objects only: the caller owns the validation error scope (init, and
 * the e2e check page demo/smoke/webgpu-liquid.ts).
 */
export function buildPipelines(device: GPUDevice, canvasFormat: GPUTextureFormat): LiquidPipelines {
  const V = GPUShaderStage.VERTEX;
  const F = GPUShaderStage.FRAGMENT;
  const splatModule = device.createShaderModule({ label: "liquiddom splat", code: SPLAT_WGSL });
  const compositeModule = device.createShaderModule({ label: "liquiddom composite", code: COMPOSITE_WGSL });
  const restModule = device.createShaderModule({ label: "liquiddom rest", code: REST_WGSL });
  const splatLayout = device.createBindGroupLayout({
    label: "liquiddom splat",
    entries: [
      { binding: 0, visibility: V, buffer: { type: "uniform" } },
      { binding: 1, visibility: V, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: V, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: V, buffer: { type: "read-only-storage" } },
    ],
  });
  const compositeLayout = device.createBindGroupLayout({
    label: "liquiddom composite",
    entries: [
      { binding: 0, visibility: F, buffer: { type: "uniform" } },
      { binding: 1, visibility: F, texture: { sampleType: "float" } },
      { binding: 2, visibility: F, texture: { sampleType: "float" } },
      { binding: 3, visibility: F, sampler: { type: "filtering" } },
    ],
  });
  const restLayout = device.createBindGroupLayout({
    label: "liquiddom rest",
    entries: [
      { binding: 0, visibility: V | F, buffer: { type: "uniform" } },
      { binding: 1, visibility: V, buffer: { type: "read-only-storage" } },
    ],
  });
  const splat = device.createRenderPipeline({
    label: "liquiddom splat",
    layout: device.createPipelineLayout({ bindGroupLayouts: [splatLayout] }),
    vertex: { module: splatModule, entryPoint: "vs" },
    fragment: {
      module: splatModule,
      entryPoint: "fs",
      targets: [
        { format: T0_FORMAT, blend: ADDITIVE_BLEND },
        { format: T0_ALPHA_FORMAT, blend: ADDITIVE_BLEND },
      ],
    },
    primitive: { topology: "triangle-list" },
  });
  const composite = device.createRenderPipeline({
    label: "liquiddom composite",
    layout: device.createPipelineLayout({ bindGroupLayouts: [compositeLayout] }),
    vertex: { module: compositeModule, entryPoint: "vs" },
    fragment: { module: compositeModule, entryPoint: "fs", targets: [{ format: canvasFormat }] },
    primitive: { topology: "triangle-list" },
  });
  const rest = device.createRenderPipeline({
    label: "liquiddom rest",
    layout: device.createPipelineLayout({ bindGroupLayouts: [restLayout] }),
    vertex: { module: restModule, entryPoint: "vs" },
    fragment: { module: restModule, entryPoint: "fs", targets: [{ format: canvasFormat, blend: OVER_BLEND }] },
    primitive: { topology: "triangle-list" },
  });
  return {
    modules: [splatModule, compositeModule, restModule],
    splatLayout,
    compositeLayout,
    restLayout,
    splat,
    composite,
    rest,
  };
}

function adapterIsFallback(adapter: GPUAdapter): boolean {
  const info = (adapter as { info?: { isFallbackAdapter?: boolean } }).info;
  const legacy = (adapter as { isFallbackAdapter?: boolean }).isFallbackAdapter;
  return info?.isFallbackAdapter === true || legacy === true;
}

/** Backing-store px: integers ≥ 1 (Review Focus 1: a 0×0 or sub-pixel canvas never yields a 0-size texture). */
const pxOrOne = (v: number): number => (Number.isFinite(v) && v >= 1 ? Math.floor(v) : 1);

export class WebGPURenderer implements Renderer {
  readonly t0Scale: number;
  private fallbackAdapter = false;
  private fragmentEstimate = 0;
  private device: GPUDevice | null = null;
  private ctx: GPUCanvasContext | null = null;
  private pipelines: LiquidPipelines | null = null;
  private sampler: GPUSampler | null = null;
  private viewBuffer: GPUBuffer | null = null;
  private particleBuffer: GPUBuffer | null = null;
  private homeBuffer: GPUBuffer | null = null;
  private elementBuffer: GPUBuffer | null = null;
  private t0: GPUTexture | null = null;
  private t0Alpha: GPUTexture | null = null;
  private t0View: GPUTextureView | null = null;
  private t0AlphaView: GPUTextureView | null = null;
  private splatGroup: GPUBindGroup | null = null;
  private compositeGroup: GPUBindGroup | null = null;
  private restGroup: GPUBindGroup | null = null;
  private particleScratch = new Float32Array(0);
  private homeScratch = new Int32Array(0);
  private elementScratch = new Float32Array(0);
  private readonly viewScratch = new Float32Array(VIEW_UNIFORM_FLOATS);
  private bufferCapacity = -1;
  private bufferSlots = -1;
  private widthPx = 1;
  private heightPx = 1;
  private t0Width = 0;
  private t0Height = 0;
  private uploadedGeneration = Number.NaN;
  private uploadedPaints: RenderFrame["paints"] | null = null;
  private uploadedHomeCount = -1;
  private lost = false;
  private warnedLost = false;
  private reportedGpuError = false;

  constructor(opts: WebGPURendererOptions = {}) {
    const s = opts.t0Scale ?? T0_SCALE_DEFAULT;
    if (!(Number.isFinite(s) && s > 0 && s <= 1)) {
      throw new RangeError(`[liquiddom] WebGPU t0Scale must be a finite number in (0, 1], got ${String(s)}`);
    }
    this.t0Scale = s;
  }

  /** True for a software adapter (SwiftShader). Explicit 'webgpu' accepts it; W72 (D72-1) reads it for 'auto'. */
  get isFallbackAdapter(): boolean {
    return this.fallbackAdapter;
  }

  /** Splat fragments of the last frame (D72-4). W72 fills it; 0 in W71. */
  get lastFragmentEstimate(): number {
    return this.fragmentEstimate;
  }

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
    this.fallbackAdapter = adapterIsFallback(adapter);
    let device: GPUDevice;
    try {
      device = await adapter.requestDevice();
    } catch (cause) {
      throw new WebGPUUnavailableError("requestDevice rejected", { cause });
    }
    try {
      const ctx = canvas.getContext("webgpu");
      if (!ctx) throw new WebGPUUnavailableError("canvas.getContext('webgpu') returned null");
      const format = navigator.gpu.getPreferredCanvasFormat();
      ctx.configure({ device, format, alphaMode: "premultiplied" });
      device.pushErrorScope("validation");
      const pipelines = buildPipelines(device, format);
      const sampler = device.createSampler({
        label: "liquiddom T0",
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      });
      const viewBuffer = device.createBuffer({
        label: "liquiddom view",
        size: VIEW_UNIFORM_FLOATS * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      const invalid = await device.popErrorScope();
      // A shader or pipeline error is a bug, not "no WebGPU" (spec §3): it rejects create().
      if (invalid) throw new Error(`[liquiddom] WebGPU pipeline validation failed: ${invalid.message}`);
      this.device = device;
      this.ctx = ctx;
      this.pipelines = pipelines;
      this.sampler = sampler;
      this.viewBuffer = viewBuffer;
      this.lost = false;
      const owned = device;
      void device.lost.then((info) => this.onDeviceLost(owned, info));
      device.addEventListener("uncapturederror", (ev) => this.onGpuError(owned, ev as GPUUncapturedErrorEvent));
      this.allocateTargets();
    } catch (err) {
      this.releaseGpuObjects();
      device.destroy();
      throw err;
    }
  }

  resize(widthPx: number, heightPx: number, _dpr: number): void {
    // The runtime has already written canvas.width/height; the configured context follows them.
    this.widthPx = pxOrOne(widthPx);
    this.heightPx = pxOrOne(heightPx);
    this.allocateTargets();
  }

  render(frame: RenderFrame): void {
    const { device, ctx, pipelines } = this;
    if (!device || !ctx || !pipelines || this.lost) return;
    this.ensureBuffers(frame);
    const { particleBuffer, homeBuffer, elementBuffer, viewBuffer, t0View, t0AlphaView } = this;
    const { splatGroup, compositeGroup, restGroup } = this;
    if (!particleBuffer || !homeBuffer || !elementBuffer || !viewBuffer || !t0View || !t0AlphaView) return;
    if (!splatGroup || !compositeGroup || !restGroup) return;
    const queue = device.queue;

    const count = packParticles(frame, this.particleScratch);
    if (count > 0) queue.writeBuffer(particleBuffer, 0, this.particleScratch, 0, count * 2);
    if (
      frame.generation !== this.uploadedGeneration ||
      frame.paints !== this.uploadedPaints ||
      count !== this.uploadedHomeCount
    ) {
      packHomes(frame, this.homeScratch);
      if (count > 0) queue.writeBuffer(homeBuffer, 0, this.homeScratch, 0, count);
      this.uploadedGeneration = frame.generation;
      this.uploadedPaints = frame.paints;
      this.uploadedHomeCount = count;
    }
    const slots = packElements(frame, this.elementScratch);
    if (slots > 0) queue.writeBuffer(elementBuffer, 0, this.elementScratch, 0, slots * ELEMENT_GPU_FLOATS);
    const v = this.viewScratch;
    const dpr = frame.viewport.dpr;
    v[0] = frame.viewport.widthCss;
    v[1] = frame.viewport.heightCss;
    v[2] = this.widthPx;
    v[3] = this.heightPx;
    v[4] = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
    v[5] = this.t0Scale;
    v[6] = 0;
    v[7] = 0;
    queue.writeBuffer(viewBuffer, 0, v);

    const encoder = device.createCommandEncoder({ label: "liquiddom frame" });
    const splat = encoder.beginRenderPass({
      label: "liquiddom splat",
      colorAttachments: [
        { view: t0View, clearValue: CLEAR, loadOp: "clear", storeOp: "store" },
        { view: t0AlphaView, clearValue: CLEAR, loadOp: "clear", storeOp: "store" },
      ],
    });
    if (count > 0) {
      splat.setPipeline(pipelines.splat);
      splat.setBindGroup(0, splatGroup);
      splat.draw(6, count);
    }
    splat.end();
    const screen = encoder.beginRenderPass({
      label: "liquiddom screen",
      colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: CLEAR, loadOp: "clear", storeOp: "store" }],
    });
    screen.setPipeline(pipelines.composite);
    screen.setBindGroup(0, compositeGroup);
    screen.draw(3);
    if (slots > 0) {
      screen.setPipeline(pipelines.rest);
      screen.setBindGroup(0, restGroup);
      screen.draw(6, slots);
    }
    screen.end();
    queue.submit([encoder.finish()]);
  }

  destroy(): void {
    const device = this.device;
    this.releaseGpuObjects();
    this.lost = false;
    device?.destroy();
  }

  /** T0 and T0a at ceil(backing px · t0Scale), at least 1×1; the composite bind group follows them. */
  private allocateTargets(): void {
    const { device, pipelines, sampler, viewBuffer } = this;
    if (!device || !pipelines || !sampler || !viewBuffer) return;
    const w = Math.max(1, Math.ceil(this.widthPx * this.t0Scale));
    const h = Math.max(1, Math.ceil(this.heightPx * this.t0Scale));
    if (this.t0 && w === this.t0Width && h === this.t0Height) return;
    this.t0?.destroy();
    this.t0Alpha?.destroy();
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    this.t0 = device.createTexture({ label: "liquiddom T0", size: [w, h], format: T0_FORMAT, usage });
    this.t0Alpha = device.createTexture({ label: "liquiddom T0a", size: [w, h], format: T0_ALPHA_FORMAT, usage });
    this.t0View = this.t0.createView();
    this.t0AlphaView = this.t0Alpha.createView();
    this.t0Width = w;
    this.t0Height = h;
    this.compositeGroup = device.createBindGroup({
      label: "liquiddom composite",
      layout: pipelines.compositeLayout,
      entries: [
        { binding: 0, resource: { buffer: viewBuffer } },
        { binding: 1, resource: this.t0View },
        { binding: 2, resource: this.t0AlphaView },
        { binding: 3, resource: sampler },
      ],
    });
  }

  /** Storage buffers sized by the pools (fixed at create()); never smaller than MIN_BUFFER_BYTES (Review Focus 2). */
  private ensureBuffers(frame: RenderFrame): void {
    const { device, pipelines, viewBuffer } = this;
    if (!device || !pipelines || !viewBuffer) return;
    const cap = Math.max(0, Math.floor(frame.particleCapacity));
    const slots = Math.floor(frame.elementView.length / ELEMENT_STRIDE);
    if (this.particleBuffer && cap === this.bufferCapacity && slots === this.bufferSlots) return;
    this.particleBuffer?.destroy();
    this.homeBuffer?.destroy();
    this.elementBuffer?.destroy();
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const particleBuffer = device.createBuffer({ label: "liquiddom particles", size: Math.max(MIN_BUFFER_BYTES, cap * 8), usage });
    const homeBuffer = device.createBuffer({ label: "liquiddom homes", size: Math.max(MIN_BUFFER_BYTES, cap * 4), usage });
    const elementBuffer = device.createBuffer({
      label: "liquiddom elements",
      size: Math.max(ELEMENT_GPU_BYTES, slots * ELEMENT_GPU_BYTES),
      usage,
    });
    this.particleBuffer = particleBuffer;
    this.homeBuffer = homeBuffer;
    this.elementBuffer = elementBuffer;
    this.particleScratch = new Float32Array(cap * 2);
    this.homeScratch = new Int32Array(cap);
    this.elementScratch = new Float32Array(slots * ELEMENT_GPU_FLOATS);
    this.bufferCapacity = cap;
    this.bufferSlots = slots;
    this.uploadedGeneration = Number.NaN;
    this.uploadedPaints = null;
    this.uploadedHomeCount = -1;
    this.splatGroup = device.createBindGroup({
      label: "liquiddom splat",
      layout: pipelines.splatLayout,
      entries: [
        { binding: 0, resource: { buffer: viewBuffer } },
        { binding: 1, resource: { buffer: particleBuffer } },
        { binding: 2, resource: { buffer: homeBuffer } },
        { binding: 3, resource: { buffer: elementBuffer } },
      ],
    });
    this.restGroup = device.createBindGroup({
      label: "liquiddom rest",
      layout: pipelines.restLayout,
      entries: [
        { binding: 0, resource: { buffer: viewBuffer } },
        { binding: 1, resource: { buffer: elementBuffer } },
      ],
    });
  }

  private releaseGpuObjects(): void {
    this.t0?.destroy();
    this.t0Alpha?.destroy();
    this.particleBuffer?.destroy();
    this.homeBuffer?.destroy();
    this.elementBuffer?.destroy();
    this.viewBuffer?.destroy();
    this.device = null;
    this.ctx = null;
    this.pipelines = null;
    this.sampler = null;
    this.viewBuffer = null;
    this.particleBuffer = null;
    this.homeBuffer = null;
    this.elementBuffer = null;
    this.t0 = null;
    this.t0Alpha = null;
    this.t0View = null;
    this.t0AlphaView = null;
    this.splatGroup = null;
    this.compositeGroup = null;
    this.restGroup = null;
    this.bufferCapacity = -1;
    this.bufferSlots = -1;
    this.t0Width = 0;
    this.t0Height = 0;
    this.uploadedGeneration = Number.NaN;
    this.uploadedPaints = null;
    this.uploadedHomeCount = -1;
  }

  /** W72 (D72-3) turns this into the Canvas2D rebuild; W71 warns once and stops drawing. Our own destroy() is silent. */
  private onDeviceLost(owned: GPUDevice, info: GPUDeviceLostInfo): void {
    // Only our own destroy() is silent (it clears this.device first). A crashed GPU process also
    // reports reason "destroyed" (W71.0 spike, SwiftShader), so the reason string decides nothing.
    if (this.device !== owned) return;
    this.lost = true;
    if (this.warnedLost) return;
    this.warnedLost = true;
    console.warn(`[liquiddom] WebGPU device lost (${info.message}); the liquid is no longer drawn.`);
  }

  /** A GPU validation error at runtime is a bug: one console.error (the first), never a flood. */
  private onGpuError(owned: GPUDevice, ev: GPUUncapturedErrorEvent): void {
    if (this.device !== owned || this.reportedGpuError) return;
    this.reportedGpuError = true;
    console.error(`[liquiddom] WebGPU error: ${ev.error.message}`);
  }
}
