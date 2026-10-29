/**
 * W88 (D88-4, D88-6, D88-11): the shadow casters both renderers share, and the WebGPU plan: one
 * density source per element and distinct spread, exact radius groups (half resolution, quarter for
 * blur ≥ 32 px), the bucket overflow past six radii, the spread kernel, the source cap.
 */
import { describe, expect, it } from "vitest";
import { Dyn, DYNAMIC_FIELDS, ELEMENT_STRIDE, FLAG_PARKED, Interaction, St, STATE_STRIDE, Stat, STATIC_FIELDS } from "../src/fluid-layout";
import type { ElementPaint, RenderFrame } from "../src/renderers/frame";
import {
  nearestBucket,
  planShadows,
  SHADOW_MAX_EXACT_GROUPS,
  SHADOW_MAX_SOURCES,
  SHADOW_QUARTER_FROM_PX,
  SHADOW_SCALE_HALF,
  SHADOW_SCALE_QUARTER,
  clampSpread,
  ShadowCasters,
  spreadKernel,
} from "../src/renderers/shadow-plan";
import { parseBoxShadow, type ShadowLayer } from "../src/shadow";

const PER = 20; // particles per element: a 10 × 2 block on a 4 px lattice
const paint = (id: number, shadows: readonly ShadowLayer[]): ElementPaint => ({
  id, background: [47, 111, 222, 1], text: [255, 255, 255, 1], radiusPx: 8, particleCount: PER, areaPerParticle: 16, spacingPx: 4, atlasRect: null, shadows,
});

/** `paints.length` elements side by side, every one moving (restAlpha 0) unless `rest` names it. */
function frame(paints: Array<ElementPaint | undefined>, o: { rest?: number[]; parked?: number[]; w0?: number[]; dragged?: number[] } = {}): RenderFrame {
  const n = paints.length;
  const cap = PER * n;
  const dynamicView = new Float32Array(cap * DYNAMIC_FIELDS);
  const staticView = new Float32Array(cap * STATIC_FIELDS);
  const stateView = new Float32Array(n * STATE_STRIDE);
  const elementView = new Float32Array(n * ELEMENT_STRIDE);
  for (let id = 0; id < n; id++) {
    elementView.set([100 + 60 * id, 100, 40, 8, 4, o.dragged?.includes(id) ? Interaction.DRAGGED : Interaction.IDLE, 0, 0, NaN, NaN], id * ELEMENT_STRIDE);
    if (o.w0?.includes(id)) elementView[id * ELEMENT_STRIDE + 2] = 0;
    stateView[id * STATE_STRIDE + St.REST_ALPHA] = o.rest?.includes(id) ? 1 : 0;
    for (let k = 0; k < PER; k++) {
      const i = id * PER + k;
      dynamicView[Dyn.X * cap + i] = 102 + 60 * id + 4 * (k % 10);
      dynamicView[Dyn.Y * cap + i] = 102 + 4 * Math.floor(k / 10);
      dynamicView[Dyn.FLAGS * cap + i] = o.parked?.includes(id) ? FLAG_PARKED : 0;
      staticView[Stat.HOME * cap + i] = id;
    }
  }
  return {
    dynamicView, staticView, generation: 1, stateView, elementView, particleCapacity: cap, activeParticles: cap,
    paints, viewport: { widthCss: 800, heightCss: 600, dpr: 2 }, reducedMotion: false,
  };
}

const L = (css: string): readonly ShadowLayer[] => parseBoxShadow(css);
const TEXEL = 1; // CSS px of one half-resolution texel at dpr 2

describe("W88: ShadowCasters (D88-4)", () => {
  it("given_moving_resting_parked_inactive_dragged_and_shadowless_elements_when_collected_then_only_moving_or_dragged_active_elements_with_layers_with_their_particles_and_bounds", () => {
    const drop = L("rgba(0, 0, 0, 0.4) 0px 8px 20px 0px");
    const f = frame([paint(0, drop), paint(1, drop), paint(2, drop), paint(3, drop), paint(4, []), paint(5, drop), undefined], {
      rest: [1, 5], parked: [2], w0: [3], dragged: [5],
    });
    const c = new ShadowCasters();
    expect(c.collect(f)).toBe(2);
    expect(c.ids, "0 moves, 5 is dragged at rest; 1 rests, 2 is parked, 3 inactive, 4 has no layers, 6 no paint").toEqual([0, 5]);
    expect(Array.from(c.bounds.subarray(0, 4))).toEqual([102, 102, 138, 106]);
    expect(c.count[0]).toBe(PER);
    const mine = Array.from(c.order.subarray(c.start[0]!, c.start[0]! + c.count[0]!));
    expect(mine).toEqual(Array.from({ length: PER }, (_, k) => k));
    expect(c.collect({ ...f, reducedMotion: true }), "reduced motion").toBe(0);
    expect(c.collect({ ...f, suppressShadows: true }), "the stop repaint").toBe(0);
    expect(c.ids).toEqual([]);
  });
});

