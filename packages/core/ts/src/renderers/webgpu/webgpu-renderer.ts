/**
 * W71: the WebGPU liquid renderer (slice-3 design §2; D71-3, D71-4, D71-6). Two render passes
 * per frame:
 * 1. splat: one instanced quad per particle of a moving element into T0 (`rgba16float`:
 *    Σw·rgb, Σw) and T0a (`r16float`: Σw·a), additive, at `t0Scale` × the canvas backing size;
 * 2. screen: a full-screen triangle composites T0 into the swapchain (threshold 0.5 with an
 *    `fwidth` edge, colour Σw·rgb/Σw, premultiplied by coverage × Σw·a/Σw), then one
 *    rounded-rect SDF quad per element is drawn over it at `restAlpha` × colour alpha.
 * An element's particles splat at full weight while its `restAlpha < 1` and are skipped at 1
 * (D71-6, the D70-4 rule). No 32-bit float targets.
 * W74 (D74-4): while an element with atlas text moves, a third pass splats its text into T1
 * (`rgba16float`, Σw·text_rgba_premul) and T1w (`r16float`, Σw) at 1× the backing size — its own
 * pass, because every attachment of a pass shares one size and T0 is at `t0Scale` — and the screen
 * pass draws the text composite after the rest SDF. T2 is dropped. The atlas page is uploaded
 * once per version; `textReady(id)` tells the runtime whose text is drawn (D74-6).
 * W74 ward-review (I1): once a page is confirmed, a new version goes into a staging texture and
 * the confirmed page keeps drawing with its own text records until the new upload's error scope
 * resolves; the swap then copies the staging page into the drawn texture and switches the records
 * in one step, so a rebuild during motion never blinks the text.
 * Rendering never touches the DOM; the canvas element belongs to the runtime.
 */
import { ELEMENT_STRIDE } from "../../fluid-layout";
import type { RenderFrame, Renderer, TextAtlasFrame } from "../frame";
import { WebGPUUnavailableError } from "./errors";
import {
  ELEMENT_GPU_FLOATS,
  PARTICLE_GPU_FLOATS,
  TEXT_INFO_FLOATS,
  hasMovingText,
  packElements,
  packHomes,
  packParticles,
  packRestUV,
  packTextInfo,
} from "./gpu-buffers";
import { COMPOSITE_WGSL, REST_WGSL, SPLAT_WGSL, TEXT_COMPOSITE_WGSL, TEXT_WGSL } from "./shaders";
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
/** W74 (D74-4): the text pass targets (1× the backing size) and the atlas page texture. */
export const T1_FORMAT: GPUTextureFormat = "rgba16float";
export const T1_WEIGHT_FORMAT: GPUTextureFormat = "r16float";
export const ATLAS_FORMAT: GPUTextureFormat = "rgba8unorm";
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
  /** W72 (D72-3): a device lost after init: any loss not caused by our own destroy() (device identity, not the reason string; a crashed GPU process also reports 'destroyed'); never after destroy(). */
  readonly onDeviceLost?: (info: GPUDeviceLostInfo) => void;
}

export interface LiquidPipelines {
  readonly modules: readonly GPUShaderModule[];
  readonly splatLayout: GPUBindGroupLayout;
  readonly compositeLayout: GPUBindGroupLayout;
  readonly restLayout: GPUBindGroupLayout;
  readonly textLayout: GPUBindGroupLayout;
  readonly textCompositeLayout: GPUBindGroupLayout;
  readonly splat: GPURenderPipeline;
  readonly composite: GPURenderPipeline;
  readonly rest: GPURenderPipeline;
  readonly text: GPURenderPipeline;
  readonly textComposite: GPURenderPipeline;
}

/**
 * The splat, composite, rest, text and text-composite pipelines with explicit bind group layouts
 * (no `layout: "auto"`). Creates GPU objects only: the caller owns the validation error scope
 * (init, and the e2e check page demo/smoke/webgpu-liquid.ts), so a text shader bug rejects
 * create() like any other pipeline bug (W74, D74-4).
 */
