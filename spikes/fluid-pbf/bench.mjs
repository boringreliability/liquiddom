// Headless benchmark for solver A (PBF + shape matching).
// Loads the wasm-pack (--target web) build directly in Node and runs 600
// ticks per particle count. One tick = sim.step(1/60) = `substeps` substeps
// of `iterations` constraint iterations each (defaults 2 x 3).
// The run is not idle: it includes a splash, a global shake and a drag so the
// neighbour lists see realistic churn.
//
//   npm run bench          (rebuilds wasm first)
//   node bench.mjs         (uses existing pkg/)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';

const here = dirname(fileURLToPath(import.meta.url));
const mod = await import(join(here, 'pkg/fluid_pbf.js'));
mod.initSync({ module: readFileSync(join(here, 'pkg/fluid_pbf_bg.wasm')) });

// Same layout as the demo page at 1280x800.
const W = 1280, H = 800;
const RECTS = [
  [402, 176, 140, 48, 24],
  [570, 176, 140, 48, 24],
  [738, 176, 140, 48, 24],
  [480, 268, 320, 180, 16],
];
const TICKS = 600;
const WARMUP = 30;

function run(nTarget) {
  const sim = new mod.Sim(W, H);
  for (const r of RECTS) sim.add_element(...r);
  sim.build(nTarget);
  for (let i = 0; i < WARMUP; i++) sim.step(1 / 60);
  const times = new Float64Array(TICKS);
  for (let t = 0; t < TICKS; t++) {
    if (t === 60) sim.impulse(472, 200, 170, 950, 1.1); // splash a button
    if (t === 200) sim.impulse(640, 330, 170, 950, 1.1); // splash the card
    if (t === 300) sim.shake(700, 0.9);
    if (t >= 400 && t < 500) sim.set_offset(0, 168 * Math.min(1, (t - 400) / 40), 130 * Math.max(0, (t - 440) / 60));
    if (t === 500) sim.set_offset(0, 0, 0);
    const t0 = performance.now();
    sim.step(1 / 60);
    times[t] = performance.now() - t0;
  }
  const n = sim.count();
  sim.free();
  const sorted = Array.from(times).sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / TICKS;
  const p95 = sorted[Math.floor(TICKS * 0.95)];
  const max = sorted[TICKS - 1];
  return { nTarget, n, mean, p95, max };
}

console.log(`fluid-pbf bench: ${TICKS} ticks/run, tick = step(1/60) = 2 substeps x 3 iterations, node ${process.version}`);
console.log('n_target  n_actual  mean_ms  p95_ms  max_ms');
for (const n of [2000, 5000, 10000]) {
  const r = run(n);
  console.log(
    `${String(r.nTarget).padStart(8)}  ${String(r.n).padStart(8)}  ${r.mean.toFixed(3).padStart(7)}  ${r.p95.toFixed(3).padStart(6)}  ${r.max.toFixed(3).padStart(6)}`,
  );
}
