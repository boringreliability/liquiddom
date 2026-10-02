//! Spike: MLS-MPM liquid that IS a set of DOM elements ("T-1000" UI).
//!
//! Solver: 2D MLS-MPM (Hu et al. 2018) with APIC/MLS affine momentum and
//! quadratic B-spline weights, i.e. the mpm88 structure:
//!   P2G (mass + affine momentum + stress) -> grid update (walls) -> G2P (v, C, x, J).
//!
//! Material: weakly-compressible viscous liquid.
//!   sigma = E (J - 1) I  +  mu (C + C^T)
//! * The J-based equation of state keeps volume (blobs keep their mass when they
//!   merge/collide instead of collapsing into each other).
//! * Tension is allowed (J > 1 pulls back) -> cohesion, but capped by a plastic
//!   yield on J (J <= 1 + TENSION_MAX) so a hard hit tears it into droplets.
//! * J relaxes slowly towards 1 (Maxwell-like), so numeric drift in J never
//!   accumulates into a permanent pressure that would fight the home shape.
//! * Viscosity mu (C + C^T) makes it gloopy rather than watery.
//!
//! Home shape ("T-1000"): every particle remembers its rest position in its
//! element's local frame. Each substep it gets a damped, saturated spring
//! acceleration towards `element_rect.origin + rest + wobble`. Per-element
//! stiffness s in [0,1] scales it; hard impulses drop s, it recovers with a
//! time constant of ~0.7 s, so a splash is free liquid first and re-forms over
//! ~1-3 s.
//!
//! Units: internally positions/velocities are in grid cells (dx = 1). All tuning
//! constants are expressed in CSS px and converted with the cell size, so the
//! feel does not change when the grid resolution changes.
//!
//! FFI: TS writes element rects into `elems` (flat f32, ELEM_STRIDE per elem)
//! and reads particle positions (px, xy interleaved) and home ids straight out
//! of WASM memory. No JSON per frame.

use wasm_bindgen::prelude::*;

pub const ELEM_STRIDE: usize = 8; // x, y, w, h, radius, stiffness_cap, 0, 0
pub const MAX_ELEMS: usize = 16;

// ---- tuning (px based) -------------------------------------------------------
const SUBSTEPS: usize = 8; // per 1/60 s frame -> dt = 2.08 ms
const FRAME_DT: f32 = 1.0 / 60.0;
const SOUND_SPEED_PX: f32 = 380.0; // px/s, sets bulk modulus E
const VISCOSITY_PX: f32 = 700.0; // px^2/s kinematic viscosity
const TENSION_MAX: f32 = 0.10; // plastic yield on stretch (cohesion cap)
const COMPRESS_MIN: f32 = 0.55;
const J_RELAX: f32 = 1.5; // 1/s
const SPRING_K: f32 = 220.0; // 1/s^2 at full stiffness
const SPRING_ZETA: f32 = 0.8; // damping ratio (kept constant as s varies)
const SPRING_AMAX_PX: f32 = 3200.0; // px/s^2 saturation: far droplets crawl back
const AIR_DRAG: f32 = 0.8; // 1/s
const STIFF_TAU: f32 = 0.7; // s, stiffness recovery time constant
const STIFF_FLOOR: f32 = 0.015;
const MAX_CELLS_PER_SUBSTEP: f32 = 0.45;
const WOBBLE_PX: f32 = 1.1;
const POINTER_RADIUS_PX: f32 = 70.0;
const POINTER_PUSH_PX: f32 = 5200.0; // px/s^2 at the pointer centre
const POINTER_DRAG: f32 = 6.0; // 1/s coupling to pointer velocity
// Grid-independent drift towards home ("slip"). MPM has ONE velocity field, so a
// particle buried in another element's liquid just moves with the majority and
// its spring gets averaged away -> merged liquids never fully un-mix. The slip
// lets a particle crawl through foreign liquid. Scaled by stiffness^2 so it is
// ~off during a splash and dominant once the element has "decided" to re-form.
const SLIP_RATE: f32 = 3.0; // 1/s at full stiffness
const SLIP_MAX_PX: f32 = 160.0; // px/s

