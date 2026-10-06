#!/usr/bin/env node
/**
 * W65 (C1, D65-9; spec §2 "Release build"): opt-level 3 vs "s", decided by measurement.
 *
 * Builds the crate twice with wasm-pack, overriding the release opt-level via
 * CARGO_PROFILE_RELEASE_OPT_LEVEL (Cargo.toml stays untouched), then times
 * FluidCore.tick per fixed step at 8000 particles in the acceptance layout
 * (3 buttons + card, 1280x800) in fresh Node processes, alternating variants.
 * The core is constructed exactly like W64's scenario tests: 7-arg FFI,
 * rounded-rect area hint 76 057 px², tallest element 180 px.
 * wasm-pack runs wasm-opt on both variants, so this measures what would ship.
 *
 * W68 green review: every variant is measured twice, with the pointer inactive and
 * with an active pointer sweeping across the buttons and the card at 600 px/s
 * (the soft pointer field, D68-3).
 *
 *   node scripts/bench-opt-level.mjs               build both, compare
 *   node scripts/bench-opt-level.mjs --skip-build  reuse target/bench-opt/*
 *   node scripts/bench-opt-level.mjs --run <dir> [--pointer]
 *                                                  (internal) one measurement → JSON on stdout
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), "..");
const OUT = resolve(ROOT, "target", "bench-opt");
const VARIANTS = [
  { name: "opt-3", level: "3" },
  { name: "opt-s", level: "s" },
];
const PARTICLES = 8000;
const MAX_ELEMENTS = 32;
const VW = 1280;
const VH = 800;
const SEED = 1;
const WARMUP_FRAMES = 120;
const FRAMES = 600;
const ROUNDS = 3;
const ELEMENT_STRIDE = 10; // fluid-layout.ts ELEMENT_STRIDE / layout.rs
const FLUID_CORE_ARITY = 7; // D64-4 / B15: (particles, max_elements, w, h, area_hint, max_element_h, seed)
/** W64 scenario_tests: Σ rounded-rect area of the acceptance layout, rounded (px²). */
const AREA_HINT_PX2 = 76057;
/** W64 scenario_tests: tallest acceptance element (the card), px. */
const MAX_ELEMENT_H_PX = 180;

function layout() {
  const bw = 140;
  const bh = 48;
  const gap = 24;
  const x0 = (VW - (3 * bw + 2 * gap)) / 2;
  const els = [];
  for (let i = 0; i < 3; i++) els.push([x0 + i * (bw + gap), 260, bw, bh, 24]);
  els.push([(VW - 320) / 2, 340, 320, 180, 16]);
  return els;
}

const POINTER_MODES = ["inactive", "sweep"];
/** Sweep speed, px/s, and per-frame step at 60 Hz. */
const SWEEP_PX_S = 600;
const SWEEP_STEP_PX = SWEEP_PX_S / 60;
const SWEEP_X0 = 330;
const SWEEP_SPAN_PX = 620;
/** Button row centre and card centre (layout() above). */
const SWEEP_ROWS_Y = [284, 430];

/**
 * Pointer for frame `f` in "sweep" mode: back and forth across x ∈ [330, 950] at
 * 600 px/s, over the button row on two passes, then over the card on two passes.
 * Returns the `tick` pointer arguments [px, py, pvx, pvy, active].
 */
function sweepPointer(f) {
  const travelled = f * SWEEP_STEP_PX;
  const pass = Math.floor(travelled / SWEEP_SPAN_PX);
  const u = travelled - pass * SWEEP_SPAN_PX;
  const dir = pass % 2 === 0 ? 1 : -1;
  const x = dir > 0 ? SWEEP_X0 + u : SWEEP_X0 + SWEEP_SPAN_PX - u;
  const y = SWEEP_ROWS_Y[Math.floor(pass / 2) % SWEEP_ROWS_Y.length];
  return [x, y, dir * SWEEP_PX_S, 0, true];
}

/** Area of a w×h rect with corner radius r: w·h − (4 − π)·r². */
function roundedRectArea(w, h, r) {
  return w * h - (4 - Math.PI) * r * r;
}

