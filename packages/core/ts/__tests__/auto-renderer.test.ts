/**
 * @vitest-environment jsdom
 *
 * Ward 041 — Canvas2D Fallback & Feature Detection (red-phase tests, 10).
 *
 * Strategy: exercises `LiquidDOM.create()` end-to-end against an instrumented
 * `navigator.gpu`. Tests target the orchestration in `index.ts` — the renderer
 * selection branch, fallback canvas mount, activeRenderer getter, and
 * silentFallback log gate. WebGPU pipeline internals are NOT under test here
 * (W37/W38/W39/W40 cover those); we only verify the create-flow decisions.
 *
 * Note on red-phase failures:
 *  - T1, T2, T7, T8, T9: fail with "instance.activeRenderer undefined" until
 *    gold adds the getter.
 *  - T3, T4: fail because the fallback log is not yet implemented.
 *  - T6: fails because canvas2d mode currently goes through the new
 *    LiquidDOM.create path that always falls back to canvas2d in jsdom — but
 *    after gold, the canvas2d branch will skip WebGPU probing entirely.
 *  - T8: fails because the current default is 'canvas2d', not 'auto'.
 *  - T9: fails because the current code doesn't re-mount the canvas.
 *  - T10: fails because the current 'canvas2d' default path doesn't probe.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LiquidDOM, WebGPUUnavailableError } from "../src/index";

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

// ── navigator.gpu install/restore helpers ───────────────────────────
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
 * A full-success WebGPU mock. Returns control of every method used by the
 * W37/W38/W39/W40 success chain. Tests may override `requestAdapter` (e.g.,
 * via `vi.fn().mockImplementation`) before calling LiquidDOM.create.
 */
function makeSuccessGpu(overrides: {
  requestAdapter?: () => Promise<unknown>;
  createShaderModule?: () => unknown;
} = {}): unknown {
  return {
    getPreferredCanvasFormat: () => "bgra8unorm",
    requestAdapter:
      overrides.requestAdapter ??
      (async () => ({
        requestDevice: async () => ({
          destroy() {},
          lost: new Promise(() => {}),
          queue: {
            writeBuffer() {}, writeTexture() {}, copyExternalImageToTexture() {}, submit() {},
          },
          createBuffer: () => ({ destroy() {} }),
          createBindGroup: () => ({}),
          createBindGroupLayout: () => ({}),
          createPipelineLayout: () => ({}),
          createTexture: () => ({ destroy() {}, createView: () => ({}) }),
          createSampler: () => ({}),
          createShaderModule: overrides.createShaderModule ?? (() => ({})),
          createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
          createCommandEncoder: () => ({
            beginRenderPass: () => ({
              setPipeline() {}, setBindGroup() {}, draw() {}, end() {},
            }),
            finish: () => ({}),
          }),
          pushErrorScope: () => {},
          popErrorScope: async () => null,
        }),
      })),
  };
}

/**
 * Mount a webgpu-capable canvas mock onto every newly created <canvas>.
 * In jsdom `canvas.getContext("webgpu")` returns null by default → triggers
 * W37 path D → LiquidDOM.create({renderer:"webgpu"}) would reject. We patch
 * HTMLCanvasElement.prototype.getContext so the WebGPU success path can reach
 * pipeline creation.
 */
let originalGetContext: HTMLCanvasElement["getContext"];
function installCanvasWebgpuStub(): void {
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  const gpuCtx = { configure() {}, getCurrentTexture: () => ({ createView: () => ({}) }) };
  HTMLCanvasElement.prototype.getContext = function (type: string) {
    if (type === "webgpu") return gpuCtx as unknown as RenderingContext;
    return null;
  } as HTMLCanvasElement["getContext"];
}
function restoreCanvasGetContext(): void {
  if (originalGetContext) {
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  }
}