#[wasm_bindgen]
pub struct Sim {
    // particles
    n: usize,
    x: Vec<f32>,
    y: Vec<f32>,
    vx: Vec<f32>,
    vy: Vec<f32>,
    c: Vec<[f32; 4]>, // affine matrix C = [[c0, c1], [c2, c3]]
    j: Vec<f32>,
    home: Vec<u32>,
    home_f: Vec<f32>, // home id as f32, read by TS once
    rest_x: Vec<f32>, // px, local to the element rect origin
    rest_y: Vec<f32>,
    tgt_x: Vec<f32>, // per-substep home target (grid units)
    tgt_y: Vec<f32>,
    out: Vec<f32>, // px positions, xy interleaved (TS reads every frame)

    // grid
    cell: f32,
    inv_cell: f32,
    gw: usize,
    gh: usize,
    gm: Vec<f32>,
    gvx: Vec<f32>,
    gvy: Vec<f32>,

    // material (grid units)
    p_vol: f32,
    bulk: f32,
    mu: f32,

    // elements
    elems: Vec<f32>, // TS-written, MAX_ELEMS * ELEM_STRIDE
    prev_elems: Vec<f32>,
    n_elems: usize,
    elem_vx: [f32; MAX_ELEMS], // grid units / s
    elem_vy: [f32; MAX_ELEMS],
    stiff: [f32; MAX_ELEMS],
    elem_phase: [f32; MAX_ELEMS],
    have_prev: bool,

    // viewport
    vw: f32,
    vh: f32,

    // pointer (px)
    ptr_x: f32,
    ptr_y: f32,
    ptr_vx: f32,
    ptr_vy: f32,
    ptr_on: bool,

    time: f32,
    rng: u32,
    spacing_px: f32,
}

#[inline]
fn bspline(f: f32) -> [f32; 3] {
    [
        0.5 * (1.5 - f) * (1.5 - f),
        0.75 - (f - 1.0) * (f - 1.0),
        0.5 * (f - 0.5) * (f - 0.5),
    ]
}

fn rounded_rect_area(w: f32, h: f32, r: f32) -> f32 {
    let r = r.min(w * 0.5).min(h * 0.5).max(0.0);
    w * h - (4.0 - std::f32::consts::PI) * r * r
}

fn inside_rounded_rect(lx: f32, ly: f32, w: f32, h: f32, r: f32) -> bool {
    if lx < 0.0 || ly < 0.0 || lx > w || ly > h {
        return false;
    }
    let r = r.min(w * 0.5).min(h * 0.5).max(0.0);
    let cx = lx.clamp(r, w - r);
    let cy = ly.clamp(r, h - r);
    let dx = lx - cx;
    let dy = ly - cy;
    dx * dx + dy * dy <= r * r
}

#[wasm_bindgen]
impl Sim {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Sim {
        Sim {
            n: 0,
            x: Vec::new(),
            y: Vec::new(),
            vx: Vec::new(),
            vy: Vec::new(),
            c: Vec::new(),
            j: Vec::new(),
            home: Vec::new(),
            home_f: Vec::new(),
            rest_x: Vec::new(),
            rest_y: Vec::new(),
            tgt_x: Vec::new(),
            tgt_y: Vec::new(),
            out: Vec::new(),
            cell: 6.0,
            inv_cell: 1.0 / 6.0,
            gw: 0,
            gh: 0,
            gm: Vec::new(),
            gvx: Vec::new(),
            gvy: Vec::new(),
            p_vol: 1.0,
            bulk: 1.0,
            mu: 0.0,
            elems: vec![0.0; MAX_ELEMS * ELEM_STRIDE],
            prev_elems: vec![0.0; MAX_ELEMS * ELEM_STRIDE],
            n_elems: 0,
            elem_vx: [0.0; MAX_ELEMS],
            elem_vy: [0.0; MAX_ELEMS],
            stiff: [1.0; MAX_ELEMS],
            elem_phase: [0.0; MAX_ELEMS],
            have_prev: false,
            vw: 800.0,
            vh: 600.0,
            ptr_x: 0.0,
            ptr_y: 0.0,
            ptr_vx: 0.0,
            ptr_vy: 0.0,
            ptr_on: false,
            time: 0.0,
            rng: 0x9e37_79b9,
            spacing_px: 4.0,
        }
    }

