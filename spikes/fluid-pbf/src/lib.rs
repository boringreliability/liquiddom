//! Solver A: Position Based Fluids (Macklin & Mueller 2013) + per-element
//! shape matching (Mueller et al. 2005) with impulse-weakened binding.
//!
//! Throwaway spike. Units are CSS pixels and seconds. All per-particle state is
//! SoA (`x` block followed by `y` block in one Vec) so the hot loops stay
//! linear and SIMD-friendly, and so TS can read positions as one flat
//! Float32Array view into WASM memory (no JSON across the boundary).

use wasm_bindgen::prelude::*;

const PI: f32 = std::f32::consts::PI;
const MAX_NBR: usize = 40;

struct Elem {
    // Rest rounded-rect (DOM-measured, CSS px).
    x: f32,
    y: f32,
    w: f32,
    h: f32,
    r: f32,
    start: usize,
    count: usize,
    /// Extra translation applied to the home anchor (drag).
    off_x: f32,
    off_y: f32,
    /// Impulse "damage": weakens the binding; decays exponentially.
    damage: f32,
    phase: f32,
}

impl Elem {
    fn cx(&self) -> f32 {
        self.x + self.w * 0.5
    }
    fn cy(&self) -> f32 {
        self.y + self.h * 0.5
    }
}

#[wasm_bindgen]
pub struct Sim {
    n: usize,
    width: f32,
    height: f32,

    // --- per particle, SoA (len 2n: [x..., y...]) ---
    pos: Vec<f32>,
    prev: Vec<f32>,
    vel: Vec<f32>,
    dp: Vec<f32>,
    /// Rest offset q_i from the element's rest centre.
    rest: Vec<f32>,
    /// Radial unit vector of q_i and its perimeter angle (for idle wobble).
    wob: Vec<f32>,
    /// cos/sin of the per-particle wobble phase (3*angle + element phase), so
    /// the wobble needs no per-particle trig at runtime: SoA [cos..., sin...].
    wph: Vec<f32>,
    lambda: Vec<f32>,
    home: Vec<u32>,

    // --- neighbour search (uniform grid, counting sort) ---
    cell_of: Vec<u32>,
    cell_start: Vec<u32>,
    sorted: Vec<u32>,
    nbr: Vec<u32>,
    nbr_n: Vec<u32>,
    pair_gx: Vec<f32>,
    pair_gy: Vec<f32>,
    pair_sc: Vec<f32>,
    gw: usize,
    gh: usize,

    elems: Vec<Elem>,

    // --- kernel / fluid constants (derived from spacing) ---
    spacing: f32,
    h: f32,
    poly6: f32,
    spiky_grad: f32,
    rho0: f32,
    eps: f32,
    scorr_w: f32,

    // --- tunables ---
    pub substeps: u32,
    pub iterations: u32,
    pub k_shape: f32,
    pub k_home: f32,
    pub cohesion: f32,
    pub xsph: f32,
    pub damping: f32,
    pub damage_tau: f32,
    pub wobble: f32,
    pub contact_soft: f32,
    pub cross_cohesion: f32,

    // pointer (soft repulsion)
    ptr_x: f32,
    ptr_y: f32,
    ptr_r: f32,
    ptr_s: f32,
    ptr_on: bool,

    time: f32,
    rng: u32,
}

#[inline]
fn rand01(s: &mut u32) -> f32 {
    // xorshift32
    let mut x = *s;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *s = x;
    (x >> 8) as f32 / (1u32 << 24) as f32
}

/// Signed distance to the rounded rect (negative inside).
fn sdf_rrect(px: f32, py: f32, e: &Elem) -> f32 {
    let r = e.r.min(e.w * 0.5).min(e.h * 0.5);
    let qx = (px - e.cx()).abs() - (e.w * 0.5 - r);
    let qy = (py - e.cy()).abs() - (e.h * 0.5 - r);
    let ox = qx.max(0.0);
    let oy = qy.max(0.0);
    (ox * ox + oy * oy).sqrt() + qx.max(qy).min(0.0) - r
}

