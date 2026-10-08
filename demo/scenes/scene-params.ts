/** W65 (D65-11), W71 (D71-2, D71-4): pure, DOM-free parser for the acceptance scene query string. */
import type { SceneClock, SceneParams } from "../test-hooks";

export const DEFAULT_SCENE_SEED = 1;
const U32_MAX = 0xffff_ffff;

function flag(q: URLSearchParams, name: string): boolean {
  const raw = q.get(name);
  if (raw === null) return false;
  if (raw === "1") return true;
  if (raw === "0") return false;
  throw new TypeError(`[acceptance] ?${name} must be 0 or 1, got "${raw}"`);
}

export function parseSceneParams(search: string): SceneParams {
  const q = new URLSearchParams(search);

  let seed = DEFAULT_SCENE_SEED;
  const seedRaw = q.get("seed");
  if (seedRaw !== null) {
    if (!/^\d{1,10}$/.test(seedRaw) || Number(seedRaw) > U32_MAX) {
      throw new TypeError(`[acceptance] ?seed must be an integer in [0, ${U32_MAX}], got "${seedRaw}"`);
    }
    seed = Number(seedRaw);
  }

  const clockRaw = q.get("clock") ?? "raf";
  if (clockRaw !== "raf" && clockRaw !== "manual") {
    throw new TypeError(`[acceptance] ?clock must be "raf" or "manual", got "${clockRaw}"`);
  }
  const clock: SceneClock = clockRaw;

  // W72: "auto" is allowed (the D72-1 e2e); the default stays canvas2d so a test knows its renderer.
  const renderer = q.get("renderer") ?? "canvas2d";
  if (renderer !== "canvas2d" && renderer !== "webgpu" && renderer !== "auto") {
    throw new TypeError(`[acceptance] ?renderer must be "canvas2d", "webgpu" or "auto", got "${renderer}"`);
  }
  const t0Raw = q.get("t0");
  let t0Scale: number | undefined;
  if (t0Raw !== null) {
    if (renderer !== "webgpu") throw new TypeError(`[acceptance] ?t0 needs ?renderer=webgpu, got renderer "${renderer}"`);
    if (t0Raw !== "0.5" && t0Raw !== "0.75") throw new TypeError(`[acceptance] ?t0 must be 0.5 or 0.75 (D71-4), got "${t0Raw}"`);
    t0Scale = Number(t0Raw);
  }

  const perf = flag(q, "perf");
  if (perf && clock === "manual") {
    throw new TypeError("[acceptance] ?perf=1 measures real frames and cannot be combined with ?clock=manual");
  }

  return {
    seed,
    clock,
    renderer,
    reducedMotion: flag(q, "rm"),
    test: flag(q, "test"),
    perf,
    ...(t0Scale === undefined ? {} : { t0Scale }),
  };
}
