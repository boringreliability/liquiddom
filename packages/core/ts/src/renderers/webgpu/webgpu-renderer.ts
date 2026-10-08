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
import { estimateSplatFragments } from "./overdraw";

/** D71-4: T0 render scale relative to the canvas backing size. */
export const T0_SCALE_DEFAULT = 0.5;
/**
 * W72 (W71 ward-review M2): the smallest accepted T0 scale. Far below 0.5 a T0 texel grows past
 * the kernel radius (R ≤ 8 CSS px) and the thresholded edge turns blocky; D71-4 compared 0.5 and
 * 0.75 only. The options validate the same range (`webgpuT0Scale`, options.ts).
 */
export const T0_SCALE_MIN = 0.25;
export const T0_FORMAT: GPUTextureFormat = "rgba16float";
export const T0_ALPHA_FORMAT: GPUTextureFormat = "r16float";
/** WGSL `struct View`: size_css (2), size_px (2), dpr, t0_scale, 2 × pad. */
export const VIEW_UNIFORM_FLOATS = 8;
/** WebGPU rejects zero-size storage bindings; no buffer is smaller than this (bytes). */
export const MIN_BUFFER_BYTES = 16;
const ELEMENT_GPU_BYTES = ELEMENT_GPU_FLOATS * 4;
const CLEAR: GPUColorDict = { r: 0, g: 0, b: 0, a: 0 };
/** The WebGPU default `maxTextureDimension2D`, used when the device does not report one. */
const DEFAULT_MAX_TEXTURE_DIMENSION_2D = 8192;
/** Stands in for a view in the reused pass descriptors until the first allocateTargets()/render() sets it. */
const PLACEHOLDER_VIEW = null as unknown as GPUTextureView;

export const ADDITIVE_BLEND: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
};
/** Premultiplied "over". */
export const OVER_BLEND: GPUBlendState = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

/** W72 (D72-3): the message of a loss caused by loseDeviceForTest(), reported as reason 'unknown'. */
export const SIMULATED_LOSS_MESSAGE = "simulated device loss (test hook)";

function simulatedLossInfo(): GPUDeviceLostInfo {
  return { reason: "unknown", message: SIMULATED_LOSS_MESSAGE } as unknown as GPUDeviceLostInfo;
}

