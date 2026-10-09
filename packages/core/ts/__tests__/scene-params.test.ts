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

  it("given_renderer_auto_when_parsed_then_renderer_is_auto", () => {
    // W72 (D72-1): the scene can run the 'auto' probe (webgpu on a hardware adapter, else canvas2d).
    expect(parseSceneParams("?renderer=auto&test=1").renderer).toBe("auto");
  });

  it.each([
    "?seed=-1",
    "?seed=1.5",
    "?seed=abc",
    "?seed=",
    "?seed=4294967296",
    "?clock=fast",
    // W72 red: approved-test change (Dennis approves at W72 red): "?renderer=auto" is valid since W72 (D72-1)
    "?renderer=webgl",
    "?t0=0.5",
    "?renderer=canvas2d&t0=0.5",
    "?renderer=webgpu&t0=1",
    "?renderer=webgpu&t0=abc",
    "?rm=yes",
    "?test=2",
  ])("given_invalid_query_%s_when_parsed_then_TypeError", (query) => {
    expect(() => parseSceneParams(query)).toThrow(TypeError);
  });

  it("given_perf_with_manual_clock_when_parsed_then_TypeError", () => {
    expect(() => parseSceneParams("?perf=1&clock=manual")).toThrow(TypeError);
  });

  it("given_renderer_webgpu_with_and_without_t0_when_parsed_then_webgpu_and_t0Scale_only_when_given_W71", () => {
    expect(parseSceneParams("?renderer=webgpu&clock=manual&test=1")).toEqual({
      seed: 1,
      clock: "manual",
      renderer: "webgpu",
      reducedMotion: false,
      test: true,
      perf: false,
    });
    expect("t0Scale" in parseSceneParams("?renderer=webgpu")).toBe(false);
    expect(parseSceneParams("?renderer=webgpu&t0=0.5").t0Scale).toBe(0.5);
    expect(parseSceneParams("?renderer=webgpu&t0=0.75").t0Scale).toBe(0.75);
  });
});
