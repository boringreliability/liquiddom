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
    // W77 red: approved-test change (D77-1, approved 2026-10-10, saga dec_279c7763)
    expect(KERNEL_RADIUS_CAP_PX).toBe(16);
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
    // W77 red: approved-test change (D77-1, approved 2026-10-10, saga dec_279c7763): 2.3 × spacing up to the 16 px cap (was 8). The landing page's spacing 5.42–5.67 px
    // now gets 12.47–13.04 px (was capped at 8 px = 1.45 × spacing).
    expect(kernelRadiusPx(2)).toBeCloseTo(4.6, 12);
    expect(kernelRadiusPx(3)).toBeCloseTo(6.9, 12);
    expect(kernelRadiusPx(4)).toBeCloseTo(9.2, 12);
    expect(kernelRadiusPx(5.42)).toBeCloseTo(12.466, 12);
    expect(kernelRadiusPx(16 / 2.3)).toBeCloseTo(16, 12);
    expect(kernelRadiusPx(8)).toBe(16);
    expect(kernelRadiusPx(100)).toBe(16);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(kernelRadiusPx(bad), String(bad)).toBe(16);
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

// =============================================================================
// W77 (D77-1): the kernel reach follows the spacing up to 16 px, and the Canvas2D density grid
// cell scales with the largest kernel radius so a splat touches as many cells as at R = 8 px on
// the 2 px grid (the splat cost per particle stays flat on large-area pages).
// =============================================================================

/** Cells with density > 0 after one splat of radius `R` at an off-centre point on a grid of `scalePx`. */
function touchedCells(scalePx: number, R: number): number {
  const g = new grid.DensityGrid(scalePx);
  g.resize(200, 200);
  g.splat(100.3, 99.7, 9, R, [255, 0, 0, 1]);
  let n = 0;
  for (let iy = 0; iy < g.height; iy++) for (let ix = 0; ix < g.width; ix++) if (g.density(ix, iy) > 0) n++;
  return n;
}