export interface WebGPURendererOptions {
  /** D71-4: T0 render scale relative to the canvas backing size, in [T0_SCALE_MIN, 1] = [0.25, 1] (W72, M2). Default 0.5. */
  readonly t0Scale?: number;
  /** W72 (D72-1, D72-2): false makes a fallback (software) adapter a WebGPUUnavailableError ('auto'). Default true ('webgpu'). */
  readonly acceptFallbackAdapter?: boolean;
  /** W72 (D72-3): a device lost after init; never for reason 'destroyed' (our destroy()), never after destroy(). */
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
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

/** W71; W72 (D72-1) exports it: either adapter.info.isFallbackAdapter or the deprecated adapter.isFallbackAdapter. */
export function adapterIsFallback(adapter: GPUAdapter): boolean {
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
  /** Rest records `[0, n)` uploaded last frame; a record that stops being drawable is zeroed once (W71.4 review, Minor 1). */
  private uploadedSlots = 0;
  private maxTextureDim = DEFAULT_MAX_TEXTURE_DIMENSION_2D;
  /** Render-pass descriptors are reused; render() and allocateTargets() set only the views (W71.4 review, Minor 3). */
  private readonly t0Attachment: GPURenderPassColorAttachment = { view: PLACEHOLDER_VIEW, clearValue: CLEAR, loadOp: "clear", storeOp: "store" };
  private readonly t0AlphaAttachment: GPURenderPassColorAttachment = { view: PLACEHOLDER_VIEW, clearValue: CLEAR, loadOp: "clear", storeOp: "store" };
  private readonly screenAttachment: GPURenderPassColorAttachment = { view: PLACEHOLDER_VIEW, clearValue: CLEAR, loadOp: "clear", storeOp: "store" };
  private readonly splatPass: GPURenderPassDescriptor = { label: "liquiddom splat", colorAttachments: [this.t0Attachment, this.t0AlphaAttachment] };
  private readonly screenPass: GPURenderPassDescriptor = { label: "liquiddom screen", colorAttachments: [this.screenAttachment] };
  private readonly encoderDescriptor: GPUCommandEncoderDescriptor = { label: "liquiddom frame" };
  private readonly submitList: GPUCommandBuffer[] = [];
  private lost = false;
  private reportedGpuError = false;
  // ---- W72 (D72-2, D72-3) ----
  private readonly acceptFallbackAdapter: boolean;
  private readonly deviceLostCallback: ((info: GPUDeviceLostInfo) => void) | undefined;
  private simulatedLoss = false;
  private initSettled = false;
  private lostDuringInit: GPUDeviceLostInfo | null = null;

  constructor(opts: WebGPURendererOptions = {}) {
    const s = opts.t0Scale ?? T0_SCALE_DEFAULT;
    if (!(Number.isFinite(s) && s >= T0_SCALE_MIN && s <= 1)) {
      throw new RangeError(`[liquiddom] WebGPU t0Scale must be a finite number in [${T0_SCALE_MIN}, 1], got ${String(s)}`);
    }
    this.t0Scale = s;
    this.acceptFallbackAdapter = opts.acceptFallbackAdapter ?? true;
    this.deviceLostCallback = opts.onDeviceLost;
  }

  /** True for a software adapter (SwiftShader). Explicit 'webgpu' accepts it; W72 (D72-1) reads it for 'auto'. */
  get isFallbackAdapter(): boolean {
    return this.fallbackAdapter;
  }

  /** D72-4: estimated splat fragments of the last rendered frame (0 before the first frame, at rest and after a loss). */
  get lastFragmentEstimate(): number {
    return this.fragmentEstimate;
  }

  /**
   * @internal W72 (D72-6): the size of T0 and T0a in px, `[width, height]` = ceil(backing px ×
   * t0Scale), clamped to [1, maxTextureDimension2D]; null before init and after destroy() or a
   * failed init. Read only by FluidRuntime.t0Size (scene test hooks).
   */
  get t0Size(): readonly [number, number] | null {
    return this.t0 ? [this.t0Width, this.t0Height] : null;
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
    // W72 (D72-1, D72-2): 'auto' treats a fallback (software) adapter as unavailable, before any device or context exists.
    if (this.fallbackAdapter && !this.acceptFallbackAdapter) {
      throw new WebGPUUnavailableError("the adapter is a fallback (software) adapter, which renderer 'auto' treats as unavailable");
    }
    let device: GPUDevice;
    try {
      // W71.4 review (Minor 4): the default limit is 8192 px; a wide backing at dpr 2 exceeds it.
      const adapterLimit = adapter.limits?.maxTextureDimension2D;
      device =
        typeof adapterLimit === "number" && Number.isFinite(adapterLimit) && adapterLimit > 0
          ? await adapter.requestDevice({ requiredLimits: { maxTextureDimension2D: adapterLimit } })
          : await adapter.requestDevice();
    } catch (cause) {
      throw new WebGPUUnavailableError("requestDevice rejected", { cause });
    }
    this.watchDeviceLoss(device); // W72 (D72-3): from requestDevice on, so a loss during init is seen
    try {
      const ctx = canvas.getContext("webgpu");
      if (!ctx) throw new WebGPUUnavailableError("canvas.getContext('webgpu') returned null");
      const format = navigator.gpu.getPreferredCanvasFormat();
      // W72 (D72-1, D72-2): a separate validation scope proves the presentation surface works.
      // Chromium's headless shell hands out the same SwiftShader adapter as a working browser and
      // configure()/getCurrentTexture() do not throw; only createView() on the swapchain texture
      // raises a validation error (W71.5 review, Part B). Unusable surface = WebGPU unavailable:
      // 'auto' falls back to Canvas2D, explicit 'webgpu' rejects create(). A configure() that
      // throws is still a bug and rejects (it leaves this scope open; the catch destroys the device).
      device.pushErrorScope("validation");
      ctx.configure({ device, format, alphaMode: "premultiplied" });
      ctx.getCurrentTexture().createView();
      const surface = await device.popErrorScope();
      if (surface) {
        throw new WebGPUUnavailableError(`the canvas presentation surface is unusable (${surface.message})`);
      }
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
      const deviceLimit = device.limits?.maxTextureDimension2D;
      this.maxTextureDim =
        typeof deviceLimit === "number" && Number.isFinite(deviceLimit) && deviceLimit >= 1
          ? Math.floor(deviceLimit)
          : DEFAULT_MAX_TEXTURE_DIMENSION_2D;
      this.lost = false;
      const owned = device;
      device.addEventListener("uncapturederror", (ev) => this.onGpuError(owned, ev as GPUUncapturedErrorEvent));
      this.allocateTargets();
      this.settleInit(); // W72 (D72-3): a loss during init → WebGPUUnavailableError; the catch destroys the device
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
    this.fragmentEstimate = estimateSplatFragments(frame, this.t0Scale); // D72-4: logged, never gated
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
    // Records past `slots` are not drawable. Upload through last frame's count too, zeroed, so a
    // record that just stopped being drawable (unpainted or w = 0 before the redistribute bump,
    // while the homes on the GPU may still name it) gets flags 0 instead of staying stale.
    const upload = Math.min(Math.max(slots, this.uploadedSlots), this.bufferSlots);
    if (upload > slots) this.elementScratch.fill(0, slots * ELEMENT_GPU_FLOATS, upload * ELEMENT_GPU_FLOATS);
    if (upload > 0) queue.writeBuffer(elementBuffer, 0, this.elementScratch, 0, upload * ELEMENT_GPU_FLOATS);
    this.uploadedSlots = slots;
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

    const encoder = device.createCommandEncoder(this.encoderDescriptor);
    const splat = encoder.beginRenderPass(this.splatPass);
    if (count > 0) {
      splat.setPipeline(pipelines.splat);
      splat.setBindGroup(0, splatGroup);
      splat.draw(6, count);
    }
    splat.end();
    this.screenAttachment.view = ctx.getCurrentTexture().createView();
    const screen = encoder.beginRenderPass(this.screenPass);
    screen.setPipeline(pipelines.composite);
    screen.setBindGroup(0, compositeGroup);
    screen.draw(3);
    if (slots > 0) {
      screen.setPipeline(pipelines.rest);
      screen.setBindGroup(0, restGroup);
      screen.draw(6, slots);
    }
    screen.end();
    this.submitList[0] = encoder.finish();
    queue.submit(this.submitList);
  }

  destroy(): void {
    const device = this.device;
    this.releaseGpuObjects();
    this.lost = false;
    this.fragmentEstimate = 0;
    this.simulatedLoss = false;
    device?.destroy();
  }

  /**
   * T0 and T0a at ceil(backing px · t0Scale), at least 1×1 and at most the device's
   * maxTextureDimension2D (the composite samples T0 in normalised coordinates, so a clamped T0
   * still covers the canvas, at a lower resolution). The swapchain is sized by the runtime
   * (canvas.width/height); init requests the adapter's limit so a wide backing at dpr 2 fits.
   * The composite bind group and the splat pass views follow them.
   */
  private allocateTargets(): void {
    const { device, pipelines, sampler, viewBuffer } = this;
    if (!device || !pipelines || !sampler || !viewBuffer) return;
    const max = this.maxTextureDim;
    const w = Math.min(max, Math.max(1, Math.ceil(this.widthPx * this.t0Scale)));
    const h = Math.min(max, Math.max(1, Math.ceil(this.heightPx * this.t0Scale)));
    if (this.t0 && w === this.t0Width && h === this.t0Height) return;
    this.t0?.destroy();
    this.t0Alpha?.destroy();
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    this.t0 = device.createTexture({ label: "liquiddom T0", size: [w, h], format: T0_FORMAT, usage });
    this.t0Alpha = device.createTexture({ label: "liquiddom T0a", size: [w, h], format: T0_ALPHA_FORMAT, usage });
    this.t0View = this.t0.createView();
    this.t0AlphaView = this.t0Alpha.createView();
    this.t0Attachment.view = this.t0View;
    this.t0AlphaAttachment.view = this.t0AlphaView;
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
    this.uploadedSlots = 0;
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
    this.uploadedSlots = 0;
    this.maxTextureDim = DEFAULT_MAX_TEXTURE_DIMENSION_2D;
    this.t0Attachment.view = PLACEHOLDER_VIEW;
    this.t0AlphaAttachment.view = PLACEHOLDER_VIEW;
    this.screenAttachment.view = PLACEHOLDER_VIEW;
    this.submitList.length = 0;
  }

  /** W72 (D72-3): watches the device from requestDevice on. Before init settles a loss is remembered (init then throws). */
  private watchDeviceLoss(device: GPUDevice): void {
    this.initSettled = false;
    this.lostDuringInit = null;
    void device.lost.then((info) => {
      if (!this.initSettled) {
        this.lostDuringInit = info;
        return;
      }
      if (this.device !== device) return; // destroy() ran first: our own loss, never a rebuild
      const simulated = this.simulatedLoss;
      // D72-3 (amended after the W71.0 spike): any loss we did not cause rebuilds, whatever its
      // reason; a crashed GPU process reports "destroyed" too. Our own destroy() returned above.
      this.lost = true;
      this.fragmentEstimate = 0;
      // The renderer never warns: the runtime owns the one console.warn (D72-3).
      this.deviceLostCallback?.(simulated ? simulatedLossInfo() : info);
    });
  }

  /** D72-3: the last statement of a successful init. A loss during init counts as unavailable. */
  private settleInit(): void {
    this.initSettled = true;
    const early = this.lostDuringInit;
    if (early !== null) {
      throw new WebGPUUnavailableError(`the WebGPU device was lost during init (${early.reason}: ${early.message})`);
    }
  }

  /**
   * @internal W72 (D72-3): lose the device the way a driver reset would. Browsers cannot lose a
   * device with reason 'unknown' on demand, so this destroys it and reports the loss as
   * 'unknown'. Reached only through FluidRuntime.simulateDeviceLoss() (scene test hooks).
   */
  loseDeviceForTest(): void {
    const device = this.device;
    if (!device || this.lost) return;
    this.simulatedLoss = true;
    this.lost = true; // no frame may use the destroyed device before the loss is delivered
    device.destroy();
  }

  /** A GPU validation error at runtime is a bug: one console.error (the first), never a flood; none after a loss. */
  private onGpuError(owned: GPUDevice, ev: GPUUncapturedErrorEvent): void {
    if (this.device !== owned || this.lost || this.reportedGpuError) return;
    this.reportedGpuError = true;
    console.error(`[liquiddom] WebGPU error: ${ev.error.message}`);
  }
}
