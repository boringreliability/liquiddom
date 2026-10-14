//! W81 (D81-1, slice-6 design §4; spec §2 "Walls and off-screen elements"): parking. An element
//! whose home rect lies entirely outside the world plus the grid margin (the walls) is parked:
//! its particles carry `FLAG_PARKED`, skip the transfers (P2G, grid, G2P), the particle AABB, the
//! scroll shift, splash and shake, and both renderers skip them; the element is held at rest. It is
//! unparked once its home rect lies `UNPARK_INSET_PX` inside the bound on every side, or as soon as
//! it overlaps the world (the viewport in body mode, the container's visible window in container
//! mode), whichever comes first: its particles are then placed at rest at once (`home + rest_uv`,
//! v = 0, C = 0, J = 1, F = I) and the element is at rest (s = 1, restAlpha 1) with no previous rect
//! sample, so the frame it re-enters shows it at rest and its next home velocity is 0. A dragged
//! or inactive element is never parked. The particle budget is unchanged: a parked element keeps
//! its particles, so re-entry needs no redistribute.
//!
//! Rust stays DOM-blind: the bound is the world `create()` (or `resize_world`) gave the grid plus
//! its margin, in buffer px. No FFI change besides the particle flag bit.

use super::access::{rd, wr};
use super::elements::{Elements, Rect};
use super::grid::Grid;
use super::layout::FLAG_PARKED;
use super::particles::Particles;

/// D81-1: a parked element comes back once its home rect is this many px inside the bound on
/// every side (or once it overlaps the world).
pub const UNPARK_INSET_PX: f32 = 64.0;

/// A box in buffer px, `[x0, x1] × [y0, y1]`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

/// The parking bound: the world plus the grid margin on every side (where the walls sit, up to
/// W80's half-cell lattice drift).
pub fn bound(g: &Grid) -> Bounds {
    Bounds {
        x0: -g.margin_px,
        y0: -g.margin_px,
        x1: g.world_w_px + g.margin_px,
        y1: g.world_h_px + g.margin_px,
    }
}

/// The world itself, `[0, w] × [0, h]` (the viewport, or the container's visible window).
pub fn world(g: &Grid) -> Bounds {
    Bounds {
        x0: 0.0,
        y0: 0.0,
        x1: g.world_w_px,
        y1: g.world_h_px,
    }
}

/// `r` lies entirely outside `b` (touching counts as outside). NaN gives false.
pub fn outside(r: &Rect, b: &Bounds) -> bool {
    r.x + r.w <= b.x0 || r.x >= b.x1 || r.y + r.h <= b.y0 || r.y >= b.y1
}

/// `r` lies inside `b` with at least `inset` px to spare on every side. NaN gives false.
pub fn inside_by(r: &Rect, b: &Bounds, inset: f32) -> bool {
    r.x >= b.x0 + inset
        && r.x + r.w <= b.x1 - inset
        && r.y >= b.y0 + inset
        && r.y + r.h <= b.y1 - inset
}

/// `r` overlaps `b` with a positive area. NaN gives false.
pub fn overlaps(r: &Rect, b: &Bounds) -> bool {
    r.x < b.x1 && r.x + r.w > b.x0 && r.y < b.y1 && r.y + r.h > b.y0
}

/// Element `id`'s parked state for the rects TS wrote this frame (D81-1).
fn wants_parked(e: &Elements, id: usize, b: &Bounds, w: &Bounds) -> bool {
    if e.is_dragged(id) {
        return false;
    }
    let Some(r) = e.home_rect(id, false) else {
        return false;
    };
    if e.is_parked(id) {
        !(inside_by(&r, b, UNPARK_INSET_PX) || overlaps(&r, w))
    } else {
        outside(&r, b)
    }
}

/// Parks and unparks every element for this frame's rects; returns true when any element changed.
/// A changed element is put at rest at once (`Elements::rest_now`); then one particle pass
/// (`sync_particles`) flags the newly parked particles and places the newly unparked ones at
/// rest. O(elements) on a frame without a change. No allocation, no panic.
pub fn update(p: &mut Particles, g: &Grid, e: &mut Elements, reduced_motion: bool) -> bool {
    let (b, w) = (bound(g), world(g));
    let mut changed = false;
    for id in 0..e.cap {
        let now = wants_parked(e, id, &b, &w);
        if now != e.is_parked(id) {
            e.set_parked(id, now);
            e.rest_now(id);
            changed = true;
        }
    }
    if changed {
        sync_particles(p, g, e, reduced_motion);
    }
    changed
}

/// Brings every particle's `FLAG_PARKED` in line with its home's parked state. A parked particle
/// keeps its position and has `placed = false` (a redistribute that gives it a new home places it
/// at its new target, `pool::redistribute`, instead of letting it crawl in from where it was). A particle that stops being parked is
/// placed at rest at its target with its kinematics reset (`reset_kinematics`: v, C, J, F, torn);
/// without a target (its slot went inactive) it only loses the flag and stays unplaced. A homeless
/// particle never carries the flag.
pub fn sync_particles(p: &mut Particles, g: &Grid, e: &Elements, reduced_motion: bool) {
    for i in 0..p.cap {
        let home = p.home_of(i);
        if home.is_some_and(|h| e.is_parked(h)) {
            if let Some(f) = p.flags.get_mut(i) {
                *f |= FLAG_PARKED;
            }
            if let Some(placed) = p.placed.get_mut(i) {
                *placed = false;
            }
            continue;
        }
        if !p.is_parked(i) {
            continue;
        }
        if let Some(f) = p.flags.get_mut(i) {
            *f &= !FLAG_PARKED;
        }
        let target =
            home.and_then(|h| e.target_px(h, rd(&p.rest_u, i), rd(&p.rest_v, i), reduced_motion));
        if let Some((tx, ty)) = target {
            let (gx, gy) = g.to_grid(tx, ty);
            let (gx, gy) = g.clamp_pos(gx, gy);
            wr(&mut p.x, i, gx);
            wr(&mut p.y, i, gy);
            p.reset_kinematics(i);
            if let Some(placed) = p.placed.get_mut(i) {
                *placed = true;
            }
        }
    }
}