    // ---- shared memory accessors ------------------------------------------------
    pub fn elems_ptr(&self) -> *const f32 {
        self.elems.as_ptr()
    }
    pub fn elem_stride(&self) -> usize {
        ELEM_STRIDE
    }
    pub fn max_elems(&self) -> usize {
        MAX_ELEMS
    }
    pub fn positions_ptr(&self) -> *const f32 {
        self.out.as_ptr()
    }
    pub fn homes_ptr(&self) -> *const f32 {
        self.home_f.as_ptr()
    }
    pub fn count(&self) -> usize {
        self.n
    }
    pub fn cell_px(&self) -> f32 {
        self.cell
    }
    pub fn grid_w(&self) -> usize {
        self.gw
    }
    pub fn grid_h(&self) -> usize {
        self.gh
    }
    pub fn spacing_px(&self) -> f32 {
        self.spacing_px
    }
    pub fn substeps(&self) -> usize {
        SUBSTEPS
    }
    pub fn stiffness(&self, e: usize) -> f32 {
        if e < MAX_ELEMS {
            self.stiff[e]
        } else {
            0.0
        }
    }

    /// Initialise for viewport (vw, vh) px, `n_elems` elements already written
    /// into the elems buffer, and roughly `n_total` particles distributed by
    /// area. Picks the grid cell size (4..8 px) from viewport + particle density.
    pub fn init(&mut self, vw: f32, vh: f32, n_elems: usize, n_total: usize) -> usize {
        self.vw = vw.max(64.0);
        self.vh = vh.max(64.0);
        self.n_elems = n_elems.min(MAX_ELEMS);

        let mut areas = [0.0f32; MAX_ELEMS];
        let mut total_area = 0.0;
        for e in 0..self.n_elems {
            let b = e * ELEM_STRIDE;
            let a = rounded_rect_area(self.elems[b + 2], self.elems[b + 3], self.elems[b + 4]);
            areas[e] = a.max(0.0);
            total_area += areas[e];
        }
        let n_total = n_total.max(16);
        let area_per_particle = (total_area / n_total as f32).max(1.0);
        self.spacing_px = area_per_particle.sqrt();

        // Cell size: scales with viewport (~240 cells across the long side), but
        // never so small that we have < ~1.5 particles per cell; clamp 4..8 px.
        let by_viewport = self.vw.max(self.vh) / 240.0;
        let by_density = (1.5 * area_per_particle).sqrt();
        self.cell = by_viewport.max(by_density).clamp(4.0, 8.0);
        self.inv_cell = 1.0 / self.cell;
        self.gw = (self.vw * self.inv_cell).ceil() as usize + 1;
        self.gh = (self.vh * self.inv_cell).ceil() as usize + 1;
        let gn = self.gw * self.gh;
        self.gm = vec![0.0; gn];
        self.gvx = vec![0.0; gn];
        self.gvy = vec![0.0; gn];

        // Material in grid units. Rest density = 1 (mass == volume).
        let ppc = (self.cell * self.cell) / area_per_particle;
        self.p_vol = 1.0 / ppc;
        let c_cells = SOUND_SPEED_PX * self.inv_cell;
        self.bulk = c_cells * c_cells;
        self.mu = VISCOSITY_PX * self.inv_cell * self.inv_cell;

        // Sample each element's rounded rect on a jittered lattice.
        self.x.clear();
        self.y.clear();
        self.home.clear();
        self.rest_x.clear();
        self.rest_y.clear();
        for e in 0..self.n_elems {
            let b = e * ELEM_STRIDE;
            let (w, h, r) = (self.elems[b + 2], self.elems[b + 3], self.elems[b + 4]);
            if w <= 0.0 || h <= 0.0 {
                continue;
            }
            let want = (n_total as f32 * areas[e] / total_area).round().max(8.0);
            // spacing such that the lattice inside the rounded rect has ~want points
            let s = (areas[e] / want).sqrt();
            let nx = (w / s).floor().max(1.0) as usize;
            let ny = (h / s).floor().max(1.0) as usize;
            let ox = (w - (nx as f32 - 1.0) * s) * 0.5;
            let oy = (h - (ny as f32 - 1.0) * s) * 0.5;
            for iy in 0..ny {
                for ix in 0..nx {
                    // hex-ish offset + small jitter keeps it from looking like a grid
                    let off = if iy % 2 == 1 { 0.25 * s } else { -0.25 * s };
                    let jx = (self.rand() - 0.5) * 0.3 * s;
                    let jy = (self.rand() - 0.5) * 0.3 * s;
                    let lx = (ox + ix as f32 * s + off + jx).clamp(0.5, w - 0.5);
                    let ly = (oy + iy as f32 * s + jy).clamp(0.5, h - 0.5);
                    if inside_rounded_rect(lx, ly, w, h, r - 0.5) {
                        self.home.push(e as u32);
                        self.rest_x.push(lx);
                        self.rest_y.push(ly);
                        self.x.push(0.0);
                        self.y.push(0.0);
                    }
                }
            }
            self.elem_phase[e] = self.rand() * std::f32::consts::TAU;
            self.stiff[e] = 1.0;
        }
        self.n = self.home.len();
        self.vx = vec![0.0; self.n];
        self.vy = vec![0.0; self.n];
        self.c = vec![[0.0; 4]; self.n];
        self.j = vec![1.0; self.n];
        self.tgt_x = vec![0.0; self.n];
        self.tgt_y = vec![0.0; self.n];
        self.home_f = self.home.iter().map(|&h| h as f32).collect();
        self.out = vec![0.0; self.n * 2];
        self.prev_elems.copy_from_slice(&self.elems);
        self.have_prev = true;
        self.reset();
        self.n
    }

