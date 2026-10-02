// Headless probe: does every particle get back home after a splash?
// Prints how many particles are > 12px from their rest position over time.
// usage: node probe.mjs [n] [impulse|shake]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mod = await import(join(here, 'pkg/fluid_pbf.js'));
const wasm = mod.initSync({ module: readFileSync(join(here, 'pkg/fluid_pbf_bg.wasm')) });

const n0 = Number(process.argv[2]) || 2000;
const mode = process.argv[3] || 'impulse';
const sim = new mod.Sim(1280, 800);
const rects = [[402, 176, 140, 48, 24], [570, 176, 140, 48, 24], [738, 176, 140, 48, 24], [480, 268, 320, 180, 16]];
for (const r of rects) sim.add_element(...r);
sim.build(n0);
const n = sim.count();
const P = () => new Float32Array(wasm.memory.buffer, sim.pos_ptr(), 2 * n);
const rest = P().slice();
const far = () => {
  let c = 0, mx = 0;
  const p = P();
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(p[i] - rest[i], p[n + i] - rest[n + i]);
    if (d > 12) c++;
    mx = Math.max(mx, d);
  }
  return `far>12px=${c} max=${mx.toFixed(1)}`;
};
for (let t = 0; t < 60; t++) sim.step(1 / 60);
console.log('n', n, 'after 1s idle:', far());
if (mode === 'shake') sim.shake(700, 0.9);
else if (mode === 'drag') {
  // drag Splash over Split, then onto the card, hold, release
  for (let t = 1; t <= 40; t++) { sim.set_offset(0, 168 * t / 40, 0); sim.step(1 / 60); }
  for (let t = 0; t < 36; t++) sim.step(1 / 60);
  for (let t = 1; t <= 30; t++) { sim.set_offset(0, 168, 130 * t / 30); sim.step(1 / 60); }
  for (let t = 0; t < 48; t++) sim.step(1 / 60);
  console.log('holding over card:', far());
  sim.set_offset(0, 0, 0);
  sim.add_damage(0, 0.35);
} else sim.impulse(472, 200, 170, 950, 1.1);
for (let t = 0; t <= 300; t++) {
  sim.step(1 / 60);
  if (t % 30 === 0) console.log(`t=${(t / 60).toFixed(1)}s`, far(), 'damage', [0, 1, 2, 3].map((e) => sim.damage(e).toFixed(2)).join(' '));
}
