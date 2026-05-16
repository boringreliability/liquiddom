/**
 * @vitest-environment jsdom
 *
 * Ward 038 — SDF Blob Fragment Shader (r2 red-phase tests).
 *
 * Strategy: mock the full WebGPU success chain so `WebGPURenderer.render()`
 * runs end-to-end against an instrumented device. Each test captures the GPU
 * calls relevant to its assertion (draw arity, buffer sizes, writeBuffer
 * payloads) and locks the W38-specified behavior.
 *
 * jsdom does NOT provide navigator.gpu — tests inject a stub via
 * `Object.defineProperty(navigator, "gpu", ...)`. All 7 W37 error-path tests
 * (`webgpu-renderer.test.ts`) continue to cover the failure modes; W38 tests
 * only exercise the success path.
 *
 * After W37: 7 tests in webgpu-renderer.test.ts.
 * After W38: 7 + 4 = 11 tests across two files (this + W37's).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebGPURenderer } from "../src/renderers/webgpu-renderer";
import { FLOATS_PER_ENTITY, PARTICLES_PER_BODY } from "../src/renderers/renderer";
import type { RenderFrame, RenderFrameViewport } from "../src/renderers/renderer";
import { ZERO_MARGIN } from "../src/box-shadow";

// jsdom doesn't define the GPUBufferUsage enum (it's a real-WebGPU global).
// Polyfill the bit constants that WebGPURenderer.init() references via the
// bitwise OR in `device.createBuffer({ usage: ... })`.
if (typeof globalThis.GPUBufferUsage === "undefined") {
  (globalThis as unknown as { GPUBufferUsage: Record<string, number> }).GPUBufferUsage = {
    MAP_READ: 0x0001,
    MAP_WRITE: 0x0002,
    COPY_SRC: 0x0004,
    COPY_DST: 0x0008,
    INDEX: 0x0010,
    VERTEX: 0x0020,
    UNIFORM: 0x0040,
    STORAGE: 0x0080,
    INDIRECT: 0x0100,
    QUERY_RESOLVE: 0x0200,
  };
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

/**
 * Captured GPU call log: every call WebGPURenderer makes against the device
 * mock lands here so tests can assert against it.
 */
interface DeviceLog {
  /** sizes passed to device.createBuffer({ size }) */
  createBufferSizes: number[];
  /** captured writeBuffer args: each entry is { buffer, offset, source-snapshot, byteLength } */
  writeBuffer: Array<{
    bufferTag: string;
    offset: number;
    sourceCopy: ArrayBuffer;
    byteLength: number;
  }>;
  /** pass.draw arguments: [vertexCount, instanceCount, firstVertex, firstInstance] */
  drawCalls: Array<[number, number, number, number]>;
}

function makeDeviceMock(log: DeviceLog): unknown {
  // Tag each GPUBuffer mock with an incrementing label so writeBuffer captures
  // can later identify which buffer was written.
  let bufferCounter = 0;
  const makeBuffer = () => {
    const tag = `buf${bufferCounter++}`;
    return { tag, destroy() {} };
  };

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
        // Snapshot the source bytes so subsequent mutations don't corrupt the log.
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
      submit() {},
      onSubmittedWorkDone: () => Promise.resolve(),
    },
    createBuffer(desc: { size: number }): unknown {
      log.createBufferSizes.push(desc.size);
      return makeBuffer();
    },
    createBindGroup: () => ({}),
    createShaderModule: () => ({}),
    createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({
        setPipeline() {},
        setBindGroup() {},
        draw(vc: number, ic: number, fv = 0, fi = 0) {
          log.drawCalls.push([vc, ic, fv, fi]);
        },
        end() {},
      }),
      finish: () => ({}),
    }),
    pushErrorScope() {},
    popErrorScope: () => Promise.resolve(null),
  };
}

function makeGpu(deviceLog: DeviceLog): unknown {
  return {
    getPreferredCanvasFormat: () => "bgra8unorm",
    requestAdapter: async () => ({ requestDevice: async () => makeDeviceMock(deviceLog) }),
  };
}

function makeCanvasWithWebGpuCtx(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1728;
  canvas.height = 826;
  const ctx = {
    configure() {},
    getCurrentTexture: () => ({ createView: () => ({}) }),
  };
  canvas.getContext = ((type: string) => (type === "webgpu" ? ctx : null)) as HTMLCanvasElement["getContext"];
  return canvas;
}

function makeFrame(overrides: Partial<RenderFrame> = {}): RenderFrame {
  const vp: RenderFrameViewport = {
    widthCss: 1728,
    heightCss: 826,
    dpr: 1,
    cullMargin: 100,
    preserveBackgrounds: false,
  };
  return {
    entities: new Float32Array(4 * FLOATS_PER_ENTITY),
    particles: new Float32Array(4 * PARTICLES_PER_BODY * 2),
    capacity: 4,
    softBodyIds: [0],
    dropletIds: [],
    viewport: vp,
    theme: {
      colorDefault: "rgba(15, 52, 96, 0.75)",
      colorHover: "rgba(233, 69, 96, 0.85)",
      themeCache: new Map(),
      shadowCache: new Map(),
    },
    ...overrides,
  };
}