    /// Snap every particle back onto its home shape, zero velocity.
    pub fn reset(&mut self) {
        for p in 0..self.n {
            let b = self.home[p] as usize * ELEM_STRIDE;
            self.x[p] = self.clamp_x((self.elems[b] + self.rest_x[p]) * self.inv_cell);
            self.y[p] = self.clamp_y((self.elems[b + 1] + self.rest_y[p]) * self.inv_cell);
            self.vx[p] = 0.0;
            self.vy[p] = 0.0;
            self.c[p] = [0.0; 4];
            self.j[p] = 1.0;
        }
        for e in 0..MAX_ELEMS {
            self.stiff[e] = 1.0;
        }
        self.write_out();
    }

    pub fn set_pointer(&mut self, x: f32, y: f32, vx: f32, vy: f32, active: bool) {
        self.ptr_x = x;
        self.ptr_y = y;
        self.ptr_vx = vx;
        self.ptr_vy = vy;
        self.ptr_on = active;
    }

    /// Strong radial splash at (x, y) px. `speed` px/s at the centre, falls off
    /// to 0 at `radius`. Only particles of element `only` are kicked (-1 = all);
    /// neighbours get hit by the flying liquid itself. Hit elements go soft.
    pub fn impulse(&mut self, x: f32, y: f32, speed: f32, radius: f32, only: i32) {
        let mut hits = [0usize; MAX_ELEMS];
        let mut totals = [0usize; MAX_ELEMS];
        // Angular lobes: a few random low-frequency jets instead of a uniform
        // ring, so the liquid splits into blobs/fingers.
        let k1 = 4.0 + (self.rand() * 4.0).floor();
        let k2 = k1 + 2.0 + (self.rand() * 3.0).floor();
        let ph1 = self.rand() * std::f32::consts::TAU;
        let ph2 = self.rand() * std::f32::consts::TAU;
        for p in 0..self.n {
            let e = self.home[p] as usize;
            totals[e] += 1;
            if only >= 0 && e != only as usize {
                continue;
            }
            let px = self.x[p] * self.cell;
            let py = self.y[p] * self.cell;
            let dx = px - x;
            let dy = py - y;
            let d = (dx * dx + dy * dy).sqrt();
            if d >= radius {
                continue;
            }
            hits[e] += 1;
            let (mut ux, mut uy) = if d > 1e-3 { (dx / d, dy / d) } else { (1.0, 0.0) };
            // angular jitter so the sheet tears into separate droplets/fingers
            let a = (self.rand() - 0.5) * 0.9;
            let (sa, ca) = a.sin_cos();
            let rx = ux * ca - uy * sa;
            let ry = ux * sa + uy * ca;
            ux = rx;
            uy = ry;
            let th = dy.atan2(dx);
            let lobe = (0.6 * (k1 * th + ph1).sin() + 0.4 * (k2 * th + ph2).sin()).max(-0.2);
            let lobe = 0.3 + 0.9 * (lobe + 0.2) / 1.2;
            let f = (1.0 - d / radius).sqrt() * lobe * (0.8 + 0.4 * self.rand());
            self.vx[p] += ux * speed * f * self.inv_cell;
            self.vy[p] += uy * speed * f * self.inv_cell;
            self.j[p] = 1.0;
        }
        for e in 0..self.n_elems {
            if totals[e] > 0 && hits[e] * 5 > totals[e] {
                self.stiff[e] = STIFF_FLOOR;
            } else if hits[e] > 0 {
                self.stiff[e] = self.stiff[e].min(0.25);
            }
        }
    }

