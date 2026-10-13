//! W80 (D80-1, slice-6 design §3): scroll follows. Buffer space stays the viewport; TS reads the
//! scroll delta once per frame and calls `FluidCore::scroll_shift(dx, dy, ivx, ivy)` after
//! `registry.sync()` and before `tick`. The shift moves every particle of an element that moves
//! with the page, and that element's previous home rect, by `(−dx, −dy)` px, so the rect velocity
//! (`update_velocities`) sees only motion beyond the scroll and a scroll does not excite the
//! liquid. The particles move by whole cells and the grid's lattice origin by the rest
//! (`Grid::scroll_origin`), so they keep their lattice phase and the simulation equals the
//! unscrolled one up to f32 rounding, at rest and in flight. A light inertia `(ivx, ivy)` px/s
//! is added to the shifted particles' velocities: scrolling down (dy > 0) moves the content up,
//! the liquid lags below its home (ivy > 0, viewport space) and the home spring brings it back.
//!
//! A dragged element is skipped: its home is pinned to the pointer (TS adds the scroll delta to
//! its drag offset in the same frame), so its liquid stays where it is in the viewport. W81 adds
//! parked elements to the skip (`shifts_with_scroll`).
//!
//! W80 ward review I1: "moves with the page" is read from the rects, not assumed. An element
//! whose DOM rect did not move with the scroll (`position: fixed`, a stuck `position: sticky`,
//! an element inside a fixed ancestor) is not shifted either (`moved_with_scroll`): its liquid
//! stays put in px like a dragged one's and its previous rect stays, so the home velocity sees
//! what the rect really did. No FFI change: TS has written this frame's rects before the call.

use super::access::{add, finite_or, rd, wr};
use super::elements::Elements;
use super::grid::{Grid, WORLD_MAX_PX};
use super::interaction::POINTER_VMAX_PX_S;
use super::particles::Particles;

/// W80 (D80-1): the inertia's last-line cap in Rust, px/s (the soft pointer field's cap). TS caps
/// it far lower (`SCROLL_INERTIA_MAX_PX_S`, D80-2); this only keeps a hostile value bounded.
pub const SCROLL_INERTIA_VMAX_PX_S: f32 = POINTER_VMAX_PX_S;

/// One frame's scroll, sanitised (`ScrollShift::sanitized`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScrollShift {
    /// Scroll delta in px (the content moved by `(−dx, −dy)` in the viewport).
    pub dx_px: f32,
    pub dy_px: f32,
    /// Inertia added to the shifted particles' velocities, px/s.
    pub ivx_px_s: f32,
    pub ivy_px_s: f32,
}

impl ScrollShift {
    /// No scroll.
    pub const NONE: ScrollShift = ScrollShift {
        dx_px: 0.0,
        dy_px: 0.0,
        ivx_px_s: 0.0,
        ivy_px_s: 0.0,
    };

    /// Last-line defence for the FFI scroll (TS validates first): a non-finite delta is 0 and a
    /// finite one is clamped to ±`WORLD_MAX_PX` per axis (a negative one, e.g. overscroll, is
    /// kept); a non-finite inertia (either axis) is 0 and its speed is capped at
    /// `SCROLL_INERTIA_VMAX_PX_S` with the direction kept, also when `|v|` overflows f32;
    /// reduced motion drops the inertia (D80-1).
    pub fn sanitized(dx: f32, dy: f32, ivx: f32, ivy: f32, reduced_motion: bool) -> ScrollShift {
        let shift = |v: f32| finite_or(v, 0.0).clamp(-WORLD_MAX_PX, WORLD_MAX_PX);
        let (ivx_px_s, ivy_px_s) = if reduced_motion || !(ivx.is_finite() && ivy.is_finite()) {
            (0.0, 0.0)
        } else {
            let speed = ivx.hypot(ivy);
            if speed <= SCROLL_INERTIA_VMAX_PX_S {
                (ivx, ivy)
            } else if speed.is_finite() {
                let k = SCROLL_INERTIA_VMAX_PX_S / speed;
                (ivx * k, ivy * k)
            } else {
                // Both axes finite but |v| overflows f32: normalise by the larger axis first.
                let m = ivx.abs().max(ivy.abs());
                let (ux, uy) = (ivx / m, ivy / m);
                let k = SCROLL_INERTIA_VMAX_PX_S / ux.hypot(uy);
                (ux * k, uy * k)
            }
        };
        ScrollShift {
            dx_px: shift(dx),
            dy_px: shift(dy),
            ivx_px_s,
            ivy_px_s,
        }
    }

    /// True when the shift moves nothing and adds no velocity.
    pub fn is_none(&self) -> bool {
        self.dx_px == 0.0 && self.dy_px == 0.0 && self.ivx_px_s == 0.0 && self.ivy_px_s == 0.0
    }
}