/// Rest samples for one element: a ring that traces the rounded outline
/// (inset by s/2, so the silhouette corners stay round even at low n) plus a
/// square lattice for the interior.
fn sample_element(e: &Elem, s: f32) -> Vec<(f32, f32)> {
    let mut out = Vec::new();
    // Two rings that trace the rounded outline (inset by s/2 and 3s/2) keep
    // the silhouette corners round even at low n; a lattice fills the rest.
    for ring in 0..2 {
        let inset = s * (0.5 + ring as f32);
        let hw = e.w * 0.5 - inset;
        let hh = e.h * 0.5 - inset;
        if hw <= 0.0 || hh <= 0.0 {
            break;
        }
        let r = (e.r.min(e.w * 0.5).min(e.h * 0.5) - inset).max(0.0);
        let (sx, sy) = (hw - r, hh - r); // straight half-lengths
        let q = 0.5 * PI * r;
        let segs = [2.0 * sx, q, 2.0 * sy, q, 2.0 * sx, q, 2.0 * sy, q];
        let perim: f32 = segs.iter().sum();
        let m = (perim / s).round().max(4.0) as usize;
        let step = perim / m as f32;
        // offset odd ring by half a step so the rings interlock
        let shift = if ring == 1 { 0.5 * step } else { 0.0 };
        for k in 0..m {
            let mut t = k as f32 * step + shift;
            let mut seg = 0;
            while seg < 7 && t > segs[seg] {
                t -= segs[seg];
                seg += 1;
            }
            let a = if r > 0.0 { t / r } else { 0.0 };
            let (x, y) = match seg {
                0 => (-sx + t, -hh),
                1 => (sx + r * a.sin(), -sy - r * a.cos()),
                2 => (hw, -sy + t),
                3 => (sx + r * a.cos(), sy + r * a.sin()),
                4 => (sx - t, hh),
                5 => (-sx - r * a.sin(), sy + r * a.cos()),
                6 => (-hw, sy - t),
                _ => (-sx - r * a.cos(), -sy - r * a.sin()),
            };
            out.push((e.cx() + x, e.cy() + y));
        }
    }
    // interior lattice
    let iw = e.w - 5.0 * s;
    let ih = e.h - 5.0 * s;
    if iw >= 0.0 && ih >= 0.0 {
        // Stretch the lattice pitch slightly so it exactly spans the inner
        // area: no 2s-wide gap next to the rings (that showed up as a faint
        // inner outline in the render).
        let nx = (iw / s).round() as i32 + 1;
        let ny = (ih / s).round() as i32 + 1;
        let sx = if nx > 1 { iw / (nx - 1) as f32 } else { 0.0 };
        let sy = if ny > 1 { ih / (ny - 1) as f32 } else { 0.0 };
        let ox = e.cx() - iw * 0.5;
        let oy = e.cy() - ih * 0.5;
        for j in 0..ny {
            for i in 0..nx {
                let px = if nx > 1 { ox + i as f32 * sx } else { e.cx() };
                let py = if ny > 1 { oy + j as f32 * sy } else { e.cy() };
                if sdf_rrect(px, py, e) < -2.2 * s {
                    out.push((px, py));
                }
            }
        }
    }
    out
}

#[wasm_bindgen]
impl Sim {
    #[wasm_bindgen(constructor)]
    pub fn new(width: f32, height: f32) -> Sim {
        Sim {
            n: 0,
            width,
            height,
            pos: vec![],
            prev: vec![],
            vel: vec![],
            dp: vec![],
            rest: vec![],
            wob: vec![],
            wph: vec![],
            lambda: vec![],
            home: vec![],
            cell_of: vec![],
            cell_start: vec![],
            sorted: vec![],
            nbr: vec![],
            nbr_n: vec![],
            pair_gx: vec![],
            pair_gy: vec![],
            pair_sc: vec![],
            gw: 1,
            gh: 1,
            elems: vec![],
            spacing: 4.0,
            h: 8.0,
            poly6: 0.0,
            spiky_grad: 0.0,
            rho0: 1.0,
            eps: 1.0,
            scorr_w: 1.0,
            substeps: 2,
            iterations: 3,
            k_shape: 0.10,
            k_home: 0.035,
            cohesion: 2.0,
            xsph: 0.08,
            damping: 1.6,
            damage_tau: 1.0,
            wobble: 1.0,
            contact_soft: 0.7,
            cross_cohesion: 0.3,
            ptr_x: 0.0,
            ptr_y: 0.0,
            ptr_r: 70.0,
            ptr_s: 0.0,
            ptr_on: false,
            time: 0.0,
            rng: 0x9E37_79B9,
        }
    }

