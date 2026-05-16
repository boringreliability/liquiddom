/**
 * @vitest-environment jsdom
 *
 * Ward 037 — WebGPU Pipeline Scaffolding (r2 red-phase tests).
 *
 * Test coverage strategy:
 *  - Paths A–E of Decision §7 each get a dedicated rejection assertion
 *    (T2/T3/T5/T6 — path A/B/C/D/E respectively).
 *  - T1 locks the Renderer-contract + WebGPUUnavailableError shape + the
 *    barrel re-export (Decision §11 amendment / r2 C2 fix).
 *  - T4 locks destroy() idempotency (Decision §16).
 *  - T7 locks the LiquidDOM.create({ renderer: 'webgpu' }) wire-up — a
 *    gold that ships WebGPURenderer but forgets the switch in index.ts
 *    would otherwise pass T1-T6 (review P1.3).
 *
 * Test count bumped 5→7 in r2 of the red phase after parallel test-code
 * reviews surfaced two critical coverage holes (path E unverified, wire-up
 * unverified). Spec §Tests table tracks this.
 *
 * Promise handling: every `init()` invocation is captured once and the
 * rejected error is destructured for multi-assertion (review C1 fix).
 * Calling init() twice with the same renderer mutates state in unpredictable
 * ways once gold lands.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  WebGPURenderer,
  WebGPUUnavailableError,
} from "../src/renderers/webgpu-renderer";
import { LiquidDOM, WebGPUUnavailableError as BarrelExportedError } from "../src/index";
import type { Renderer } from "../src/renderers/renderer";

// jsdom ResizeObserver polyfill for the LiquidDOM.create wire-up test.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/**
 * Idempotent navigator.gpu swap: saves the descriptor on the FIRST call per
 * test, lets subsequent calls in the same test overwrite the mock without
 * losing the original (review nit #8 fix).
 */
let originalGpuDescriptor: PropertyDescriptor | undefined;
let originalGpuCaptured = false;

function setNavigatorGpu(value: unknown): void {
  if (!originalGpuCaptured) {
    originalGpuDescriptor = Object.getOwnPropertyDescriptor(navigator, "gpu");
    originalGpuCaptured = true;
  }
  Object.defineProperty(navigator, "gpu", {
    value,
    configurable: true,
    writable: true,
  });
}

function restoreNavigatorGpu(): void {
  if (!originalGpuCaptured) return;
  if (originalGpuDescriptor) {
    Object.defineProperty(navigator, "gpu", originalGpuDescriptor);
  } else {
    delete (navigator as { gpu?: unknown }).gpu;
  }
  originalGpuDescriptor = undefined;
  originalGpuCaptured = false;
}

function makeCanvas(): HTMLCanvasElement {
  return document.createElement("canvas");
}

/** Minimal device mock: success path through requestAdapter + requestDevice. */
function makeMinimalGpu(overrides: {
  requestDevice?: () => Promise<unknown>;
  popErrorScope?: () => Promise<unknown>;
} = {}): unknown {
  return {
    getPreferredCanvasFormat: () => "bgra8unorm",
    requestAdapter: async () => ({
      requestDevice:
        overrides.requestDevice ??
        (async () => ({
          destroy() {},
          lost: new Promise(() => {}),
          queue: { writeBuffer() {}, submit() {} },
          createBuffer: () => ({ destroy() {} }),
          createBindGroup: () => ({}),
          createShaderModule: () => ({}),
          createRenderPipeline: () => ({ getBindGroupLayout: () => ({}) }),
          createCommandEncoder: () => ({
            beginRenderPass: () => ({
              setPipeline() {}, setBindGroup() {}, draw() {}, end() {},
            }),
            finish: () => ({}),
          }),
          pushErrorScope: () => {},
          popErrorScope: overrides.popErrorScope ?? (async () => null),
        })),
    }),
  };
}

