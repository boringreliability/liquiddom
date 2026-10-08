/** W72 (D72-4): splat overdraw estimate — Σ over elements with restAlpha < 1 of particles × (2·R·dpr·t0Scale)². */
import { describe, it, expect } from "vitest";
import { estimateSplatFragments } from "../src/renderers/webgpu/overdraw";
import { kernelRadiusPx, KERNEL_RADIUS_CAP_PX } from "../src/renderers/kernel-params";
import type { ElementPaint, RenderFrame } from "../src/renderers/frame";
import { St, STATE_STRIDE } from "../src/fluid-layout";

function paint(id: number, particleCount: number, spacingPx: number): ElementPaint {
  return {
    id,
    background: [0, 0, 0, 1],
    text: [0, 0, 0, 1],
    radiusPx: 0,
    particleCount,
    areaPerParticle: spacingPx * spacingPx,
    spacingPx,
    atlasRect: null,
  };
}

function frame(paints: Array<ElementPaint | undefined>, restAlphas: number[], dpr = 1, activeParticles = 1000): RenderFrame {
  const stateView = new Float32Array(Math.max(1, restAlphas.length) * STATE_STRIDE);
  restAlphas.forEach((a, id) => {
    stateView[id * STATE_STRIDE + St.REST_ALPHA] = a;
  });
  return {
    dynamicView: new Float32Array(0),
    staticView: new Float32Array(0),
    generation: 1,
    stateView,
    elementView: new Float32Array(0),
    particleCapacity: 1000,
    activeParticles,
    paints,
    viewport: { widthCss: 1280, heightCss: 800, dpr },
    reducedMotion: false,
  };
}

const quad = (spacing: number, dpr: number, scale: number): number => (2 * kernelRadiusPx(spacing) * dpr * scale) ** 2;

describe("W72: estimateSplatFragments (D72-4)", () => {
  it("given_resting_and_moving_elements_when_estimated_then_only_restAlpha_below_1_counts_particles_times_quad_area", () => {
    const f = frame([paint(0, 700, 2), paint(1, 300, 3), paint(2, 500, 2)], [0.5, 0, 1]);
    const expected = Math.round(700 * quad(2, 1, 0.5) + 300 * quad(3, 1, 0.5));
    expect(estimateSplatFragments(f, 0.5)).toBe(expected);
    expect(expected).toBeGreaterThan(0);
    // R = min(8, 2.3·2) = 4.6 px → a 4.6 px quad side at dpr 1 and scale 0.5 → 700 · 21.16 ≈ 14 812.
    expect(Math.round(700 * quad(2, 1, 0.5))).toBe(14_812);
    expect(estimateSplatFragments(frame([paint(0, 700, 2)], [1]), 0.5)).toBe(0);
  });

  it("given_dpr_scale_and_degenerate_paints_when_estimated_then_quad_side_scales_and_unpainted_or_empty_slots_add_nothing", () => {
    const base = estimateSplatFragments(frame([paint(0, 700, 2)], [0]), 0.5);
    // Side ∝ dpr · scale: dpr 2 and scale 0.75 → (2 · 0.75 / 0.5)² = 9×.
    expect(estimateSplatFragments(frame([paint(0, 700, 2)], [0], 2), 0.75)).toBe(Math.round(700 * quad(2, 2, 0.75)));
    expect(Math.abs(estimateSplatFragments(frame([paint(0, 700, 2)], [0], 2), 0.75) - 9 * base)).toBeLessThanOrEqual(9);
    // Unpainted slot, empty element, NaN restAlpha, no active particles, bad scale → 0.
    expect(estimateSplatFragments(frame([undefined, paint(1, 0, 2)], [0, 0]), 0.5)).toBe(0);
    expect(estimateSplatFragments(frame([paint(0, 700, 2)], [Number.NaN]), 0.5)).toBe(0);
    expect(estimateSplatFragments(frame([paint(0, 700, 2)], [0], 1, 0), 0.5)).toBe(0);
    expect(estimateSplatFragments(frame([paint(0, 700, 2)], [0]), Number.NaN)).toBe(0);
    // A non-finite spacing uses the capped radius (kernelRadiusPx contract) and a bad dpr counts as 1.
    expect(estimateSplatFragments(frame([paint(0, 10, Number.NaN)], [0]), 0.5)).toBe(10 * (2 * KERNEL_RADIUS_CAP_PX * 0.5) ** 2);
    expect(estimateSplatFragments(frame([paint(0, 700, 2)], [0], 0), 0.5)).toBe(base);
  });
});
