// TS side of the spike: DOM measurement, input, RAF loop, HUD, render.
// Physics lives in Rust/WASM (../src/lib.rs); we talk through flat Float32Array
// views straight into WASM memory (no JSON per frame).
import init, { Sim } from "../pkg/fluid_mpm.js";
import { LiquidRenderer, hexToRgb } from "./render";

const canvas = document.getElementById("liquid") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const els = Array.from(document.querySelectorAll<HTMLElement>(".liquid-el"));
const hud = {
  fps: document.getElementById("h-fps")!,
  phys: document.getElementById("h-phys")!,
  rend: document.getElementById("h-rend")!,
  n: document.getElementById("h-n")!,
  grid: document.getElementById("h-grid")!,
};
const nSelect = document.getElementById("n-select") as HTMLSelectElement;

const params = new URLSearchParams(location.search);
let nTarget = clampN(Number(params.get("n") ?? 5000));
nSelect.value = String(nTarget);
let debug = params.has("debug");

function clampN(n: number) {
  if (!Number.isFinite(n)) return 5000;
  return Math.max(200, Math.min(20000, Math.round(n)));
}

const wasm = await init();
const sim = new Sim();
const renderer = new LiquidRenderer(els.map((e) => hexToRgb(e.dataset.color ?? "#888888")), 2);

// ---- element measurement -> shared elems buffer ------------------------------
const caps = els.map(() => 1);
function writeElems() {
  const stride = sim.elem_stride();
  const buf = new Float32Array(wasm.memory.buffer, sim.elems_ptr(), sim.max_elems() * stride);
  els.forEach((el, i) => {
    const r = el.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    const b = i * stride;
    buf[b] = r.left;
    buf[b + 1] = r.top;
    buf[b + 2] = r.width;
    buf[b + 3] = r.height;
    buf[b + 4] = radius;
    buf[b + 5] = caps[i];
  });
}

let vw = 0, vh = 0, dpr = 1;
function setup() {
  vw = window.innerWidth;
  vh = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(vw * dpr);
  canvas.height = Math.round(vh * dpr);
  renderer.resize(vw, vh);
  writeElems();
  const n = sim.init(vw, vh, els.length, nTarget);
  hud.n.textContent = `${n} (asked ${nTarget})`;
  hud.grid.textContent = `${sim.grid_w()}x${sim.grid_h()} @ ${sim.cell_px().toFixed(1)}px, ${sim.substeps()} substeps`;
}
setup();

let resizeTimer = 0;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(setup, 150);
});
nSelect.addEventListener("change", () => {
  nTarget = clampN(Number(nSelect.value));
  const u = new URL(location.href);
  u.searchParams.set("n", String(nTarget));
  history.replaceState(null, "", u);
  setup();
});

// ---- input -------------------------------------------------------------------
const pointer = { x: 0, y: 0, vx: 0, vy: 0, t: 0, inside: false };
window.addEventListener("pointermove", (e) => {
  const now = performance.now();
  const dt = Math.max((now - pointer.t) / 1000, 1 / 240);
  if (pointer.inside) {
    // smoothed pointer velocity
    pointer.vx = pointer.vx * 0.5 + ((e.clientX - pointer.x) / dt) * 0.5;
    pointer.vy = pointer.vy * 0.5 + ((e.clientY - pointer.y) / dt) * 0.5;
  }
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.t = now;
  pointer.inside = true;
  if (drag) onDragMove(e);
});
document.addEventListener("pointerleave", () => (pointer.inside = false));
window.addEventListener("blur", () => (pointer.inside = false));

const SPLASH_SPEED = 950; // px/s
function splashAt(x: number, y: number, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  const radius = Math.max(110, Math.hypot(r.width, r.height) * 0.75);
  sim.impulse(x, y, SPLASH_SPEED, radius, els.indexOf(el));
}

// press-and-drag a button: the DOM button follows the pointer (transform), the
// liquid's home follows the DOM rect, stiffness is capped low so it sloshes and
// merges with whatever it overlaps. On release the button glides home.
type Drag = { el: HTMLElement; idx: number; sx: number; sy: number; moved: boolean; id: number };
let drag: Drag | null = null;
let suppressClick = false;

