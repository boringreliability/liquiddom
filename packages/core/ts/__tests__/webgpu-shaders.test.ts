/**
 * W71 (D71-3, D71-5, D71-6, Review Focus 3 and 4): static checks of the WGSL sources. The
 * e2e webgpu-liquid.spec.ts compiles and validates them on a real adapter.
 */
import { describe, expect, it } from "vitest";
import {
  COMPOSITE_WGSL, FINV_NORM_CLAMP, REST_WGSL, SPLAT_WGSL, TEXT_COMPOSITE_WGSL, TEXT_DET_EPS, TEXT_WGSL,
} from "../src/renderers/webgpu/shaders";

describe("W71 WGSL sources", () => {
  // W74 red: approved-test change (D74-4: two more shaders; the splat reads the 32-byte particle)
  it("given_the_five_shaders_when_read_then_each_has_a_vs_and_an_fs_entry_point_and_binds_group_0_only", () => {
    for (const src of [SPLAT_WGSL, COMPOSITE_WGSL, REST_WGSL, TEXT_WGSL, TEXT_COMPOSITE_WGSL]) {
      expect(src).toMatch(/@vertex\s+fn vs\(/);
      expect(src).toMatch(/@fragment\s+fn fs\(/);
      expect(src).not.toMatch(/@group\([1-9]\)/);
    }
    expect(SPLAT_WGSL).toContain("var<storage, read> particles: array<Particle>;");
    expect(SPLAT_WGSL).toContain("particles[ii].a.xy");
  });

  it("given_SPLAT_WGSL_when_read_then_it_embeds_the_shared_kernel_cap_normalises_by_pi_R2_over_3_and_skips_unassigned_or_resting_particles", () => {
    // W77 red: approved-test change (D77-1, approved 2026-10-10, saga dec_279c7763): the shared cap 8 → 16 px.
    expect(SPLAT_WGSL).toContain("const KERNEL_RADIUS_CAP_PX: f32 = 16.0;");
    expect(SPLAT_WGSL).toContain("e.mass / (PI * r2 / 3.0)");
    expect(SPLAT_WGSL).toContain("home < 0");
    expect(SPLAT_WGSL).toContain("e.rest_alpha >= 1.0"); // D71-6: skipped at rest
    expect(SPLAT_WGSL).toContain("e.flags < 0.5"); // Review Focus 3: unpainted or inactive slot
    expect(SPLAT_WGSL).toMatch(/@location\(0\) acc: vec4f,\s*@location\(1\) acc_alpha: f32/);
  });

  it("given_COMPOSITE_WGSL_when_read_then_threshold_and_edge_come_from_kernel_params_the_sum_is_guarded_and_the_output_is_premultiplied", () => {
    expect(COMPOSITE_WGSL).toContain("const DENSITY_THRESHOLD: f32 = 0.5;");
    expect(COMPOSITE_WGSL).toContain("const EDGE_SOFTNESS: f32 = 0.1;");
    expect(COMPOSITE_WGSL).toContain("fwidth(sum_w)");
    expect(COMPOSITE_WGSL).toContain("1.0 / max(sum_w, SUM_W_EPS)"); // Review Focus 4: Σw = 0 never divides by zero
    expect(COMPOSITE_WGSL).toContain("return vec4f(rgb * alpha, alpha);");
  });

  it("given_REST_WGSL_when_read_then_alpha_is_coverage_times_rest_alpha_times_colour_alpha_with_analytic_aa_and_premultiplied", () => {
    expect(REST_WGSL).toContain("clamp(0.5 - sd * view.dpr, 0.0, 1.0)");
    expect(REST_WGSL).toContain("coverage * in.shape.w * clamp(in.color.a, 0.0, 1.0)");
    expect(REST_WGSL).toContain("return vec4f(in.color.rgb * alpha, alpha);");
  });

  // W71.4 review fix (Minor 2): the fwidth-widened edge never reaches Σw = 0 (no halo around steep blobs).
  it("given_COMPOSITE_WGSL_when_read_then_the_edge_softness_is_clamped_below_the_threshold", () => {
    expect(COMPOSITE_WGSL).toContain("const EDGE_SOFTNESS_MAX: f32 = 0.45;");
    expect(COMPOSITE_WGSL).toContain("clamp(0.75 * fwidth(sum_w), EDGE_SOFTNESS, EDGE_SOFTNESS_MAX)");
  });

  it("given_TEXT_WGSL_when_read_then_it_splats_t1_and_t1w_with_the_liquids_kernel_and_skips_resting_unpainted_or_textless_elements", () => {
    // W77 red: approved-test change (D77-1, approved 2026-10-10, saga dec_279c7763): the shared cap 8 → 16 px.
    expect(TEXT_WGSL).toContain("const KERNEL_RADIUS_CAP_PX: f32 = 16.0;");
    expect(TEXT_WGSL).toContain("e.mass / (PI * r2 / 3.0)");
    expect(TEXT_WGSL).toContain("1.0 / max(view.dpr * view.t0_scale, 1e-6)"); // the splat's T0-texel floor
    expect(TEXT_WGSL).toContain("e.rest_alpha >= 1.0");
    expect(TEXT_WGSL).toContain("e.flags < 0.5");
    expect(TEXT_WGSL).toContain("info.size.z < 0.5");
    expect(TEXT_WGSL).toContain("var<storage, read> rest_uv: array<vec2f>;");
    expect(TEXT_WGSL).toContain("var<storage, read> text_info: array<TextInfo>;");
    expect(TEXT_WGSL).toMatch(/@location\(0\) acc: vec4f,\s*@location\(1\) acc_w: f32/);
  });

  it("given_TEXT_WGSL_when_read_then_f_inverse_is_norm_clamped_to_2_and_coverage_is_0_when_torn_degenerate_or_outside_the_unit_square_d74_4", () => {
    expect([FINV_NORM_CLAMP, TEXT_DET_EPS]).toEqual([2, 1e-4]);
    expect(TEXT_WGSL).toContain("const FINV_NORM_CLAMP: f32 = 2.0;");
    expect(TEXT_WGSL).toContain("const TEXT_DET_EPS: f32 = 0.0001;");
    expect(TEXT_WGSL).toContain("vec4f(f.w, -f.y, -f.z, f.x) / det");
    expect(TEXT_WGSL).toContain("smin * FINV_NORM_CLAMP < 1.0");
    expect(TEXT_WGSL).toContain("(u32(p.b.z) & FLAG_TORN) != 0u");
    expect(TEXT_WGSL).toContain("abs(det) < TEXT_DET_EPS");
    expect(TEXT_WGSL).toContain("all(uv >= vec2f(0.0, 0.0)) && all(uv <= vec2f(1.0, 1.0))");
    expect(TEXT_WGSL).toContain("out.acc_w = w;"); // torn and outside particles still add Σw
  });

  it("given_TEXT_COMPOSITE_WGSL_when_read_then_t1_over_t1w_is_thresholded_like_the_liquid_and_premultiplied", () => {
    expect(TEXT_COMPOSITE_WGSL).toContain("const DENSITY_THRESHOLD: f32 = 0.5;");
    expect(TEXT_COMPOSITE_WGSL).toContain("clamp(0.75 * fwidth(sum_w), EDGE_SOFTNESS, EDGE_SOFTNESS_MAX)");
    expect(TEXT_COMPOSITE_WGSL).toContain("acc / max(sum_w, SUM_W_EPS)");
    expect(TEXT_COMPOSITE_WGSL).toContain("return text * coverage;");
  });
});