    /// Global shake: every element gets a kick in its own random direction,
    /// plus per-particle noise, and goes soft.
    pub fn shake(&mut self, speed: f32) {
        let mut dir = [(0.0f32, 0.0f32); MAX_ELEMS];
        for d in dir.iter_mut() {
            let a = self.rand() * std::f32::consts::TAU;
            *d = (a.cos(), a.sin());
        }
        for p in 0..self.n {
            let e = self.home[p] as usize;
            let nx = self.rand() - 0.5;
            let ny = self.rand() - 0.5;
            self.vx[p] += (dir[e].0 + nx * 0.9) * speed * self.inv_cell;
            self.vy[p] += (dir[e].1 + ny * 0.9) * speed * self.inv_cell;
        }
        for e in 0..self.n_elems {
            self.stiff[e] = self.stiff[e].min(0.04);
        }
    }

    /// Advance one display frame (fixed 1/60 s, SUBSTEPS substeps). The real
    /// frame time is only used to estimate element velocity.
    pub fn step(&mut self) {
        // element velocities from rect deltas (for damping relative to a moving home)
        for e in 0..self.n_elems {
            let b = e * ELEM_STRIDE;
            if self.have_prev {
                self.elem_vx[e] = (self.elems[b] - self.prev_elems[b]) / FRAME_DT * self.inv_cell;
                self.elem_vy[e] =
                    (self.elems[b + 1] - self.prev_elems[b + 1]) / FRAME_DT * self.inv_cell;
            }
        }
        self.prev_elems.copy_from_slice(&self.elems);
        self.have_prev = true;

        let dt = FRAME_DT / SUBSTEPS as f32;
        for _ in 0..SUBSTEPS {
            self.update_stiffness(dt);
            self.substep(dt);
            self.time += dt;
        }
        self.write_out();
    }
}

impl Sim {
    fn rand(&mut self) -> f32 {
        // xorshift32
        let mut s = self.rng;
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        self.rng = s;
        (s >> 8) as f32 / (1u32 << 24) as f32
    }

    #[inline]
    fn clamp_x(&self, x: f32) -> f32 {
        x.clamp(1.0, self.gw as f32 - 2.001)
    }
    #[inline]
    fn clamp_y(&self, y: f32) -> f32 {
        y.clamp(1.0, self.gh as f32 - 2.001)
    }

    fn update_stiffness(&mut self, dt: f32) {
        let k = 1.0 - (-dt / STIFF_TAU).exp();
        for e in 0..self.n_elems {
            let cap = self.elems[e * ELEM_STRIDE + 5];
            let cap = if cap > 0.0 { cap.min(1.0) } else { 1.0 };
            let s = self.stiff[e] + (1.0 - self.stiff[e]) * k;
            self.stiff[e] = s.min(cap).max(STIFF_FLOOR);
        }
    }

