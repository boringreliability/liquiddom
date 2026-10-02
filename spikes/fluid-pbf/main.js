// Fluid PBF spike: TS-side orchestration (plain JS for spike speed).
// DOM measurement, input, fixed-step loop, HUD. Physics lives in WASM; we
// read particle positions through a Float32Array view into WASM memory.

import init, { Sim } from './pkg/fluid_pbf.js';
import { LiquidRenderer } from './render.js';

const N_OPTIONS = [2000, 5000, 10000];
const params = new URLSearchParams(location.search);
const FIXED_DT = 1 / 60;

const wasm = await init();
const canvas = document.getElementById('liquid');
const els = [...document.querySelectorAll('.liquid-el')];
const colors = els.map((el) => el.dataset.color);
const renderer = new LiquidRenderer(canvas, colors, Number(params.get('scale')) || 2);

let nTarget = Number(params.get('n')) || 2000;
let sim = null;
let views = null;
let debug = params.has('debug');
let rects = [];

// ---------------------------------------------------------------- sim setup

function measure() {
  return els.map((el) => {
    const r = el.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    return { x: r.left, y: r.top, w: r.width, h: r.height, radius };
  });
}

function buildSim() {
  if (sim) sim.free();
  rects = measure();
  sim = new Sim(window.innerWidth, window.innerHeight);
  for (const r of rects) sim.add_element(r.x, r.y, r.w, r.h, r.radius);
  sim.build(nTarget);
  // optional tuning via URL, e.g. ?k_shape=0.2&cohesion=2
  for (const key of ['k_shape', 'k_home', 'cohesion', 'xsph', 'damping', 'damage_tau', 'wobble', 'contact_soft', 'substeps', 'iterations']) {
    if (params.has(key)) sim[key] = Number(params.get(key));
  }
  views = null;
  document.getElementById('count').textContent = sim.count();
  document.getElementById('nval').textContent = nTarget;
  document.getElementById('nslider').value = String(Math.max(0, N_OPTIONS.indexOf(nTarget)));
}

/** Rebind views whenever WASM memory may have grown (detached buffer). */
function getViews() {
  const buf = wasm.memory.buffer;
  if (!views || views.buf !== buf || views.n !== sim.count()) {
    const n = sim.count();
    const pos = new Float32Array(buf, sim.pos_ptr(), 2 * n);
    views = {
      buf,
      n,
      xs: pos.subarray(0, n),
      ys: pos.subarray(n, 2 * n),
      home: new Uint32Array(buf, sim.home_ptr(), n),
    };
  }
  return views;
}

buildSim();

// ---------------------------------------------------------------- input

const pointer = { x: 0, y: 0, active: false };
let drag = null; // { idx, x0, y0, moved, id }
let suppressClick = false;

window.addEventListener('pointermove', (ev) => {
  pointer.x = ev.clientX;
  pointer.y = ev.clientY;
  pointer.active = true;
});
document.addEventListener('pointerleave', () => (pointer.active = false));
window.addEventListener('blur', () => (pointer.active = false));

els.forEach((el, idx) => {
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    drag = { idx, x0: ev.clientX, y0: ev.clientY, moved: false, id: ev.pointerId };
    el.setPointerCapture(ev.pointerId);
  });
  el.addEventListener('pointermove', (ev) => {
    if (!drag || drag.idx !== idx || drag.id !== ev.pointerId) return;
    const dx = ev.clientX - drag.x0;
    const dy = ev.clientY - drag.y0;
    if (!drag.moved && Math.hypot(dx, dy) > 6) {
      drag.moved = true;
      el.style.cursor = 'grabbing';
    }
    if (drag.moved) sim.set_offset(idx, dx, dy);
  });
  const endDrag = (ev) => {
    if (!drag || drag.idx !== idx || drag.id !== ev.pointerId) return;
    if (drag.moved) {
      // Let go: home anchor snaps back to the DOM rect; a little damage makes
      // the release read as liquid sloshing home rather than a rigid spring.
      sim.set_offset(idx, 0, 0);
      sim.add_damage(idx, 0.35);
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 0);
    }
    el.style.cursor = '';
    drag = null;
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  // Click (also keyboard Enter/Space on buttons) = splash.
  el.addEventListener('click', (ev) => {
    if (suppressClick) return;
    let x = ev.clientX;
    let y = ev.clientY;
    if (ev.detail === 0 || (x === 0 && y === 0)) {
      const r = el.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    splash(x, y);
  });
});

function splash(x, y) {
  sim.impulse(x, y, 170, 950, 1.1);
}

window.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k === 's') sim.shake(700, 0.9);
  else if (k === 'r') sim.reset();
  else if (k === 'd') debug = !debug;
});

document.getElementById('nslider').addEventListener('input', (ev) => {
  nTarget = N_OPTIONS[Number(ev.target.value)];
  const u = new URL(location.href);
  u.searchParams.set('n', String(nTarget));
  history.replaceState(null, '', u);
  buildSim();
});

window.addEventListener('resize', () => {
  renderer.resize(window.innerWidth, window.innerHeight);
  sim.resize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- loop

const hud = {
  fps: document.getElementById('fps'),
  phys: document.getElementById('phys'),
  rend: document.getElementById('rend'),
  dmg: document.getElementById('dmg'),
};
let fpsEma = 60, physEma = 0, rendEma = 0, hudT = 0;
let last = performance.now();
let acc = 0;

function syncRects() {
  const now = measure();
  for (let i = 0; i < now.length; i++) {
    const a = now[i], b = rects[i];
    if (Math.abs(a.w - b.w) > 0.5 || Math.abs(a.h - b.h) > 0.5) {
      buildSim(); // size changed: resample
      return;
    }
    if (a.x !== b.x || a.y !== b.y) sim.set_rest_origin(i, a.x, a.y);
  }
  rects = now;
}

function frame(now) {
  const elapsed = Math.min((now - last) / 1000, 0.1);
  last = now;
  fpsEma += ((elapsed > 0 ? 1 / elapsed : 60) - fpsEma) * 0.05;

  syncRects();
  const dragging = drag && drag.moved;
  sim.set_pointer(pointer.x, pointer.y, 60, 16000, pointer.active && !dragging);

  acc += elapsed;
  let steps = 0;
  const t0 = performance.now();
  while (acc >= FIXED_DT && steps < 2) {
    sim.step(FIXED_DT);
    acc -= FIXED_DT;
    steps++;
  }
  if (steps === 2) acc = 0; // drop time instead of spiralling
  const t1 = performance.now();
  if (steps > 0) physEma += ((t1 - t0) / steps - physEma) * 0.1;

  const v = getViews();
  renderer.draw(v.xs, v.ys, v.home, v.n, sim.spacing(), debug);
  const t2 = performance.now();
  rendEma += (t2 - t1 - rendEma) * 0.1;

  if (now - hudT > 250) {
    hudT = now;
    hud.fps.textContent = fpsEma.toFixed(0);
    hud.phys.textContent = physEma.toFixed(2);
    hud.rend.textContent = rendEma.toFixed(2);
    hud.dmg.textContent = els.map((_, i) => sim.damage(i).toFixed(2)).join(' ');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Exposed for manual poking in devtools.
window.__spike = { get sim() { return sim; }, splash };
