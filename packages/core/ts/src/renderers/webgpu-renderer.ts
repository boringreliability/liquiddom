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
import { BLOB_SDF_WGSL } from "./shaders/blob-sdf.wgsl";
import { FUSION_SDF_WGSL } from "./shaders/fusion-sdf.wgsl";

const PARTICLE_FLOATS_PER_BODY = PARTICLES_PER_BODY * 2;
// W38 Decision §6: EntityGPU = 4 × vec4 = 64 bytes (color + aabb + clipRect + params).
const FLOATS_PER_ENTITY_GPU = 16;
const BYTES_PER_ENTITY_GPU = FLOATS_PER_ENTITY_GPU * 4; // 64 bytes
// W38 Decision §1: one AABB-quad per entity = 6 vertices (2 triangles).
// W39 Decision §1: fusion pipeline ALSO emits 6 vertices but with instance
// count = 1 (single full-screen quad).
const VERTICES_PER_ENTITY = 6;
// W38 Decision §10b: global uniform = mat4x4 (64B) + flags vec4 (16B) = 80B.
const GLOBAL_UNIFORM_FLOATS = 20;
const GLOBAL_UNIFORM_BYTES = GLOBAL_UNIFORM_FLOATS * 4;
// W39 Decision §2: fusion-pipeline capacity safety valve. Above this,
// fragment shader's MAX_ENTITIES = 64 loop would scale per-fragment cost
// dangerously; fall back to AABB pipeline (no fusion) + once-per-session warn.
const FUSION_MAX_CAPACITY = 64;

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
  // W39 Decision §1: two pipelines coexist. aabbPipeline is the W38 default
  // (per-entity AABB quad); fusionPipeline activates when fusionRadius > 0.
  private aabbPipeline: GPURenderPipeline | null = null;
  private fusionPipeline: GPURenderPipeline | null = null;
  // W39 Decision §9 / r2 F2: explicit bind-group + pipeline layouts so both
  // pipelines accept the same bindGroup.
  private bindGroupLayout: GPUBindGroupLayout | null = null;
  private particleBuffer: GPUBuffer | null = null;
  private entityBuffer: GPUBuffer | null = null;
  private projectionBuffer: GPUBuffer | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private sRgbFormat: GPUTextureFormat | null = null;
  private capacity = 0;
  // W38: 20 floats = mat4x4 projection + flags vec4. Decision §10/§10b.
  private readonly projMatrix = new Float32Array(GLOBAL_UNIFORM_FLOATS);
  private entityScratch: Float32Array | null = null;
  // W39 Decision §2: once-per-instance warn when capacity > 64 forces a
  // fusion-disabled fallback. Per-instance (NOT module-static) so each new
  // WebGPURenderer gets a fresh notification.
  private warnedFusionCapacityFallback = false;
  // W40: refraction state. `refractionTexture` is unconditionally bound
  // (1×1 white dummy until host calls setBackgroundTexture).
  // `warnedRefractionCapacityFallback` is the refraction-only sibling of the
  // fusion warn flag (per Spec §7 dual-warn priority).
  private refractionTexture: GPUTexture | null = null;
  private refractionSampler: GPUSampler | null = null;
  private hasUserTexture = false;
  private warnedRefractionCapacityFallback = false;

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

      // W39 Decision §9 / r2 F2: explicit bind-group + pipeline layout shared
      // between BOTH pipelines. `layout: "auto"` would produce pipeline-specific
      // BGLs that aren't interchangeable, breaking cross-pipeline bindGroup
      // sharing. W40 extends the BGL 3 → 5 entries (texture + sampler for
      // refraction). The AABB shader does not reference bindings 3/4 —
      // WebGPU permits bind groups to carry resources unused by the pipeline.
      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "uniform" },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: { type: "read-only-storage" },
          },
          {
            binding: 3,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: "float", viewDimension: "2d" },
          },
          {
            binding: 4,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: "filtering" },
          },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

      // Path E: shader compile or pipeline validation fails. Wrap BOTH pipeline
      // creations in one validation error scope so a typo in either shader
      // surfaces as the cause of WebGPUUnavailableError.
      device.pushErrorScope("validation");
      const aabbShader = device.createShaderModule({ code: BLOB_SDF_WGSL });
      const aabbPipeline = device.createRenderPipeline({
        label: "aabb-pipeline",
        layout: pipelineLayout,
        vertex: { module: aabbShader, entryPoint: "vs_main" },
        fragment: {
          module: aabbShader,
          entryPoint: "fs_main",
          targets: [{ format: sRgbFormat, blend: { color: PREMUL_BLEND, alpha: PREMUL_BLEND } }],
        },
        primitive: { topology: "triangle-list" },
      });
      // W39: second pipeline using FUSION_SDF_WGSL. Same bind-group layout,
      // same blend state, same primitive topology — only the shader code differs.
      const fusionShader = device.createShaderModule({ code: FUSION_SDF_WGSL });
      const fusionPipeline = device.createRenderPipeline({
        label: "fusion-pipeline",
        layout: pipelineLayout,
        vertex: { module: fusionShader, entryPoint: "vs_main" },
        fragment: {
          module: fusionShader,
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

      // W38: global uniform = mat4x4 + flags vec4 = 80 bytes. Updated each frame.
      const projectionBuffer = device.createBuffer({
        size: GLOBAL_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      // W40: dummy 1×1 white refraction texture + linear-clamp sampler.
      // Bound unconditionally; shader gates sampling on flags.z (Spec §3).
      const refractionTexture = device.createTexture({
        size: [1, 1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      device.queue.writeTexture(
        { texture: refractionTexture },
        new Uint8Array([255, 255, 255, 255]),
        { bytesPerRow: 4 },
        [1, 1, 1],
      );
      const refractionSampler = device.createSampler({
        minFilter: "linear",
        magFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
      });

      // All init steps succeeded — commit state. Attaching `device.lost` AFTER
      // commit prevents spurious post-destroy warnings on path-D/E failures
      // (the device is destroyed in the catch below, but its lost-promise
      // resolves later; without this gate it would fire console.warn after the
      // consumer's catch handler already cleaned up).
      this.device = device;
      this.ctx = ctx;
      this.aabbPipeline = aabbPipeline;
      this.fusionPipeline = fusionPipeline;
      this.bindGroupLayout = bindGroupLayout;
      this.projectionBuffer = projectionBuffer;
      this.refractionTexture = refractionTexture;
      this.refractionSampler = refractionSampler;
      this.sRgbFormat = sRgbFormat;
      const ownedDevice = device;
      device.lost.then((info) => {
        if (this.device !== ownedDevice) return; // already destroyed locally
        console.warn(`[liquiddom] WebGPU device lost: ${info.message}`);
        // W40: invalidate refraction state on device loss. Texture handle is
        // no longer usable; setBackgroundTexture must be a no-op until re-init.
        this.refractionTexture = null;
        this.hasUserTexture = false;
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
    const aabbPipeline = this.aabbPipeline;
    const fusionPipeline = this.fusionPipeline;
    const bindGroupLayout = this.bindGroupLayout;
    const projBuf = this.projectionBuffer;
    const sRgbFormat = this.sRgbFormat;
    const refractionTex = this.refractionTexture;
    const refractionSamp = this.refractionSampler;
    if (
      !device || !ctx || !aabbPipeline || !fusionPipeline ||
      !bindGroupLayout || !projBuf || !sRgbFormat ||
      !refractionTex || !refractionSamp
    ) return;
    if (!frame.particles) return; // Decision §13: mock-mode no-op
    // (W38: preserveBackgrounds is now supported via SDF discard — the W37
    // once-per-session warn has been removed.)

    // W39 Decision §1 + §2 / W40 Decision §6: pick pipeline. Fusion path
    // activates when EITHER fusionRadius > 0 OR refraction is requested with a
    // texture. Capacity > 64 disables fusion + warns (per-instance, once).
    const rawFusion = frame.theme.fusionRadius ?? 0;
    const wantsFusion = rawFusion > 0;
    const wantsRefraction = frame.theme.refraction?.enabled === true;
    const needsFusionPipeline = wantsFusion || (wantsRefraction && this.hasUserTexture);
    const useFusion = needsFusionPipeline && frame.capacity <= FUSION_MAX_CAPACITY;
    if (needsFusionPipeline && !useFusion) {
      // W40 Spec §7 dual-warn priority: fusion-warn wins when both requested;
      // refraction-only warn fires only when refraction was the SOLE reason
      // fusion pipeline was needed (wantsFusion === false).
      if (wantsFusion && !this.warnedFusionCapacityFallback) {
        console.warn(
          `[liquiddom] fusionRadius set but capacity (${frame.capacity}) > ${FUSION_MAX_CAPACITY}. Fusion disabled — falling back to per-entity AABB pipeline.`,
        );
        this.warnedFusionCapacityFallback = true;
      } else if (!wantsFusion && wantsRefraction && this.hasUserTexture && !this.warnedRefractionCapacityFallback) {
        console.warn(
          `[liquiddom] theme.refraction.enabled set but capacity (${frame.capacity}) > ${FUSION_MAX_CAPACITY}. Refraction disabled — falling back to per-entity AABB pipeline.`,
        );
        this.warnedRefractionCapacityFallback = true;
      }
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
      // W40: capacity-change BGL rebuild must include bindings 3+4
      // (texture + sampler). Otherwise post-resize the rebuilt 3-entry
      // bind group would be rejected against the 5-entry layout.
      this.bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: projBuf } },
          { binding: 1, resource: { buffer: this.particleBuffer } },
          { binding: 2, resource: { buffer: this.entityBuffer } },
          { binding: 3, resource: refractionTex.createView() },
          { binding: 4, resource: refractionSamp },
        ],
      });
    }

    // Update projection matrix from viewport CSS px → clip space [-1, 1].
    this.updateProjectionMatrix(frame.viewport.widthCss, frame.viewport.heightCss);
    // W38 Decision §10: pack flags vec4 after the mat4x4. Slot 16 carries the
    // preserveBackgroundsActive flag.
    // W39 Decision §7 + r2 m1: fusionRadius lives at slot 17 (= flags.y).
    // Clamp NaN/negative to 0 — defense-in-depth alongside LiquidDOM.create()'s
    // CPU clamp.
    const fusionRadiusForFlag = useFusion && Number.isFinite(rawFusion)
      ? Math.max(0, rawFusion)
      : 0;
    // W40 Decision §6: flags.z carries effective refraction strength.
    // refractionActive requires: wantsRefraction AND hasUserTexture AND
    // !reducedMotion AND useFusion (refraction lives in the fusion shader).
    const refractionActive = wantsRefraction
      && this.hasUserTexture
      && !frame.reducedMotion
      && useFusion;
    const rawStrength = frame.theme.refraction?.strength;
    const refractionStrength = refractionActive && rawStrength !== undefined && Number.isFinite(rawStrength)
      ? Math.max(0, rawStrength)
      : 0;
    this.projMatrix[16] = frame.viewport.preserveBackgrounds ? 1.0 : 0.0;
    this.projMatrix[17] = fusionRadiusForFlag;
    this.projMatrix[18] = refractionStrength;
    this.projMatrix[19] = 0; // reserved
    device.queue.writeBuffer(
      projBuf, 0,
      this.projMatrix.buffer, this.projMatrix.byteOffset, GLOBAL_UNIFORM_BYTES,
    );

    // Upload particle data verbatim.
    device.queue.writeBuffer(
      this.particleBuffer!, 0,
      frame.particles.buffer, frame.particles.byteOffset, frame.particles.byteLength,
    );

    // Pack per-entity (color + AABB + clipRect + params) into scratch.
    // Each entity occupies FLOATS_PER_ENTITY_GPU = 16 floats = 64 bytes.
    // Layout: [r·a, g·a, b·a, a, minX, minY, maxX, maxY, clipX, clipY, clipW, clipH, softness, clipBorderRadius, 0, 0]
    const colorDefault = parseColor(frame.theme.colorDefault);
    const colorHover = parseColor(frame.theme.colorHover);
    const scratch = this.entityScratch!;
    scratch.fill(0);

    for (const id of frame.softBodyIds) {
      const off = id * FLOATS_PER_ENTITY;
      const w = frame.entities[off + 2];
      const h = frame.entities[off + 3];
      if (w === 0) continue;
      const lt = Math.round(frame.entities[off + 5]);
      if (lt === 6) continue; // FreeDrop leaker (W56 defense-in-depth)

      // Compute particle AABB.
      const pBase = id * PARTICLE_FLOATS_PER_BODY;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < PARTICLES_PER_BODY; i++) {
        const px = frame.particles[pBase + i * 2];
        const py = frame.particles[pBase + i * 2 + 1];
        if (px < minX) minX = px;
        if (py < minY) minY = py;
        if (px > maxX) maxX = px;
        if (py > maxY) maxY = py;
      }
      // Decision §4: softness derived from element diagonal, clamped [2, 8].
      const softness = Math.max(2, Math.min(8, Math.sqrt(w * w + h * h) * 0.01));
      minX -= softness; minY -= softness;
      maxX += softness; maxY += softness;

      // Decision §6 / R3: clamp border-radius to min(w, h) / 2.
      const rawRadius = frame.entities[off + 8];
      const clipBorderRadius = Math.min(rawRadius, Math.min(w, h) / 2);

      const isHover = frame.entities[off + 4] === 1.0;
      const color = isHover ? colorHover : colorDefault;
      const sOff = id * FLOATS_PER_ENTITY_GPU;
      scratch[sOff +  0] = color[0];
      scratch[sOff +  1] = color[1];
      scratch[sOff +  2] = color[2];
      scratch[sOff +  3] = color[3];
      scratch[sOff +  4] = minX;
      scratch[sOff +  5] = minY;
      scratch[sOff +  6] = maxX;
      scratch[sOff +  7] = maxY;
      scratch[sOff +  8] = frame.entities[off + 0]; // clipRect.x
      scratch[sOff +  9] = frame.entities[off + 1]; // clipRect.y
      scratch[sOff + 10] = w;                       // clipRect.w
      scratch[sOff + 11] = h;                       // clipRect.h
      scratch[sOff + 12] = softness;
      scratch[sOff + 13] = clipBorderRadius;
      // sOff+14, +15 are padding (already zero from fill).
    }

    for (const id of frame.dropletIds) {
      const off = id * FLOATS_PER_ENTITY;
      const diameter = frame.entities[off + 2];
      if (diameter === 0) continue;
      const cx = frame.entities[off + 0];
      const cy = frame.entities[off + 1];
      const r = diameter * 0.5;
      const softness = Math.max(2, Math.min(8, diameter * 0.05));
      const sOff = id * FLOATS_PER_ENTITY_GPU;
      scratch[sOff +  0] = colorDefault[0];
      scratch[sOff +  1] = colorDefault[1];
      scratch[sOff +  2] = colorDefault[2];
      scratch[sOff +  3] = colorDefault[3];
      scratch[sOff +  4] = cx - r - softness;
      scratch[sOff +  5] = cy - r - softness;
      scratch[sOff +  6] = cx + r + softness;
      scratch[sOff +  7] = cy + r + softness;
      // Droplets don't clip — clipRect.zw = 0 makes the shader skip clip pass.
      scratch[sOff +  8] = 0;
      scratch[sOff +  9] = 0;
      scratch[sOff + 10] = 0;
      scratch[sOff + 11] = 0;
      scratch[sOff + 12] = softness;
      scratch[sOff + 13] = 0;
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
    // W39 Decision §1: dual-pipeline dispatch. Fusion path = single full-screen
    // quad (instance count 1). AABB path = one quad per entity (× capacity).
    pass.setPipeline(useFusion ? fusionPipeline : aabbPipeline);
    pass.setBindGroup(0, this.bindGroup!);
    pass.draw(VERTICES_PER_ENTITY, useFusion ? 1 : frame.capacity, 0, 0);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  /**
   * Ward 040: hand a host-supplied background snapshot for refractive sampling.
   * Two guards open the method:
   *   1. `!this.device` → post-destroy / device-lost: silent no-op.
   *   2. `bitmap === null && !hasUserTexture` → already-dummy: silent no-op
   *      (idempotency parity with W14's destroy/observe pattern).
   * Otherwise: destroy prior texture, create new GPU texture (or recreate the
   * 1×1 white dummy), upload, recreate the bind group.
   */
  setBackgroundTexture(bitmap: ImageBitmap | null): void {
    const device = this.device;
    if (!device) return;
    if (bitmap === null && !this.hasUserTexture) return;

    const prev = this.refractionTexture;
    let nextTex: GPUTexture;
    if (bitmap !== null) {
      nextTex = device.createTexture({
        size: [bitmap.width, bitmap.height, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      device.queue.copyExternalImageToTexture(
        { source: bitmap },
        { texture: nextTex },
        [bitmap.width, bitmap.height, 1],
      );
    } else {
      // Recreate the 1×1 white dummy — matches init §3 exactly so the binding
      // is valid + uniform across the bitmap/null transitions.
      nextTex = device.createTexture({
        size: [1, 1, 1],
        format: "rgba8unorm",
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
      });
      device.queue.writeTexture(
        { texture: nextTex },
        new Uint8Array([255, 255, 255, 255]),
        { bytesPerRow: 4 },
        [1, 1, 1],
      );
    }
    prev?.destroy();
    this.refractionTexture = nextTex;
    this.hasUserTexture = bitmap !== null;
    this.rebuildBindGroup();
  }

  /** W40: rebuild bind group after refraction texture swap. */
  private rebuildBindGroup(): void {
    const device = this.device;
    const bindGroupLayout = this.bindGroupLayout;
    const projBuf = this.projectionBuffer;
    const partBuf = this.particleBuffer;
    const entBuf = this.entityBuffer;
    const tex = this.refractionTexture;
    const samp = this.refractionSampler;
    if (!device || !bindGroupLayout || !projBuf || !partBuf || !entBuf || !tex || !samp) {
      // Pre-first-render path: capacity-change branch in render() will build
      // the bind group with the current refractionTexture reference.
      return;
    }
    this.bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: projBuf } },
        { binding: 1, resource: { buffer: partBuf } },
        { binding: 2, resource: { buffer: entBuf } },
        { binding: 3, resource: tex.createView() },
        { binding: 4, resource: samp },
      ],
    });
  }

  destroy(): void {
    this.refractionTexture?.destroy();
    this.particleBuffer?.destroy();
    this.entityBuffer?.destroy();
    this.projectionBuffer?.destroy();
    this.device?.destroy();
    this.canvas = null;
    this.ctx = null;
    this.device = null;
    this.aabbPipeline = null;
    this.fusionPipeline = null;
    this.bindGroupLayout = null;
    this.particleBuffer = null;
    this.entityBuffer = null;
    this.projectionBuffer = null;
    this.bindGroup = null;
    this.sRgbFormat = null;
    this.capacity = 0;
    this.entityScratch = null;
    this.warnedFusionCapacityFallback = false;
    this.refractionTexture = null;
    this.refractionSampler = null;
    this.hasUserTexture = false;
    this.warnedRefractionCapacityFallback = false;
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
