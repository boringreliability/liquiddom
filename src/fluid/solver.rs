//! One MLS-MPM substep (spec §2 "Physics", Hu et al. 2018), the reduced-motion pin
//! and the per-element `maxDev`. W64 shipped the at-rest subset (D64-13). W67 adds
//! stress, viscosity, the J update, CFL caps, air drag, the relative and saturated
//! home spring, slip drift and wobble. Re-implemented under test, with the spike as
//! a reference only (D2).
//!
//! Units: positions in grid cells (dx = 1), velocities in cells/s. Every tuning
//! constant is in CSS px and is converted with `g.inv_cell`, so the feel does not
//! depend on the cell size.
//!
//! Per substep:
//! 1. dirty region = particle AABB + 2 cells (B6), cleared;
//! 2. per particle: air drag, damped saturated home spring relative to the element's
//!    velocity (target = rest_uv in the home rect + wobble·(1 − restAlpha)), then P2G
//!    of mass, APIC momentum and stress σ = E(J−1)·I + μ(C + Cᵀ);
//! 3. grid: momentum → velocity, walls, CFL cap (grid.rs);
//! 4. G2P: velocity + C, CFL cap, slip drift (non-physical, ∝ s²), advect,
//!    J ← clamp(J·(1 + dt·tr C), COMPRESS_MIN, 1 + TENSION_MAX), then relax to 1,
//!    and maxDev against the target actually used (D67-10).

use super::access::{rd, rd_or, rd4, wr, wr4};
use super::elements::Elements;
use super::grid::{Grid, cap_speed};
use super::layout::{ST_REST_ALPHA, STATE_STRIDE};
use super::material::{MaterialParams, map_viscosity};
use super::particles::Particles;

/// Home spring at full stiffness (1/s²), spike value.
pub const SPRING_K: f32 = 220.0;
/// Damping ratio, constant as stiffness varies (spec §2).
pub const SPRING_ZETA: f32 = 0.8;
/// Home spring acceleration saturation (px/s²) × (0.25 + 0.75·s): far droplets crawl back.
pub const SPRING_AMAX_PX_S2: f32 = 3200.0;
/// Speed of sound in px/s; sets the bulk modulus E = c² (D67-7).
pub const SOUND_SPEED_PX_S: f32 = 380.0;
/// J is clamped from below (spec §2).
pub const COMPRESS_MIN: f32 = 0.55;
/// J relaxes towards 1 at this rate (1/s), so drift never becomes permanent pressure.
pub const J_RELAX_PER_S: f32 = 1.5;
/// Air drag (1/s).
pub const AIR_DRAG_PER_S: f32 = 0.8;
/// CFL cap for particles and grid (spec §2).
pub const MAX_CELLS_PER_SUBSTEP: f32 = 0.45;
/// Wobble amplitude at restAlpha 0 (px); × (1 − restAlpha).
pub const WOBBLE_PX: f32 = 1.1;
/// Slip drift rate at s = 1 (1/s), scaled by s². Non-physical (no momentum conservation).
pub const SLIP_RATE_PER_S: f32 = 3.0;
/// Slip drift cap (px/s).
pub const SLIP_MAX_PX_S: f32 = 160.0;

/// Pointer input for one substep. W68's soft pointer field reads it; W67 passes the default.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PointerField {
    pub active: bool,
    pub x_px: f32,
    pub y_px: f32,
    pub vx_px: f32,
    pub vy_px: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct StepInput {
    pub dt: f32,
    pub time_s: f32,
    pub pointer: PointerField,
}

/// Pre-allocated scratch (B7). Nothing here allocates after `new`.
pub struct Scratch {
    /// Per particle: target in grid units (NaN = none). `compute_targets` writes the
    /// un-wobbled target; `substep` overwrites it with the target it used.
    pub tgt_x: Vec<f32>,
    pub tgt_y: Vec<f32>,
    /// Per element: max |x − target| in px.
    pub max_dev: Vec<f32>,
    /// W67, per element: kinematic viscosity in cells²/s for this substep.
    pub el_mu: Vec<f32>,
}

