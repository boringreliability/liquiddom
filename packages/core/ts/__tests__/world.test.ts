/**
 * @vitest-environment jsdom
 * W81 (D81-2, D81-3): the world the fluid grid covers — measureWorld (body mode max(screen, inner)
 * per axis, container mode the client box), clampWorld (Rust's `world_extent`) and grownWorld (the
 * one logged reallocation: outgrown axes only, at least × WORLD_GROWTH, capped, never shrinking).
 */
import { afterEach, describe, expect, it } from "vitest";
import { clampWorld, grownWorld, measureWorld, WORLD_GROWTH, WORLD_MAX_PX, WORLD_MIN_PX } from "../src/world";

const setWindow = (key: string, value: number): void => {
  Object.defineProperty(window, key, { value, configurable: true });
};
const setScreen = (w: number, h: number): void => {
  Object.defineProperty(window.screen, "width", { configurable: true, get: () => w });
  Object.defineProperty(window.screen, "height", { configurable: true, get: () => h });
};

afterEach(() => {
  setWindow("innerWidth", 1024);
  setWindow("innerHeight", 768);
  delete (window.screen as unknown as { width?: number }).width;
  delete (window.screen as unknown as { height?: number }).height;
  document.body.replaceChildren();
});

describe("W81 world (D81-2, D81-3)", () => {
  it("given_body_mode_when_measured_then_the_world_is_max_screen_inner_per_axis", () => {
    setScreen(1280, 800);
    setWindow("innerWidth", 1500);
    setWindow("innerHeight", 700);
    expect(measureWorld()).toEqual({ w: 1500, h: 800 });
  });

  it("given_container_mode_when_measured_then_the_world_is_the_container_client_box_not_its_scroll_range_d81_3", () => {
    const box = document.createElement("div");
    Object.defineProperty(box, "clientWidth", { value: 640, configurable: true });
    Object.defineProperty(box, "clientHeight", { value: 360, configurable: true });
    Object.defineProperty(box, "scrollWidth", { value: 640, configurable: true });
    Object.defineProperty(box, "scrollHeight", { value: 1200, configurable: true });
    document.body.appendChild(box);
    expect(measureWorld(box)).toEqual({ w: 640, h: 360 });
    const empty = document.createElement("div"); // jsdom: client box 0 × 0
    expect(measureWorld(empty), "at least 1 px").toEqual({ w: 1, h: 1 });
  });

  it("given_rusts_world_extent_when_clampWorld_then_positive_extents_clamp_to_64_8192_and_non_positive_or_non_finite_fall_back_to_1280_800", () => {
    expect([WORLD_MIN_PX, WORLD_MAX_PX]).toEqual([64, 8192]);
    expect(clampWorld({ w: 10, h: 9000 })).toEqual({ w: 64, h: 8192 });
    expect(clampWorld({ w: 1920, h: 1080 })).toEqual({ w: 1920, h: 1080 });
    expect(clampWorld({ w: Number.NaN, h: -1 })).toEqual({ w: 1280, h: 800 });
    expect(clampWorld({ w: Number.POSITIVE_INFINITY, h: 0 })).toEqual({ w: 1280, h: 800 });
  });

  it("given_a_world_when_grownWorld_then_only_outgrown_axes_grow_to_at_least_1_25_times_capped_at_8192_and_it_never_shrinks", () => {
    expect(WORLD_GROWTH).toBe(1.25);
    const now = { w: 1920, h: 1080 };
    expect(grownWorld(now, { w: 1920, h: 1080 }), "the same size").toBeNull();
    expect(grownWorld(now, { w: 1000, h: 500 }), "smaller: never shrinks").toBeNull();
    expect(grownWorld(now, { w: Number.NaN, h: Number.NaN }), "non-finite: Rust's 1280 × 800 fallback is smaller").toBeNull();
    expect(grownWorld(now, { w: 2400, h: 1200 })).toEqual({ w: 2400, h: 1350 });
    expect(grownWorld(now, { w: 1930, h: 1080 }), "a few px wider: × 1.25, height kept").toEqual({ w: 2400, h: 1080 });
    expect(grownWorld(now, { w: 1920, h: 3000 })).toEqual({ w: 1920, h: 3000 });
    expect(grownWorld({ w: 8000, h: 1080 }, { w: 9000, h: 1080 }), "capped").toEqual({ w: 8192, h: 1080 });
    expect(grownWorld({ w: 8192, h: 1080 }, { w: 9000, h: 1080 }), "at the cap: nothing to grow").toBeNull();
  });
});