    fn substep(&mut self, dt: f32) {
        let gw = self.gw;
        let gh = self.gh;
        let inv = self.inv_cell;
        self.gm.fill(0.0);
        self.gvx.fill(0.0);
        self.gvy.fill(0.0);

        let p_vol = self.p_vol;
        let p_mass = p_vol; // rest density 1
        let bulk = self.bulk;
        let mu = self.mu;
        let amax = SPRING_AMAX_PX * inv;
        let drag = (-AIR_DRAG * dt).exp();
        let t = self.time;

        let ptr_on = self.ptr_on;
        let (ptx, pty) = (self.ptr_x * inv, self.ptr_y * inv);
        let (pvx, pvy) = (self.ptr_vx * inv, self.ptr_vy * inv);
        let pr = POINTER_RADIUS_PX * inv;
        let pr2 = pr * pr;
        let ppush = POINTER_PUSH_PX * inv;

        // ---- external forces + P2G ----
        for p in 0..self.n {
            let e = self.home[p] as usize;
            let b = e * ELEM_STRIDE;
            let s = self.stiff[e];
            let ph = self.elem_phase[e];

            // home target under the element's current rect, with subtle wobble
            let rx = self.rest_x[p];
            let ry = self.rest_y[p];
            let wob_y = WOBBLE_PX * (2.1 * t + 0.045 * rx + ph).sin();
            let wob_x = 0.6 * WOBBLE_PX * (1.7 * t + 0.07 * ry + ph * 1.3).cos();
            let tx = (self.elems[b] + rx + wob_x) * inv;
            let ty = (self.elems[b + 1] + ry + wob_y) * inv;
            self.tgt_x[p] = tx;
            self.tgt_y[p] = ty;

            let mut vx = self.vx[p] * drag;
            let mut vy = self.vy[p] * drag;
            let x = self.x[p];
            let y = self.y[p];

            // damped saturated spring; zeta kept constant as stiffness varies
            let k = SPRING_K * s;
            let cdamp = 2.0 * SPRING_ZETA * k.sqrt();
            let mut ax = k * (tx - x) + cdamp * (self.elem_vx[e] - vx);
            let mut ay = k * (ty - y) + cdamp * (self.elem_vy[e] - vy);
            let am = (ax * ax + ay * ay).sqrt();
            let amax_s = amax * (0.25 + 0.75 * s);
            if am > amax_s {
                ax *= amax_s / am;
                ay *= amax_s / am;
            }

            if ptr_on {
                let dx = x - ptx;
                let dy = y - pty;
                let d2 = dx * dx + dy * dy;
                if d2 < pr2 {
                    let d = d2.sqrt().max(1e-3);
                    let f = 1.0 - d / pr;
                    let f2 = f * f;
                    ax += dx / d * ppush * f2;
                    ay += dy / d * ppush * f2;
                    ax += (pvx - vx) * POINTER_DRAG * f2;
                    ay += (pvy - vy) * POINTER_DRAG * f2;
                }
            }
            vx += ax * dt;
            vy += ay * dt;
            self.vx[p] = vx;
            self.vy[p] = vy;

            // P2G
            let bx = (x - 0.5).floor();
            let by = (y - 0.5).floor();
            let fx = x - bx;
            let fy = y - by;
            let wx = bspline(fx);
            let wy = bspline(fy);
            let jm1 = self.j[p] - 1.0;
            let cc = self.c[p];
            let pres = bulk * jm1; // isotropic part of sigma
            let s00 = pres + mu * 2.0 * cc[0];
            let s01 = mu * (cc[1] + cc[2]);
            let s11 = pres + mu * 2.0 * cc[3];
            let kk = -dt * 4.0 * p_vol;
            let a00 = kk * s00 + p_mass * cc[0];
            let a01 = kk * s01 + p_mass * cc[1];
            let a10 = kk * s01 + p_mass * cc[2];
            let a11 = kk * s11 + p_mass * cc[3];
            let mvx = p_mass * vx;
            let mvy = p_mass * vy;
            let bxi = bx as usize;
            let byi = by as usize;
            for (jj, wyj) in wy.iter().enumerate() {
                let dy = jj as f32 - fy;
                let row = (byi + jj) * gw + bxi;
                for (ii, wxi) in wx.iter().enumerate() {
                    let w = wxi * wyj;
                    let dx = ii as f32 - fx;
                    let idx = row + ii;
                    self.gm[idx] += w * p_mass;
                    self.gvx[idx] += w * (mvx + a00 * dx + a01 * dy);
                    self.gvy[idx] += w * (mvy + a10 * dx + a11 * dy);
                }
            }
        }

        // ---- grid update: momentum -> velocity, viewport walls (slip) ----
        for jy in 0..gh {
            for ix in 0..gw {
                let idx = jy * gw + ix;
                let m = self.gm[idx];
                if m <= 0.0 {
                    continue;
                }
                let mut vx = self.gvx[idx] / m;
                let mut vy = self.gvy[idx] / m;
                if (ix < 2 && vx < 0.0) || (ix + 3 > gw && vx > 0.0) {
                    vx = 0.0;
                }
                if (jy < 2 && vy < 0.0) || (jy + 3 > gh && vy > 0.0) {
                    vy = 0.0;
                }
                self.gvx[idx] = vx;
                self.gvy[idx] = vy;
            }
        }

        // ---- G2P ----
        let vmax = MAX_CELLS_PER_SUBSTEP / dt;
        let relax = (J_RELAX * dt).min(1.0);
        let slip_max = SLIP_MAX_PX * inv;
        for p in 0..self.n {
            let x = self.x[p];
            let y = self.y[p];
            let bx = (x - 0.5).floor();
            let by = (y - 0.5).floor();
            let fx = x - bx;
            let fy = y - by;
            let wx = bspline(fx);
            let wy = bspline(fy);
            let bxi = bx as usize;
            let byi = by as usize;
            let mut nvx = 0.0;
            let mut nvy = 0.0;
            let mut c = [0.0f32; 4];
            for (jj, wyj) in wy.iter().enumerate() {
                let dy = jj as f32 - fy;
                let row = (byi + jj) * gw + bxi;
                for (ii, wxi) in wx.iter().enumerate() {
                    let w = wxi * wyj;
                    let dx = ii as f32 - fx;
                    let idx = row + ii;
                    let gvx = self.gvx[idx];
                    let gvy = self.gvy[idx];
                    nvx += w * gvx;
                    nvy += w * gvy;
                    c[0] += 4.0 * w * gvx * dx;
                    c[1] += 4.0 * w * gvx * dy;
                    c[2] += 4.0 * w * gvy * dx;
                    c[3] += 4.0 * w * gvy * dy;
                }
            }
            let sp = (nvx * nvx + nvy * nvy).sqrt();
            if sp > vmax {
                nvx *= vmax / sp;
                nvy *= vmax / sp;
            }
            self.vx[p] = nvx;
            self.vy[p] = nvy;
            self.c[p] = c;
            // slip: advect with grid velocity + private drift towards home
            let s = self.stiff[self.home[p] as usize];
            let rate = SLIP_RATE * s * s;
            let mut sx = (self.tgt_x[p] - x) * rate;
            let mut sy = (self.tgt_y[p] - y) * rate;
            let sm = (sx * sx + sy * sy).sqrt();
            if sm > slip_max {
                sx *= slip_max / sm;
                sy *= slip_max / sm;
            }
            self.x[p] = self.clamp_x(x + dt * (nvx + sx));
            self.y[p] = self.clamp_y(y + dt * (nvy + sy));
            let mut j = self.j[p] * (1.0 + dt * (c[0] + c[3]));
            j = j.clamp(COMPRESS_MIN, 1.0 + TENSION_MAX); // plastic yield on stretch
            j += (1.0 - j) * relax;
            self.j[p] = j;
        }
    }

    fn write_out(&mut self) {
        let cell = self.cell;
        for p in 0..self.n {
            self.out[2 * p] = self.x[p] * cell;
            self.out[2 * p + 1] = self.y[p] * cell;
        }
    }
}

impl Default for Sim {
    fn default() -> Self {
        Self::new()
    }
}
