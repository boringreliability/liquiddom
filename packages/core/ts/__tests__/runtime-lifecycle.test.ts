/**
 * @vitest-environment jsdom
 * W66: runtime.ts additions (canvas mount via stylesheet.ts, renderer
 * selection, LoopController, stylesheet refcount).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createFluidRuntime } from "../src/runtime";
import { createManualClock } from "../src/clock";
import { WebGPUUnavailableError } from "../src/renderers/webgpu-renderer";
import { STYLE_ELEMENT_ID } from "../src/stylesheet";
import { freedOf, resetDom, setupFacadeTestEnv, spyBackend, ticksOf } from "./_facade-helpers";

beforeEach(() => {
  resetDom();
  setupFacadeTestEnv();
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
});
