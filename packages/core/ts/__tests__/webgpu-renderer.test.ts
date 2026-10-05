/**
 * @vitest-environment jsdom
 * W66: WebGPURenderer stripped to infrastructure (spec §3 "Infrastructure"):
 * adapter/device/context, configure(alphaMode 'premultiplied'), a clear pass,
 * resize, destroy, device.lost. No shaders or pipelines until slice 3.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { WebGPURenderer, WebGPUUnavailableError, WEBGPU_INFRA_ONLY_WARNING } from "../src/renderers/webgpu-renderer";
import { WebGPUUnavailableError as BarrelError } from "../src/index";
import type { RenderFrame, Renderer } from "../src/renderers/frame";
import { installNavigatorGpu, makeGpuMock, type GpuMock } from "./_facade-helpers";

let restoreGpu: (() => void) | null = null;
afterEach(() => {
  restoreGpu?.();
  restoreGpu = null;
});

function canvasFor(mock: GpuMock | null): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.getContext = ((type: string) => (type === "webgpu" && mock ? mock.canvasContext : null)) as HTMLCanvasElement["getContext"];
  return canvas;
}
async function errorOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(() => null, (e: unknown) => e);
}
const FRAME = {} as RenderFrame; // the infra renderer never reads the frame

describe("W66: WebGPURenderer (infra only)", () => {
  it("given_webgpu_renderer_when_typed_then_satisfies_frame_Renderer_contract_and_error_is_reexported", () => {
    const r: Renderer = new WebGPURenderer();
    expect(typeof r.init).toBe("function");
    expect(typeof r.render).toBe("function");
    expect(typeof r.resize).toBe("function");
    expect(typeof r.destroy).toBe("function");
    const cause = new Error("inner");
    const err = new WebGPUUnavailableError("msg", { cause });
    expect(err.name).toBe("WebGPUUnavailableError");
    expect(err.cause).toBe(cause);
    expect(BarrelError).toBe(WebGPUUnavailableError);
    expect(WEBGPU_INFRA_ONLY_WARNING).toMatch(/infrastructure-only/);
  });

  it("given_navigator_gpu_missing_when_init_then_WebGPUUnavailableError", async () => {
    restoreGpu = installNavigatorGpu(undefined);
    const err = await errorOf(new WebGPURenderer().init(canvasFor(null)));
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect((err as Error).message).toMatch(/navigator\.gpu/);
  });

  it("given_requestAdapter_null_or_throwing_when_init_then_WebGPUUnavailableError_with_cause", async () => {
    const nul = makeGpuMock({ adapter: "null" });
    restoreGpu = installNavigatorGpu(nul.gpu);
    expect(await errorOf(new WebGPURenderer().init(canvasFor(nul)))).toBeInstanceOf(WebGPUUnavailableError);
    restoreGpu();
    const thr = makeGpuMock({ adapter: "throw" });
    restoreGpu = installNavigatorGpu(thr.gpu);
    const err = await errorOf(new WebGPURenderer().init(canvasFor(thr)));
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect((err as Error).cause).toBe(thr.adapterError);
  });

  it("given_requestDevice_rejects_when_init_then_WebGPUUnavailableError_with_cause", async () => {
    const mock = makeGpuMock({ device: "reject" });
    restoreGpu = installNavigatorGpu(mock.gpu);
    const err = await errorOf(new WebGPURenderer().init(canvasFor(mock)));
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect((err as Error).cause).toBe(mock.deviceError);
  });

  it("given_getContext_webgpu_null_when_init_then_WebGPUUnavailableError_and_device_destroyed", async () => {
    const mock = makeGpuMock();
    restoreGpu = installNavigatorGpu(mock.gpu);
    const err = await errorOf(new WebGPURenderer().init(canvasFor(null)));
    expect(err).toBeInstanceOf(WebGPUUnavailableError);
    expect((err as Error).message).toMatch(/getContext/);
    expect(mock.calls.deviceDestroyed).toBe(1);
  });

  it("given_successful_init_when_configured_then_alphaMode_premultiplied_and_no_shader_or_pipeline_created", async () => {
    const mock = makeGpuMock();
    restoreGpu = installNavigatorGpu(mock.gpu);
    await new WebGPURenderer().init(canvasFor(mock));
    expect(mock.calls.configure).toHaveLength(1);
    expect(mock.calls.configure[0]).toMatchObject({ format: "bgra8unorm", alphaMode: "premultiplied" });
    expect(mock.calls.shaderModules).toBe(0);
    expect(mock.calls.pipelines).toBe(0);
  });

  it("given_initialised_renderer_when_render_then_one_clear_pass_transparent_and_submitted", async () => {
    const mock = makeGpuMock();
    restoreGpu = installNavigatorGpu(mock.gpu);
    const r = new WebGPURenderer();
    await r.init(canvasFor(mock));
    r.resize(1280, 800, 1);
    r.render(FRAME);
    expect(mock.calls.passes).toHaveLength(1);
    expect(mock.calls.passes[0]).toMatchObject({
      colorAttachments: [{ loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
    });
    expect(mock.calls.submits).toBe(1);
  });

  it("given_device_lost_when_rendering_then_one_console_warn_and_render_noop", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const mock = makeGpuMock();
      restoreGpu = installNavigatorGpu(mock.gpu);
      const r = new WebGPURenderer();
      await r.init(canvasFor(mock));
      mock.loseDevice("gpu reset");
      await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
      expect(String(warn.mock.calls[0]![0])).toMatch(/device lost.*gpu reset/);
      r.render(FRAME);
      r.render(FRAME);
      expect(mock.calls.passes).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("given_destroy_when_called_before_init_after_failure_and_twice_then_no_throw_and_device_destroyed_once", async () => {
    expect(() => new WebGPURenderer().destroy()).not.toThrow();
    restoreGpu = installNavigatorGpu(undefined);
    const failed = new WebGPURenderer();
    await errorOf(failed.init(canvasFor(null)));
    expect(() => { failed.destroy(); failed.destroy(); }).not.toThrow();
    restoreGpu();
    const mock = makeGpuMock();
    restoreGpu = installNavigatorGpu(mock.gpu);
    const ok = new WebGPURenderer();
    await ok.init(canvasFor(mock));
    ok.destroy();
    ok.destroy();
    expect(mock.calls.deviceDestroyed).toBe(1);
    ok.render(FRAME);
    expect(mock.calls.passes).toHaveLength(0);
  });
});
