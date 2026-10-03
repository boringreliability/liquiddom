/** W64: Canvas2D density grid (spec §3 "Canvas2D fallback"). Pure, no DOM. */
import { describe, expect, it } from "vitest";
import type { RGBA } from "../src/color";
import {
  DENSITY_THRESHOLD,
  DensityGrid,
  KERNEL_RADIUS_CAP_PX,
  KERNEL_RADIUS_PER_SPACING,
} from "../src/renderers/density-grid";

const RED: RGBA = [255, 0, 0, 1];
const BLUE: RGBA = [0, 0, 255, 1];

/** Particles on a lattice of `spacing` px filling the rect, one splat each. */
function lattice(g: DensityGrid, x: number, y: number, w: number, h: number, spacing: number, rgb: RGBA, massScale = 1) {
  const mass = spacing * spacing * massScale;
  const radius = Math.min(KERNEL_RADIUS_PER_SPACING * spacing, KERNEL_RADIUS_CAP_PX);
  for (let py = y + spacing / 2; py < y + h; py += spacing) {
    for (let px = x + spacing / 2; px < x + w; px += spacing) g.splat(px, py, mass, radius, rgb);
  }
}

/** Cell index whose centre is at `px` (scale 2: centres at 1, 3, 5, …). */
const cell = (px: number) => Math.floor(px / 2);

describe("W64 DensityGrid", () => {
  it("given_uniform_particles_of_one_element_when_splatted_then_interior_density_near_1_and_0_5_crossing_at_rect_edge", () => {
    const g = new DensityGrid(2);
    g.resize(400, 300);
    lattice(g, 50, 40, 100, 60, 2, RED);
    const row = cell(71);
    expect(Math.abs(g.density(cell(101), row) - 1)).toBeLessThan(0.05);
    // Left edge x = 50: the cell centred at 49 is outside, at 51 inside.
    expect(g.density(cell(49), row)).toBeLessThan(DENSITY_THRESHOLD);
    expect(g.density(cell(51), row)).toBeGreaterThan(DENSITY_THRESHOLD);
    // Right edge x = 150.
    expect(g.density(cell(149), row)).toBeGreaterThan(DENSITY_THRESHOLD);
    expect(g.density(cell(151), row)).toBeLessThan(DENSITY_THRESHOLD);
  });

  it("given_two_elements_with_different_spacing_when_splatted_then_each_normalised_independently", () => {
    const g = new DensityGrid(2);
    g.resize(400, 300);
    lattice(g, 20, 40, 120, 100, 2, RED); // R = 4.6 px
    lattice(g, 220, 40, 120, 100, 4, BLUE); // R = 9.2 → capped at 8 px
    expect(Math.abs(g.density(cell(81), cell(91)) - 1)).toBeLessThan(0.06);
    expect(Math.abs(g.density(cell(281), cell(91)) - 1)).toBeLessThan(0.06);
  });

  it("given_overlapping_elements_when_resolving_color_then_rgb_is_density_weighted_blend", () => {
    const g = new DensityGrid(2);
    g.resize(400, 300);
    lattice(g, 50, 40, 100, 60, 2, RED, 1);
    lattice(g, 50, 40, 100, 60, 2, BLUE, 3);
    const [r, gg, b, a] = g.color(cell(101), cell(71));
    expect(r).toBeCloseTo(255 * 0.25, 0);
    expect(gg).toBeCloseTo(0, 5);
    expect(b).toBeCloseTo(255 * 0.75, 0);
    expect(a).toBeCloseTo(1, 5);
    expect(g.density(cell(101), cell(71))).toBeCloseTo(4, 0);
  });

  it("given_radius_request_above_8px_when_splatting_then_capped_at_8px", () => {
    const g = new DensityGrid(2);
    g.resize(400, 300);
    g.splat(101, 101, 50, 20, RED);
    expect(g.density(cell(101), cell(101))).toBeGreaterThan(0);
    expect(g.density(cell(107), cell(101))).toBeGreaterThan(0); // 6 px away
    expect(g.density(cell(109), cell(101))).toBe(0); // 8 px away: outside the capped kernel
    let total = 0;
    for (let iy = 0; iy < g.height; iy++) for (let ix = 0; ix < g.width; ix++) total += g.density(ix, iy) * 4;
    expect(Math.abs(total - 50) / 50).toBeLessThan(0.05);
  });

  it("given_threshold_when_writing_image_then_interior_opaque_outside_transparent_with_element_colour", () => {
    const g = new DensityGrid(2);
    g.resize(400, 300);
    lattice(g, 50, 40, 100, 60, 2, BLUE);
    const data = new Uint8ClampedArray(g.width * g.height * 4);
    g.writeImage(data);
    const px = (ix: number, iy: number) => Array.from(data.subarray((iy * g.width + ix) * 4, (iy * g.width + ix) * 4 + 4));
    expect(px(cell(101), cell(71))).toEqual([0, 0, 255, 255]);
    expect(px(cell(181), cell(71))).toEqual([0, 0, 0, 0]);
    g.clear();
    expect(g.isEmpty).toBe(true);
    expect(g.density(cell(101), cell(71))).toBe(0);
  });
});
