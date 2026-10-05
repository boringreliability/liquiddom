/**
 * W65 (D65-11): acceptance scene query parameters. Pure parser in
 * demo/scenes/scene-params.ts (imported like playground-state was).
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_SCENE_SEED, parseSceneParams } from "../../../../demo/scenes/scene-params";

describe("W65 acceptance scene params", () => {
  it("given_empty_query_when_parsed_then_seed_1_raf_clock_canvas2d_and_all_flags_off", () => {
    expect(DEFAULT_SCENE_SEED).toBe(1);
    expect(parseSceneParams("")).toEqual({
      seed: 1,
      clock: "raf",
      renderer: "canvas2d",
      reducedMotion: false,
      test: false,
      perf: false,
    });
  });

  it("given_seed_7_clock_manual_rm_1_test_1_when_parsed_then_all_fields_set", () => {
    expect(parseSceneParams("?seed=7&clock=manual&rm=1&test=1")).toEqual({
      seed: 7,
      clock: "manual",
      renderer: "canvas2d",
      reducedMotion: true,
      test: true,
      perf: false,
    });
  });

  it("given_perf_1_with_raf_clock_and_max_u32_seed_when_parsed_then_perf_true", () => {
    const p = parseSceneParams("?perf=1&test=1&seed=4294967295&renderer=canvas2d");
    expect(p.perf).toBe(true);
    expect(p.clock).toBe("raf");
    expect(p.seed).toBe(4294967295);
  });

  it.each([
    "?seed=-1",
    "?seed=1.5",
    "?seed=abc",
    "?seed=",
    "?seed=4294967296",
    "?clock=fast",
    "?renderer=webgpu",
    "?renderer=auto",
    "?rm=yes",
    "?test=2",
  ])("given_invalid_query_%s_when_parsed_then_TypeError", (query) => {
    expect(() => parseSceneParams(query)).toThrow(TypeError);
  });

  it("given_perf_with_manual_clock_when_parsed_then_TypeError", () => {
    expect(() => parseSceneParams("?perf=1&clock=manual")).toThrow(TypeError);
  });
});