impl Scratch {
    pub fn new(particles: usize, elements: usize) -> Scratch {
        Scratch {
            tgt_x: vec![f32::NAN; particles],
            tgt_y: vec![f32::NAN; particles],
            max_dev: vec![0.0; elements],
            el_mu: vec![0.0; elements],
        }
    }
}

/// Un-wobbled targets for the current rects, clamped like W64's (used by reduced motion
/// and redistribute).
pub fn compute_targets(
    p: &Particles,
    g: &Grid,
    e: &Elements,
    reduced_motion: bool,
    s: &mut Scratch,
) {
    for i in 0..p.cap {
        let target = p
            .home_of(i)
            .and_then(|h| e.target_px(h, rd(&p.rest_u, i), rd(&p.rest_v, i), reduced_motion));
        let (tx, ty) = match target {
            Some((x, y)) => {
                let (gx, gy) = g.to_grid(x, y);
                g.clamp_pos(gx, gy)
            }
            None => (f32::NAN, f32::NAN),
        };
        wr(&mut s.tgt_x, i, tx);
        wr(&mut s.tgt_y, i, ty);
    }
}

fn particle_bounds(p: &Particles, g: &Grid) -> Option<(f32, f32, f32, f32)> {
    let mut bounds: Option<(f32, f32, f32, f32)> = None;
    for i in 0..p.cap {
        if p.home_of(i).is_none() {
            continue;
        }
        let (x, y) = g.clamp_pos(rd(&p.x, i), rd(&p.y, i));
        bounds = Some(match bounds {
            None => (x, y, x, y),
            Some((x0, y0, x1, y1)) => (x0.min(x), y0.min(y), x1.max(x), y1.max(y)),
        });
    }
    bounds
}

/// One substep of J: integrate with tr C, clamp (COMPRESS_MIN / plastic yield at
/// 1 + tension_max), relax towards 1. Non-finite → 1.
pub fn update_j(j: f32, trace_c: f32, dt: f32, tension_max: f32) -> f32 {
    let next = j * (1.0 + dt * trace_c);
    let next = if next.is_finite() { next } else { 1.0 };
    let next = next.clamp(COMPRESS_MIN, 1.0 + tension_max.max(0.0));
    next + (1.0 - next) * (J_RELAX_PER_S * dt).min(1.0)
}

/// Velocity factor for one substep of air drag.
pub fn drag_factor(dt: f32) -> f32 {
    (-AIR_DRAG_PER_S * dt).exp()
}