function nearestRank(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

function summarize(samples) {
  if (samples.length === 0) throw new RangeError("no samples");
  const s = [...samples].sort((a, b) => a - b);
  return {
    n: s.length,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    p50: nearestRank(s, 0.5),
    p95: nearestRank(s, 0.95),
    max: s[s.length - 1],
  };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function measure(dir, pointerMode) {
  const glue = await import(pathToFileURL(resolve(dir, "liquiddom.js")).href);
  const exports = glue.initSync({ module: readFileSync(resolve(dir, "liquiddom_bg.wasm")) });
  if (glue.FluidCore.length !== FLUID_CORE_ARITY) {
    throw new Error(`FluidCore constructor takes ${glue.FluidCore.length} args, expected ${FLUID_CORE_ARITY} (D64-4)`);
  }
  const els = layout();
  const areaHint = Math.round(els.reduce((acc, [, , w, h, r]) => acc + roundedRectArea(w, h, r), 0));
  const maxElementH = Math.max(...els.map(([, , , h]) => h));
  if (areaHint !== AREA_HINT_PX2) throw new Error(`area hint ${areaHint} != ${AREA_HINT_PX2} (scenario_tests)`);
  if (maxElementH !== MAX_ELEMENT_H_PX) throw new Error(`max element h ${maxElementH} != ${MAX_ELEMENT_H_PX}`);
  const core = new glue.FluidCore(PARTICLES, MAX_ELEMENTS, VW, VH, areaHint, maxElementH, SEED);
  if (core.element_stride() !== ELEMENT_STRIDE) {
    throw new Error(`element_stride ${core.element_stride()} != ${ELEMENT_STRIDE}`);
  }
  const view = new Float32Array(exports.memory.buffer, core.elements_ptr(), core.element_capacity() * ELEMENT_STRIDE);
  els.forEach(([x, y, w, h, r], i) => {
    view.set([x, y, w, h, r, 0, 0, 0, Number.NaN, Number.NaN], i * ELEMENT_STRIDE);
  });
  core.redistribute();

  const perStep = [];
  let steps = 0;
  for (let f = 0; f < WARMUP_FRAMES + FRAMES; f++) {
    const m = f - WARMUP_FRAMES;
    // No-ops until W67; the same script then exercises the dynamics.
    if (m === 60) core.splash(0, els[0][0] + 70, els[0][1] + 24, 1);
    if (m === 330) core.shake(1);
    const [px, py, pvx, pvy, active] = pointerMode === "sweep" ? sweepPointer(f) : [0, 0, 0, 0, false];
    const t0 = performance.now();
    const n = core.tick(1 / 60, px, py, pvx, pvy, active, 0, 0);
    const dt = performance.now() - t0;
    if (m >= 0 && n > 0) {
      perStep.push(dt / n);
      steps += n;
    }
  }
  // FNV-1a over the bits of the final dynamic view: equal across builds ⇔ the same
  // simulation, bit for bit (checks behaviour-preserving perf changes).
  const dyn = new Uint32Array(exports.memory.buffer, core.dynamic_ptr(), core.particle_capacity() * core.dynamic_fields());
  let checksum = 0x811c9dc5;
  for (let i = 0; i < dyn.length; i++) checksum = Math.imul(checksum ^ dyn[i], 0x01000193) >>> 0;
  const result = {
    pointer: pointerMode,
    checksum: checksum.toString(16).padStart(8, "0"),
    ...summarize(perStep),
    steps,
    activeParticles: core.active_particles(),
    cellPx: core.cell_px(),
    areaHint,
    maxElementH,
  };
  core.free();
  return result;
}

function build(variant) {
  const outDir = resolve(OUT, variant.name);
  console.log(`[bench-opt] wasm-pack build --release (opt-level=${variant.level}) -> ${outDir}`);
  const r = spawnSync("wasm-pack", ["build", "--release", "--target", "web", "--out-dir", outDir], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, CARGO_PROFILE_RELEASE_OPT_LEVEL: variant.level },
  });
  if (r.status !== 0) throw new Error(`wasm-pack failed for ${variant.name} (exit ${r.status})`);
  return outDir;
}

function runChild(dir, pointerMode) {
  const args = [SCRIPT, "--run", dir, ...(pointerMode === "sweep" ? ["--pointer"] : [])];
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`measurement failed for ${dir}:\n${r.stderr}`);
  const line = r.stdout.trim().split("\n").pop();
  return JSON.parse(line);
}

async function main() {
  if (process.argv[2] === "--run") {
    const dir = process.argv[3];
    if (!dir || !existsSync(resolve(dir, "liquiddom_bg.wasm"))) throw new Error(`--run needs a wasm-pack out dir, got ${dir}`);
    const mode = process.argv.includes("--pointer") ? "sweep" : "inactive";
    process.stdout.write(`${JSON.stringify(await measure(dir, mode))}\n`);
    return;
  }
  mkdirSync(OUT, { recursive: true });
  const skipBuild = process.argv.includes("--skip-build");
  const dirs = Object.fromEntries(VARIANTS.map((v) => [v.name, skipBuild ? resolve(OUT, v.name) : build(v)]));
  const key = (v, mode) => `${v.name}/${mode}`;
  const runs = {};
  for (const v of VARIANTS) for (const mode of POINTER_MODES) runs[key(v, mode)] = [];
  for (let round = 1; round <= ROUNDS; round++) {
    for (const v of VARIANTS) {
      for (const mode of POINTER_MODES) {
        const r = runChild(dirs[v.name], mode);
        runs[key(v, mode)].push(r);
        console.log(
          `[bench-opt] round ${round} ${v.name} pointer ${mode}: mean ${r.mean.toFixed(3)} ms, p95 ${r.p95.toFixed(3)} ms per step`,
        );
      }
    }
  }
  const rows = VARIANTS.flatMap((v) =>
    POINTER_MODES.map((mode) => {
      const rs = runs[key(v, mode)];
      return {
        variant: v.name,
        pointer: mode,
        wasm_bytes: statSync(resolve(dirs[v.name], "liquiddom_bg.wasm")).size,
        median_mean_ms_per_step: +median(rs.map((r) => r.mean)).toFixed(3),
        median_p95_ms_per_step: +median(rs.map((r) => r.p95)).toFixed(3),
        cell_px: +rs[0].cellPx.toFixed(3),
        active_particles: rs[0].activeParticles,
      };
    }),
  );
  console.log(
    `\nFluidCore tick per fixed step, ${PARTICLES} particles, ${VW}x${VH}, area hint ${AREA_HINT_PX2} px², ` +
      `max h ${MAX_ELEMENT_H_PX} px, ${FRAMES} ticks x ${ROUNDS} rounds, node ${process.version}`,
  );
  console.table(rows);
  const out = resolve(OUT, "results.json");
  writeFileSync(out, `${JSON.stringify({ recordedAt: new Date().toISOString(), node: process.version, rows, runs }, null, 2)}\n`);
  console.log(`[bench-opt] wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
