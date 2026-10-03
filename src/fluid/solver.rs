//! W64 at-rest substep (decision D64-13): the home spring plus the MLS-MPM /
//! APIC transfer, with no stress, J update, CFL cap, drag, slip or wobble yet
//! (all W67). Also the reduced-motion pin and the per-element `maxDev`.

use super::access::{rd, rd_or, rd4, wr, wr4};
use super::elements::Elements;
use super::grid::Grid;
use super::particles::Particles;

/// Home spring at full stiffness (1/s²), spike value.
pub const SPRING_K: f32 = 220.0;
/// Damping ratio, constant as stiffness varies (spec §2).
pub const SPRING_ZETA: f32 = 0.8;

pub struct StepInput {
    pub dt: f32,
    pub time_s: f32,
}

/// Pre-allocated per-tick scratch (B7).
pub struct Scratch {
    /// Home targets in grid units; NaN = no target.
    pub tgt_x: Vec<f32>,
    pub tgt_y: Vec<f32>,
    /// Per-element max |x − target| in px.
    pub max_dev: Vec<f32>,
}

impl Scratch {
    pub fn new(particles: usize, elements: usize) -> Scratch {
        Scratch {
            tgt_x: vec![f32::NAN; particles],
            tgt_y: vec![f32::NAN; particles],
            max_dev: vec![0.0; elements],
        }
    }
}

/// Targets for the current rects, once per tick before the fixed steps.
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
            Some((x, y)) => g.to_grid(x, y),
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

/// One MPM substep over particles with a home: spring → P2G → grid → G2P.
pub fn substep(p: &mut Particles, g: &mut Grid, e: &Elements, inp: &StepInput, s: &Scratch) {
    let Some((x0, y0, x1, y1)) = particle_bounds(p, g) else {
        return;
    };
    g.set_region(x0, y0, x1, y1);
    g.clear_region();
    let dt = inp.dt;
    for i in 0..p.cap {
        let Some(h) = p.home_of(i) else {
            continue;
        };
        let m = rd(&p.mass, i);
        if m <= 0.0 {
            continue;
        }
        let (x, y) = (rd(&p.x, i), rd(&p.y, i));
        let (mut vx, mut vy) = (rd(&p.vx, i), rd(&p.vy, i));
        let (tx, ty) = (rd_or(&s.tgt_x, i, f32::NAN), rd_or(&s.tgt_y, i, f32::NAN));
        let has_target = tx.is_finite() && ty.is_finite();
        if has_target {
            let k = SPRING_K * rd_or(&e.stiffness, h, 1.0);
            let damp = 2.0 * SPRING_ZETA * k.sqrt();
            vx += (k * (tx - x) - damp * vx) * dt;
            vy += (k * (ty - y) - damp * vy) * dt;
        }
        wr(&mut p.vx, i, vx);
        wr(&mut p.vy, i, vy);
        let [c00, c01, c10, c11] = rd4(&p.c, i, [0.0; 4]);
        let st = g.stencil(x, y);
        g.p2g(&st, m, m * vx, m * vy, [m * c00, m * c01, m * c10, m * c11]);
    }
    g.update_velocities(dt, 0.0);
    for i in 0..p.cap {
        if p.home_of(i).is_none() || rd(&p.mass, i) <= 0.0 {
            continue;
        }
        let (x, y) = (rd(&p.x, i), rd(&p.y, i));
        let st = g.stencil(x, y);
        let (vx, vy, c) = g.g2p(&st);
        wr(&mut p.vx, i, vx);
        wr(&mut p.vy, i, vy);
        wr4(&mut p.c, i, c);
        let (nx, ny) = g.clamp_pos(x + dt * vx, y + dt * vy);
        wr(&mut p.x, i, nx);
        wr(&mut p.y, i, ny);
    }
}

/// Reduced motion (spec §2): every particle sits at its target, at rest.
pub fn pin_to_targets(p: &mut Particles, g: &Grid, s: &Scratch) {
    for i in 0..p.cap {
        let (tx, ty) = (rd_or(&s.tgt_x, i, f32::NAN), rd_or(&s.tgt_y, i, f32::NAN));
        let has_target = tx.is_finite() && ty.is_finite();
        if !has_target {
            continue;
        }
        let (x, y) = g.clamp_pos(tx, ty);
        wr(&mut p.x, i, x);
        wr(&mut p.y, i, y);
        wr(&mut p.vx, i, 0.0);
        wr(&mut p.vy, i, 0.0);
        wr4(&mut p.c, i, [0.0; 4]);
    }
}

/// Per element: max |x − target| in px over its particles, O(n).
pub fn measure_max_dev(p: &Particles, g: &Grid, tgt_x: &[f32], tgt_y: &[f32], out: &mut [f32]) {
    out.fill(0.0);
    for i in 0..p.cap {
        let Some(h) = p.home_of(i) else {
            continue;
        };
        let (tx, ty) = (rd_or(tgt_x, i, f32::NAN), rd_or(tgt_y, i, f32::NAN));
        let has_target = tx.is_finite() && ty.is_finite();
        if !has_target {
            continue;
        }
        let dx = rd(&p.x, i) - tx;
        let dy = rd(&p.y, i) - ty;
        let d = (dx * dx + dy * dy).sqrt() * g.cell_px;
        if let Some(m) = out.get_mut(h)
            && d > *m
        {
            *m = d;
        }
    }
}
