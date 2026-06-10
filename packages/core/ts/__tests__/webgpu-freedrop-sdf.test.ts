/**
 * @vitest-environment jsdom
 *
 * Ward 062 — WebGPU FreeDrop SDF dispatch branch.
 *
 * Tests #1-#3: pure shader-source string assertions (no WebGPU execution).
 *   These lock the WGSL dispatch contract — that the new `sdCircle` helper
 *   exists, that `blob-sdf.wgsl` calls BOTH SDFs and reads `params.z`, and
 *   that `fusion-sdf.wgsl` factors an `entitySdf()` helper used in BOTH
 *   `fs_main` and `combinedSdf` so the dispatch can't be added to one
 *   site and forgotten in the other.
 *
 * Tests #4-#5: runtime entity-buffer packing via the W37/W38-style mock
 *   device. Captures `device.queue.writeBuffer` calls and decodes the
 *   `EntityGPU` scratch to verify `params.z` carries the kind discriminator
 *   and that the droplet AABB is square.
 *
 * Test #6: parity contract — both renderers must agree that a FreeDrop
 *   with diameter D has geometric radius D/2. Locks the math without
 *   coupling to Canvas2D's normal (Bezier-spline) render path.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebGPURenderer } from "../src/renderers/webgpu-renderer";
import { FLOATS_PER_ENTITY, PARTICLES_PER_BODY } from "../src/renderers/renderer";
import type { RenderFrame, RenderFrameViewport } from "../src/renderers/renderer";
import { BLOB_SDF_WGSL } from "../src/renderers/shaders/blob-sdf.wgsl";
import { FUSION_SDF_WGSL } from "../src/renderers/shaders/fusion-sdf.wgsl";
import { SDF_HELPERS_WGSL } from "../src/renderers/shaders/sdf-helpers.wgsl";

// ── jsdom WebGPU-enum polyfills (copied from W37/W38 pattern) ───────────
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

// ── navigator.gpu swap utilities (W37/W38 pattern) ──────────────────────
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

// ── Device mock with writeBuffer capture (W38 pattern) ──────────────────
interface DeviceLog {
  createBufferSizes: number[];
  writeBuffer: Array<{
    bufferTag: string;
    offset: number;
    sourceCopy: ArrayBuffer;
    byteLength: number;
  }>;
}

function makeDeviceMock(log: DeviceLog): unknown {
  let bufferCounter = 0;
  const makeBuffer = () => ({ tag: `buf${bufferCounter++}`, destroy() {} });
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
        log.writeBuffer.push({
          bufferTag: buffer.tag ?? "unknown",
          offset,
          sourceCopy: sourceBuf.slice(sourceByteOffset, sourceByteOffset + sourceByteLength),
          byteLength: sourceByteLength,
        });
      },
      writeTexture() {},
      copyExternalImageToTexture() {},
      submit() {},
      onSubmittedWorkDone: () => Promise.resolve(),
    },
    createBuffer(desc: { size: number }): unknown {
      log.createBufferSizes.push(desc.size);
      return makeBuffer();
    },
    createBindGroup: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createTexture: () => ({ destroy() {}, createView: () => ({}) }),
    createSampler: () => ({}),
    createShaderModule: () => ({}),
    createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
    createCommandEncoder: () => ({
      beginRenderPass: () => ({
        setPipeline() {}, setBindGroup() {}, draw() {}, end() {},
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
  const ctx = {
    configure() {},
    getCurrentTexture: () => ({ createView: () => ({}) }),
  };
  canvas.getContext = ((type: string) =>
    type === "webgpu" ? ctx : null) as HTMLCanvasElement["getContext"];
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
    softBodyIds: [],
    dropletIds: [],
    viewport: vp,
    reducedMotion: false,
    theme: {
      colorDefault: "rgba(120, 160, 220, 0.75)",
      colorHover: "rgba(233, 69, 96, 0.85)",
      themeCache: new Map(),
      shadowCache: new Map(),
    },
    ...overrides,
  };
}

describe("Ward 062: WebGPU FreeDrop SDF dispatch branch", () => {
  // ──────────────────────────────────────────────────────────────────────
  // Tests #1-#3: shader-source string assertions
  // ──────────────────────────────────────────────────────────────────────

  // T1: sdf-helpers exports the sdCircle WGSL function.
  it("sdf_helpers_exports_sdCircle_function_with_correct_signature", () => {
    // Primary: ordered-signature lock. Parameter order MUST be
    // `(p, center, radius)` because every call site in blob-sdf and
    // fusion-sdf passes them in that order. A contributor swapping the
    // first two would compile cleanly but render every droplet wrong.
    expect(SDF_HELPERS_WGSL).toMatch(
      /fn\s+sdCircle\s*\(\s*p\s*:\s*vec2<f32>\s*,\s*center\s*:\s*vec2<f32>\s*,\s*radius\s*:\s*f32\s*\)\s*->\s*f32/,
    );
    // Secondary: declaration exists at all (cheap fast-fail if the
    // ordered check fails because the helper is missing entirely).
    expect(SDF_HELPERS_WGSL).toMatch(/fn\s+sdCircle\s*\(/);
  });

  // T2: blob-sdf contains both SDF call sites AND reads params.z AND uses
  // if/else dispatch (NOT select()).
  // Per W62 spec §Tests #2: independent substring assertions, no proximity /
  // token-adjacency check — those break under benign WGSL refactors. The
  // if/else lock was added during gold-phase review (Suggestion #6 / Major
  // #2): a future contributor "simplifying" to `select(...)` would trigger
  // a known Chromium WGSL rendering bug where the FreeDrop branch goes
  // invisible. The matching shader comment explains the why; this test
  // catches the regression at CI time.
  it("blob_sdf_shader_contains_both_SDFs_and_uses_if_else_dispatch", () => {
    // (a) sdCircle is called somewhere in the source.
    expect(BLOB_SDF_WGSL).toContain("sdCircle(");
    // (b) sdPolygon is still wired (soft-body path preserved).
    expect(BLOB_SDF_WGSL).toContain("sdPolygon(");
    // (c) params.z is read (the kind discriminator).
    expect(BLOB_SDF_WGSL).toContain("params.z");
    // (d) The dispatch uses `if (isFreeDrop)` — NOT `select(...)`.
    // Locks the verified-working form. See the matching comment in
    // `blob-sdf.wgsl.ts` fs_main for the Chromium WGSL bug rationale.
    expect(BLOB_SDF_WGSL).toMatch(/if\s*\(\s*isFreeDrop\s*\)/);
  });

  // T3: fusion-sdf factors entitySdf used in BOTH fs_main and combinedSdf.
  // Per W62 spec §Tests #3: four substring assertions to prevent one-site
  // regressions where the dispatch is added to one site and forgotten in
  // the other.
  it("fusion_sdf_factors_entitySdf_used_in_both_fs_main_and_combinedSdf", () => {
    // (a) The helper is declared.
    expect(FUSION_SDF_WGSL).toMatch(/fn\s+entitySdf\s*\(/);
    // (b) fs_main exists (the main winner-take-all loop site).
    expect(FUSION_SDF_WGSL).toContain("fs_main");
    // (c) combinedSdf exists (the gradient-helper site).
    expect(FUSION_SDF_WGSL).toContain("combinedSdf");
    // (d) entitySdf is CALLED at least twice — once from each call site.
    // Use a negative-lookbehind to assert word-boundary. The regex matches
    // BOTH the declaration (`fn entitySdf(`, since `fn ` ends with space, not
    // `[a-zA-Z_]`) AND every call site, so we subtract `declCount` to get
    // the net call sites. Locks the "fan-out" property: declaring entitySdf
    // without calling it from both fs_main AND combinedSdf is a regression.
    const callMatches = FUSION_SDF_WGSL.match(/(?<![a-zA-Z_])entitySdf\s*\(/g) ?? [];
    const declCount = (FUSION_SDF_WGSL.match(/fn\s+entitySdf\s*\(/g) ?? []).length;
    expect(callMatches.length - declCount).toBeGreaterThanOrEqual(2);
  });

  // ──────────────────────────────────────────────────────────────────────
  // Tests #4-#5: runtime entity-buffer packing
  // ──────────────────────────────────────────────────────────────────────

  describe("entity-buffer packing", () => {
    let log: DeviceLog;

    beforeEach(() => {
      log = { createBufferSizes: [], writeBuffer: [] };
      setNavigatorGpu(makeGpu(log));
    });

    afterEach(() => {
      restoreNavigatorGpu();
    });

    // Helper: decode the EntityGPU scratch buffer from the writeBuffer log.
    //
    // EntityGPU = 16 floats × 4 bytes = 64 bytes per entity. The renderer
    // writes THREE GPU buffers per frame (W37/W38/W40 layouts):
    //   - particleBuffer:   capacity × 16 particles × 2 floats × 4B = capacity × 128B
    //   - entityBuffer:     capacity × 16 floats × 4B               = capacity × 64B
    //   - projectionBuffer: 20 floats × 4B                          = 80B  (constant)
    // For capacity = 4: 512 / 256 / 80 — all three sizes are distinct, so
    // matching on `byteLength === capacity * 64` uniquely identifies the
    // entity-buffer write. If the renderer ever switches to a typed-subarray
    // write (e.g. `scratch.subarray(0, n)`) the byteLength heuristic would
    // break; the `expect(write).toBeDefined()` guard makes that failure
    // explicit rather than letting a `find() === undefined` slip through.
    function decodeEntityScratch(capacity: number): Float32Array {
      const expectedBytes = capacity * 64;
      const write = log.writeBuffer.find((w) => w.byteLength === expectedBytes);
      expect(write, `entity-buffer writeBuffer of size ${expectedBytes} not found`).toBeDefined();
      return new Float32Array(write!.sourceCopy);
    }

    // T4: kind=1 for droplets, kind=0 for soft-bodies.
    // params.z lives at float index 14 within each entity's 16-float slot.
    it("webgpu_renderer_packs_kind_1_for_droplets_and_kind_0_for_soft_bodies", async () => {
      const renderer = new WebGPURenderer();
      await renderer.init(makeCanvasWithWebGpuCtx());

      const entities = new Float32Array(4 * FLOATS_PER_ENTITY);
      // Slot 0: soft-body at (50, 60), 100×100, liquid_type = 0.
      entities[0] = 50; entities[1] = 60; entities[2] = 100; entities[3] = 100;
      entities[5] = 0; // liquid_type = soft-body
      // Slot 1: FreeDrop droplet at (300, 200), diameter = 56, liquid_type = 6.
      entities[FLOATS_PER_ENTITY + 0] = 300;
      entities[FLOATS_PER_ENTITY + 1] = 200;
      entities[FLOATS_PER_ENTITY + 2] = 56;  // diameter
      entities[FLOATS_PER_ENTITY + 5] = 6;   // liquid_type = FreeDrop

      // Populate particles for the soft-body slot so its AABB is well-defined.
      // Particle buffer per slot = 16 × 2 floats.
      const particles = new Float32Array(4 * PARTICLES_PER_BODY * 2);
      for (let i = 0; i < PARTICLES_PER_BODY; i++) {
        particles[i * 2] = 50 + (i % 4) * 25;
        particles[i * 2 + 1] = 60 + Math.floor(i / 4) * 25;
      }

      const frame = makeFrame({
        entities,
        particles,
        softBodyIds: [0],
        dropletIds: [1],
      });
      renderer.render(frame);

      const scratch = decodeEntityScratch(frame.capacity);
      // params.z lives at scratch[id * 16 + 14].
      const softBodyKind = scratch[0 * 16 + 14];
      const dropletKind = scratch[1 * 16 + 14];
      expect(softBodyKind).toBe(0);
      expect(dropletKind).toBe(1);

      renderer.destroy();
    });

    // T5: droplet AABB is square (load-bearing invariant for sdCircle radius
    // recovery: `radius = halfExtent.x - softness` only works if halfExtent.x
    // == halfExtent.y).
    //
    // CONTRACT-LOCK: passes today AND must continue to pass after W62.
    // Today the droplet packing in webgpu-renderer.ts:466-469 produces a
    // square AABB via `(cx ± r ± softness)`. W62 documents this as a
    // load-bearing invariant — if a future ward adds non-uniform softness
    // or per-axis radius, this test catches the regression before the
    // shader silently renders an ellipse instead of a circle.
    it("webgpu_renderer_packs_square_AABB_for_droplets", async () => {
      const renderer = new WebGPURenderer();
      await renderer.init(makeCanvasWithWebGpuCtx());

      const entities = new Float32Array(4 * FLOATS_PER_ENTITY);
      // Single FreeDrop at (300, 200), diameter = 56.
      entities[0] = 300; entities[1] = 200; entities[2] = 56; entities[5] = 6;
      const frame = makeFrame({
        entities,
        softBodyIds: [],
        dropletIds: [0],
      });
      renderer.render(frame);

      const scratch = decodeEntityScratch(frame.capacity);
      // AABB at slot 0: minX = scratch[4], minY = scratch[5], maxX = scratch[6], maxY = scratch[7].
      const minX = scratch[4];
      const minY = scratch[5];
      const maxX = scratch[6];
      const maxY = scratch[7];
      const width = maxX - minX;
      const height = maxY - minY;
      // Square AABB invariant. Precision 4 (within 5e-5) matches the
      // observed Float32 round-trip noise (~3e-5 between two arithmetically
      // equal values stored as f32 in the GPU buffer). Tightening to 5
      // (5e-6) would false-positive on the f32 rounding; staying at 3
      // (5e-4) would be 10× looser than the actual noise floor.
      expect(width).toBeCloseTo(height, 4);
      // Sanity: the AABB is non-degenerate.
      expect(width).toBeGreaterThan(0);

      renderer.destroy();
    });

    // T6: parity contract — both renderers agree on circle radius = diameter/2.
    // Geometric-radius lock, not a comparison against Canvas2D's spline output
    // (Canvas2D's normal path is a Bezier through 16 particles; ctx.arc is
    // mock-mode only). This test verifies that WebGPU's packing math recovers
    // the same radius value Canvas2D uses in its mock-mode fallback path
    // (drawDroplet calls ctx.arc with r = diameter * 0.5).
    //
    // CONTRACT-LOCK: passes today (the radius math is already correct;
    // W62 only changes WHERE the radius is used — analytical sdCircle in
    // the shader, instead of the polygon SDF over 16 perimeter particles).
    // This test must continue to pass after W62 to prove the math itself
    // didn't drift.
    it("both_renderers_target_identical_circle_radius_for_a_given_diameter", async () => {
      const diameter = 56;
      const cx = 300;
      const cy = 50;

      // Canvas2D reference: r = diameter * 0.5 (canvas2d-renderer.ts:142, 160).
      const canvas2dRadius = diameter * 0.5;
      expect(canvas2dRadius).toBe(28);

      // WebGPU packing: AABB is (cx ± r ± softness) where
      // softness = clamp(diameter * 0.05, 2, 8).
      // Recover the radius via the shader's planned formula:
      //   radius = halfExtent.x - softness
      const renderer = new WebGPURenderer();
      await renderer.init(makeCanvasWithWebGpuCtx());

      const entities = new Float32Array(4 * FLOATS_PER_ENTITY);
      entities[0] = cx; entities[1] = cy; entities[2] = diameter; entities[5] = 6;
      const frame = makeFrame({
        entities,
        softBodyIds: [],
        dropletIds: [0],
      });
      renderer.render(frame);

      const scratch = decodeEntityScratch(frame.capacity);
      const minX = scratch[4];
      const maxX = scratch[6];
      const halfExtentX = (maxX - minX) * 0.5;
      // Softness pack matches the formula in webgpu-renderer.ts:460:
      // softness = Math.max(2, Math.min(8, diameter * 0.05))
      // For diameter=56: softness = clamp(2.8, 2, 8) = 2.8.
      const softness = Math.max(2, Math.min(8, diameter * 0.05));
      expect(softness).toBeCloseTo(2.8, 5);
      const webgpuRadius = halfExtentX - softness;
      // Both renderers must agree on the geometric radius. Precision 4
      // (within 5e-5) matches the observed Float32 round-trip noise.
      expect(webgpuRadius).toBeCloseTo(canvas2dRadius, 4);

      renderer.destroy();
    });
  });
});
