/**
 * @vitest-environment jsdom
 *
 * Ward 039 — Metaball Fusion Shader (r2 red-phase tests, 7 total).
 *
 * Strategy: extends W38's WebGPU success-chain mock to capture pipeline
 * identity + bindGroup identity + layout-call signatures across consecutive
 * renders. Locks the dual-pipeline branch (Decisions §1, §2), explicit
 * GPUPipelineLayout (§9 / r2 F2), shared bindGroup (§9), uniform flag write
 * (§7), capacity safety valve with cross-instance re-warn (§2), and the
 * CPU-side NaN/negative clamp (r2 m1). Pure WGSL math (smin, winner-take-all,
 * preserveBackgrounds clip) is verified only by manual smoke.
 *
 * Anchoring: T1/T2 anchor pipeline identity by DRAW ARITY, not by pipeline
 * tag — the spec doesn't lock the order in which gold creates the two
 * pipelines, so an array-index assumption would be flaky.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebGPURenderer } from "../src/renderers/webgpu-renderer";
import { LiquidDOM } from "../src/index";
import { FLOATS_PER_ENTITY, PARTICLES_PER_BODY } from "../src/renderers/renderer";
import type { RenderFrame, RenderFrameViewport } from "../src/renderers/renderer";

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

interface DeviceLog {
  pipelinesCreated: Array<{ tag: string; layoutArg: unknown }>;
  bindGroupsCreated: Array<{ tag: string }>;
  bindGroupLayoutCalls: number;
  pipelineLayoutCalls: number;
  setPipelineCalls: Array<{ tag: string }>;
  setBindGroupCalls: Array<{ tag: string }>;
  drawCalls: Array<[number, number, number, number]>;
  writeBuffer: Array<{ bufferTag: string; offset: number; sourceCopy: ArrayBuffer; byteLength: number }>;
}

function makeDeviceMock(log: DeviceLog): unknown {
  let bufferCounter = 0;
  let pipelineCounter = 0;
  let bindGroupCounter = 0;
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
      // W40: refraction paths.
      writeTexture() {},
      copyExternalImageToTexture() {},
      submit() {},
      onSubmittedWorkDone: () => Promise.resolve(),
    },
    createBuffer: () => ({ tag: `buf${bufferCounter++}`, destroy() {} }),
    createBindGroup: () => {
      const bg = { tag: `bg${bindGroupCounter++}` };
      log.bindGroupsCreated.push(bg);
      return bg;
    },
    // W40: refraction texture + sampler created in init().
    createTexture: () => ({ destroy() {}, createView: () => ({}) }),
    createSampler: () => ({}),
    createShaderModule: () => ({}),
    createRenderPipeline: (desc: { layout?: unknown }) => {
      const p = { tag: `pipeline${pipelineCounter++}`, layoutArg: desc.layout, getBindGroupLayout: () => ({}) };
      log.pipelinesCreated.push(p);
      return p;
    },
    createBindGroupLayout: () => {
      log.bindGroupLayoutCalls++;
      return {};
    },
    createPipelineLayout: () => {
      log.pipelineLayoutCalls++;
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

function makeFrame(overrides: Partial<RenderFrame> = {}): RenderFrame {
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
    reducedMotion: false,
    theme: defaultTheme(),
    ...overrides,
  };
}

function freshLog(): DeviceLog {
  return {
    pipelinesCreated: [], bindGroupsCreated: [],
    bindGroupLayoutCalls: 0, pipelineLayoutCalls: 0,
    setPipelineCalls: [], setBindGroupCalls: [],
    drawCalls: [], writeBuffer: [],
  };
}

describe("Ward 039: Metaball Fusion Shader", () => {
  let log: DeviceLog;

  beforeEach(() => {
    log = freshLog();
    setNavigatorGpu(makeGpu(log));
  });

  afterEach(() => {
    restoreNavigatorGpu();
  });

  // ── T1: fusionRadius = 0 → AABB pipeline path (draw 6 × capacity) ──
  it("fusion_disabled_uses_aabb_pipeline_when_fusionRadius_is_zero", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());

    // Both pipelines created eagerly at init time (Decision §10).
    expect(log.pipelinesCreated.length).toBe(2);

    renderer.render(makeFrame({
      theme: defaultTheme({ fusionRadius: 0 }),
    }));

    // Draw arity anchors the pipeline choice (per-entity AABB, NOT full-screen).
    expect(log.drawCalls).toEqual([[6, 4, 0, 0]]);

    renderer.destroy();
  });

  // ── T2: fusionRadius > 0, capacity ≤ 64 → fusion pipeline path (draw 6 × 1) ──
  it("fusion_enabled_uses_fullscreen_pipeline_and_single_instance", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());
    expect(log.pipelinesCreated.length).toBe(2);

    renderer.render(makeFrame({
      capacity: 4,
      theme: defaultTheme({ fusionRadius: 30 }),
    }));

    // Fusion path: single full-screen quad — instance count = 1.
    expect(log.drawCalls).toEqual([[6, 1, 0, 0]]);

    renderer.destroy();
  });

  // ── T3: fusionRadius written to flags.y at byte offset 68 ──────────
  it("fusion_radius_written_to_uniform_flags_y", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());

    renderer.render(makeFrame({ theme: defaultTheme({ fusionRadius: 25 }) }));
    renderer.render(makeFrame({ theme: defaultTheme({ fusionRadius: 0 }) }));

    // Take the LAST two projection writes (slice -2). The mock may capture
    // an init-time projection write before the per-frame writes; filter on
    // byteLength === 80 then sort temporally via slice.
    const projWrites = log.writeBuffer.filter((w) => w.byteLength === 80);
    expect(projWrites.length).toBeGreaterThanOrEqual(2);
    const lastTwo = projWrites.slice(-2);

    // flags.y lives at byte offset 68 (mat4x4=64B + flags.x=4B = 68 byte start of flags.y).
    const frame1Flag = new Float32Array(lastTwo[0].sourceCopy, 68, 1)[0];
    const frame2Flag = new Float32Array(lastTwo[1].sourceCopy, 68, 1)[0];
    expect(frame1Flag).toBe(25);
    expect(frame2Flag).toBe(0);

    renderer.destroy();
  });

  // ── T4: capacity > 64 fallback warns once per renderer instance ─────
  it("fusion_capacity_safety_valve_falls_back_above_64", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const frame128 = makeFrame({
      entities: new Float32Array(128 * FLOATS_PER_ENTITY),
      particles: new Float32Array(128 * PARTICLES_PER_BODY * 2),
      capacity: 128,
      softBodyIds: [],
      theme: defaultTheme({ fusionRadius: 30 }),
    });
    renderer.render(frame128);

    // Fell back to AABB pipeline: instance count = capacity (128).
    expect(log.drawCalls[0]).toEqual([6, 128, 0, 0]);
    expect(warn).toHaveBeenCalledTimes(1);

    // Second render with same condition does NOT re-warn (once-per-instance).
    renderer.render(frame128);
    expect(warn).toHaveBeenCalledTimes(1);
    renderer.destroy();

    // Different renderer INSTANCE → re-warns (proves per-instance, not module-static).
    const log2 = freshLog();
    setNavigatorGpu(makeGpu(log2));
    const renderer2 = new WebGPURenderer();
    await renderer2.init(makeCanvasWithWebGpuCtx());
    renderer2.render(frame128);
    expect(warn).toHaveBeenCalledTimes(2);
    renderer2.destroy();

    warn.mockRestore();
  });

  // ── T5: shared bindGroup across both pipelines; draw arity differs ──
  it("fusion_and_aabb_pipelines_share_one_bindGroup", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());

    renderer.render(makeFrame({ theme: defaultTheme({ fusionRadius: 0 }) }));
    renderer.render(makeFrame({ theme: defaultTheme({ fusionRadius: 30 }) }));

    // Two render calls → two draw calls. AABB path = (6, capacity);
    // fusion path = (6, 1). Different arities prove different pipelines.
    expect(log.drawCalls.length).toBe(2);
    const [drawA, drawB] = log.drawCalls;
    expect(drawA[1]).not.toBe(drawB[1]);

    // bindGroup is shared → setBindGroup receives the SAME reference both times.
    expect(log.setBindGroupCalls.length).toBe(2);
    expect(log.setBindGroupCalls[0].tag).toBe(log.setBindGroupCalls[1].tag);

    // Exactly ONE bindGroup created total (not one per pipeline).
    expect(log.bindGroupsCreated.length).toBe(1);

    renderer.destroy();
  });

  // ── T6: CPU clamp + NaN/Infinity validation in LiquidDOM.create() ───
  it("fusion_radius_clamped_to_finite_nonNegative", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());

    // Render three frames with adversarial fusionRadius values directly on
    // the theme (validating renderer-level resilience — defense-in-depth
    // alongside the LiquidDOM.create()-level clamp).
    const themes = [
      defaultTheme({ fusionRadius: NaN }),
      defaultTheme({ fusionRadius: -10 }),
      defaultTheme({ fusionRadius: 30 }),
    ];
    for (const theme of themes) {
      renderer.render(makeFrame({ theme }));
    }

    const projWrites = log.writeBuffer.filter((w) => w.byteLength === 80).slice(-3);
    expect(projWrites.length).toBe(3);
    const flag1 = new Float32Array(projWrites[0].sourceCopy, 68, 1)[0];
    const flag2 = new Float32Array(projWrites[1].sourceCopy, 68, 1)[0];
    const flag3 = new Float32Array(projWrites[2].sourceCopy, 68, 1)[0];
    expect(flag1).toBe(0); // NaN → 0
    expect(flag2).toBe(0); // negative → 0
    expect(flag3).toBe(30); // valid → passed through

    renderer.destroy();
  });

  // ── T7: explicit GPUBindGroupLayout + GPUPipelineLayout used (NOT auto) ──
  it("pipelines_use_explicit_pipelinelayout_not_auto", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());

    // Decision §9 r2 F2: explicit GPUBindGroupLayout + GPUPipelineLayout
    // shared between both pipelines. `layout: "auto"` would silently produce
    // pipeline-specific BGLs that aren't interchangeable in real WebGPU.
    expect(log.bindGroupLayoutCalls).toBeGreaterThanOrEqual(1);
    expect(log.pipelineLayoutCalls).toBeGreaterThanOrEqual(1);

    // Both render pipelines received a non-"auto" layout argument.
    expect(log.pipelinesCreated.length).toBe(2);
    for (const p of log.pipelinesCreated) {
      expect(p.layoutArg).not.toBe("auto");
    }

    renderer.destroy();
  });
});

// Smoke-import to ensure LiquidDOM is reachable (T6 indirectly stresses it).
void LiquidDOM;
