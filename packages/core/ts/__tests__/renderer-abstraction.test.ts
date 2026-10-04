/**
 * @vitest-environment jsdom
 * W66: one Renderer contract (renderers/frame.ts); the soft-body renderer
 * modules are gone; selectRenderer implements D66-2.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Renderer } from "../src/renderers/frame";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import { WebGPURenderer } from "../src/renderers/webgpu-renderer";
import { selectRenderer } from "../src/renderers/select";
import { setupFacadeTestEnv } from "./_facade-helpers";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
beforeEach(setupFacadeTestEnv);

describe("W66: renderer abstraction", () => {
  it("given_both_renderers_when_typed_then_satisfy_frame_Renderer_init_render_resize_destroy", () => {
    const renderers: Renderer[] = [new FluidCanvas2DRenderer(), new WebGPURenderer()];
    for (const r of renderers) {
      for (const m of ["init", "render", "resize", "destroy"] as const) expect(typeof r[m]).toBe("function");
    }
  });

  it("given_soft_body_renderer_modules_when_checked_then_deleted", () => {
    for (const rel of ["renderers/renderer.ts", "renderers/canvas2d-renderer.ts", "renderers/shaders", "phantom-observer.ts", "wasm-bridge.ts", "box-shadow.ts"]) {
      expect(existsSync(resolve(SRC, rel)), rel).toBe(false);
    }
  });

  it("given_selectRenderer_auto_or_canvas2d_when_called_then_FluidCanvas2DRenderer_active_canvas2d", async () => {
    for (const choice of ["auto", "canvas2d"] as const) {
      const sel = await selectRenderer(choice, document.createElement("canvas"));
      expect(sel.active).toBe("canvas2d");
      expect(sel.renderer).toBeInstanceOf(FluidCanvas2DRenderer);
      sel.renderer.destroy();
    }
  });

  it("given_selectRenderer_canvas2d_with_null_2d_context_when_called_then_rejects_D64_5", async () => {
    const canvas = document.createElement("canvas");
    canvas.getContext = (() => null) as HTMLCanvasElement["getContext"];
    const destroy = vi.spyOn(FluidCanvas2DRenderer.prototype, "destroy");
    try {
      await expect(selectRenderer("canvas2d", canvas)).rejects.toBeInstanceOf(Error);
      expect(destroy).toHaveBeenCalledTimes(1);
    } finally {
      destroy.mockRestore();
    }
  });
});