    /// Register a rest shape (rounded rect, CSS px). Call before `build`.
    pub fn add_element(&mut self, x: f32, y: f32, w: f32, h: f32, radius: f32) -> u32 {
        self.elems.push(Elem {
            x,
            y,
            w,
            h,
            r: radius,
            start: 0,
            count: 0,
            off_x: 0.0,
            off_y: 0.0,
            damage: 0.0,
            phase: self.elems.len() as f32 * 1.7,
        });
        (self.elems.len() - 1) as u32
    }

    /// Sample particles on a square lattice inside every rest shape. One shared
    /// spacing so count is proportional to area and rest density is uniform.
    pub fn build(&mut self, target_n: u32) {
        let area: f32 = self.elems.iter().map(|e| e.w * e.h).sum();
        // Shrink spacing a touch until we reach the target count.
        let mut s = (area / target_n.max(1) as f32).sqrt();
        let mut samples: Vec<(u32, f32, f32)>;
        loop {
            samples = Vec::new();
            for (ei, e) in self.elems.iter().enumerate() {
                for (px, py) in sample_element(e, s) {
                    samples.push((ei as u32, px, py));
                }
            }
            if samples.len() as u32 >= target_n || s < 0.5 {
                break;
            }
            s *= 0.985;
        }
        let n = samples.len();
        self.n = n;
        self.spacing = s;
        self.pos = vec![0.0; 2 * n];
        self.rest = vec![0.0; 2 * n];
        self.wob = vec![0.0; 2 * n];
        self.wph = vec![0.0; 2 * n];
        self.home = vec![0; n];
        let mut counts = vec![0usize; self.elems.len()];
        let mut first = vec![usize::MAX; self.elems.len()];
        for (i, &(ei, px, py)) in samples.iter().enumerate() {
            let e = &self.elems[ei as usize];
            self.pos[i] = px;
            self.pos[n + i] = py;
            let qx = px - e.cx();
            let qy = py - e.cy();
            self.rest[i] = qx;
            self.rest[n + i] = qy;
            let l = (qx * qx + qy * qy).sqrt().max(1e-3);
            // Scale wobble with distance from centre so the interior stays put.
            let rmax = (e.w * e.w + e.h * e.h).sqrt() * 0.5;
            let f = (l / rmax).min(1.0);
            self.wob[i] = qx / l * f;
            self.wob[n + i] = qy / l * f;
            let ph = 3.0 * qy.atan2(qx) + e.phase;
            self.wph[i] = ph.cos();
            self.wph[n + i] = ph.sin();
            self.home[i] = ei;
            counts[ei as usize] += 1;
            first[ei as usize] = first[ei as usize].min(i);
        }
        for (k, e) in self.elems.iter_mut().enumerate() {
            e.start = if first[k] == usize::MAX { 0 } else { first[k] };
            e.count = counts[k];
        }
        self.prev = self.pos.clone();
        self.vel = vec![0.0; 2 * n];
        self.dp = vec![0.0; 2 * n];
        self.lambda = vec![0.0; n];
        self.nbr = vec![0; n * MAX_NBR];
        self.nbr_n = vec![0; n];
        self.pair_gx = vec![0.0; n * MAX_NBR];
        self.pair_gy = vec![0.0; n * MAX_NBR];
        self.pair_sc = vec![0.0; n * MAX_NBR];
        self.cell_of = vec![0; n];
        self.sorted = vec![0; n];
        self.setup_kernels();
        self.setup_grid();
    }