describe("Ward 041: Canvas2D Fallback & Feature Detection", () => {
  beforeEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    // Default to path A (no navigator.gpu) — individual tests override.
    setNavigatorGpu(undefined);
  });

  afterEach(() => {
    restoreNavigatorGpu();
    restoreCanvasGetContext();
  });

  // ── T1: auto mode + working WebGPU → activeRenderer === 'webgpu' ────
  it("auto_mode_uses_webgpu_when_available", async () => {
    setNavigatorGpu(makeSuccessGpu());
    installCanvasWebgpuStub();

    const instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      renderer: "auto",
    });

    expect(instance.activeRenderer).toBe("webgpu");
    instance.destroy();
  });

  // ── T2: auto + no WebGPU → activeRenderer === 'canvas2d', no throw ──
  it("auto_mode_falls_back_to_canvas2d_when_webgpu_unavailable", async () => {
    // beforeEach already set gpu = undefined (path A).
    const instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      renderer: "auto",
      silentFallback: true,  // suppress the log so this test stays clean
    });

    expect(instance.activeRenderer).toBe("canvas2d");
    instance.destroy();
  });

  // ── T3: auto fallback logs an info-level message by default ─────────
  it("auto_mode_logs_fallback_info", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      renderer: "auto",
    });

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toMatch(/WebGPU unavailable/i);

    instance.destroy();
    info.mockRestore();
  });

  // ── T4: silentFallback: true suppresses the info log ────────────────
  it("silentFallback_true_suppresses_log", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      renderer: "auto",
      silentFallback: true,
    });

    expect(info).not.toHaveBeenCalled();

    instance.destroy();
    info.mockRestore();
  });

  // ── T5: webgpu mode hard-fails on unavailable (W37 contract) ────────
  it("webgpu_mode_throws_on_unavailable", async () => {
    // beforeEach already set gpu = undefined.
    const err = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      renderer: "webgpu",
    }).then(
      () => null,
      (e) => e as unknown,
    );
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
  });

  // ── T6: canvas2d mode never probes WebGPU ───────────────────────────
  // No installCanvasWebgpuStub() — canvas2d must NOT call getContext("webgpu").
  it("canvas2d_mode_skips_webgpu_probing", async () => {
    const requestAdapter = vi.fn(async () => ({
      requestDevice: async () => ({} as unknown),
    }));
    setNavigatorGpu({ ...makeSuccessGpu(), requestAdapter } as unknown);

    const instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      renderer: "canvas2d",
    });

    expect(requestAdapter).not.toHaveBeenCalled();
    expect(instance.activeRenderer).toBe("canvas2d");
    instance.destroy();
  });

  // ── T7: activeRenderer getter reflects active path in both modes ────
  it("activeRenderer_getter_reflects_active_path", async () => {
    // canvas2d path
    const i1 = await LiquidDOM.create({
      capacity: 4, autoObserve: false, renderer: "canvas2d",
    });
    expect(i1.activeRenderer).toBe("canvas2d");
    i1.destroy();

    // webgpu path
    setNavigatorGpu(makeSuccessGpu());
    installCanvasWebgpuStub();
    const i2 = await LiquidDOM.create({
      capacity: 4, autoObserve: false, renderer: "webgpu",
    });
    expect(i2.activeRenderer).toBe("webgpu");
    i2.destroy();
  });

  // ── T8: omitted renderer option behaves as 'auto' (default-string lock) ──
  it("omitted_renderer_option_acts_as_auto", async () => {
    // beforeEach set gpu = undefined. With 'auto' default, this should
    // resolve via fallback (NOT throw). 'canvas2d' default would also
    // resolve, but a regressed 'webgpu' default would reject — this test
    // also locks the literal default-string.
    // Note: `renderer` field is OMITTED from the options object — only
    // `silentFallback: true` is present (to quiet the fallback log).
    const instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      silentFallback: true,
    });

    expect(instance.activeRenderer).toBe("canvas2d");

    // Now exercise the WebGPU-available path with the same omit-renderer call:
    // 'auto' would probe & succeed → activeRenderer === 'webgpu'. 'canvas2d'
    // default would skip probing & stay 'canvas2d'. This disambiguates the two.
    instance.destroy();

    setNavigatorGpu(makeSuccessGpu());
    installCanvasWebgpuStub();
    const i2 = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
    });
    expect(i2.activeRenderer).toBe("webgpu");
    i2.destroy();
  });

  // ── T9: auto fallback creates a fresh canvas (W37 §17 hazard) ───────
  it("auto_fallback_creates_fresh_canvas", async () => {
    // beforeEach set gpu = undefined → fallback path.
    const create = vi.spyOn(document, "createElement");

    const instance = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      renderer: "auto",
      silentFallback: true,
    });

    // Count canvases attributable to LiquidDOM.create's mount logic.
    // Initial mount + fallback mount = 2. Does NOT include WASM init or
    // other code paths (LiquidDOM.create doesn't create canvases elsewhere).
    const canvasCalls = create.mock.calls.filter((c) => c[0] === "canvas").length;
    expect(canvasCalls).toBe(2);

    instance.destroy();
    create.mockRestore();

    // Counter-case: on the WebGPU SUCCESS path, mountCanvas is called
    // exactly once. Catches an off-by-one regression where gold accidentally
    // mounts a fallback canvas even when WebGPU succeeded.
    const create2 = vi.spyOn(document, "createElement");
    setNavigatorGpu(makeSuccessGpu());
    installCanvasWebgpuStub();
    const i2 = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      renderer: "auto",
    });
    const canvasCalls2 = create2.mock.calls.filter((c) => c[0] === "canvas").length;
    expect(canvasCalls2).toBe(1);
    i2.destroy();
    create2.mockRestore();
  });

  // ── T10: auto mode re-throws non-WebGPUUnavailableError ─────────────
  it("auto_mode_rethrows_non_webgpu_errors", async () => {
    // Wire createShaderModule to throw a TypeError. W37's init() catches
    // and re-throws (the post-acquisition try/catch wraps cleanup but
    // preserves the original error). The TypeError escapes init() →
    // LiquidDOM.create's 'auto' catch sees `!(err instanceof
    // WebGPUUnavailableError)` and re-throws → LiquidDOM.create rejects.
    setNavigatorGpu(
      makeSuccessGpu({
        createShaderModule: () => {
          throw new TypeError("intentional non-webgpu bug");
        },
      }),
    );
    installCanvasWebgpuStub();

    const err = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      renderer: "auto",
      silentFallback: true,
    }).then(
      () => null,
      (e) => e as unknown,
    );
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toMatch(/intentional non-webgpu bug/);
  });
});