describe("W77 density grid cell (D77-1)", () => {
  it("given_the_largest_kernel_radius_when_densityCellPx_then_max_of_2px_and_ceil_R_over_4_with_bad_or_oversized_radii_taking_the_cap", () => {
    expect(grid.DEFAULT_SCALE_PX).toBe(2);
    expect(grid.DENSITY_CELLS_PER_RADIUS).toBe(4);
    const cell = grid.densityCellPx;
    // The acceptance scene (R 7.09–7.36 px) keeps the 2 px grid: its frames do not change.
    expect(cell(4.6)).toBe(2);
    expect(cell(7.09)).toBe(2);
    expect(cell(7.36)).toBe(2);
    expect(cell(8)).toBe(2);
    // Quarter-px steps above 8 px: ceil(R) / 4.
    expect(cell(8.01)).toBe(2.25);
    expect(cell(12.466)).toBe(3.25); // landing cards, spacing 5.42 px
    expect(cell(13.04)).toBe(3.5); // landing pills, spacing 5.67 px
    expect(cell(16)).toBe(4);
    // A radius above the cap is capped first; a bad radius gets the cap (kernelRadiusPx's contract).
    expect(cell(100)).toBe(4);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(cell(bad), String(bad)).toBe(4);
  });

  it("given_a_splat_at_R_on_the_densityCellPx_R_grid_when_counting_touched_cells_then_at_most_1_15x_a_splat_at_8px_on_the_2px_grid", () => {
    const reference = touchedCells(2, 8);
    expect(reference).toBeGreaterThan(40); // π·8²/2² ≈ 50 cells
    for (const R of [kernelRadiusPx(5.42), kernelRadiusPx(5.67), 16]) {
      const n = touchedCells(grid.densityCellPx(R), R);
      expect(n, `R ${R.toFixed(2)} px on ${grid.densityCellPx(R)} px cells: ${n} vs ${reference}`).toBeLessThanOrEqual(1.15 * reference);
    }
    // Without the scaling the 16 px kernel touches ≈4× the cells (the spike's 12 → 21.5 ms Canvas2D frame).
    expect(touchedCells(2, 16)).toBeGreaterThan(3 * reference);
  });

  it("given_paints_whose_largest_kernel_radius_changes_when_rendering_then_the_grid_cell_follows_densityCellPx_and_the_buffer_is_reallocated_only_on_a_change", async () => {
    const r = new FluidCanvas2DRenderer();
    await r.init(document.createElement("canvas"));
    r.resize(200, 100, 1);
    const created = (): unknown[][] => fake.contexts.flatMap((c) => c.ops("createImageData").map((op) => op.args));
    expect(created().at(-1)).toEqual([100, 50]);

    r.render(onePaintFrame(3.09)); // acceptance spacing: R 7.11 px
    expect(r.densityCellPx).toBe(2);
    const before = created().length;

    r.render(onePaintFrame(5.42)); // landing card spacing: R 12.47 px
    expect(r.densityCellPx).toBe(3.25);
    expect(created().at(-1), "buffer sized to the new cell").toEqual([Math.ceil(200 / 3.25), Math.ceil(100 / 3.25)]);
    const afterChange = created().length;
    expect(afterChange).toBe(before + 1);

    r.render(onePaintFrame(5.42));
    r.render(onePaintFrame(5.42));
    expect(created().length, "no reallocation while the cell stays the same").toBe(afterChange);

    r.render(onePaintFrame(3.09));
    expect(r.densityCellPx).toBe(2);
    expect(created().at(-1)).toEqual([100, 50]);
  });

  // W77 red review (findings 1 and 2): the cell follows only paints that have particles, and it is
  // bounded by the smallest kernel radius as well, so no element's kernel falls under 2.3 cells per
  // radius (it never reaches the one-cell floor in DensityGrid.splat, where Canvas2D would diverge
  // from WebGPU's kernel, D71-5).
  it("given_the_largest_and_smallest_kernel_radius_when_densityCellPx_then_the_cell_is_never_coarser_than_the_finest_spacing", () => {
    const cell = grid.densityCellPx;
    // One radius: the min bound is looser than ceil(R) / 4, so the single-radius rule is unchanged.
    expect(cell(13.04, 13.04)).toBe(3.5);
    // The landing page (cards R 12.47, pills R 13.04): unchanged, 3.5 px.
    expect(cell(13.04, kernelRadiusPx(5.42))).toBe(3.5);
    // A 16 px kernel next to an acceptance-sized one (spacing 3.2, R 7.36): the cell drops to the
    // finest spacing in quarter px, floor(4 · 3.2) / 4 = 3 (not 4).
    expect(cell(16, kernelRadiusPx(3.2))).toBe(3);
    // Next to a fine element (spacing 2, R 4.6) the grid stays at 2 px.
    expect(cell(16, kernelRadiusPx(2))).toBe(2);
    // The 2 px floor (DEFAULT_SCALE_PX, WebGPU's 0.5× backing at DPR 1) still wins for spacings under 2 px.
    expect(cell(16, kernelRadiusPx(0.5))).toBe(2);
    // A bad smallest radius adds no bound; a smallest radius above the largest is clamped to it.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(cell(16, bad), String(bad)).toBe(4);
    expect(cell(8, 16)).toBe(2);
    // The property: every kernel spans at least 2.3 cells per radius whenever the grid is coarser than 2 px.
    for (const maxR of [8.01, 10, 12.47, 13.04, 16]) {
      for (const minSpacing of [2.2, 2.6, 3.09, 3.5, 4.4, 5.42, 6.5]) {
        const minR = Math.min(kernelRadiusPx(minSpacing), maxR);
        const c = cell(maxR, minR);
        if (c > grid.DEFAULT_SCALE_PX) expect(minR / c, `maxR ${maxR}, minR ${minR.toFixed(2)}: cell ${c}`).toBeGreaterThanOrEqual(KERNEL_RADIUS_PER_SPACING - 1e-9);
      }
    }
  });

  it("given_a_paint_without_particles_or_with_a_non_positive_spacing_when_rendering_then_it_does_not_coarsen_the_grid", async () => {
    const r = new FluidCanvas2DRenderer();
    await r.init(document.createElement("canvas"));
    r.resize(200, 100, 1);
    // spacingPx = sqrt(areaPerParticle) is 0 for an observed element without particles (hidden,
    // zero-size or waiting for redistribute); kernelRadiusPx(0) is the cap, which would put the
    // whole page on the 4 px grid.
    r.render(paintsFrame([{ spacingPx: 3.09, particleCount: 16 }, { spacingPx: 0, particleCount: 0 }]));
    expect(r.densityCellPx, "a zero-particle paint is skipped").toBe(2);
    r.render(paintsFrame([{ spacingPx: 3.09, particleCount: 16 }, { spacingPx: 0, particleCount: 8 }]));
    expect(r.densityCellPx, "a zero spacing is skipped").toBe(2);
    r.render(paintsFrame([{ spacingPx: 3.09, particleCount: 16 }, { spacingPx: Number.NaN, particleCount: 8 }]));
    expect(r.densityCellPx, "a non-finite spacing is skipped").toBe(2);
  });

  it("given_paints_with_mixed_spacings_when_rendering_then_the_cell_is_bounded_by_the_smallest_kernel_radius_and_each_splat_keeps_its_own_radius", async () => {
    const splat = vi.spyOn(grid.DensityGrid.prototype, "splat");
    const r = new FluidCanvas2DRenderer();
    await r.init(document.createElement("canvas"));
    r.resize(200, 100, 1);
    // Spacing 2.6 (R 5.98) moving next to spacing 6.5 (R 14.95): ceil(14.95) / 4 = 3.75 px would put
    // the fine element at 1.6 cells per radius; the bound keeps 2.5 px (floor(4 · 2.6) / 4).
    r.render(paintsFrame([{ spacingPx: 2.6, particleCount: 16 }, { spacingPx: 6.5, particleCount: 16 }]));
    expect(r.densityCellPx).toBe(2.5);
    expect(kernelRadiusPx(2.6) / r.densityCellPx).toBeGreaterThanOrEqual(KERNEL_RADIUS_PER_SPACING);
    // One kernel in both renderers (D71-5): each splat still gets its own paint's kernelRadiusPx.
    expect(splat).toHaveBeenCalled();
    for (const call of splat.mock.calls) expect(call[3]).toBe(kernelRadiusPx(2.6));
  });
});

/**
 * W77 red review: a frame with one paint per spec (ids 0, 1, …); 16 moving particles belong to
 * paint 0, the other paints are at rest. Only `particleCount` and `spacingPx` differ per paint.
 */
function paintsFrame(specs: ReadonlyArray<{ spacingPx: number; particleCount: number }>): RenderFrame {
  const base = onePaintFrame(specs[0]!.spacingPx);
  const n = specs.length;
  const elementView = new Float32Array(n * ELEMENT_STRIDE);
  const stateView = new Float32Array(n * STATE_STRIDE);
  const paints: ElementPaint[] = specs.map((s, id) => {
    elementView.set([40 + 60 * id, 40, 40, 20, 4, 0, 0, 0, Number.NaN, Number.NaN], id * ELEMENT_STRIDE);
    stateView[id * STATE_STRIDE + St.REST_ALPHA] = id === 0 ? 0 : 1;
    return { ...base.paints[0]!, id, particleCount: s.particleCount, areaPerParticle: s.spacingPx * s.spacingPx, spacingPx: s.spacingPx };
  });
  return { ...base, elementView, stateView, paints };
}