    fn setup_kernels(&mut self) {
        let s = self.spacing;
        let h = 2.0 * s;
        self.h = h;
        self.poly6 = 4.0 / (PI * h.powi(8));
        self.spiky_grad = -30.0 / (PI * h.powi(5));
        // Rest density and constraint-gradient scale of an interior lattice
        // particle, so eps / s_corr are resolution independent.
        let mut rho = 0.0;
        let mut sum_g = 0.0;
        let k = (h / s).ceil() as i32 + 1;
        for j in -k..=k {
            for i in -k..=k {
                let dx = i as f32 * s;
                let dy = j as f32 * s;
                let r2 = dx * dx + dy * dy;
                if r2 < h * h {
                    rho += self.w_poly6(r2);
                    if r2 > 0.0 {
                        let r = r2.sqrt();
                        let g = self.spiky_grad * (h - r) * (h - r);
                        sum_g += g * g;
                    }
                }
            }
        }
        self.rho0 = rho;
        // sum_k |grad_k C|^2 at rest ~ sum_g / rho0^2 (self term is ~0 by symmetry)
        let cgrad = sum_g / (rho * rho);
        self.eps = 0.6 * cgrad;
        self.scorr_w = self.w_poly6((0.2 * h) * (0.2 * h));
    }

    fn setup_grid(&mut self) {
        self.gw = (self.width / self.h).ceil() as usize + 2;
        self.gh = (self.height / self.h).ceil() as usize + 2;
        self.cell_start = vec![0; self.gw * self.gh + 1];
    }

    #[inline]
    fn w_poly6(&self, r2: f32) -> f32 {
        let h2 = self.h * self.h;
        if r2 >= h2 {
            0.0
        } else {
            let d = h2 - r2;
            self.poly6 * d * d * d
        }
    }

    pub fn resize(&mut self, width: f32, height: f32) {
        self.width = width;
        self.height = height;
        self.setup_grid();
    }

    /// Move an element's rest shape (DOM moved / viewport resized).
    pub fn set_rest_origin(&mut self, e: u32, x: f32, y: f32) {
        if let Some(el) = self.elems.get_mut(e as usize) {
            el.x = x;
            el.y = y;
        }
    }

    /// Drag: translate the home anchor of one element.
    pub fn set_offset(&mut self, e: u32, dx: f32, dy: f32) {
        if let Some(el) = self.elems.get_mut(e as usize) {
            el.off_x = dx;
            el.off_y = dy;
        }
    }

    pub fn add_damage(&mut self, e: u32, d: f32) {
        if let Some(el) = self.elems.get_mut(e as usize) {
            el.damage = (el.damage + d).min(3.0);
        }
    }

    pub fn set_pointer(&mut self, x: f32, y: f32, radius: f32, strength: f32, active: bool) {
        self.ptr_x = x;
        self.ptr_y = y;
        self.ptr_r = radius;
        self.ptr_s = strength;
        self.ptr_on = active;
    }

    /// Strong radial impulse (splash). Elements are damaged in proportion to
    /// how much of their mass got hit, which weakens their shape binding.
    pub fn impulse(&mut self, x: f32, y: f32, radius: f32, strength: f32, damage: f32) {
        let n = self.n;
        let mut hit = vec![0.0f32; self.elems.len()];
        for i in 0..n {
            let dx = self.pos[i] - x;
            let dy = self.pos[n + i] - y;
            let d = (dx * dx + dy * dy).sqrt();
            if d < radius {
                let f = 1.0 - d / radius;
                let inv = 1.0 / d.max(1.0);
                let jx = rand01(&mut self.rng) - 0.5;
                let jy = rand01(&mut self.rng) - 0.5;
                let s = strength * (0.35 + 0.65 * f);
                self.vel[i] += (dx * inv + jx * 0.12) * s;
                self.vel[n + i] += (dy * inv + jy * 0.12) * s;
                hit[self.home[i] as usize] += f;
            }
        }
        for (k, e) in self.elems.iter_mut().enumerate() {
            if e.count > 0 {
                let frac = (hit[k] / e.count as f32 * 2.5).min(1.0);
                e.damage = (e.damage + damage * frac).min(3.0);
            }
        }
    }

