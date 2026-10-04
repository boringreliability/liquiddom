/**
 * @vitest-environment jsdom
 * W66: runtime.ts additions (canvas mount via stylesheet.ts, renderer
 * selection, LoopController, stylesheet refcount).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ElementRegistry } from "../src/element-registry";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import { createFluidRuntime } from "../src/runtime";
import { createManualClock } from "../src/clock";
import { WebGPUUnavailableError } from "../src/renderers/webgpu-renderer";
import { STYLE_ELEMENT_ID } from "../src/stylesheet";
import { freedOf, resetDom, setupFacadeTestEnv, spyBackend, ticksOf } from "./_facade-helpers";

beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("W66: runtime additions", () => {
  it("given_runtime_when_created_then_canvas_has_liquid_canvas_class_aria_hidden_and_styles_injected", async () => {
    const sb = spyBackend();
    const rt = await createFluidRuntime({ particles: 1024, maxElements: 4, seed: 1, testBackend: sb.backend });
    try {
      expect(rt.canvas.classList.contains("liquid-canvas")).toBe(true);
      expect(rt.canvas.getAttribute("aria-hidden")).toBe("true");
      expect(document.getElementById(STYLE_ELEMENT_ID)).not.toBeNull();
      expect(rt.activeRenderer).toBe("canvas2d");
      expect(rt.isPaused).toBe(false);
    } finally {
      rt.destroy();
    }
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
  });

  it("given_renderer_init_failure_when_creating_runtime_then_canvas_removed_and_core_freed", async () => {
    const sb = spyBackend();
    // navigator.gpu is undefined in jsdom → WebGPU path A.
    await expect(
      createFluidRuntime({ particles: 1024, maxElements: 4, seed: 1, testBackend: sb.backend, renderer: "webgpu" }),
    ).rejects.toBeInstanceOf(WebGPUUnavailableError);
    expect(document.querySelector("canvas")).toBeNull();
    expect(freedOf(sb)).toHaveLength(sb.cores.length);
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
  });

  it("given_runtime_pause_when_frames_advance_then_no_tick_until_resume", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    const rt = await createFluidRuntime({ particles: 1024, maxElements: 4, seed: 1, testBackend: sb.backend, clock });
    try {
      clock.advance(2);
      const before = ticksOf(sb).length;
      rt.pause();
      expect(rt.isPaused).toBe(true);
      clock.advance(5);
      expect(ticksOf(sb)).toHaveLength(before);
      rt.resume();
      clock.advance(3);
      expect(ticksOf(sb)).toHaveLength(before + 3);
    } finally {
      rt.destroy();
    }
  });

  it("fix1_given_sync_failure_after_styles_acquired_when_creating_then_styles_released_and_renderer_destroyed_once", async () => {
    const sb = spyBackend();
    vi.spyOn(FluidCanvas2DRenderer.prototype, "resize").mockImplementation(() => {
      throw new Error("resize boom");
    });
    const destroySpy = vi.spyOn(FluidCanvas2DRenderer.prototype, "destroy");
    await expect(
      createFluidRuntime({ particles: 1024, maxElements: 4, seed: 1, testBackend: sb.backend }),
    ).rejects.toThrow("resize boom");
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(freedOf(sb)).toHaveLength(sb.cores.length);
  });

  it("fix2_given_pause_spanning_5s_when_resumed_then_first_tick_dt_is_at_most_one_frame", async () => {
    const sb = spyBackend();
    const clock = createManualClock();
    const rt = await createFluidRuntime({ particles: 1024, maxElements: 4, seed: 1, testBackend: sb.backend, clock });
    try {
      clock.advance(3);
      rt.pause();
      clock.advance(1, 5000);
      rt.resume();
      const before = ticksOf(sb).length;
      clock.advance(1);
      const ticks = ticksOf(sb);
      expect(ticks).toHaveLength(before + 1);
      expect(ticks[before][0]).toBeLessThanOrEqual(1 / 60 + 1e-6);
    } finally {
      rt.destroy();
    }
  });

  it("fix3_given_unobserved_element_when_refresh_then_noop", async () => {
    const sb = spyBackend();
    const rt = await createFluidRuntime({ particles: 1024, maxElements: 4, seed: 1, testBackend: sb.backend });
    try {
      const refreshSpy = vi.spyOn(ElementRegistry.prototype, "refresh");
      rt.refresh(document.createElement("div"));
      expect(refreshSpy).not.toHaveBeenCalled();
    } finally {
      rt.destroy();
    }
  });
});
