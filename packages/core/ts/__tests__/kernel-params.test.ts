/**
 * @vitest-environment jsdom
 * W71 (D71-5): kernel parameters shared by the Canvas2D density grid and the WebGPU splat
 * pass (renderers/kernel-params.ts). The parity test pins that both renderers put the same
 * weight on the same point.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DENSITY_THRESHOLD,
  EDGE_SOFTNESS,
  KERNEL_RADIUS_CAP_PX,
  KERNEL_RADIUS_PER_SPACING,
  kernelRadiusPx,
  kernelWeight,
} from "../src/renderers/kernel-params";
import * as grid from "../src/renderers/density-grid";
import { FluidCanvas2DRenderer } from "../src/renderers/fluid-canvas2d";
import { Dyn, DYNAMIC_FIELDS, ELEMENT_STRIDE, St, STATE_STRIDE, STATIC_FIELDS } from "../src/fluid-layout";
import type { ElementPaint, RenderFrame } from "../src/renderers/frame";
import { installFakeCanvas2D, type FakeCanvasHandle } from "./_fake-canvas";

const RENDERERS = resolve(dirname(fileURLToPath(import.meta.url)), "../src/renderers");
let fake: FakeCanvasHandle;
beforeEach(() => {
  fake = installFakeCanvas2D();
});
afterEach(() => {
  fake.restore();
  vi.restoreAllMocks();
});

/** 16 moving particles of one element (home 0) whose paint has the given spacing. */
function onePaintFrame(spacingPx: number): RenderFrame {
  const cap = 16;
  const dynamicView = new Float32Array(cap * DYNAMIC_FIELDS);
  for (let i = 0; i < cap; i++) {
    dynamicView[Dyn.X * cap + i] = 50 + i;
    dynamicView[Dyn.Y * cap + i] = 50;
  }
  const elementView = new Float32Array(ELEMENT_STRIDE);
  elementView.set([40, 40, 40, 20, 4, 0, 0, 0, Number.NaN, Number.NaN]);
  const stateView = new Float32Array(STATE_STRIDE);
  stateView[St.REST_ALPHA] = 0;
  const paint: ElementPaint = {
    id: 0,
    background: [47, 111, 222, 1],
    text: [0, 0, 0, 1],
    radiusPx: 4,
    particleCount: cap,
    areaPerParticle: spacingPx * spacingPx,
    spacingPx,
    atlasRect: null,
  };
  return {
    dynamicView,
    staticView: new Float32Array(cap * STATIC_FIELDS),
    generation: 1,
    stateView,
    elementView,
    particleCapacity: cap,
    activeParticles: cap,
    paints: [paint],
    viewport: { widthCss: 200, heightCss: 100, dpr: 1 },
    reducedMotion: false,
  };
}

describe("W71 kernel-params (D71-5)", () => {
  it("given_kernel_params_when_read_then_spec_values_and_density_grid_re_exports_them_instead_of_defining_its_own", () => {
    expect(KERNEL_RADIUS_CAP_PX).toBe(8);
    expect(KERNEL_RADIUS_PER_SPACING).toBe(2.3);
    expect(DENSITY_THRESHOLD).toBe(0.5);
    expect(EDGE_SOFTNESS).toBe(0.1);
    expect(grid.KERNEL_RADIUS_CAP_PX).toBe(KERNEL_RADIUS_CAP_PX);
    expect(grid.KERNEL_RADIUS_PER_SPACING).toBe(KERNEL_RADIUS_PER_SPACING);
    expect(grid.DENSITY_THRESHOLD).toBe(DENSITY_THRESHOLD);
    expect(grid.EDGE_SOFTNESS).toBe(EDGE_SOFTNESS);
    const src = readFileSync(resolve(RENDERERS, "density-grid.ts"), "utf8");
    expect(src).toContain('from "./kernel-params"');
    expect(src).not.toMatch(/export const (KERNEL_RADIUS_CAP_PX|KERNEL_RADIUS_PER_SPACING|DENSITY_THRESHOLD|EDGE_SOFTNESS)\b/);
  });

  it("given_a_spacing_when_kernelRadiusPx_then_min_of_the_cap_and_2_3_spacing_and_the_cap_for_non_finite_or_non_positive", () => {
    expect(kernelRadiusPx(2)).toBeCloseTo(4.6, 12);
    expect(kernelRadiusPx(3)).toBeCloseTo(6.9, 12);
    expect(kernelRadiusPx(8 / 2.3)).toBeCloseTo(8, 12);
    expect(kernelRadiusPx(4)).toBe(8);
    expect(kernelRadiusPx(100)).toBe(8);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(kernelRadiusPx(bad), String(bad)).toBe(8);
  });

  it("given_kernelWeight_when_integrated_over_its_disk_then_it_returns_the_mass_and_it_is_zero_at_and_beyond_R", () => {
    const R = 6.9;
    const mass = 9;
    const h = 0.05;
    let sum = 0;
    for (let y = -R; y <= R; y += h) {
      for (let x = -R; x <= R; x += h) sum += kernelWeight(Math.hypot(x, y), R, mass) * h * h;
    }
    expect(Math.abs(sum - mass) / mass).toBeLessThan(0.005);
    expect(kernelWeight(0, R, mass)).toBeCloseTo((3 * mass) / (Math.PI * R * R), 12);
    expect(kernelWeight(R, R, mass)).toBe(0);
    expect(kernelWeight(R + 0.1, R, mass)).toBe(0);
    for (const badR of [0, -2, Number.NaN]) expect(kernelWeight(1, badR, mass)).toBe(0);
    for (const badMass of [0, -1, Number.NaN]) expect(kernelWeight(1, R, badMass)).toBe(0);
    expect(kernelWeight(Number.NaN, R, mass)).toBe(0);
  });

  it("given_one_splat_when_the_density_grid_is_sampled_at_cell_centres_then_each_cell_equals_kernelWeight_there", () => {
    const g = new grid.DensityGrid(2);
    g.resize(64, 64);
    const x = 31.3;
    const y = 27.9;
    const mass = 9;
    const R = kernelRadiusPx(3);
    g.splat(x, y, mass, R, [255, 0, 0, 1]);
    let nonZero = 0;
    for (let iy = 0; iy < g.height; iy++) {
      for (let ix = 0; ix < g.width; ix++) {
        const want = kernelWeight(Math.hypot((ix + 0.5) * 2 - x, (iy + 0.5) * 2 - y), R, mass);
        const got = g.density(ix, iy);
        expect(Math.abs(got - want), `cell (${ix}, ${iy})`).toBeLessThanOrEqual(1e-6 * Math.max(1, want));
        if (got > 0) nonZero++;
      }
    }
    expect(nonZero).toBeGreaterThan(30);
  });

  it("given_the_canvas2d_renderer_when_splatting_then_the_radius_is_kernelRadiusPx_of_the_paint_spacing", async () => {
    const splat = vi.spyOn(grid.DensityGrid.prototype, "splat");
    const r = new FluidCanvas2DRenderer();
    await r.init(document.createElement("canvas"));
    r.resize(200, 100, 1);
    for (const spacing of [2, 5]) {
      splat.mockClear();
      r.render(onePaintFrame(spacing));
      expect(splat).toHaveBeenCalledTimes(16);
      for (const call of splat.mock.calls) expect(call[3]).toBe(kernelRadiusPx(spacing));
    }
    expect(readFileSync(resolve(RENDERERS, "fluid-canvas2d.ts"), "utf8")).toContain("kernelRadiusPx(paint.spacingPx)");
  });
});
