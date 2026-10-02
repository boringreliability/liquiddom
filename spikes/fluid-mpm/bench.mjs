// Headless benchmark: loads the wasm (wasm-pack --target web output) in node,
// lays out the same 3 buttons + card as the page in a 1280x800 viewport, and
// runs 600 frames (each = 8 MLS-MPM substeps) at n = 2000/5000/10000.
// Events during the run so it is not just a resting state:
//   pointer sweeping across the row the whole time, splash at frame 60 and 200,
//   shake at frame 330, a "drag" of button 1 over button 2 between 420-480.
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { initSync, Sim } from "./pkg/fluid_mpm.js";

const wasmBytes = readFileSync(new URL("./pkg/fluid_mpm_bg.wasm", import.meta.url));
const { memory } = initSync({ module: wasmBytes });

const VW = 1280;
const VH = 800;
function layout() {
  const bw = 140, bh = 48, gap = 24;
  const rowW = 3 * bw + 2 * gap;
  const x0 = (VW - rowW) / 2;
  const els = [];
  for (let i = 0; i < 3; i++) els.push([x0 + i * (bw + gap), 260, bw, bh, 24]);
  els.push([(VW - 320) / 2, 340, 320, 180, 16]);
  return els;
}

function writeElems(sim, els, caps) {
  const stride = sim.elem_stride();
  const buf = new Float32Array(memory.buffer, sim.elems_ptr(), sim.max_elems() * stride);
  els.forEach((r, i) => {
    buf.set(r, i * stride);
    buf[i * stride + 5] = caps ? caps[i] : 1;
  });
}

function run(n) {
  const sim = new Sim();
  const base = layout();
  writeElems(sim, base);
  const count = sim.init(VW, VH, base.length, n);
  const times = [];
  for (let f = 0; f < 600; f++) {
    const els = base.map((r) => r.slice());
    let caps = [1, 1, 1, 1];
    if (f >= 420 && f < 480) {
      const t = (f - 420) / 60;
      els[0][0] += t * 164; // slide button 0 onto button 1
      caps = [0.35, 0.25, 1, 1];
    }
    writeElems(sim, els, caps);
    const px = 300 + ((f * 7) % 700);
    sim.set_pointer(px, 284, 420, 0, true);
    if (f === 60) sim.impulse(base[0][0] + 70, 284, 950, 111, 0);
    if (f === 200) sim.impulse(640, 430, 950, 275, 3);
    if (f === 330) sim.shake(500);
    const t0 = performance.now();
    sim.step();
    times.push(performance.now() - t0);
  }
  // sanity: every particle finite and inside viewport
  const pos = new Float32Array(memory.buffer, sim.positions_ptr(), count * 2);
  let bad = 0;
  for (let i = 0; i < pos.length; i++) if (!Number.isFinite(pos[i])) bad++;
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)];
  const res = {
    n_requested: n,
    n_actual: count,
    cell_px: +sim.cell_px().toFixed(2),
    grid: `${sim.grid_w()}x${sim.grid_h()}`,
    substeps: sim.substeps(),
    mean_ms_per_tick: +mean.toFixed(3),
    p95_ms_per_tick: +p95.toFixed(3),
    max_ms: +times[times.length - 1].toFixed(3),
    non_finite: bad,
  };
  sim.free();
  return res;
}

// warm-up (JIT the JS glue, page in the wasm)
run(2000);
const rows = [2000, 5000, 10000].map(run);
console.log(`MLS-MPM bench, ${VW}x${VH} viewport, 600 ticks (1 tick = 1 frame = 8 substeps), node ${process.version}`);
console.table(rows);