describe("Ward 038: SDF Blob Fragment Shader", () => {
  let log: DeviceLog;

  beforeEach(() => {
    log = { createBufferSizes: [], writeBuffer: [], drawCalls: [] };
    setNavigatorGpu(makeGpu(log));
  });

  afterEach(() => {
    restoreNavigatorGpu();
  });

  // ── T1: draw call uses 6 vertices per instance (AABB quad), not 48 ─────
  it("webgpu_sdf_pipeline_uses_aabb_quad_draw_call", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());

    const entities = new Float32Array(4 * FLOATS_PER_ENTITY);
    // Slot 0: 100x100 soft-body at (50, 60), active.
    entities[0] = 50; entities[1] = 60; entities[2] = 100; entities[3] = 100;
    const frame = makeFrame({ entities });
    renderer.render(frame);

    expect(log.drawCalls.length).toBeGreaterThan(0);
    const lastDraw = log.drawCalls[log.drawCalls.length - 1];
    // W38 Decision §1: vertexCount = 6 (one AABB quad, two triangles). W37 was 48.
    expect(lastDraw[0]).toBe(6);
    // instanceCount = frame.capacity (per W37 §2 / unchanged in W38).
    expect(lastDraw[1]).toBe(frame.capacity);

    renderer.destroy();
  });

  // ── T2: entityBuffer is sized for 64 bytes per entity (4 × vec4) ───────
  it("webgpu_sdf_entityGpu_layout_is_64_bytes_per_entity", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());

    const frame = makeFrame();
    renderer.render(frame);

    // Find the entityBuffer allocation. We allocate 3 buffers in lazy block:
    //   particleBuffer = capacity * 16 * 2 * 4 = 512 bytes for capacity 4
    //   entityBuffer   = capacity * 64        = 256 bytes for capacity 4  (W38: was 128 in W37)
    //   projectionBuffer = 80 bytes (W38: was 64 in W37)
    // The 256 byte size identifies the entityBuffer.
    expect(log.createBufferSizes).toContain(frame.capacity * 64);
    // Defense-in-depth: NOT the W37 32-byte layout.
    expect(log.createBufferSizes).not.toContain(frame.capacity * 32);

    renderer.destroy();
  });

  // ── T3: AABB packed from particle min/max + softness margin ────────────
  it("webgpu_sdf_aabb_packed_correctly_from_particles", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());

    // Slot 0: rect (50, 60, 100, 100). Particles span [100..200] × [50..150].
    const entities = new Float32Array(4 * FLOATS_PER_ENTITY);
    entities[0] = 50; entities[1] = 60; entities[2] = 100; entities[3] = 100;
    const particles = new Float32Array(4 * PARTICLES_PER_BODY * 2);
    const pBase = 0;
    // 16 perimeter particles spanning the exact bounds [100..200, 50..150].
    // First 4 at corners, others interpolated along edges.
    const corners: Array<[number, number]> = [
      [100, 50], [200, 50], [200, 150], [100, 150],
    ];
    for (let i = 0; i < PARTICLES_PER_BODY; i++) {
      const c = corners[i % 4];
      particles[pBase + i * 2] = c[0];
      particles[pBase + i * 2 + 1] = c[1];
    }
    const frame = makeFrame({ entities, particles });
    renderer.render(frame);

    // Decode the entityBuffer's first 8 floats (color rgba + aabb minXY maxXY).
    // entityBuffer is whichever writeBuffer write has byteLength = 4 × 64 = 256.
    const entityWrite = log.writeBuffer.find((w) => w.byteLength === 256);
    expect(entityWrite).toBeDefined();
    const view = new Float32Array(entityWrite!.sourceCopy);
    // Slot 0 starts at offset 0. color = view[0..4]. aabb = view[4..8].
    const minX = view[4];
    const minY = view[5];
    const maxX = view[6];
    const maxY = view[7];

    // Expected softness from Decision §4: max(2, min(8, sqrt(w*w + h*h) * 0.01)).
    // Re-derive so the test fails loudly if the spec formula changes.
    const expectedSoftness = Math.max(2, Math.min(8, Math.sqrt(100 * 100 + 100 * 100) * 0.01));
    expect(minX).toBeCloseTo(100 - expectedSoftness, 3);
    expect(minY).toBeCloseTo(50 - expectedSoftness, 3);
    expect(maxX).toBeCloseTo(200 + expectedSoftness, 3);
    expect(maxY).toBeCloseTo(150 + expectedSoftness, 3);

    renderer.destroy();
  });

  // ── T4: preserveBackgrounds flag packed into the uniform buffer ────────
  it("webgpu_sdf_uniform_includes_preserveBackgrounds_flag", async () => {
    const renderer = new WebGPURenderer();
    await renderer.init(makeCanvasWithWebGpuCtx());

    const entities = new Float32Array(4 * FLOATS_PER_ENTITY);
    entities[0] = 50; entities[1] = 60; entities[2] = 100; entities[3] = 100;
    // Frame with preserveBackgrounds: false.
    renderer.render(makeFrame({ entities }));
    // Frame with preserveBackgrounds: true.
    renderer.render(makeFrame({
      entities,
      viewport: {
        widthCss: 1728, heightCss: 826, dpr: 1, cullMargin: 100,
        preserveBackgrounds: true,
      },
    }));

    // The projection buffer is identified by byteLength = 80 (W38 Decision §10b
    // vs. W37's 64). At least one write per frame goes to it.
    const projWrites = log.writeBuffer.filter((w) => w.byteLength === 80);
    expect(projWrites.length).toBeGreaterThanOrEqual(2); // one per frame

    // Decode the flag float at byte offset 64 (the float32 immediately after
    // the 16-float mat4x4). Use new Float32Array(buffer, 64, 1)[0] per r2 F8.
    const flagFrame1 = new Float32Array(projWrites[0].sourceCopy, 64, 1)[0];
    const flagFrame2 = new Float32Array(projWrites[1].sourceCopy, 64, 1)[0];
    expect(flagFrame1).toBe(0);
    expect(flagFrame2).toBe(1);

    renderer.destroy();
  });
});

// ZERO_MARGIN is imported for type-completeness in case tests need it later;
// reference it once to avoid unused-import warnings.
void ZERO_MARGIN;