describe("W88: the WebGPU shadow plan (D88-6, D88-11)", () => {
  it("given_layers_with_three_distinct_blurs_on_two_elements_when_planned_then_three_exact_groups_one_record_per_layer_last_css_layer_first_and_offsets_in_the_records", () => {
    const f = frame([
      paint(0, L("rgb(0, 255, 255) 0px 0px 12px 0px, rgba(0, 0, 0, 0.4) 0px 8px 20px 0px")),
      paint(1, L("rgba(0, 0, 0, 0.4) 2px 8px 20px 0px, rgb(255, 0, 0) 0px 0px 5px 0px")),
    ]);
    const c = new ShadowCasters();
    c.collect(f);
    const plan = planShadows(c, f, TEXEL);
    expect(plan.drawn).toEqual([0, 1]);
    expect(plan.groups.map((g) => [g.blur, g.scale, g.count])).toEqual([[20, SHADOW_SCALE_HALF, 2], [12, SHADOW_SCALE_HALF, 1], [5, SHADOW_SCALE_HALF, 1]]);
    const g20 = plan.groups[0]!;
    const recs = plan.records.slice(g20.first, g20.first + g20.count);
    expect(recs.map((r) => [plan.sources[r.source]!.id, r.dx, r.dy])).toEqual([[0, 0, 8], [1, 2, 8]]);
    expect(plan.records[0]!.color).toEqual([0, 0, 0, 0.4]);
    expect(plan.sources.map((s) => [s.id, s.spread, s.layer, s.channel])).toEqual([[0, 0, 0, 0], [1, 0, 0, 1]]);
    expect(plan.densityLayers).toBe(1);
    const src = plan.sources[0]!;
    expect(src.rect).toEqual({ x0: 102 - src.radius, y0: 102 - src.radius, x1: 138 + src.radius, y1: 106 + src.radius });
    expect(plan.records[0]!.rect).toEqual({ x0: src.rect.x0, y0: src.rect.y0 + 8, x1: src.rect.x1, y1: src.rect.y1 + 8 });
    expect(g20.reach.y1, "3σ = 1.5 × blur beyond the lowest record").toBeCloseTo(src.rect.y1 + 8 + 30, 6);
  });

  it("given_a_blur_at_or_above_32_px_when_planned_then_its_group_uses_the_quarter_resolution_targets", () => {
    expect(SHADOW_QUARTER_FROM_PX).toBe(32);
    const f = frame([paint(0, L("rgb(0, 255, 255) 0px 0px 32px 8px, rgb(0, 255, 255) 0px 0px 31.5px 0px"))]);
    const c = new ShadowCasters();
    c.collect(f);
    expect(planShadows(c, f, TEXEL).groups.map((g) => [g.blur, g.scale])).toEqual([[31.5, SHADOW_SCALE_HALF], [32, SHADOW_SCALE_QUARTER]]);
  });

  it("given_eight_distinct_blurs_when_planned_then_the_first_six_stay_exact_and_the_rest_join_their_log_nearest_bucket_D88_6", () => {
    expect(SHADOW_MAX_EXACT_GROUPS).toBe(6);
    expect([1, 5, 6, 11, 12, 20, 40, 100].map(nearestBucket)).toEqual([4, 4, 8, 8, 16, 16, 32, 64]);
    const blurs = [3, 5, 7, 9, 11, 13, 15, 30];
    const css = blurs.map((b) => `rgb(0, 0, 0) 0px 0px ${b}px 0px`).join(", ");
    const f = frame([paint(0, L(css).slice(0, 4)), paint(1, L(css).slice(4))]);
    const c = new ShadowCasters();
    c.collect(f);
    const keys = planShadows(c, f, TEXEL).groups.map((g) => g.blur);
    // Records go last layer first per element: 0 → 9, 7, 5, 3; 1 → 30, 15, then 13 and 11 overflow.
    expect(keys).toEqual([9, 7, 5, 3, 30, 15, 16, 8]);
  });

  it("given_layers_with_different_spreads_on_one_element_when_planned_then_one_density_source_per_distinct_spread_with_spread_0_first", () => {
    const f = frame([paint(0, L("rgb(0, 0, 0) 0px 4px 0px 6px, rgb(0, 0, 0) 0px 0px 8px 6px, rgb(0, 0, 0) 0px 0px 2px -2px"))]);
    const c = new ShadowCasters();
    c.collect(f);
    const plan = planShadows(c, f, TEXEL);
    expect(plan.sources.map((s) => s.spread)).toEqual([0, 6, -2]);
    expect(plan.records.map((r) => plan.sources[r.source]!.spread)).toEqual([-2, 6, 6]);
    expect(plan.sources[1]!.radius).toBeCloseTo(plan.sources[0]!.radius + 6, 9);
  });

  it("given_more_density_sources_than_four_layers_hold_when_planned_then_whole_elements_that_do_not_fit_are_not_drawn", () => {
    expect(SHADOW_MAX_SOURCES).toBe(16);
    const three = L("rgb(0, 0, 0) 0px 0px 4px 2px, rgb(0, 0, 0) 0px 0px 4px 4px"); // spreads 0 (implied), 2, 4
    const f = frame(Array.from({ length: 7 }, (_, id) => paint(id, three)));
    const c = new ShadowCasters();
    c.collect(f);
    const plan = planShadows(c, f, TEXEL);
    expect(plan.drawn, "5 × 3 sources fit in 16, a sixth element does not").toEqual([0, 1, 2, 3, 4]);
    expect(plan.sources).toHaveLength(15);
    expect(plan.densityLayers).toBe(4);
  });

  it("given_a_spread_when_its_kernel_is_widened_and_mass_scaled_then_a_half_plane_of_particles_reads_density_0_5_at_the_spread_distance", () => {
    const R = 7;
    for (const s of [6, 12, -3]) {
      const k = spreadKernel(R, s);
      expect(k.radius).toBe(R + Math.abs(s));
      // Particles on a 0.5 px lattice fill x < 0 (mass = h²): the density at x = s, y = 0.
      const h = 0.5;
      const Rp = k.radius;
      let rho = 0;
      for (let x = -h / 2; x > s - Rp - 1; x -= h) {
        for (let y = -Rp - 1; y <= Rp + 1; y += h) {
          const q = 1 - ((s - x) ** 2 + y * y) / (Rp * Rp);
          if (q > 0) rho += (h * h * k.weightScale * q * q) / ((Math.PI * Rp * Rp) / 3);
        }
      }
      expect(rho, `spread ${s}`).toBeCloseTo(0.5, 1);
    }
    expect(spreadKernel(R, 0)).toEqual({ radius: R, weightScale: 1 });
  });

  it("given_a_huge_spread_when_planned_then_the_source_kernel_is_R_plus_the_viewport_diagonal_not_R_plus_the_spread_I1", () => {
    const f = frame([paint(0, L("rgba(0, 0, 0, 0.5) 0px 0px 0px 9999px")), undefined]);
    const c = new ShadowCasters();
    c.collect(f);
    const plan = planShadows(c, f, TEXEL);
    const diag = 1000; // 800 × 600
    expect(plan.sources[1]!.radius).toBeCloseTo(plan.sources[0]!.radius + diag, 9);
    expect(plan.sources[1]!.spread).toBe(diag);
  });
});

describe("W88: clampSpread (final review I1)", () => {
  it("given_spreads_when_clamped_then_the_sign_is_kept_the_cap_is_the_viewport_diagonal_and_small_spreads_are_unchanged", () => {
    expect(clampSpread(9999, 400, 300)).toBe(500);
    expect(clampSpread(-9999, 400, 300)).toBe(-500);
    expect(clampSpread(6, 400, 300)).toBe(6);
    expect(clampSpread(-4, 400, 300)).toBe(-4);
    expect(clampSpread(0, 400, 300)).toBe(0);
    expect(clampSpread(500, 400, 300)).toBe(500);
  });

  it("given_a_bad_viewport_when_clamped_then_a_fixed_fallback_cap_applies", () => {
    for (const [w, h] of [[0, 0], [NaN, 300], [400, -1], [Infinity, 300]] as const) {
      expect(clampSpread(99999, w, h)).toBe(4096);
      expect(clampSpread(-99999, w, h)).toBe(-4096);
      expect(clampSpread(7, w, h)).toBe(7);
    }
  });
});