    /// Global shake: every element gets a random kick plus per-particle jitter.
    pub fn shake(&mut self, strength: f32, damage: f32) {
        let n = self.n;
        // Per-element kick + a coherent per-element "slosh" field (crossed sine
        // waves with random phase/wavelength) so the liquid sloshes in waves
        // instead of fizzing like sand, and no two elements look alike.
        for k in 0..self.elems.len() {
            let a = rand01(&mut self.rng) * 2.0 * PI;
            let mag = strength * (0.6 + 0.5 * rand01(&mut self.rng));
            let (ax, ay) = (a.cos() * mag, a.sin() * mag);
            let p1 = rand01(&mut self.rng) * 2.0 * PI;
            let p2 = rand01(&mut self.rng) * 2.0 * PI;
            let k1 = 2.0 * PI / (90.0 + 120.0 * rand01(&mut self.rng));
            let k2 = 2.0 * PI / (90.0 + 120.0 * rand01(&mut self.rng));
            let (start, count) = (self.elems[k].start, self.elems[k].count);
            for i in start..start + count {
                let x = self.pos[i];
                let y = self.pos[n + i];
                let jx = rand01(&mut self.rng) - 0.5;
                let jy = rand01(&mut self.rng) - 0.5;
                self.vel[i] += ax + strength * ((k1 * y + p1).sin() * 0.4 + jx * 0.15);
                self.vel[n + i] += ay + strength * ((k2 * x + p2).sin() * 0.4 + jy * 0.15);
            }
            let e = &mut self.elems[k];
            e.damage = (e.damage + damage).min(3.0);
        }
    }

    pub fn reset(&mut self) {
        let n = self.n;
        for k in 0..self.elems.len() {
            let e = &mut self.elems[k];
            e.off_x = 0.0;
            e.off_y = 0.0;
            e.damage = 0.0;
            let (cx, cy, s, c) = (e.cx(), e.cy(), e.start, e.count);
            for i in s..s + c {
                self.pos[i] = cx + self.rest[i];
                self.pos[n + i] = cy + self.rest[n + i];
            }
        }
        self.vel.iter_mut().for_each(|v| *v = 0.0);
        self.prev.copy_from_slice(&self.pos);
    }

    // ------------------------------------------------------------------
    // Solver
    // ------------------------------------------------------------------

    /// Advance one frame of `dt` seconds, split into `substeps`.
    pub fn step(&mut self, dt: f32) {
        let dt = dt.clamp(0.0, 1.0 / 30.0);
        if self.n == 0 || dt <= 0.0 {
            return;
        }
        let sub = self.substeps.max(1);
        let h = dt / sub as f32;
        for _ in 0..sub {
            self.substep(h);
        }
        let decay = (-dt / self.damage_tau).exp();
        for e in &mut self.elems {
            e.damage *= decay;
        }
    }

    fn substep(&mut self, dt: f32) {
        let n = self.n;
        self.time += dt;

        // 1. External forces + damping, then predict.
        let damp = (-self.damping * dt).exp();
        let (pr, ps, px, py) = (self.ptr_r, self.ptr_s, self.ptr_x, self.ptr_y);
        for i in 0..n {
            let mut vx = self.vel[i] * damp;
            let mut vy = self.vel[n + i] * damp;
            if self.ptr_on {
                let dx = self.pos[i] - px;
                let dy = self.pos[n + i] - py;
                let d2 = dx * dx + dy * dy;
                if d2 < pr * pr {
                    let d = d2.sqrt().max(1.0);
                    let f = 1.0 - d / pr;
                    let a = ps * f * f * dt / d;
                    vx += dx * a;
                    vy += dy * a;
                }
            }
            self.vel[i] = vx;
            self.vel[n + i] = vy;
            self.prev[i] = self.pos[i];
            self.prev[n + i] = self.pos[n + i];
            self.pos[i] += vx * dt;
            self.pos[n + i] += vy * dt;
        }
        self.clamp_walls();

        // 2. Neighbours on predicted positions (reused across iterations).
        self.find_neighbours();
        self.contact_softening();

        // 3. Constraint iterations: density (PBF) + shape matching.
        let iters = self.iterations.max(1);
        for _ in 0..iters {
            self.solve_density();
            self.solve_shape(iters);
            self.clamp_walls();
        }

        // 4. Velocity update, cohesion, XSPH viscosity.
        let inv_dt = 1.0 / dt;
        for i in 0..2 * n {
            self.vel[i] = (self.pos[i] - self.prev[i]) * inv_dt;
        }
        self.post_velocity(dt);
    }

    fn clamp_walls(&mut self) {
        let n = self.n;
        let m = self.spacing * 0.5;
        let (w, hh) = (self.width - m, self.height - m);
        for i in 0..n {
            self.pos[i] = self.pos[i].clamp(m, w);
        }
        for i in n..2 * n {
            self.pos[i] = self.pos[i].clamp(m, hh);
        }
    }

