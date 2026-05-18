/**
 * @vitest-environment jsdom
 *
 * Ward 040 — Background Refraction Sampling (red-phase tests, 10 total).
 *
 * Strategy: extends W39's mock harness to capture refraction-specific surface:
 * createBindGroupLayout descriptor entries (verify 5 entries), createTexture,
 * queue.copyExternalImageToTexture, queue.writeTexture, createSampler, and a
 * counted bindGroup-rebuild signal across setBackgroundTexture calls.
 *
 * Anchoring (mirroring W39's discipline): pipeline identity via DRAW ARITY,
 * not pipeline tag — draw(6,1,...) = fusion full-screen quad; draw(6,N,...) =
 * AABB per-entity quad. Uniform writes filter on byteLength === 80; flags.z
 * lives at byte offset 72 (mat4=64 + flags.x=4 + flags.y=4).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebGPURenderer } from "../src/renderers/webgpu-renderer";
import { LiquidDOM } from "../src/index";
import { FLOATS_PER_ENTITY, PARTICLES_PER_BODY } from "../src/renderers/renderer";
import type { RenderFrame, RenderFrameViewport } from "../src/renderers/renderer";

// ── Polyfills (jsdom is missing WebGPU enums + ResizeObserver) ─────
if (typeof globalThis.GPUBufferUsage === "undefined") {
  (globalThis as unknown as { GPUBufferUsage: Record<string, number> }).GPUBufferUsage = {
    MAP_READ: 0x0001, MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004, COPY_DST: 0x0008,
    INDEX: 0x0010, VERTEX: 0x0020,
    UNIFORM: 0x0040, STORAGE: 0x0080,
    INDIRECT: 0x0100, QUERY_RESOLVE: 0x0200,
  };
}
if (typeof globalThis.GPUShaderStage === "undefined") {
  (globalThis as unknown as { GPUShaderStage: Record<string, number> }).GPUShaderStage = {
    VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4,
  };
}
if (typeof globalThis.GPUTextureUsage === "undefined") {
  (globalThis as unknown as { GPUTextureUsage: Record<string, number> }).GPUTextureUsage = {
    COPY_SRC: 0x01, COPY_DST: 0x02,
    TEXTURE_BINDING: 0x04, STORAGE_BINDING: 0x08,
    RENDER_ATTACHMENT: 0x10,
  };
}
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// ── navigator.gpu install/restore helpers ────────────────────────────
let savedGpu: PropertyDescriptor | undefined;
let savedCaptured = false;

function setNavigatorGpu(value: unknown): void {
  if (!savedCaptured) {
    savedGpu = Object.getOwnPropertyDescriptor(navigator, "gpu");
    savedCaptured = true;
  }
  Object.defineProperty(navigator, "gpu", { value, configurable: true, writable: true });
}

function restoreNavigatorGpu(): void {
  if (!savedCaptured) return;
  if (savedGpu) Object.defineProperty(navigator, "gpu", savedGpu);
  else delete (navigator as { gpu?: unknown }).gpu;
  savedCaptured = false;
  savedGpu = undefined;
}

interface MockTexture {
  tag: string;
  size: [number, number, number];
  format: string;
  usage: number;
  destroyed: boolean;
  destroy: () => void;
}

interface DeviceLog {
  bindGroupLayoutDescriptors: Array<{ entries: Array<{ binding: number; visibility: number; texture?: unknown; sampler?: unknown; buffer?: unknown }> }>;
  pipelinesCreated: Array<{ tag: string; layoutArg: unknown }>;
  bindGroupsCreated: Array<{ tag: string }>;
  pipelineLayoutCalls: number;
  setPipelineCalls: Array<{ tag: string }>;
  setBindGroupCalls: Array<{ tag: string }>;
  drawCalls: Array<[number, number, number, number]>;
  writeBuffer: Array<{ bufferTag: string; offset: number; sourceCopy: ArrayBuffer; byteLength: number }>;
  texturesCreated: MockTexture[];
  copyExternalImageCalls: Array<{ source: unknown; destination: unknown; size: unknown }>;
  writeTextureCalls: Array<{ destination: unknown; size: unknown }>;
  samplersCreated: number;
}

function makeDeviceMock(log: DeviceLog): unknown {
  let bufferCounter = 0;
  let pipelineCounter = 0;
  let bindGroupCounter = 0;
  let textureCounter = 0;
  return {
    destroy() {},
    lost: new Promise(() => {}),
    queue: {
      writeBuffer(
        buffer: { tag?: string },
        offset: number,
        source: ArrayBuffer | ArrayBufferView,
        srcOffset?: number,
        size?: number,
      ): void {
        let sourceBuf: ArrayBuffer;
        let sourceByteOffset = 0;
        let sourceByteLength: number;
        if (source instanceof ArrayBuffer) {
          sourceBuf = source;
          sourceByteLength = size ?? source.byteLength;
          sourceByteOffset = srcOffset ?? 0;
        } else {
          sourceBuf = source.buffer as ArrayBuffer;
          sourceByteOffset = source.byteOffset + (srcOffset ?? 0);
          sourceByteLength = size ?? source.byteLength;
        }
        const copy = sourceBuf.slice(sourceByteOffset, sourceByteOffset + sourceByteLength);
        log.writeBuffer.push({
          bufferTag: buffer.tag ?? "unknown",
          offset,
          sourceCopy: copy,
          byteLength: sourceByteLength,
        });
      },
      writeTexture(destination: unknown, _data: unknown, _layout: unknown, size: unknown): void {
        log.writeTextureCalls.push({ destination, size });
      },
      copyExternalImageToTexture(source: unknown, destination: unknown, size: unknown): void {
        log.copyExternalImageCalls.push({ source, destination, size });
      },
      submit() {},
      onSubmittedWorkDone: () => Promise.resolve(),
    },
    createBuffer: () => ({ tag: `buf${bufferCounter++}`, destroy() {} }),
    createBindGroup: () => {
      const bg = { tag: `bg${bindGroupCounter++}` };
      log.bindGroupsCreated.push(bg);
      return bg;
    },
    createShaderModule: () => ({}),
    createRenderPipeline: (desc: { layout?: unknown }) => {
      const p = { tag: `pipeline${pipelineCounter++}`, layoutArg: desc.layout, getBindGroupLayout: () => ({}) };
      log.pipelinesCreated.push(p);
      return p;
    },
    createBindGroupLayout: (desc: { entries: Array<{ binding: number; visibility: number; texture?: unknown; sampler?: unknown; buffer?: unknown }> }) => {
      log.bindGroupLayoutDescriptors.push({ entries: desc.entries });
      return {};
    },
    createPipelineLayout: () => {
      log.pipelineLayoutCalls++;
      return {};
    },
    createTexture: (desc: { size: number[]; format: string; usage: number }) => {
      const tag = `tex${textureCounter++}`;
      const size: [number, number, number] = [desc.size[0], desc.size[1], desc.size[2] ?? 1];
      const tex: MockTexture = {
        tag,
        size,
        format: desc.format,
        usage: desc.usage,
        destroyed: false,
        destroy() { this.destroyed = true; },
      };
      log.texturesCreated.push(tex);
      return Object.assign(tex, { createView: () => ({}) });
    },
    createSampler: () => {
      log.samplersCreated++;
      return {};
    },
    createCommandEncoder: () => ({
      beginRenderPass: () => ({
        setPipeline(p: { tag?: string }) { log.setPipelineCalls.push({ tag: p.tag ?? "unknown" }); },
        setBindGroup(_idx: number, bg: { tag?: string }) { log.setBindGroupCalls.push({ tag: bg.tag ?? "unknown" }); },
        draw(vc: number, ic: number, fv = 0, fi = 0) { log.drawCalls.push([vc, ic, fv, fi]); },
        end() {},
      }),
      finish: () => ({}),
    }),
    pushErrorScope() {},
    popErrorScope: () => Promise.resolve(null),
  };
}

function makeGpu(log: DeviceLog): unknown {
  return {
    getPreferredCanvasFormat: () => "bgra8unorm",
    requestAdapter: async () => ({ requestDevice: async () => makeDeviceMock(log) }),
  };
}

function makeCanvasWithWebGpuCtx(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1728;
  canvas.height = 826;
  const ctx = { configure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) };
  canvas.getContext = ((type: string) => (type === "webgpu" ? ctx : null)) as HTMLCanvasElement["getContext"];
  return canvas;
}

function defaultTheme(extra: Partial<RenderFrame["theme"]> = {}): RenderFrame["theme"] {
  return {
    colorDefault: "rgba(15, 52, 96, 0.75)",
    colorHover: "rgba(233, 69, 96, 0.85)",
    themeCache: new Map(),
    shadowCache: new Map(),
    ...extra,
  };
}

// `reducedMotion` not yet on the W36 `RenderFrame` interface; the `as RenderFrame`
// cast is intentional red-phase scaffolding — W40 gold adds it as required (Spec §1).
function makeFrame(overrides: Partial<RenderFrame> & { reducedMotion?: boolean } = {}): RenderFrame {
  const vp: RenderFrameViewport = {
    widthCss: 1728, heightCss: 826, dpr: 1, cullMargin: 100, preserveBackgrounds: false,
  };
  const entities = new Float32Array(4 * FLOATS_PER_ENTITY);
  entities[0] = 50; entities[1] = 60; entities[2] = 100; entities[3] = 100;
  return {
    entities,
    particles: new Float32Array(4 * PARTICLES_PER_BODY * 2),
    capacity: 4,
    softBodyIds: [0],
    dropletIds: [],
    viewport: vp,
    theme: defaultTheme(),
    reducedMotion: false,
    ...overrides,
  } as RenderFrame;
}

function freshLog(): DeviceLog {
  return {
    bindGroupLayoutDescriptors: [],
    pipelinesCreated: [], bindGroupsCreated: [],
    pipelineLayoutCalls: 0,
    setPipelineCalls: [], setBindGroupCalls: [],
    drawCalls: [], writeBuffer: [],
    texturesCreated: [],
    copyExternalImageCalls: [], writeTextureCalls: [],
    samplersCreated: 0,
  };
}

// Minimal ImageBitmap stand-in (jsdom does not provide ImageBitmap).
function makeFakeBitmap(width = 256, height = 256): ImageBitmap {
  return { width, height, close() {} } as unknown as ImageBitmap;
}

// Byte offsets in the 80-byte global uniform:
//   bytes 0..63 = mat4x4 projection
//   bytes 64..67 = flags.x (preserveBackgrounds)
//   bytes 68..71 = flags.y (fusionRadius)
//   bytes 72..75 = flags.z (refractionStrength) — W40
//   bytes 76..79 = flags.w (reserved)
const FLAGS_Y_BYTE_OFFSET = 68;
const FLAGS_Z_BYTE_OFFSET = 72;

describe("Ward 040: Background Refraction Sampling", () => {
  let log: DeviceLog;

  beforeEach(() => {
    log = freshLog();
    setNavigatorGpu(makeGpu(log));
  });

  afterEach(() => {
    restoreNavigatorGpu();
  });

  // ── T1: bind_group_layout has 5 entries (W39's 3 + texture + sampler) ──
  it("bind_group_layout_has_five_entries", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());

    // Exactly one BGL created in init (W39 invariant: shared layout).
    expect(log.bindGroupLayoutDescriptors.length).toBe(1);
    const entries = log.bindGroupLayoutDescriptors[0].entries;
    expect(entries.length).toBe(5);

    // W39 bindings preserved: 0 = uniform buffer.
    const uniform = entries.find((e) => e.binding === 0);
    expect(uniform).toBeDefined();
    expect(uniform!.buffer).toBeDefined();

    // Binding 3 = texture (fragment visibility).
    const tex = entries.find((e) => e.binding === 3);
    expect(tex).toBeDefined();
    expect(tex!.texture).toBeDefined();
    expect(tex!.visibility & 0x2).toBeTruthy(); // FRAGMENT

    // Binding 4 = sampler (fragment visibility).
    const samp = entries.find((e) => e.binding === 4);
    expect(samp).toBeDefined();
    expect(samp!.sampler).toBeDefined();
    expect(samp!.visibility & 0x2).toBeTruthy(); // FRAGMENT

    renderer.destroy();
  });

  // ── T2: setBackgroundTexture creates texture + rebuilds bind group ──
  it("set_background_texture_creates_gpu_texture_and_rebuilds_bind_group", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());
    // Spec §4: bind group is built on first render's capacity-change branch.
    // To assert "rebuild" semantics on setBackgroundTexture, prime a render
    // first so an initial bind group exists.
    renderer.render(makeFrame());

    const bgBefore = log.bindGroupsCreated.length;
    const texBefore = log.texturesCreated.length;

    const bitmap = makeFakeBitmap(320, 240);
    renderer.setBackgroundTexture(bitmap);

    // One new texture created with bitmap dimensions.
    expect(log.texturesCreated.length).toBe(texBefore + 1);
    const created = log.texturesCreated[log.texturesCreated.length - 1];
    expect(created.size).toEqual([320, 240, 1]);

    // copyExternalImageToTexture called exactly once with correct wrapper + size.
    expect(log.copyExternalImageCalls.length).toBe(1);
    expect((log.copyExternalImageCalls[0].source as { source: ImageBitmap }).source).toBe(bitmap);
    expect(log.copyExternalImageCalls[0].size).toEqual([320, 240, 1]);

    // BindGroup rebuilt → at least one NEW bindGroup beyond pre-call count.
    expect(log.bindGroupsCreated.length).toBeGreaterThan(bgBefore);

    renderer.destroy();
  });

  // ── T3: setBackgroundTexture(null) releases prior + recreates dummy ──
  it("set_background_texture_null_releases_prior_and_recreates_dummy", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());

    const userBitmap = makeFakeBitmap(128, 128);
    renderer.setBackgroundTexture(userBitmap);
    const userTex = log.texturesCreated[log.texturesCreated.length - 1];
    expect(userTex.destroyed).toBe(false);

    const texCountBeforeNull = log.texturesCreated.length;
    renderer.setBackgroundTexture(null);

    // Prior user-supplied texture destroyed.
    expect(userTex.destroyed).toBe(true);

    // Dummy recreated → at least one new texture (1×1 white rgba8unorm) + writeTexture call.
    expect(log.texturesCreated.length).toBeGreaterThan(texCountBeforeNull);
    const newDummy = log.texturesCreated[log.texturesCreated.length - 1];
    expect(newDummy.size).toEqual([1, 1, 1]);
    expect(newDummy.format).toBe("rgba8unorm");
    // Dummy is initialized via writeTexture (vs copyExternalImageToTexture).
    expect(log.writeTextureCalls.length).toBeGreaterThan(0);

    renderer.destroy();
  });

  // ── T4: flags.z carries strength when refraction active ─────────────
  it("flags_z_carries_strength_when_active", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());
    renderer.setBackgroundTexture(makeFakeBitmap());

    renderer.render(makeFrame({
      theme: defaultTheme({ refraction: { enabled: true, strength: 8 } }),
      reducedMotion: false,
    }));

    const projWrites = log.writeBuffer.filter((w) => w.byteLength === 80);
    const last = projWrites[projWrites.length - 1];
    const flagZ = new Float32Array(last.sourceCopy, FLAGS_Z_BYTE_OFFSET, 1)[0];
    expect(flagZ).toBe(8);

    renderer.destroy();
  });

  // ── T5: flags.z = 0 when no user texture (silent disable) ───────────
  it("flags_z_zero_when_no_user_texture", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());
    // NO setBackgroundTexture call → hasUserTexture stays false.

    renderer.render(makeFrame({
      theme: defaultTheme({ refraction: { enabled: true, strength: 8 } }),
      reducedMotion: false,
    }));

    const projWrites = log.writeBuffer.filter((w) => w.byteLength === 80);
    const last = projWrites[projWrites.length - 1];
    const flagZ = new Float32Array(last.sourceCopy, FLAGS_Z_BYTE_OFFSET, 1)[0];
    expect(flagZ).toBe(0);

    renderer.destroy();
  });

  // ── T6: flags.z = 0 under reduced motion (even with enabled + texture) ──
  it("flags_z_zero_under_reduced_motion", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());
    renderer.setBackgroundTexture(makeFakeBitmap());

    renderer.render(makeFrame({
      theme: defaultTheme({ refraction: { enabled: true, strength: 8 } }),
      reducedMotion: true,
    }));

    const projWrites = log.writeBuffer.filter((w) => w.byteLength === 80);
    const last = projWrites[projWrites.length - 1];
    const flagZ = new Float32Array(last.sourceCopy, FLAGS_Z_BYTE_OFFSET, 1)[0];
    expect(flagZ).toBe(0);

    renderer.destroy();
  });

  // ── T7a: CPU clamp NaN → 0 (renderer-level adversarial-input test) ──
  // Mirrors W39 T6 pattern: pass adversarial theme values DIRECTLY to the
  // renderer.render() and inspect the projection-buffer write. The renderer's
  // own clamp logic (Spec §6) is defense-in-depth alongside index.ts's
  // instance-layer clamp (Spec §5). Both clamps converge on flags.z === 0.
  it("cpu_clamp_strength_nan", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());
    renderer.setBackgroundTexture(makeFakeBitmap());

    renderer.render(makeFrame({
      theme: defaultTheme({ refraction: { enabled: true, strength: NaN } }),
      reducedMotion: false,
    }));

    const projWrites = log.writeBuffer.filter((w) => w.byteLength === 80);
    const last = projWrites[projWrites.length - 1];
    const flagZ = new Float32Array(last.sourceCopy, FLAGS_Z_BYTE_OFFSET, 1)[0];
    expect(flagZ).toBe(0);

    renderer.destroy();
  });

  // ── T7b: CPU clamp negative → 0 ─────────────────────────────────────
  it("cpu_clamp_strength_negative", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());
    renderer.setBackgroundTexture(makeFakeBitmap());

    renderer.render(makeFrame({
      theme: defaultTheme({ refraction: { enabled: true, strength: -10 } }),
      reducedMotion: false,
    }));

    const projWrites = log.writeBuffer.filter((w) => w.byteLength === 80);
    const last = projWrites[projWrites.length - 1];
    const flagZ = new Float32Array(last.sourceCopy, FLAGS_Z_BYTE_OFFSET, 1)[0];
    expect(flagZ).toBe(0);

    renderer.destroy();
  });

  // ── T8: setBackgroundTexture is idempotent (post-destroy + null-noop) ──
  it("set_background_texture_after_destroy_is_silent", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());
    renderer.destroy();

    // Post-destroy call must not throw and must not invoke GPU API.
    const texCountBefore = log.texturesCreated.length;
    expect(() => renderer.setBackgroundTexture(makeFakeBitmap())).not.toThrow();
    expect(log.texturesCreated.length).toBe(texCountBefore);

    // null-noop idempotency: fresh renderer, no prior user texture, null → no-op.
    // Mid-test re-install of navigator.gpu is safe because savedCaptured guards
    // the first capture in setNavigatorGpu; afterEach still restores the
    // pre-test descriptor captured by beforeEach's initial setNavigatorGpu.
    const log2 = freshLog();
    setNavigatorGpu(makeGpu(log2));
    const renderer2 = new WebGPURenderer();
    await renderer2.init(makeCanvasWithWebGpuCtx());
    const beforeNullDestroyCount = log2.texturesCreated.filter((t) => t.destroyed).length;
    renderer2.setBackgroundTexture(null);
    // No texture destroyed (no user texture to destroy).
    const afterNullDestroyCount = log2.texturesCreated.filter((t) => t.destroyed).length;
    expect(afterNullDestroyCount).toBe(beforeNullDestroyCount);
    renderer2.destroy();
  });

  // ── T9: refraction auto-promotes to fusion pipeline at fusionRadius=0 ──
  it("refraction_auto_promotes_to_fusion_pipeline", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());
    renderer.setBackgroundTexture(makeFakeBitmap());

    renderer.render(makeFrame({
      capacity: 4,
      theme: defaultTheme({
        fusionRadius: 0,
        refraction: { enabled: true, strength: 8 },
      }),
      reducedMotion: false,
    }));

    // Fusion pipeline used → single-instance full-screen quad draw.
    expect(log.drawCalls).toEqual([[6, 1, 0, 0]]);

    // flags.y (fusionRadius) is 0 — proves no fusionRadius was inflated.
    const projWrites = log.writeBuffer.filter((w) => w.byteLength === 80);
    const last = projWrites[projWrites.length - 1];
    const flagY = new Float32Array(last.sourceCopy, FLAGS_Y_BYTE_OFFSET, 1)[0];
    expect(flagY).toBe(0);

    renderer.destroy();
  });

  // ── T10: capacity-overflow refraction warn fires once; fusion-warn priority ──
  it("refraction_capacity_overflow_warns_once", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());
    renderer.setBackgroundTexture(makeFakeBitmap());

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Refraction-only over capacity (fusionRadius=0): refraction warn fires once.
    const frame128Ref = makeFrame({
      entities: new Float32Array(128 * FLOATS_PER_ENTITY),
      particles: new Float32Array(128 * PARTICLES_PER_BODY * 2),
      capacity: 128,
      softBodyIds: [],
      theme: defaultTheme({
        fusionRadius: 0,
        refraction: { enabled: true, strength: 8 },
      }),
    });
    renderer.render(frame128Ref);
    expect(warn).toHaveBeenCalledTimes(1);
    // First warn is refraction-only (fusionRadius=0 so no fusion in message).
    expect(warn.mock.calls[0][0]).toMatch(/refraction/i);
    expect(warn.mock.calls[0][0]).not.toMatch(/fusionRadius/i);

    // Second render with same condition → no re-warn.
    renderer.render(frame128Ref);
    expect(warn).toHaveBeenCalledTimes(1);

    // Now ALSO request fusion at over-capacity: fusion-warn fires (NOT refraction-warn again).
    const frame128Both = makeFrame({
      entities: new Float32Array(128 * FLOATS_PER_ENTITY),
      particles: new Float32Array(128 * PARTICLES_PER_BODY * 2),
      capacity: 128,
      softBodyIds: [],
      theme: defaultTheme({
        fusionRadius: 30,
        refraction: { enabled: true, strength: 8 },
      }),
    });
    renderer.render(frame128Both);
    expect(warn).toHaveBeenCalledTimes(2);
    // Second warn is fusion-specific (the more general feature; refraction priority is suppressed).
    expect(warn.mock.calls[1][0]).toMatch(/fusionRadius/i);

    renderer.destroy();
    warn.mockRestore();
  });
});

// Smoke-import — keeps LiquidDOM reachable for T7a/T7b.
void LiquidDOM;