export function buildPipelines(device: GPUDevice, canvasFormat: GPUTextureFormat): LiquidPipelines {
  const V = GPUShaderStage.VERTEX;
  const F = GPUShaderStage.FRAGMENT;
  const splatModule = device.createShaderModule({ label: "liquiddom splat", code: SPLAT_WGSL });
  const compositeModule = device.createShaderModule({ label: "liquiddom composite", code: COMPOSITE_WGSL });
  const restModule = device.createShaderModule({ label: "liquiddom rest", code: REST_WGSL });
  const textModule = device.createShaderModule({ label: "liquiddom text", code: TEXT_WGSL });
  const textCompositeModule = device.createShaderModule({ label: "liquiddom text composite", code: TEXT_COMPOSITE_WGSL });
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
  const textLayout = device.createBindGroupLayout({
    label: "liquiddom text",
    entries: [
      { binding: 0, visibility: V, buffer: { type: "uniform" } },
      { binding: 1, visibility: V, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: V, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: V, buffer: { type: "read-only-storage" } },
      { binding: 4, visibility: V, buffer: { type: "read-only-storage" } },
      { binding: 5, visibility: V, buffer: { type: "read-only-storage" } },
      { binding: 6, visibility: F, texture: { sampleType: "float" } },
      { binding: 7, visibility: F, sampler: { type: "filtering" } },
    ],
  });
  const textCompositeLayout = device.createBindGroupLayout({
    label: "liquiddom text composite",
    entries: [
      { binding: 0, visibility: F, buffer: { type: "uniform" } },
      { binding: 1, visibility: F, texture: { sampleType: "float" } },
      { binding: 2, visibility: F, texture: { sampleType: "float" } },
      { binding: 3, visibility: F, sampler: { type: "filtering" } },
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
  const text = device.createRenderPipeline({
    label: "liquiddom text",
    layout: device.createPipelineLayout({ bindGroupLayouts: [textLayout] }),
    vertex: { module: textModule, entryPoint: "vs" },
    fragment: {
      module: textModule,
      entryPoint: "fs",
      targets: [
        { format: T1_FORMAT, blend: ADDITIVE_BLEND },
        { format: T1_WEIGHT_FORMAT, blend: ADDITIVE_BLEND },
      ],
    },
    primitive: { topology: "triangle-list" },
  });
  const textComposite = device.createRenderPipeline({
    label: "liquiddom text composite",
    layout: device.createPipelineLayout({ bindGroupLayouts: [textCompositeLayout] }),
    vertex: { module: textCompositeModule, entryPoint: "vs" },
    fragment: { module: textCompositeModule, entryPoint: "fs", targets: [{ format: canvasFormat, blend: OVER_BLEND }] },
    primitive: { topology: "triangle-list" },
  });
  return {
    modules: [splatModule, compositeModule, restModule, textModule, textCompositeModule],
    splatLayout,
    compositeLayout,
    restLayout,
    textLayout,
    textCompositeLayout,
    splat,
    composite,
    rest,
    text,
    textComposite,
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

/** W74 ward-review (I1): the paint owner of slots `[0, n)` at pack time (allocation-free once sized). */
function recordOwners(frame: RenderFrame, out: Array<number | undefined>, n: number): void {
  out.length = n;
  for (let id = 0; id < n; id++) out[id] = frame.paints[id]?.owner;
}

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
  // ---- W74 (D74-4): the text pass ----
  private restUvBuffer: GPUBuffer | null = null;
  /** The text records of the drawn page (binding 5 of the text group). */
  private textInfoBuffer: GPUBuffer | null = null;
  private restUvScratch = new Float32Array(0);
  private textInfoScratch = new Float32Array(0);
  /** Per slot: 1 while its text record is valid (packTextInfo); read by textReady(). */
  private textOk = new Uint8Array(0);
  private textInfoDirty = true;
  private textInfoPaints: RenderFrame["paints"] | null = null;
  private atlasTexture: GPUTexture | null = null;
  private atlasView: GPUTextureView | null = null;
  private atlasWidth = 0;
  private atlasHeight = 0;
  private atlasVersion = Number.NaN;
  /** True once the copy of `atlasVersion` is confirmed by its error scope (W74 review). */
  private atlasOk = false;
  /** W74 review: bumped by every upload, drop and release, so a late error-scope result for an older upload is ignored. */
  private atlasUploadSeq = 0;
  /** W75 amendment B (D75-1): the seq of the upload whose error scope has not resolved yet (0: none). */
  private inFlightSeq = 0;
  // ---- W74 ward-review (I1): the staged page and its text records, swapped in once confirmed ----
  private stagingTexture: GPUTexture | null = null;
  private stagingWidth = 0;
  private stagingHeight = 0;
  /** True while a staged version awaits its error scope (the confirmed page keeps drawing). */
  private staged = false;
  /** The staged page's text records; created at the first staged upload, swapped with textInfoBuffer. */
  private textInfoBackBuffer: GPUBuffer | null = null;
  private pendingInfoScratch = new Float32Array(0);
  private pendingOk = new Uint8Array(0);
  private pendingInfoDirty = true;
  private pendingInfoPaints: RenderFrame["paints"] | null = null;
  /** Per slot: the paint owner each record was packed for (drawn / staged); a reused slot is masked while staged. */
  private textOwners: Array<number | undefined> = [];
  private pendingOwners: Array<number | undefined> = [];
  private readonly swapEncoderDescriptor: GPUCommandEncoderDescriptor = { label: "liquiddom atlas swap" };
  private readonly swapSubmitList: GPUCommandBuffer[] = [];
  private t1: GPUTexture | null = null;
  private t1Weight: GPUTexture | null = null;
  private t1Width = 0;
  private t1Height = 0;
  private textGroup: GPUBindGroup | null = null;
  private textCompositeGroup: GPUBindGroup | null = null;
  private readonly t1Attachment: GPURenderPassColorAttachment = { view: PLACEHOLDER_VIEW, clearValue: CLEAR, loadOp: "clear", storeOp: "store" };
  private readonly t1WeightAttachment: GPURenderPassColorAttachment = { view: PLACEHOLDER_VIEW, clearValue: CLEAR, loadOp: "clear", storeOp: "store" };
  private readonly textPass: GPURenderPassDescriptor = { label: "liquiddom text", colorAttachments: [this.t1Attachment, this.t1WeightAttachment] };

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

  /**
   * W74 review: the device's maxTextureDimension2D (the WebGPU default 8192 before init and after
   * destroy()). The runtime caps the text atlas page at min(ATLAS_MAX_SIZE_PX, this), so a page
   * the device cannot hold is never built.
   */
  get maxTextureDimension(): number {
    return this.maxTextureDim;
  }

  /**
   * @internal W75 amendment B (D75-1, saga dec_b2499bfc): true while an atlas upload (staged or
   * first) awaits its error scope. The runtime builds no new page meanwhile, so at most one upload
   * is in flight and continuous text changes cannot supersede every upload before it confirms.
   * False after a drop, a release, a loss or destroy() (each bumps the upload seq).
   */
  get atlasPending(): boolean {
    return this.inFlightSeq !== 0 && this.inFlightSeq === this.atlasUploadSeq && this.device !== null && !this.lost;
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
    if (this.t1) this.allocateTextTargets(); // W74: T1/T1w follow once they exist
  }

  render(frame: RenderFrame): void {
    const { device, ctx, pipelines } = this;
    if (!device || !ctx || !pipelines || this.lost) return;
    this.fragmentEstimate = estimateSplatFragments(frame, this.t0Scale); // D72-4: logged, never gated
    this.ensureBuffers(frame);
    const { particleBuffer, homeBuffer, restUvBuffer, elementBuffer, viewBuffer, t0View, t0AlphaView } = this;
    const { splatGroup, compositeGroup, restGroup } = this;
    if (!particleBuffer || !homeBuffer || !restUvBuffer || !elementBuffer || !viewBuffer || !t0View || !t0AlphaView) return;
    if (!splatGroup || !compositeGroup || !restGroup) return;
    const queue = device.queue;

    // W74 (D74-4): the text pass decision comes first: F and flags are packed only in a frame that
    // runs it (ward-review M1); the 8-float record layout stays.
    const textMoves = this.prepareText(frame);
    // W74 (D74-4): 8 floats per particle — position, F and flags — for the splat and the text pass.
    const count = packParticles(frame, this.particleScratch, textMoves);
    if (count > 0) queue.writeBuffer(particleBuffer, 0, this.particleScratch, 0, count * PARTICLE_GPU_FLOATS);
    if (
      frame.generation !== this.uploadedGeneration ||
      frame.paints !== this.uploadedPaints ||
      count !== this.uploadedHomeCount
    ) {
      packHomes(frame, this.homeScratch);
      packRestUV(frame, this.restUvScratch); // W74: rest UVs change only with the homes
      if (count > 0) {
        queue.writeBuffer(homeBuffer, 0, this.homeScratch, 0, count);
        queue.writeBuffer(restUvBuffer, 0, this.restUvScratch, 0, count * 2);
      }
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
    // Every write above lands before this frame's submit, so the text pass sees this frame's restAlpha.
    const drawText = textMoves && count > 0;

    const encoder = device.createCommandEncoder(this.encoderDescriptor);
    const splat = encoder.beginRenderPass(this.splatPass);
    if (count > 0) {
      splat.setPipeline(pipelines.splat);
      splat.setBindGroup(0, splatGroup);
      splat.draw(6, count);
    }
    splat.end();
    if (drawText && this.textGroup) {
      // W74 (D74-4): its own pass — T1/T1w are at 1×, and all attachments of a pass share one size.
      const text = encoder.beginRenderPass(this.textPass);
      text.setPipeline(pipelines.text);
      text.setBindGroup(0, this.textGroup);
      text.draw(6, count);
      text.end();
    }
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
    if (drawText && this.textGroup && this.textCompositeGroup) {
      // W74 (D74-4): after the rest SDF, so the text never blinks at the cross-fade.
      screen.setPipeline(pipelines.textComposite);
      screen.setBindGroup(0, this.textCompositeGroup);
      screen.draw(3);
    }
    screen.end();
    this.submitList[0] = encoder.finish();
    queue.submit(this.submitList);
  }

  /**
   * W74 (D74-6): true when render() draws atlas text for slot `id` whenever its restAlpha < 1:
   * the device is alive, the atlas page is uploaded and the slot's text record is valid. The
   * runtime sets `liquid-text` only then.
   */
  textReady(id: number): boolean {
    return (
      this.device !== null &&
      !this.lost &&
      this.atlasOk &&
      Number.isInteger(id) &&
      id >= 0 &&
      id < this.textOk.length &&
      this.textOk[id] === 1
    );
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

  /** Storage buffers sized by the pools (fixed at create()); never smaller than one array element (Review Focus 2). */
  private ensureBuffers(frame: RenderFrame): void {
    const { device, pipelines, viewBuffer } = this;
    if (!device || !pipelines || !viewBuffer) return;
    const cap = Math.max(0, Math.floor(frame.particleCapacity));
    const slots = Math.floor(frame.elementView.length / ELEMENT_STRIDE);
    if (this.particleBuffer && cap === this.bufferCapacity && slots === this.bufferSlots) return;
    this.particleBuffer?.destroy();
    this.homeBuffer?.destroy();
    this.restUvBuffer?.destroy();
    this.elementBuffer?.destroy();
    this.textInfoBuffer?.destroy();
    this.textInfoBackBuffer?.destroy();
    this.textInfoBackBuffer = null;
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const particleBytes = PARTICLE_GPU_FLOATS * 4;
    const textInfoBytes = TEXT_INFO_FLOATS * 4;
    const particleBuffer = device.createBuffer({ label: "liquiddom particles", size: Math.max(particleBytes, cap * particleBytes), usage });
    const homeBuffer = device.createBuffer({ label: "liquiddom homes", size: Math.max(MIN_BUFFER_BYTES, cap * 4), usage });
    const restUvBuffer = device.createBuffer({ label: "liquiddom rest uv", size: Math.max(MIN_BUFFER_BYTES, cap * 8), usage });
    const elementBuffer = device.createBuffer({
      label: "liquiddom elements",
      size: Math.max(ELEMENT_GPU_BYTES, slots * ELEMENT_GPU_BYTES),
      usage,
    });
    const textInfoBuffer = device.createBuffer({ label: "liquiddom text info", size: Math.max(textInfoBytes, slots * textInfoBytes), usage });
    this.particleBuffer = particleBuffer;
    this.homeBuffer = homeBuffer;
    this.restUvBuffer = restUvBuffer;
    this.elementBuffer = elementBuffer;
    this.textInfoBuffer = textInfoBuffer;
    this.particleScratch = new Float32Array(cap * PARTICLE_GPU_FLOATS);
    this.homeScratch = new Int32Array(cap);
    this.restUvScratch = new Float32Array(cap * 2);
    this.elementScratch = new Float32Array(slots * ELEMENT_GPU_FLOATS);
    this.textInfoScratch = new Float32Array(slots * TEXT_INFO_FLOATS);
    this.textOk = new Uint8Array(slots);
    this.pendingInfoScratch = new Float32Array(slots * TEXT_INFO_FLOATS);
    this.pendingOk = new Uint8Array(slots);
    this.pendingInfoDirty = true;
    this.pendingInfoPaints = null;
    this.bufferCapacity = cap;
    this.bufferSlots = slots;
    this.uploadedGeneration = Number.NaN;
    this.uploadedPaints = null;
    this.uploadedHomeCount = -1;
    this.uploadedSlots = 0;
    this.textInfoDirty = true;
    this.textInfoPaints = null;
    this.textGroup = null;
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

  /**
   * W74 (D74-4, D74-5, Review Focus 4): uploads the atlas page once per version, packs the text
   * records when the page or the paints change, and allocates T1/T1w. True when at least one
   * element with a valid text record has restAlpha < 1 this frame (the text pass then runs).
   */
  private prepareText(frame: RenderFrame): boolean {
    const { device, pipelines, sampler, viewBuffer, particleBuffer, homeBuffer, elementBuffer, restUvBuffer, textInfoBuffer } = this;
    if (!device || !pipelines || !sampler || !viewBuffer || !particleBuffer || !homeBuffer || !elementBuffer || !restUvBuffer || !textInfoBuffer) {
      return false;
    }
    const atlas = frame.textAtlas ?? null;
    if (atlas === null) {
      this.dropAtlas();
      return false;
    }
    if (atlas.version !== this.atlasVersion) this.uploadAtlas(device, atlas);
    if (this.staged) {
      // W74 ward-review (I1): the frame's paints carry the staged page's rects. They go into the
      // back records; the drawn records stay with the drawn page and only lose unpainted slots.
      if (this.textInfoDirty) {
        this.textOk.fill(0); // the drawn records were lost with a buffer reallocation
        this.textInfoPaints = frame.paints;
        this.textInfoDirty = false;
      }
      if (this.pendingInfoDirty || frame.paints !== this.pendingInfoPaints) {
        packTextInfo(frame, atlas, this.pendingInfoScratch, this.pendingOk);
        device.queue.writeBuffer(this.ensureBackInfoBuffer(device), 0, this.pendingInfoScratch);
        recordOwners(frame, this.pendingOwners, this.pendingOk.length);
        this.pendingInfoPaints = frame.paints;
        this.pendingInfoDirty = false;
        // A slot that lost its paint, or now holds another element (unobserve + observe, ward
        // review), must not show the drawn page's text: masked and its drawn record zeroed.
        const ok = this.textOk;
        let masked = false;
        for (let id = 0; id < ok.length; id++) {
          if (ok[id] !== 1) continue;
          const p = frame.paints[id];
          if (p !== undefined && p.owner === this.textOwners[id]) continue;
          ok[id] = 0;
          this.textInfoScratch.fill(0, id * TEXT_INFO_FLOATS, (id + 1) * TEXT_INFO_FLOATS);
          masked = true;
        }
        if (masked) device.queue.writeBuffer(textInfoBuffer, 0, this.textInfoScratch);
      }
    } else if (this.textInfoDirty || frame.paints !== this.textInfoPaints) {
      // Packed before the atlasOk check, so textReady() turns true as soon as the upload is confirmed.
      packTextInfo(frame, atlas, this.textInfoScratch, this.textOk);
      device.queue.writeBuffer(textInfoBuffer, 0, this.textInfoScratch);
      recordOwners(frame, this.textOwners, this.textOk.length);
      this.textInfoPaints = frame.paints;
      this.textInfoDirty = false;
    }
    const atlasView = this.atlasView;
    if (!this.atlasOk || !atlasView) return false;
    if (!hasMovingText(frame, this.textOk)) return false;
    this.allocateTextTargets();
    if (!this.textGroup) {
      this.textGroup = device.createBindGroup({
        label: "liquiddom text",
        layout: pipelines.textLayout,
        entries: [
          { binding: 0, resource: { buffer: viewBuffer } },
          { binding: 1, resource: { buffer: particleBuffer } },
          { binding: 2, resource: { buffer: homeBuffer } },
          { binding: 3, resource: { buffer: elementBuffer } },
          { binding: 4, resource: { buffer: restUvBuffer } },
          { binding: 5, resource: { buffer: textInfoBuffer } },
          { binding: 6, resource: atlasView },
          { binding: 7, resource: sampler },
        ],
      });
    }
    return this.textCompositeGroup !== null;
  }

  /**
   * W74 (Review Focus 4): a page larger than maxTextureDimension2D, or a copy that throws (a
   * detached or unusable source), leaves no atlas: textReady turns false and the DOM text stays.
   * A same-size page reuses the texture.
   *
   * W74 review (Review Focus 1): a device-timeline validation error does not throw here, so the
   * copy runs in its own validation scope and a version counts only once `popErrorScope()`
   * resolves without an error; on an error one console.warn is logged (never console.error: a
   * failed atlas is not a failed frame) and the version is not retried.
   *
   * W74 ward-review (I1): with no confirmed page (the first version, or after a drop or a failure)
   * the page is copied into the drawn texture and textReady stays false until it is confirmed.
   * With a confirmed page, it is copied into the staging texture instead: the confirmed page and
   * its records keep drawing (textReady stays true for their slots) until the scope resolves, then
   * swapAtlas() switches both. A failed staged version drops all atlas text (both pages; rare).
   */
  private uploadAtlas(device: GPUDevice, atlas: TextAtlasFrame): void {
    this.atlasVersion = atlas.version;
    const seq = ++this.atlasUploadSeq;
    const { width: w, height: h } = atlas;
    const max = this.maxTextureDim;
    if (!(Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1 && w <= max && h <= max)) {
      this.releaseAtlas();
      return;
    }
    const staged = this.atlasOk && this.atlasTexture !== null;
    let target: GPUTexture;
    if (staged) {
      if (!this.stagingTexture || w !== this.stagingWidth || h !== this.stagingHeight) {
        this.stagingTexture?.destroy();
        this.stagingTexture = device.createTexture({
          label: "liquiddom atlas staging",
          size: [w, h],
          format: ATLAS_FORMAT,
          usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.stagingWidth = w;
        this.stagingHeight = h;
      }
      target = this.stagingTexture;
      this.staged = true;
      this.pendingInfoDirty = true;
    } else {
      this.atlasOk = false;
      this.releaseStaging();
      target = this.ensureAtlasTexture(device, w, h);
      this.textInfoDirty = true;
    }
    device.pushErrorScope("validation");
    try {
      device.queue.copyExternalImageToTexture({ source: atlas.canvas }, { texture: target, premultipliedAlpha: true }, [w, h]);
    } catch {
      this.releaseAtlas(); // Review Focus 1: no atlas text; the runtime keeps the DOM text
    }
    this.inFlightSeq = seq;
    const confirm = (ok: boolean, why: string): void => {
      // superseded, dropped, destroyed or lost
      if (seq !== this.atlasUploadSeq || this.device !== device || this.lost) return;
      this.inFlightSeq = 0;
      if (!ok) {
        console.warn(`liquiddom: text atlas upload failed (${why}); the DOM text stays`);
        this.releaseAtlas();
        return;
      }
      if (staged) this.swapAtlas(device);
      else this.atlasOk = true;
    };
    device.popErrorScope().then(
      (err) => confirm(err === null, err?.message ?? ""),
      (reason: unknown) => confirm(false, String(reason)),
    );
  }

  /** The drawn atlas texture at w × h (a same-size texture is reused); the text group follows a new one. */
  private ensureAtlasTexture(device: GPUDevice, w: number, h: number): GPUTexture {
    if (this.atlasTexture && w === this.atlasWidth && h === this.atlasHeight) return this.atlasTexture;
    this.atlasTexture?.destroy();
    const texture = device.createTexture({
      label: "liquiddom atlas",
      size: [w, h],
      format: ATLAS_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.atlasTexture = texture;
    this.atlasView = texture.createView();
    this.atlasWidth = w;
    this.atlasHeight = h;
    this.textGroup = null;
    return texture;
  }

  /** W74 ward-review (I1): the staged page's text records live here until the swap; created on first use. */
  private ensureBackInfoBuffer(device: GPUDevice): GPUBuffer {
    if (this.textInfoBackBuffer) return this.textInfoBackBuffer;
    const bytes = TEXT_INFO_FLOATS * 4;
    this.textInfoBackBuffer = device.createBuffer({
      label: "liquiddom text info",
      size: Math.max(bytes, this.pendingOk.length * bytes),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    return this.textInfoBackBuffer;
  }

  /**
   * W74 ward-review (I1): the staged version is confirmed. One submit copies the staging page into
   * the drawn texture (reallocated when the size changed); the staged records become the drawn
   * ones and the text group is rebuilt. Both take effect from the next frame on, together.
   */
  private swapAtlas(device: GPUDevice): void {
    const staging = this.stagingTexture;
    const back = this.textInfoBackBuffer;
    if (!this.staged || !staging || !back) {
      this.releaseAtlas();
      return;
    }
    const w = this.stagingWidth;
    const h = this.stagingHeight;
    const front = this.ensureAtlasTexture(device, w, h);
    const encoder = device.createCommandEncoder(this.swapEncoderDescriptor);
    encoder.copyTextureToTexture({ texture: staging }, { texture: front }, [w, h]);
    this.swapSubmitList[0] = encoder.finish();
    device.queue.submit(this.swapSubmitList);
    this.textInfoBackBuffer = this.textInfoBuffer;
    this.textInfoBuffer = back;
    const scratch = this.textInfoScratch;
    this.textInfoScratch = this.pendingInfoScratch;
    this.pendingInfoScratch = scratch;
    const ok = this.textOk;
    this.textOk = this.pendingOk;
    this.pendingOk = ok;
    const owners = this.textOwners;
    this.textOwners = this.pendingOwners;
    this.pendingOwners = owners;
    this.textInfoPaints = this.pendingInfoPaints;
    this.textInfoDirty = false;
    this.pendingInfoDirty = true;
    this.pendingInfoPaints = null;
    this.staged = false;
    this.textGroup = null;
  }

  /** W74: no atlas this frame (Canvas2D never gets here; WebGPU without OffscreenCanvas or after an atlas failure). */
  private dropAtlas(): void {
    this.atlasVersion = Number.NaN;
    if (this.atlasTexture === null && this.stagingTexture === null && !this.atlasOk) return;
    this.releaseAtlas();
  }

  /** No atlas text: both pages are released and every pending upload is ignored (the version is kept: no retry). */
  private releaseAtlas(): void {
    this.atlasTexture?.destroy();
    this.atlasTexture = null;
    this.atlasView = null;
    this.atlasWidth = 0;
    this.atlasHeight = 0;
    this.releaseStaging();
    this.atlasOk = false;
    this.atlasUploadSeq += 1;
    this.textOk.fill(0);
    this.textGroup = null;
  }

  private releaseStaging(): void {
    this.stagingTexture?.destroy();
    this.stagingTexture = null;
    this.stagingWidth = 0;
    this.stagingHeight = 0;
    this.staged = false;
    this.pendingInfoDirty = true;
    this.pendingInfoPaints = null;
  }

  /** W74 (D74-4): T1 and T1w at 1× the backing size, clamped to maxTextureDimension2D; the text composite group follows them. */
  private allocateTextTargets(): void {
    const { device, pipelines, sampler, viewBuffer } = this;
    if (!device || !pipelines || !sampler || !viewBuffer) return;
    const max = this.maxTextureDim;
    const w = Math.min(max, this.widthPx);
    const h = Math.min(max, this.heightPx);
    if (this.t1 && w === this.t1Width && h === this.t1Height) return;
    this.t1?.destroy();
    this.t1Weight?.destroy();
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    this.t1 = device.createTexture({ label: "liquiddom T1", size: [w, h], format: T1_FORMAT, usage });
    this.t1Weight = device.createTexture({ label: "liquiddom T1w", size: [w, h], format: T1_WEIGHT_FORMAT, usage });
    const t1View = this.t1.createView();
    const t1WeightView = this.t1Weight.createView();
    this.t1Attachment.view = t1View;
    this.t1WeightAttachment.view = t1WeightView;
    this.t1Width = w;
    this.t1Height = h;
    this.textCompositeGroup = device.createBindGroup({
      label: "liquiddom text composite",
      layout: pipelines.textCompositeLayout,
      entries: [
        { binding: 0, resource: { buffer: viewBuffer } },
        { binding: 1, resource: t1View },
        { binding: 2, resource: t1WeightView },
        { binding: 3, resource: sampler },
      ],
    });
  }

  private releaseGpuObjects(): void {
    this.t0?.destroy();
    this.t0Alpha?.destroy();
    this.particleBuffer?.destroy();
    this.homeBuffer?.destroy();
    this.elementBuffer?.destroy();
    this.restUvBuffer?.destroy();
    this.textInfoBuffer?.destroy();
    this.textInfoBackBuffer?.destroy();
    this.atlasTexture?.destroy();
    this.stagingTexture?.destroy();
    this.t1?.destroy();
    this.t1Weight?.destroy();
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
    this.restUvBuffer = null;
    this.textInfoBuffer = null;
    this.restUvScratch = new Float32Array(0);
    this.textInfoScratch = new Float32Array(0);
    this.textOk = new Uint8Array(0);
    this.textInfoDirty = true;
    this.textInfoPaints = null;
    this.atlasTexture = null;
    this.atlasView = null;
    this.atlasWidth = 0;
    this.atlasHeight = 0;
    this.atlasVersion = Number.NaN;
    this.atlasOk = false;
    this.atlasUploadSeq += 1;
    this.textInfoBackBuffer = null;
    this.stagingTexture = null;
    this.stagingWidth = 0;
    this.stagingHeight = 0;
    this.staged = false;
    this.pendingInfoScratch = new Float32Array(0);
    this.pendingOk = new Uint8Array(0);
    this.pendingInfoDirty = true;
    this.pendingInfoPaints = null;
    this.textOwners = [];
    this.pendingOwners = [];
    this.swapSubmitList.length = 0;
    this.t1 = null;
    this.t1Weight = null;
    this.t1Width = 0;
    this.t1Height = 0;
    this.textGroup = null;
    this.textCompositeGroup = null;
    this.t1Attachment.view = PLACEHOLDER_VIEW;
    this.t1WeightAttachment.view = PLACEHOLDER_VIEW;
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