describe("Ward 037: WebGPU Pipeline Scaffolding", () => {
  beforeEach(() => {
    while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
    // Lock path A as the default for hermetic isolation (review #7 fix).
    setNavigatorGpu(undefined);
  });

  afterEach(() => {
    restoreNavigatorGpu();
  });

  // ── T1: contract sanity + WebGPUUnavailableError shape + barrel re-export ──
  it("webgpu_renderer_satisfies_renderer_contract", () => {
    // Compile-time check — fails compilation if WebGPURenderer drifts from Renderer.
    const _: Renderer = new WebGPURenderer();
    void _;

    // Runtime sanity on Renderer surface.
    const r = new WebGPURenderer();
    expect(typeof r.init).toBe("function");
    expect(typeof r.render).toBe("function");
    expect(typeof r.resize).toBe("function");
    expect(typeof r.destroy).toBe("function");

    // init() returns a Promise. Swallow rejection — we test behavior in T2-T6.
    const result = r.init(makeCanvas());
    expect(result).toBeInstanceOf(Promise);
    result.catch(() => {});

    // WebGPUUnavailableError shape + cause-option acceptance (review #6 fix).
    const inner = new Error("inner cause");
    const err = new WebGPUUnavailableError("msg", { cause: inner });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WebGPUUnavailableError");
    expect(err.message).toBe("msg");
    expect(err.cause).toBe(inner);

    // Barrel re-export identity check (review P1.2 fix): the class re-exported
    // from `src/index.ts` MUST be the same identity used by consumers, so
    // `instanceof` in user code works after they `catch (err)`.
    expect(BarrelExportedError).toBe(WebGPUUnavailableError);
  });

  // ── T2: path A — navigator.gpu missing ─────────────────────────────
  it("init_throws_WebGPUUnavailableError_when_navigator_gpu_missing", async () => {
    // beforeEach already set gpu = undefined.
    const renderer = new WebGPURenderer();
    const err = await renderer.init(makeCanvas()).then(
      () => null,
      (e) => e as unknown,
    );
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect((err as Error).message).toMatch(/navigator\.gpu/i);
  });

  // ── T3: path B — requestAdapter returns null ───────────────────────
  it("init_throws_WebGPUUnavailableError_when_requestAdapter_returns_null", async () => {
    setNavigatorGpu({
      getPreferredCanvasFormat: () => "bgra8unorm",
      requestAdapter: async () => null,
    });

    const renderer = new WebGPURenderer();
    const err = await renderer.init(makeCanvas()).then(
      () => null,
      (e) => e as unknown,
    );
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect((err as Error).message).toMatch(/adapter/i);
  });

  // ── T4: destroy idempotency ────────────────────────────────────────
  it("destroy_is_idempotent_before_init_and_after_failed_init", async () => {
    const renderer = new WebGPURenderer();
    // Pre-init: destroy is a no-op.
    expect(() => renderer.destroy()).not.toThrow();
    expect(() => renderer.destroy()).not.toThrow();

    // Force init failure (path A — beforeEach already set gpu = undefined).
    await expect(renderer.init(makeCanvas())).rejects.toBeInstanceOf(Error);

    // Post-failed-init: destroy still a no-op.
    expect(() => renderer.destroy()).not.toThrow();
    expect(() => renderer.destroy()).not.toThrow();
  });

  // ── T5: paths C + D — requestDevice rejection / getContext null ────
  it("init_throws_when_requestDevice_rejects_or_getContext_returns_null", async () => {
    // Path C — requestDevice rejects.
    const innerCause = new Error("device error");
    setNavigatorGpu(
      makeMinimalGpu({
        requestDevice: async () => {
          throw innerCause;
        },
      }),
    );
    const r1 = new WebGPURenderer();
    const errC = await r1.init(makeCanvas()).then(
      () => null,
      (e) => e as unknown,
    );
    expect(errC).toBeInstanceOf(WebGPUUnavailableError);
    // r2 review C2: cause MUST propagate so W41 can log/distinguish.
    expect((errC as { cause?: unknown }).cause).toBe(innerCause);

    // Path D — adapter + device succeed but canvas.getContext returns null.
    restoreNavigatorGpu();
    setNavigatorGpu(makeMinimalGpu());
    const r2 = new WebGPURenderer();
    const canvas = makeCanvas();
    // Tighter mock: only "webgpu" returns null, other context types fall through
    // (review #4 — defends against future code paths that call getContext("2d")).
    const origGetContext = canvas.getContext.bind(canvas);
    canvas.getContext = ((type: string, ...rest: unknown[]) =>
      type === "webgpu" ? null : (origGetContext as (...a: unknown[]) => unknown)(type, ...rest)
    ) as HTMLCanvasElement["getContext"];

    const errD = await r2.init(canvas).then(
      () => null,
      (e) => e as unknown,
    );
    expect(errD).toBeInstanceOf(WebGPUUnavailableError);
    expect((errD as Error).message).toMatch(/getContext/i);
  });

  // ── T6: path E — shader / pipeline validation failure ──────────────
  it("init_throws_WebGPUUnavailableError_when_pipeline_validation_fails", async () => {
    const validationError = { message: "shader compile failed: bad token" };
    setNavigatorGpu(
      makeMinimalGpu({
        popErrorScope: async () => validationError,
      }),
    );
    const renderer = new WebGPURenderer();
    // jsdom's canvas.getContext is unimplemented → returns null by default,
    // which fires path D before path E. Mock it to return a minimal
    // GPUCanvasContext stub so init() reaches the pipeline-validation block.
    const canvas = makeCanvas();
    const fakeGpuCtx = {
      configure() {},
      getCurrentTexture: () => ({ createView: () => ({}) }),
    };
    canvas.getContext = ((type: string) =>
      type === "webgpu" ? fakeGpuCtx : null
    ) as HTMLCanvasElement["getContext"];

    const err = await renderer.init(canvas).then(
      () => null,
      (e) => e as unknown,
    );
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    // The validation error MUST be propagated via cause so consumers can
    // surface useful WGSL diagnostics (Decision §7 path E).
    expect((err as { cause?: unknown }).cause).toBe(validationError);
  });

  // ── T7: LiquidDOM.create wire-up dispatches to WebGPURenderer ──────
  it("liquiddom_create_with_renderer_webgpu_rejects_when_unavailable", async () => {
    // beforeEach already set gpu = undefined → path A.
    // A gold that forgets to wire the 'webgpu' switch in index.ts would
    // instead instantiate Canvas2DRenderer and resolve successfully here.
    const err = await LiquidDOM.create({
      capacity: 4,
      autoObserve: false,
      renderer: "webgpu",
    }).then(
      () => null,
      (e) => e as unknown,
    );
    expect(err).toBeInstanceOf(WebGPUUnavailableError);

    // Sanity: same call without `renderer` opt-in resolves cleanly (defaults
    // to canvas2d, unaffected by missing navigator.gpu).
    const instance = await LiquidDOM.create({ capacity: 4, autoObserve: false });
    expect(typeof instance.destroy).toBe("function");
    instance.destroy();
  });
});
