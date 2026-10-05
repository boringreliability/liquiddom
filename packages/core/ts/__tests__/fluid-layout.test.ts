/** @vitest-environment node */
/**
 * W64: the TS layout mirror equals src/fluid/layout.rs (spec §2: "A test
 * asserts they match"), including HOVER_SWELL (plan resolution B1), and the
 * home-rect rule the rest contour is drawn at.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as L from "../src/fluid-layout";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const LAYOUT_RS = readFileSync(resolve(ROOT, "src/fluid/layout.rs"), "utf-8");

function rustConstants(): Map<string, number> {
  const out = new Map<string, number>();
  const re = /^pub const ([A-Z0-9_]+): (?:usize|u32|f32) = (-?[0-9][0-9_.]*);/gm;
  for (const m of LAYOUT_RS.matchAll(re)) out.set(m[1], Number(m[2].replace(/_/g, "")));
  return out;
}

const TS_MIRROR: Record<string, number> = {
  ELEMENT_STRIDE: L.ELEMENT_STRIDE,
  EL_X: L.El.X,
  EL_Y: L.El.Y,
  EL_W: L.El.W,
  EL_H: L.El.H,
  EL_RADIUS: L.El.RADIUS,
  EL_INTERACTION: L.El.INTERACTION,
  EL_HOME_DX: L.El.HOME_DX,
  EL_HOME_DY: L.El.HOME_DY,
  EL_VISCOSITY: L.El.VISCOSITY,
  EL_RECOVERY: L.El.RECOVERY,
  STATE_STRIDE: L.STATE_STRIDE,
  ST_S: L.St.S,
  ST_MAX_DEV: L.St.MAX_DEV,
  ST_REST_ALPHA: L.St.REST_ALPHA,
  ST_RESERVED: L.St.RESERVED,
  DYNAMIC_FIELDS: L.DYNAMIC_FIELDS,
  DYN_X: L.Dyn.X,
  DYN_Y: L.Dyn.Y,
  DYN_F00: L.Dyn.F00,
  DYN_F01: L.Dyn.F01,
  DYN_F10: L.Dyn.F10,
  DYN_F11: L.Dyn.F11,
  DYN_FLAGS: L.Dyn.FLAGS,
  STATIC_FIELDS: L.STATIC_FIELDS,
  STAT_HOME: L.Stat.HOME,
  STAT_REST_U: L.Stat.REST_U,
  STAT_REST_V: L.Stat.REST_V,
  HOME_NONE: L.HOME_NONE,
  FLAG_TORN: L.FLAG_TORN,
  INTERACTION_IDLE: L.Interaction.IDLE,
  INTERACTION_HOVER: L.Interaction.HOVER,
  INTERACTION_FOCUSED: L.Interaction.FOCUSED,
  INTERACTION_DRAGGED: L.Interaction.DRAGGED,
  HOVER_SWELL: L.HOVER_SWELL,
};

function slot(values: number[]): Float32Array {
  const v = new Float32Array(2 * L.ELEMENT_STRIDE);
  v.set(values, 0);
  return v;
}

describe("W64 fluid-layout mirror of src/fluid/layout.rs", () => {
  it("given_layout_rs_when_parsed_then_every_rust_constant_has_an_equal_ts_mirror", () => {
    const rust = rustConstants();
    expect(rust.size).toBe(35);
    for (const [name, value] of rust) {
      expect(TS_MIRROR, `TS mirror is missing ${name}`).toHaveProperty(name);
      expect(TS_MIRROR[name], name).toBe(value);
    }
  });

  it("given_ts_mirror_when_compared_then_no_ts_constant_is_missing_in_rust", () => {
    const rust = rustConstants();
    for (const name of Object.keys(TS_MIRROR)) {
      expect(rust.has(name), `layout.rs lacks ${name}`).toBe(true);
    }
  });

  it("given_hover_swell_when_compared_then_rust_and_ts_both_equal_0_02", () => {
    expect(rustConstants().get("HOVER_SWELL")).toBe(0.02);
    expect(L.HOVER_SWELL).toBe(0.02);
  });

  it("given_hover_interaction_and_motion_when_homeRect_then_swelled_2_percent_about_centre", () => {
    const r = L.homeRect(slot([100, 200, 140, 48, 24, L.Interaction.HOVER, 5, -3, NaN, NaN]), 0, false);
    expect(r).not.toBeNull();
    const k = 1 + L.HOVER_SWELL;
    expect(r!.w).toBeCloseTo(140 * k, 4);
    expect(r!.h).toBeCloseTo(48 * k, 4);
    expect(r!.r).toBeCloseTo(24 * k, 4);
    expect(r!.x + r!.w / 2).toBeCloseTo(105 + 70, 4);
    expect(r!.y + r!.h / 2).toBeCloseTo(197 + 24, 4);
  });

  it("given_hover_interaction_under_reduced_motion_when_homeRect_then_dom_rect_plus_home_offset", () => {
    const r = L.homeRect(slot([100, 200, 140, 48, 24, L.Interaction.HOVER, 5, -3, NaN, NaN]), 0, true);
    expect(r).toEqual({ x: 105, y: 197, w: 140, h: 48, r: 24 });
  });

  it("given_inactive_nan_or_out_of_range_slot_when_homeRect_then_null", () => {
    expect(L.homeRect(slot([0, 0, 0, 0, 0, 0, 0, 0, NaN, NaN]), 0, false)).toBeNull();
    expect(L.homeRect(slot([NaN, 0, 10, 10, 0, 0, 0, 0, NaN, NaN]), 0, false)).toBeNull();
    expect(L.homeRect(slot([0, 0, 10, 10, 0, 0, 0, 0, NaN, NaN]), 5, false)).toBeNull();
    expect(L.roundedRectArea(140, 48, 100)).toBeCloseTo(140 * 48 - (4 - Math.PI) * 24 * 24, 6);
  });
});