/// Damped, saturated home spring (grid units). Damping acts on the velocity relative
/// to the element's own velocity, so a co-moving particle on its target feels nothing.
pub fn home_spring_accel(
    pos: (f32, f32),
    vel: (f32, f32),
    target: (f32, f32),
    home_vel: (f32, f32),
    s: f32,
    inv_cell: f32,
) -> (f32, f32) {
    let s = if s.is_finite() {
        s.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let k = SPRING_K * s;
    let damping = 2.0 * SPRING_ZETA * k.sqrt();
    let mut ax = k * (target.0 - pos.0) + damping * (home_vel.0 - vel.0);
    let mut ay = k * (target.1 - pos.1) + damping * (home_vel.1 - vel.1);
    let a_max = SPRING_AMAX_PX_S2 * inv_cell * (0.25 + 0.75 * s);
    let a = ax.hypot(ay);
    if a > a_max {
        let scale = a_max / a;
        ax *= scale;
        ay *= scale;
    }
    if ax.is_finite() && ay.is_finite() {
        (ax, ay)
    } else {
        (0.0, 0.0)
    }
}

/// Grid-independent drift towards the target: offset × 3/s × s², capped at `max`.
pub fn slip_velocity(offset: (f32, f32), s: f32, max: f32) -> (f32, f32) {
    let rate = SLIP_RATE_PER_S * s * s;
    let (sx, sy) = (offset.0 * rate, offset.1 * rate);
    let m = sx.hypot(sy);
    if m > max {
        (sx * max / m, sy * max / m)
    } else {
        (sx, sy)
    }
}

/// Subtle wobble of the target (px) at local rest position (lx, ly), × (1 − restAlpha).
/// wy depends only on lx and wx only on ly, so the field is divergence-free (no pressure).
pub fn wobble_offset_px(time_s: f32, lx: f32, ly: f32, phase: f32, rest_alpha: f32) -> (f32, f32) {
    let alpha = if rest_alpha.is_finite() {
        rest_alpha.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let amp = WOBBLE_PX * (1.0 - alpha);
    if amp <= 0.0 {
        return (0.0, 0.0);
    }
    let wy = amp * (2.1 * time_s + 0.045 * lx + phase).sin();
    let wx = 0.6 * amp * (1.7 * time_s + 0.07 * ly + 1.3 * phase).cos();
    (wx, wy)
}

/// Kinematic viscosity of an element in px²/s: its slot-8 override (normalised) or the material's.
pub fn element_viscosity_px2_s(e: &Elements, id: usize, m: &MaterialParams) -> f32 {
    e.viscosity_override(id)
        .map(map_viscosity)
        .unwrap_or(m.viscosity_px2_s)
}

/// The target the spring uses this substep, in grid units (D67-10). Never under
/// reduced motion: `substep` only runs with motion on, so hover swell applies.
fn wobbled_target(
    e: &Elements,
    g: &Grid,
    id: usize,
    u: f32,
    v: f32,
    time_s: f32,
) -> Option<(f32, f32)> {
    let rect = e.home_rect(id, false)?;
    let (tx, ty) = (rect.x + u * rect.w, rect.y + v * rect.h);
    let alpha = rd_or(&e.state, id * STATE_STRIDE + ST_REST_ALPHA, 0.0);
    let phase = rd(&e.phase, id);
    let (wx, wy) = wobble_offset_px(time_s, u * rect.w, v * rect.h, phase, alpha);
    let (gx, gy) = g.to_grid(tx + wx, ty + wy);
    // Clamped like W64's targets: a huge home offset cannot overflow the spring.
    if gx.is_finite() && gy.is_finite() {
        Some(g.clamp_pos(gx, gy))
    } else {
        None
    }
}

/// One MLS-MPM substep over particles with a home. A particle whose home slot is
/// inactive (freed, awaiting redistribute) moves as free liquid with the material viscosity.
pub fn substep(
    p: &mut Particles,
    g: &mut Grid,
    e: &Elements,
    m: &MaterialParams,
    inp: &StepInput,
    s: &mut Scratch,
) {
    let dt = inp.dt;
    if !(dt.is_finite() && dt > 0.0) {
        return;
    }
    let Some((x0, y0, x1, y1)) = particle_bounds(p, g) else {
        return;
    };
    g.set_region(x0, y0, x1, y1);
    g.clear_region();

    let inv = g.inv_cell;
    let inv2 = inv * inv;
    let free_mu = m.viscosity_px2_s * inv2;
    for (id, mu) in s.el_mu.iter_mut().enumerate() {
        *mu = element_viscosity_px2_s(e, id, m) * inv2;
    }
    s.max_dev.fill(0.0);
    let sound = SOUND_SPEED_PX_S * inv;
    let bulk = sound * sound;
    let drag = drag_factor(dt);

    // ---- forces + P2G ----
    for i in 0..p.cap {
        let Some(h) = p.home_of(i) else {
            continue;
        };
        let mass = rd(&p.mass, i);
        if mass <= 0.0 {
            continue;
        }
        // Clamped like W64, so every stencil stays inside the grid.
        let (x, y) = g.clamp_pos(rd(&p.x, i), rd(&p.y, i));
        let mut vx = rd(&p.vx, i) * drag;
        let mut vy = rd(&p.vy, i) * drag;
        let target = if e.is_active(h) {
            wobbled_target(e, g, h, rd(&p.rest_u, i), rd(&p.rest_v, i), inp.time_s)
        } else {
            None
        };
        let (tx, ty) = match target {
            Some((tx, ty)) => {
                let stiff = rd_or(&e.stiffness, h, 1.0);
                let home_v = (rd(&e.vel_x, h) * inv, rd(&e.vel_y, h) * inv);
                let (ax, ay) = home_spring_accel((x, y), (vx, vy), (tx, ty), home_v, stiff, inv);
                vx += ax * dt;
                vy += ay * dt;
                (tx, ty)
            }
            None => (f32::NAN, f32::NAN),
        };
        wr(&mut s.tgt_x, i, tx);
        wr(&mut s.tgt_y, i, ty);
        wr(&mut p.vx, i, vx);
        wr(&mut p.vy, i, vy);

        let [c00, c01, c10, c11] = rd4(&p.c, i, [0.0; 4]);
        let j = rd_or(&p.j, i, 1.0);
        let mu = if target.is_some() {
            rd_or(&s.el_mu, h, free_mu)
        } else {
            free_mu
        };
        let pressure = bulk * (j - 1.0);
        let s00 = pressure + 2.0 * mu * c00;
        let s01 = mu * (c01 + c10);
        let s11 = pressure + 2.0 * mu * c11;
        // MLS-MPM affine term: −dt·4·V·σ + m·C, with V = m (rest density 1, B4).
        let k = -dt * 4.0 * mass;
        let affine = [
            k * s00 + mass * c00,
            k * s01 + mass * c01,
            k * s01 + mass * c10,
            k * s11 + mass * c11,
        ];
        let st = g.stencil(x, y);
        g.p2g(&st, mass, mass * vx, mass * vy, affine);
    }

    // ---- grid: momentum → velocity, walls, CFL cap ----
    let vmax = MAX_CELLS_PER_SUBSTEP / dt;
    g.update_velocities(dt, vmax);

    // ---- G2P ----
    let slip_max = SLIP_MAX_PX_S * inv;
    for i in 0..p.cap {
        let Some(h) = p.home_of(i) else {
            continue;
        };
        if rd(&p.mass, i) <= 0.0 {
            continue;
        }
        let (x, y) = g.clamp_pos(rd(&p.x, i), rd(&p.y, i));
        let st = g.stencil(x, y);
        let (gvx, gvy, c) = g.g2p(&st);
        let (vx, vy) = cap_speed(gvx, gvy, vmax);
        let (tx, ty) = (rd_or(&s.tgt_x, i, f32::NAN), rd_or(&s.tgt_y, i, f32::NAN));
        let has_target = tx.is_finite() && ty.is_finite();
        let (sx, sy) = if has_target {
            slip_velocity((tx - x, ty - y), rd_or(&e.stiffness, h, 1.0), slip_max)
        } else {
            (0.0, 0.0)
        };
        let (nx, ny) = g.clamp_pos(x + dt * (vx + sx), y + dt * (vy + sy));
        let [c00, _, _, c11] = c;
        let nj = update_j(rd_or(&p.j, i, 1.0), c00 + c11, dt, m.tension_max);
        wr(&mut p.x, i, nx);
        wr(&mut p.y, i, ny);
        wr(&mut p.vx, i, vx);
        wr(&mut p.vy, i, vy);
        wr4(&mut p.c, i, c);
        wr(&mut p.j, i, nj);
        if has_target {
            let d = (nx - tx).hypot(ny - ty) * g.cell_px;
            if let Some(md) = s.max_dev.get_mut(h)
                && d > *md
            {
                *md = d;
            }
        }
    }
}

/// Reduced motion (spec §2): every particle sits at its (un-wobbled) target from
/// `compute_targets`, with its kinematics reset (v = 0, C = 0, J = 1, F = I; W67 also
/// resets J and F, which W64 left alone).
pub fn pin_to_targets(p: &mut Particles, g: &Grid, s: &Scratch) {
    for i in 0..p.cap {
        let (tx, ty) = (rd_or(&s.tgt_x, i, f32::NAN), rd_or(&s.tgt_y, i, f32::NAN));
        if !(tx.is_finite() && ty.is_finite()) {
            continue;
        }
        let (x, y) = g.clamp_pos(tx, ty);
        wr(&mut p.x, i, x);
        wr(&mut p.y, i, y);
        p.reset_kinematics(i);
    }
}

/// Per element: max |x − target| in px over its particles, O(n) (W64; used by reduced
/// motion and redistribute against the un-wobbled targets of `compute_targets`).
pub fn measure_max_dev(p: &Particles, g: &Grid, tgt_x: &[f32], tgt_y: &[f32], out: &mut [f32]) {
    out.fill(0.0);
    for i in 0..p.cap {
        let Some(h) = p.home_of(i) else {
            continue;
        };
        let (tx, ty) = (rd_or(tgt_x, i, f32::NAN), rd_or(tgt_y, i, f32::NAN));
        if !(tx.is_finite() && ty.is_finite()) {
            continue;
        }
        let d = (rd(&p.x, i) - tx).hypot(rd(&p.y, i) - ty) * g.cell_px;
        if let Some(m) = out.get_mut(h)
            && d > *m
        {
            *m = d;
        }
    }
}

#[cfg(test)]
mod w67_tests {
    use super::*;
    use std::f32::consts::TAU;

    use crate::fluid::elements::{REST_MAX_DEV_PX, S_FLOOR};
    use crate::fluid::layout::{EL_VISCOSITY, ST_REST_ALPHA};
    use crate::fluid::material::DEFAULT_MATERIAL;

    const CELL: f32 = 6.0;
    const DT: f32 = 1.0 / 480.0;

    /// One element at `rect` (x, y, w, h px) with an n×n particle lattice placed exactly
    /// on its targets. Each particle starts at velocity `vel(px, py)` px/s. The element is
    /// settled (restAlpha 1, no wobble) and has stiffness `stiffness`.
    struct Rig {
        p: Particles,
        g: Grid,
        e: Elements,
        s: Scratch,
        m: MaterialParams,
    }

    impl Rig {
        fn block(
            rect: [f32; 4],
            n: usize,
            stiffness: f32,
            vel: impl Fn(f32, f32) -> (f32, f32),
        ) -> Rig {
            let [x0, y0, w, h] = rect;
            let g = Grid::new(400.0, 400.0, CELL, 200.0);
            let mut e = Elements::new(1);
            e.buf[..10].copy_from_slice(&[x0, y0, w, h, 0.0, 0.0, 0.0, 0.0, f32::NAN, f32::NAN]);
            e.stiffness[0] = stiffness;
            e.state[ST_REST_ALPHA] = 1.0;
            e.rest_w[0] = w;
            e.rest_h[0] = h;
            e.counts[0] = (n * n) as u32;
            e.area_per_particle[0] = w * h / (n * n) as f32;
            let mut p = Particles::new(n * n);
            let mass = e.area_per_particle[0] / (CELL * CELL);
            for k in 0..n * n {
                let u = ((k % n) as f32 + 0.5) / n as f32;
                let v = ((k / n) as f32 + 0.5) / n as f32;
                let (px, py) = (x0 + u * w, y0 + v * h);
                let (gx, gy) = g.to_grid(px, py);
                let (vx, vy) = vel(px, py);
                p.x[k] = gx;
                p.y[k] = gy;
                p.vx[k] = vx / CELL;
                p.vy[k] = vy / CELL;
                p.j[k] = 1.0;
                p.c[k] = [0.0; 4];
                p.home[k] = 0;
                p.rank[k] = k as u32;
                p.rest_u[k] = u;
                p.rest_v[k] = v;
                p.placed[k] = true;
                p.mass[k] = mass;
            }
            Rig {
                p,
                g,
                e,
                s: Scratch::new(n * n, 1),
                m: DEFAULT_MATERIAL.params(),
            }
        }

        fn step(&mut self, substeps: usize) {
            for k in 0..substeps {
                let inp = StepInput {
                    dt: DT,
                    time_s: k as f32 * DT,
                    pointer: PointerField::default(),
                };
                substep(
                    &mut self.p,
                    &mut self.g,
                    &self.e,
                    &self.m,
                    &inp,
                    &mut self.s,
                );
            }
        }
    }

    #[test]
    fn given_compressed_particles_when_substep_then_j_clamped_at_0_55_and_relaxes_towards_1() {
        let relax = (J_RELAX_PER_S * DT).min(1.0);
        let j = update_j(1.0, -2000.0, DT, 0.16);
        assert!(
            (j - (COMPRESS_MIN + (1.0 - COMPRESS_MIN) * relax)).abs() < 1e-6,
            "clamp, then relax: {j}"
        );
        let mut j = 0.6;
        for _ in 0..960 {
            j = update_j(j, 0.0, DT, 0.16);
        }
        assert!(
            j > 0.97 && j <= 1.0,
            "2 s of relaxation brings J back towards 1: {j}"
        );

        let mut rig = Rig::block([170.0, 170.0, 60.0, 60.0], 20, S_FLOOR, |x, y| {
            (-600.0 * (x - 200.0), -600.0 * (y - 200.0))
        });
        rig.step(2);
        let min_j = rig.p.j.iter().copied().fold(f32::INFINITY, f32::min);
        assert!(
            min_j >= COMPRESS_MIN - 1e-6,
            "never below COMPRESS_MIN: {min_j}"
        );
        assert!(min_j < 0.9, "the converging block was compressed: {min_j}");
    }

    #[test]
    fn given_stretch_beyond_tension_max_when_substep_then_j_yields_at_1_plus_tension_max() {
        let relax = (J_RELAX_PER_S * DT).min(1.0);
        let j = update_j(1.0, 2000.0, DT, 0.16);
        assert!(
            (j - (1.16 + (1.0 - 1.16) * relax)).abs() < 1e-6,
            "yield at 1 + tension_max: {j}"
        );
        assert!(j <= 1.16);
        assert!(update_j(1.0, 2000.0, DT, 0.02) <= 1.02);
        assert!(
            (update_j(f32::NAN, 1.0, DT, 0.16) - 1.0).abs() < 1e-6,
            "non-finite J resets to 1"
        );
    }

    #[test]
    fn given_high_velocity_when_substep_then_particle_and_grid_speed_capped_at_0_45_cells_per_substep()
     {
        let mut rig = Rig::block([190.0, 190.0, 6.0, 6.0], 2, S_FLOOR, |_, _| (20_000.0, 0.0));
        rig.step(1);
        let vmax = MAX_CELLS_PER_SUBSTEP / DT;
        for (&vx, &vy) in rig.p.vx.iter().zip(rig.p.vy.iter()) {
            assert!(
                vx.hypot(vy) <= vmax * (1.0 + 1e-5),
                "particle speed {} > {vmax}",
                vx.hypot(vy)
            );
        }
        let grid_max = rig
            .g
            .mvx
            .iter()
            .zip(rig.g.mvy.iter())
            .zip(rig.g.mass.iter())
            .filter(|&(_, &m)| m > 0.0)
            .map(|((&vx, &vy), _)| vx.hypot(vy))
            .fold(0.0f32, f32::max);
        assert!(
            grid_max <= vmax * (1.0 + 1e-5),
            "grid speed {grid_max} > {vmax}"
        );
        assert!(
            grid_max > 0.5 * vmax,
            "the cap was actually exercised: {grid_max}"
        );
    }

    #[test]
    fn given_free_moving_particle_when_ticking_then_air_drag_decays_velocity() {
        let f = drag_factor(DT);
        let mut v = 1.0f32;
        for _ in 0..480 {
            v *= f;
        }
        assert!(
            (v - (-AIR_DRAG_PER_S).exp()).abs() < 1e-3,
            "1 s of drag = exp(-0.8): {v}"
        );

        let mut rig = Rig::block([190.0, 190.0, 6.0, 6.0], 1, S_FLOOR, |_, _| (120.0, 0.0));
        rig.step(1);
        let vx = rig.p.vx[0] * CELL;
        assert!(
            vx < 120.0 * f + 1e-3,
            "decays at least by the drag factor: {vx}"
        );
        assert!(vx > 100.0, "a weak home spring barely brakes it: {vx}");
    }

    fn shear_rms_gradient(viscosity_px2_s: f32) -> f32 {
        let mut rig = Rig::block([170.0, 170.0, 60.0, 60.0], 20, S_FLOOR, |_, y| {
            (60.0 * (TAU * (y - 170.0) / 60.0).sin(), 0.0)
        });
        rig.m.viscosity_px2_s = viscosity_px2_s;
        rig.step(8);
        let sum: f32 = rig.p.c.iter().map(|&[_, c01, _, _]| c01 * c01).sum();
        (sum / rig.p.c.len() as f32).sqrt()
    }

    #[test]
    fn given_shear_flow_when_substep_then_viscous_stress_reduces_velocity_gradient() {
        let thin = shear_rms_gradient(100.0);
        let thick = shear_rms_gradient(2000.0);
        assert!(thin > 1.0, "the shear profile has a gradient: {thin}");
        assert!(
            thick < 0.9 * thin,
            "viscosity damps the gradient: thick {thick} vs thin {thin}"
        );
    }

    #[test]
    fn given_element_viscosity_slot_nan_when_ticking_then_material_default_used() {
        let m = MaterialParams {
            viscosity_px2_s: 450.0,
            tension_max: 0.16,
            recovery_s: 0.7,
        };
        let mut rig = Rig::block([100.0, 100.0, 40.0, 40.0], 1, 1.0, |_, _| (0.0, 0.0));
        assert!((element_viscosity_px2_s(&rig.e, 0, &m) - 450.0).abs() < 1e-3);
        rig.e.buf[EL_VISCOSITY] = 1.0;
        assert!((element_viscosity_px2_s(&rig.e, 0, &m) - 2000.0).abs() < 1e-2);
    }

    #[test]
    fn given_element_moving_at_v_and_particles_co_moving_on_target_when_spring_evaluated_then_damping_force_zero()
     {
        let inv = 1.0 / CELL;
        let (ax, ay) = home_spring_accel(
            (10.0, 12.0),
            (5.0, -3.0),
            (10.0, 12.0),
            (5.0, -3.0),
            1.0,
            inv,
        );
        assert!(
            ax.abs() < 1e-6 && ay.abs() < 1e-6,
            "co-moving on target: no force ({ax}, {ay})"
        );
        let (bx, by) = home_spring_accel(
            (10.0, 12.0),
            (6.0, -3.0),
            (10.0, 12.0),
            (5.0, -3.0),
            1.0,
            inv,
        );
        let expected = -2.0 * SPRING_ZETA * SPRING_K.sqrt();
        assert!(
            (bx - expected).abs() < 1e-3,
            "damping c = 2ζ√k on the relative velocity: {bx}"
        );
        assert!(by.abs() < 1e-6);
    }

    #[test]
    fn given_droplet_far_from_home_when_spring_evaluated_then_acceleration_saturates() {
        let inv = 1.0 / CELL;
        for s in [S_FLOOR, 0.25, 1.0] {
            let (ax, ay) =
                home_spring_accel((0.0, 0.0), (0.0, 0.0), (1000.0, 0.0), (0.0, 0.0), s, inv);
            let a_max = SPRING_AMAX_PX_S2 * inv * (0.25 + 0.75 * s);
            assert!(
                (ax.hypot(ay) - a_max).abs() < 1e-3 * a_max,
                "s={s}: |a|={} vs {a_max}",
                ax.hypot(ay)
            );
            assert!(ax > 0.0, "pulls towards home");
        }
    }

    #[test]
    fn given_s_1_and_offset_particle_when_ticking_then_slip_rate_3_per_s_capped_160px_per_s() {
        let inv = 1.0 / CELL;
        let max = SLIP_MAX_PX_S * inv;
        let (sx, sy) = slip_velocity((10.0 * inv, 0.0), 1.0, max);
        assert!(
            (sx * CELL - 30.0).abs() < 1e-3 && sy.abs() < 1e-7,
            "3/s × 10 px = 30 px/s: {}",
            sx * CELL
        );
        let (sx, _) = slip_velocity((100.0 * inv, 0.0), 1.0, max);
        assert!(
            (sx * CELL - 160.0).abs() < 1e-3,
            "capped at 160 px/s: {}",
            sx * CELL
        );
    }

    #[test]
    fn given_s_floor_when_ticking_then_slip_scaled_by_s_squared() {
        let inv = 1.0 / CELL;
        let (sx, _) = slip_velocity((10.0 * inv, 0.0), S_FLOOR, SLIP_MAX_PX_S * inv);
        let expected = 3.0 * S_FLOOR * S_FLOOR * 10.0;
        assert!(
            (sx * CELL - expected).abs() < 1e-6,
            "{} vs {expected}",
            sx * CELL
        );
    }

    #[test]
    fn given_rest_alpha_1_when_ticking_then_wobble_zero() {
        let (wx, wy) = wobble_offset_px(1.3, 40.0, 12.0, 0.7, 1.0);
        assert!(wx.abs() < f32::EPSILON && wy.abs() < f32::EPSILON);
        let mut peak = 0.0f32;
        for k in 0..200 {
            let (wx, wy) = wobble_offset_px(k as f32 * 0.05, 40.0, 12.0, 0.7, 0.0);
            assert!(wy.abs() <= WOBBLE_PX + 1e-6 && wx.abs() <= 0.6 * WOBBLE_PX + 1e-6);
            peak = peak.max(wx.hypot(wy));
            let (hx, hy) = wobble_offset_px(k as f32 * 0.05, 40.0, 12.0, 0.7, 0.5);
            assert!(hy.abs() <= 0.5 * WOBBLE_PX + 1e-6 && hx.abs() <= 0.3 * WOBBLE_PX + 1e-6);
        }
        assert!(peak > 0.5 * WOBBLE_PX, "wobble exists while liquid: {peak}");
    }

    #[test]
    fn given_particle_on_wobbled_target_when_max_dev_measured_then_below_rest_threshold() {
        // D67-10: maxDev is measured against the target the spring used (wobble included).
        let mut rig = Rig::block([170.0, 170.0, 60.0, 60.0], 20, 1.0, |_, _| (0.0, 0.0));
        rig.e.state[ST_REST_ALPHA] = 0.0; // liquid: the full 1.1 px wobble is active
        let inp = StepInput {
            dt: DT,
            time_s: 0.37,
            pointer: PointerField::default(),
        };
        substep(&mut rig.p, &mut rig.g, &rig.e, &rig.m, &inp, &mut rig.s);
        let used_x = rig.s.tgt_x.clone();
        let used_y = rig.s.tgt_y.clone();
        // Put every particle exactly on the target the spring used.
        rig.p.x.copy_from_slice(&used_x);
        rig.p.y.copy_from_slice(&used_y);
        let mut dev_used = vec![0.0; 1];
        measure_max_dev(&rig.p, &rig.g, &used_x, &used_y, &mut dev_used);
        assert!(
            dev_used[0] < REST_MAX_DEV_PX,
            "on the wobbled target: {}",
            dev_used[0]
        );

        // Against the un-wobbled target the same positions deviate by the wobble itself.
        let mut plain = Scratch::new(rig.p.cap, 1);
        compute_targets(&rig.p, &rig.g, &rig.e, false, &mut plain);
        let mut dev_plain = vec![0.0; 1];
        measure_max_dev(&rig.p, &rig.g, &plain.tgt_x, &plain.tgt_y, &mut dev_plain);
        assert!(
            dev_plain[0] > 0.5 && dev_plain[0] <= WOBBLE_PX * 1.2 + 1e-3,
            "the un-wobbled deviation is the wobble offset (~1.1 px): {}",
            dev_plain[0]
        );
    }

    #[test]
    fn given_d67_7_constants_when_read_then_spike_values_pinned() {
        assert_eq!(SPRING_K, 220.0);
        assert_eq!(SPRING_ZETA, 0.8);
        assert_eq!(SPRING_AMAX_PX_S2, 3200.0);
        assert_eq!(SOUND_SPEED_PX_S, 380.0);
        assert_eq!(COMPRESS_MIN, 0.55);
        assert_eq!(J_RELAX_PER_S, 1.5);
        assert_eq!(AIR_DRAG_PER_S, 0.8);
        assert_eq!(MAX_CELLS_PER_SUBSTEP, 0.45);
        assert_eq!(WOBBLE_PX, 1.1);
        assert_eq!(SLIP_RATE_PER_S, 3.0);
        assert_eq!(SLIP_MAX_PX_S, 160.0);
    }
}