els.forEach((el, idx) => {
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (el.tagName === "BUTTON") {
      drag = { el, idx, sx: e.clientX, sy: e.clientY, moved: false, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
    }
  });
  el.addEventListener("click", (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const r = el.getBoundingClientRect();
    // keyboard activation has detail 0 and no meaningful coordinates
    const x = e.detail === 0 ? r.left + r.width / 2 : e.clientX;
    const y = e.detail === 0 ? r.top + r.height / 2 : e.clientY;
    splashAt(x, y, el);
  });
  if (el.tagName !== "BUTTON") {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        el.click();
      }
    });
  }
});

function onDragMove(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.sx;
  const dy = e.clientY - drag.sy;
  if (!drag.moved && Math.hypot(dx, dy) > 6) {
    drag.moved = true;
    drag.el.classList.add("dragging");
    drag.el.style.transition = "none";
  }
  if (drag.moved) drag.el.style.transform = `translate(${dx}px, ${dy}px)`;
}

function endDrag(e: PointerEvent) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  if (d.moved) {
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 0);
    d.el.classList.remove("dragging");
    d.el.style.transition = "transform 700ms cubic-bezier(.2,.75,.25,1)";
    d.el.style.transform = "";
  }
}
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

function updateCaps() {
  caps.fill(1);
  if (!drag || !drag.moved) return;
  caps[drag.idx] = 0.3;
  const a = drag.el.getBoundingClientRect();
  els.forEach((el, i) => {
    if (i === drag!.idx) return;
    const b = el.getBoundingClientRect();
    const pad = 16;
    const overlap =
      a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
    if (overlap) caps[i] = 0.2;
  });
}

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "s") sim.shake(520);
  else if (k === "r") sim.reset();
  else if (k === "d") debug = !debug;
});

// ---- loop ----------------------------------------------------------------------
const STEP = 1000 / 60;
let last = performance.now();
let acc = 0;
let physEma = 0, rendEma = 0, frames = 0, fpsT = last, fps = 0;

function frame(now: number) {
  const dtMs = Math.min(now - last, 100);
  last = now;
  acc += dtMs;

  updateCaps();
  writeElems();
  // pointer repulsion only while hovering and not dragging (drag would push its own liquid away)
  const idle = now - pointer.t > 120;
  if (idle) { pointer.vx *= 0.8; pointer.vy *= 0.8; }
  sim.set_pointer(pointer.x, pointer.y, pointer.vx, pointer.vy, pointer.inside && !drag?.moved);

  let steps = 0;
  const t0 = performance.now();
  while (acc >= STEP && steps < 3) {
    sim.step();
    acc -= STEP;
    steps++;
  }
  if (steps === 3) acc = 0;
  const t1 = performance.now();
  if (steps > 0) physEma = physEma * 0.9 + ((t1 - t0) / steps) * 0.1;

  const n = sim.count();
  const pos = new Float32Array(wasm.memory.buffer, sim.positions_ptr(), n * 2);
  const homes = new Float32Array(wasm.memory.buffer, sim.homes_ptr(), n);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);
  if (debug) {
    ctx.globalAlpha = 0.25;
    renderer.render(ctx, pos, homes, n, sim.spacing_px());
    ctx.globalAlpha = 1;
    renderer.renderDebug(ctx, pos, homes, n);
  } else {
    renderer.render(ctx, pos, homes, n, sim.spacing_px());
  }
  const t2 = performance.now();
  rendEma = rendEma * 0.9 + (t2 - t1) * 0.1;

  frames++;
  if (now - fpsT > 500) {
    fps = (frames * 1000) / (now - fpsT);
    frames = 0;
    fpsT = now;
    hud.fps.textContent = fps.toFixed(0);
    hud.phys.textContent = physEma.toFixed(2);
    hud.rend.textContent = rendEma.toFixed(2);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// handle for poking from devtools / playwright
(window as unknown as { __spike: unknown }).__spike = { sim, splashAt, els };