/// W80 (D80-1): whether element `id`'s particles and previous home rect follow the scroll. A
/// dragged element does not: its home is pinned to the pointer. W81 also skips a parked element.
pub fn shifts_with_scroll(e: &Elements, id: usize) -> bool {
    !e.is_dragged(id)
}

/// W80 ward review I1: whether element `id`'s DOM rect moved with this shift. `m` is the rect's
/// change since the last velocity sample (`prev`, which earlier shifts since that sample already
/// moved for an element that followed them, so `m` is this call's change alone). The element
/// follows when `m` is at least as close to the scroll's `(−dx, −dy)` as to no motion:
/// `|m + d|² ≤ |m|²`, i.e. its rect moved by at least half the scroll against it. The tolerance is
/// the midpoint between the two hypotheses, so it scales with the scroll: an element that did
/// a bit of both (a sticky element that sticks mid-frame, or one with its own CSS motion during
/// the scroll) gets the reading that leaves the smaller residual for the home velocity (at most
/// `|d|/2` px), and sub-px rect rounding cannot flip a scroll of a few px. Ties (`d = 0`) follow.
/// Without a previous sample (an element observed since the last simulating tick: its particles
/// were placed at the rect written before this frame's scroll) or without an active rect it
/// follows, as before the review. NaN in the rect reads as not moved.
pub fn moved_with_scroll(e: &Elements, id: usize, s: &ScrollShift) -> bool {
    let Some(r) = e.rect(id) else {
        return true;
    };
    if !e.has_prev.get(id).copied().unwrap_or(false) {
        return true;
    }
    let (mx, my) = (r.x - rd(&e.prev_x, id), r.y - rd(&e.prev_y, id));
    let (fx, fy) = (mx + s.dx_px, my + s.dy_px);
    fx * fx + fy * fy <= mx * mx + my * my
}

/// Whether element `id`'s particles and previous home rect move with shift `s`: not skipped
/// (`shifts_with_scroll`) and, unless under reduced motion, its rect moved with the scroll
/// (`moved_with_scroll`). Under reduced motion every tick pins each particle to its target, so
/// the reading would change nothing visible; it is skipped there.
fn follows_scroll(e: &Elements, id: usize, s: &ScrollShift, reduced_motion: bool) -> bool {
    shifts_with_scroll(e, id) && (reduced_motion || moved_with_scroll(e, id, s))
}

/// Applies a sanitised shift. The grid's lattice origin moves by the sub-cell rest
/// (`Grid::scroll_origin`) and every homed particle whose element follows the scroll
/// (`shifts_with_scroll` and `moved_with_scroll`) by the whole cells (clamped to the grid like
/// every position write), so together they move by `(−dx, −dy)` px; those particles gain the
/// inertia. The particles of a dragged element, or of one whose rect did not move with the page,
/// move by the rest in the other direction, so they stay put in px. Each following element's
/// previous home rect moves with it. APIC C, J and F are translation-invariant and stay; the grid
/// is cleared every substep; the caller invalidates the fused AABB (D68-10). No allocation, no
/// panic.
pub fn apply(
    p: &mut Particles,
    g: &mut Grid,
    e: &mut Elements,
    s: &ScrollShift,
    reduced_motion: bool,
) {
    let moves = s.dx_px != 0.0 || s.dy_px != 0.0;
    let (kx, ky) = if moves {
        g.scroll_origin(s.dx_px, s.dy_px)
    } else {
        (0.0, 0.0)
    };
    // A particle that stays put in px moves by the origin's change in grid units.
    let (rx, ry) = (
        (s.dx_px - kx * g.cell_px) * g.inv_cell,
        (s.dy_px - ky * g.cell_px) * g.inv_cell,
    );
    let (gvx, gvy) = (s.ivx_px_s * g.inv_cell, s.ivy_px_s * g.inv_cell);
    let kicks = gvx != 0.0 || gvy != 0.0;
    // The reading per element, cached for runs of particles of the same element. Every reading
    // here precedes the `shift_prev` below, so all of them see the same previous rects.
    let mut last: Option<(usize, bool)> = None;
    for i in 0..p.cap {
        let Some(h) = p.home_of(i) else {
            continue;
        };
        let follows = match last {
            Some((id, f)) if id == h => f,
            _ => {
                let f = follows_scroll(e, h, s, reduced_motion);
                last = Some((h, f));
                f
            }
        };
        if moves {
            let (sx, sy) = if follows { (-kx, -ky) } else { (rx, ry) };
            let (x, y) = g.clamp_pos(rd(&p.x, i) + sx, rd(&p.y, i) + sy);
            wr(&mut p.x, i, x);
            wr(&mut p.y, i, y);
        }
        if kicks && follows {
            add(&mut p.vx, i, gvx);
            add(&mut p.vy, i, gvy);
        }
    }
    if moves {
        for id in 0..e.cap {
            // Reads only this id's own previous rect, which no earlier iteration changed.
            if follows_scroll(e, id, s, reduced_motion) {
                e.shift_prev(id, -s.dx_px, -s.dy_px);
            }
        }
    }
}