    fn find_neighbours(&mut self) {
        let n = self.n;
        let inv = 1.0 / self.h;
        let (gw, gh) = (self.gw, self.gh);
        let ncell = gw * gh;
        self.cell_start.iter_mut().for_each(|c| *c = 0);
        for i in 0..n {
            let cx = ((self.pos[i] * inv) as usize).min(gw - 1);
            let cy = ((self.pos[n + i] * inv) as usize).min(gh - 1);
            let c = cy * gw + cx;
            self.cell_of[i] = c as u32;
            self.cell_start[c + 1] += 1;
        }
        for c in 0..ncell {
            self.cell_start[c + 1] += self.cell_start[c];
        }
        // Counting sort (use nbr_n as a temporary cursor).
        for c in 0..n {
            self.nbr_n[c] = 0;
        }
        let mut cursor = self.cell_start.clone();
        for i in 0..n {
            let c = self.cell_of[i] as usize;
            self.sorted[cursor[c] as usize] = i as u32;
            cursor[c] += 1;
        }
        let h2 = self.h * self.h;
        for i in 0..n {
            let xi = self.pos[i];
            let yi = self.pos[n + i];
            let c = self.cell_of[i] as usize;
            let cx = (c % gw) as isize;
            let cy = (c / gw) as isize;
            let mut cnt = 0usize;
            let base = i * MAX_NBR;
            'outer: for oy in -1..=1isize {
                let yy = cy + oy;
                if yy < 0 || yy >= gh as isize {
                    continue;
                }
                for ox in -1..=1isize {
                    let xx = cx + ox;
                    if xx < 0 || xx >= gw as isize {
                        continue;
                    }
                    let cc = yy as usize * gw + xx as usize;
                    let (a, b) = (
                        self.cell_start[cc] as usize,
                        self.cell_start[cc + 1] as usize,
                    );
                    for &j in &self.sorted[a..b] {
                        let j = j as usize;
                        if j == i {
                            continue;
                        }
                        let dx = xi - self.pos[j];
                        let dy = yi - self.pos[n + j];
                        if dx * dx + dy * dy < h2 {
                            self.nbr[base + cnt] = j as u32;
                            cnt += 1;
                            if cnt == MAX_NBR {
                                break 'outer;
                            }
                        }
                    }
                }
            }
            self.nbr_n[i] = cnt as u32;
        }
    }

    /// Liquid touching liquid of another element softens both bindings, so
    /// colliding blobs actually merge instead of bouncing off as two jellies.
    /// The element being dragged keeps its binding (it must follow the hand).
    fn contact_softening(&mut self) {
        let n = self.n;
        let mut touch = vec![0u32; self.elems.len()];
        for i in 0..n {
            let hi = self.home[i];
            let base = i * MAX_NBR;
            for k in 0..self.nbr_n[i] as usize {
                if self.home[self.nbr[base + k] as usize] != hi {
                    touch[hi as usize] += 1;
                    break;
                }
            }
        }
        for (k, e) in self.elems.iter_mut().enumerate() {
            if e.count == 0 || e.off_x != 0.0 || e.off_y != 0.0 {
                continue;
            }
            let frac = touch[k] as f32 / e.count as f32;
            let target = self.contact_soft * (frac * 6.0).min(1.0);
            if target > e.damage {
                e.damage = target;
            }
        }
    }

    fn solve_density(&mut self) {
        let n = self.n;
        let h = self.h;
        let inv_rho0 = 1.0 / self.rho0;
        let self_w = self.w_poly6(0.0);
        let scorr_inv = 1.0 / self.scorr_w;
        // lambda_i. Positions don't change between this pass and the delta-p
        // pass, so per-pair gradient and s_corr are cached (saves a sqrt and
        // two kernel evaluations per pair in the second pass).
        for i in 0..n {
            let xi = self.pos[i];
            let yi = self.pos[n + i];
            let mut rho = self_w;
            let mut gix = 0.0;
            let mut giy = 0.0;
            let mut sum2 = 0.0;
            let base = i * MAX_NBR;
            for k in 0..self.nbr_n[i] as usize {
                let j = self.nbr[base + k] as usize;
                let dx = xi - self.pos[j];
                let dy = yi - self.pos[n + j];
                let r2 = dx * dx + dy * dy;
                if r2 >= h * h || r2 < 1e-10 {
                    self.pair_gx[base + k] = 0.0;
                    self.pair_gy[base + k] = 0.0;
                    self.pair_sc[base + k] = 0.0;
                    if r2 < 1e-10 {
                        rho += self_w;
                    }
                    continue;
                }
                let w = self.w_poly6(r2);
                rho += w;
                let r = r2.sqrt();
                let g = self.spiky_grad * (h - r) * (h - r) / r;
                let (gx, gy) = (g * dx, g * dy);
                self.pair_gx[base + k] = gx;
                self.pair_gy[base + k] = gy;
                let wr = w * scorr_inv;
                let wr2 = wr * wr;
                self.pair_sc[base + k] = -0.1 * wr2 * wr2;
                let (gx, gy) = (gx * inv_rho0, gy * inv_rho0);
                gix += gx;
                giy += gy;
                sum2 += gx * gx + gy * gy;
            }
            sum2 += gix * gix + giy * giy;
            // Bilateral constraint: the negative branch is what gives the
            // liquid its cohesive "beading" (with s_corr preventing clumping).
            let c = rho * inv_rho0 - 1.0;
            let c = c.max(-0.35);
            self.lambda[i] = -c / (sum2 + self.eps);
        }
        // delta p
        for i in 0..n {
            let li = self.lambda[i];
            let hi = self.home[i];
            let mut ax = 0.0;
            let mut ay = 0.0;
            let base = i * MAX_NBR;
            for k in 0..self.nbr_n[i] as usize {
                let j = self.nbr[base + k] as usize;
                let mut lsum = li + self.lambda[j];
                // Liquids from different elements only push each other
                // (no negative-pressure glue), otherwise stray mixed clumps
                // form bridges that the home anchors can never tear apart.
                if self.home[j] != hi && lsum > 0.0 {
                    lsum = 0.0;
                }
                let s = lsum + self.pair_sc[base + k];
                ax += s * self.pair_gx[base + k];
                ay += s * self.pair_gy[base + k];
            }
            self.dp[i] = ax * inv_rho0;
            self.dp[n + i] = ay * inv_rho0;
        }
        // Clamp correction length for robustness under violent splashes.
        let maxd = self.spacing * 0.5;
        for i in 0..n {
            let mut dx = self.dp[i];
            let mut dy = self.dp[n + i];
            let l2 = dx * dx + dy * dy;
            if l2 > maxd * maxd {
                let s = maxd / l2.sqrt();
                dx *= s;
                dy *= s;
            }
            self.pos[i] += dx;
            self.pos[n + i] += dy;
        }
    }

    /// Shape matching toward the best-fit rigid transform of the rest shape,
    /// plus a weaker anchor toward the (possibly dragged) home pose. Both are
    /// scaled down by the element's impulse damage.
    fn solve_shape(&mut self, iters: u32) {
        let n = self.n;
        let t = self.time;
        for e in &self.elems {
            if e.count == 0 {
                continue;
            }
            let bind = (-3.0 * e.damage).exp().max(0.015);
            // Convert per-substep stiffness to per-iteration.
            let ks = 1.0 - (1.0 - (self.k_shape * bind).min(0.95)).powf(1.0 / iters as f32);
            let ka = 1.0 - (1.0 - (self.k_home * bind).min(0.95)).powf(1.0 / iters as f32);
            let (s, c) = (e.start, e.count);
            // centroid
            let mut mx = 0.0f32;
            let mut my = 0.0f32;
            for i in s..s + c {
                mx += self.pos[i];
                my += self.pos[n + i];
            }
            mx /= c as f32;
            my /= c as f32;
            // optimal rotation (2D polar decomposition of A_pq)
            let mut a_dot = 0.0f32;
            let mut a_crs = 0.0f32;
            for i in s..s + c {
                let px = self.pos[i] - mx;
                let py = self.pos[n + i] - my;
                let qx = self.rest[i];
                let qy = self.rest[n + i];
                a_dot += px * qx + py * qy;
                a_crs += py * qx - px * qy;
            }
            let th = a_crs.atan2(a_dot);
            let (sn, cs) = th.sin_cos();
            let hx = e.cx() + e.off_x;
            let hy = e.cy() + e.off_y;
            let wa = self.wobble;
            let (st, ct) = (2.3 * t).sin_cos();
            for i in s..s + c {
                let qx = self.rest[i];
                let qy = self.rest[n + i];
                // idle "breathing" wobble along the radial direction
                // sin(wt + ph) = sin(wt)cos(ph) + cos(wt)sin(ph)
                let wv = wa * (st * self.wph[i] + ct * self.wph[n + i]);
                let qwx = qx + self.wob[i] * wv;
                let qwy = qy + self.wob[n + i] * wv;
                let gx = mx + cs * qwx - sn * qwy;
                let gy = my + sn * qwx + cs * qwy;
                let ax = hx + qwx;
                let ay = hy + qwy;
                let x = self.pos[i];
                let y = self.pos[n + i];
                self.pos[i] = x + ks * (gx - x) + ka * (ax - x);
                self.pos[n + i] = y + ks * (gy - y) + ka * (ay - y);
            }
        }
    }

    fn post_velocity(&mut self, dt: f32) {
        let n = self.n;
        let h = self.h;
        // Akinci-style cohesion kernel (normalised so its peak is 1) gives
        // surface tension; XSPH smooths the velocity field.
        let h6_64 = h.powi(6) / 64.0;
        // Resolution independent: same acceleration scale at n=2000 and 10000.
        let coh = self.cohesion * 2900.0;
        let xs = self.xsph;
        let w0 = self.w_poly6(0.0);
        for i in 0..n {
            let xi = self.pos[i];
            let yi = self.pos[n + i];
            let vxi = self.vel[i];
            let vyi = self.vel[n + i];
            let mut ax = 0.0;
            let mut ay = 0.0;
            let mut sx = 0.0;
            let mut sy = 0.0;
            let base = i * MAX_NBR;
            for k in 0..self.nbr_n[i] as usize {
                let j = self.nbr[base + k] as usize;
                let dx = self.pos[j] - xi;
                let dy = self.pos[n + j] - yi;
                let r2 = dx * dx + dy * dy;
                if r2 >= h * h || r2 < 1e-8 {
                    continue;
                }
                let r = r2.sqrt();
                let hr = h - r;
                let cterm = hr * hr * hr * r * r * r / h6_64;
                let ck = if 2.0 * r > h {
                    cterm
                } else {
                    2.0 * cterm - 1.0
                };
                let cross = if self.home[j] != self.home[i] {
                    self.cross_cohesion
                } else {
                    1.0
                };
                let f = coh * cross * ck / r;
                ax += f * dx;
                ay += f * dy;
                let w = self.w_poly6(r2) / w0;
                sx += (self.vel[j] - vxi) * w;
                sy += (self.vel[n + j] - vyi) * w;
            }
            self.dp[i] = vxi + xs * sx + ax * dt;
            self.dp[n + i] = vyi + xs * sy + ay * dt;
        }
        let vmax = 2500.0f32;
        for i in 0..n {
            let mut vx = self.dp[i];
            let mut vy = self.dp[n + i];
            let l2 = vx * vx + vy * vy;
            if l2 > vmax * vmax {
                let s = vmax / l2.sqrt();
                vx *= s;
                vy *= s;
            }
            self.vel[i] = vx;
            self.vel[n + i] = vy;
        }
    }

    // ------------------------------------------------------------------
    // Shared buffer accessors (TS builds Float32Array views on these).
    // ------------------------------------------------------------------

    pub fn count(&self) -> u32 {
        self.n as u32
    }
    pub fn spacing(&self) -> f32 {
        self.spacing
    }
    /// SoA positions: x[0..n] then y[0..n].
    pub fn pos_ptr(&self) -> *const f32 {
        self.pos.as_ptr()
    }
    pub fn vel_ptr(&self) -> *const f32 {
        self.vel.as_ptr()
    }
    pub fn home_ptr(&self) -> *const u32 {
        self.home.as_ptr()
    }
    pub fn element_count(&self) -> u32 {
        self.elems.len() as u32
    }
    pub fn damage(&self, e: u32) -> f32 {
        self.elems.get(e as usize).map(|e| e.damage).unwrap_or(0.0)
    }
}
