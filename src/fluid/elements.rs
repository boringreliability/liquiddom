//! Element table over the TS-written element buffer (spec §2 FFI item 1) and
//! the Rust-written state view (item 4). Element id == slot index.

use super::access::{add, finite_or, positive, rd, rd_or, wr};
use super::fmath::F_REST_TOL;
use super::grid::WORLD_MAX_PX;
use super::layout::{
    EL_H, EL_HOME_DX, EL_HOME_DY, EL_INTERACTION, EL_RADIUS, EL_RECOVERY, EL_VISCOSITY, EL_W, EL_X,
    EL_Y, ELEMENT_STRIDE, HOVER_SWELL, INTERACTION_DRAGGED, INTERACTION_HOVER, ST_MAX_DEV,
    ST_MAX_F_DEV, ST_REST_ALPHA, ST_S, STATE_STRIDE,
};
use super::material::sanitize_recovery;
use super::sampling::clamp_radius;

pub const S_FLOOR: f32 = 0.015;
pub const REST_S_MIN: f32 = 0.95; // W67 D67-1 option 1 (spec §2 amended; was 0.98)
pub const REST_MAX_DEV_PX: f32 = 0.75;
pub const REST_HOLD_S: f32 = 0.150;
pub const REST_FADE_S: f32 = 0.120;
/// W78 ward review (M1): slots 6–7 (home / drag offset) are clamped to ±this many px where they
/// are read. Any world is at most `WORLD_MAX_PX` wide and its grid margin at most `WORLD_MAX_PX`,
/// so a home moved further is off the grid either way; the clamp keeps a huge finite offset
/// (±3e38) from overflowing the home velocity to Inf or putting the home ~1e38 px away.
pub const HOME_OFFSET_MAX_PX: f32 = 2.0 * WORLD_MAX_PX;
/// W67: per-element wobble phases are spaced by the golden angle, so neighbours never wobble in step.
pub const WOBBLE_PHASE_STEP_RAD: f32 = 2.399_963;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub r: f32,
}

pub struct Elements {
    pub cap: usize,
    /// TS-written, `cap · ELEMENT_STRIDE` floats (exported via `elements_ptr`).
    pub buf: Vec<f32>,
    /// Rust-written, `cap · STATE_STRIDE` floats (exported via `state_ptr`).
    pub state: Vec<f32>,
    pub prev_x: Vec<f32>,
    pub prev_y: Vec<f32>,
    pub has_prev: Vec<bool>,
    /// Rect velocity in px/s (used by the W67 home spring).
    pub vel_x: Vec<f32>,
    pub vel_y: Vec<f32>,
    /// W78 (D78-3): the drag offset (slots 6–7) at the last velocity sample; 0 unless dragged.
    pub prev_off_x: Vec<f32>,
    pub prev_off_y: Vec<f32>,
    /// W79 (D79-2): set while the element is dragged or a neighbour under the drag, and kept
    /// until its restAlpha is 1 again; its particles slip at the merge rate meanwhile.
    pub merge_slip: Vec<bool>,
    /// W81 (D81-1): parked (home rect outside the world plus the margin); its particles carry
    /// `FLAG_PARKED` and are not simulated (`parking::update`).
    pub parked: Vec<bool>,
    pub stiffness: Vec<f32>,
    pub rest_w: Vec<f32>,
    pub rest_h: Vec<f32>,
    pub counts: Vec<u32>,
    pub area_per_particle: Vec<f32>,
    /// W67: seconds the rest condition has held (capped at REST_HOLD_S).
    pub rest_hold_s: Vec<f32>,
    /// W67: wobble phase per element (rad).
    pub phase: Vec<f32>,
}

/// Hover swell (spec §2, resolution B1, D68-8): while hovered the home rect grows by
/// `HOVER_SWELL` about its centre, radius included, so a pill stays a pill. Idle,
/// focused, dragged, NaN and reduced motion leave it unchanged. TS draws the rest
/// contour with the identical rule (`fluid-layout.ts` `homeRect`). The arithmetic is
/// W64's, unchanged, so Rust and TS stay identical.
pub fn swell_rect(r: &Rect, interaction: f32, reduced_motion: bool) -> Rect {
    let hovered = (interaction - INTERACTION_HOVER).abs() < 0.5;
    if reduced_motion || !hovered {
        return *r;
    }
    let k = 1.0 + HOVER_SWELL;
    Rect {
        x: r.x - 0.5 * (r.w * k - r.w),
        y: r.y - 0.5 * (r.h * k - r.h),
        w: r.w * k,
        h: r.h * k,
        r: r.r * k,
    }
}

/// W79 (D79-2): true when `b` overlaps `a` grown by `margin` px on every side. Open intervals:
/// rects exactly `margin` apart do not overlap. Any NaN coordinate gives false.
pub fn rects_overlap(a: &Rect, b: &Rect, margin: f32) -> bool {
    let (ax0, ay0) = (a.x - margin, a.y - margin);
    let (ax1, ay1) = (a.x + a.w + margin, a.y + a.h + margin);
    ax0 < b.x + b.w && b.x < ax1 && ay0 < b.y + b.h && b.y < ay1
}

impl Elements {
    pub fn new(cap: usize) -> Elements {
        let mut state = vec![0.0; cap * STATE_STRIDE];
        for id in 0..cap {
            wr(&mut state, id * STATE_STRIDE + ST_S, 1.0);
        }
        Elements {
            cap,
            buf: vec![0.0; cap * ELEMENT_STRIDE],
            state,
            prev_x: vec![0.0; cap],
            prev_y: vec![0.0; cap],
            has_prev: vec![false; cap],
            vel_x: vec![0.0; cap],
            vel_y: vec![0.0; cap],
            prev_off_x: vec![0.0; cap],
            prev_off_y: vec![0.0; cap],
            merge_slip: vec![false; cap],
            parked: vec![false; cap],
            stiffness: vec![1.0; cap],
            rest_w: vec![0.0; cap],
            rest_h: vec![0.0; cap],
            counts: vec![0; cap],
            area_per_particle: vec![0.0; cap],
            rest_hold_s: vec![0.0; cap],
            phase: (0..cap)
                .map(|id| id as f32 * WOBBLE_PHASE_STEP_RAD)
                .collect(),
        }
    }

    #[inline]
    fn field(&self, id: usize, f: usize) -> f32 {
        if id >= self.cap {
            return f32::NAN;
        }
        rd_or(&self.buf, id * ELEMENT_STRIDE + f, f32::NAN)
    }

    /// `x, y` finite and `w, h` finite and > 0.
    pub fn is_active(&self, id: usize) -> bool {
        id < self.cap
            && self.field(id, EL_X).is_finite()
            && self.field(id, EL_Y).is_finite()
            && positive(self.field(id, EL_W))
            && positive(self.field(id, EL_H))
    }

    /// W79 (D79-2): the element takes part in a merge (dragged, or a neighbour under the drag)
    /// and has not been at rest since. Out of range gives false.
    pub fn merge_slip(&self, id: usize) -> bool {
        self.merge_slip.get(id).copied().unwrap_or(false)
    }

    /// W79 (D79-2): sets or clears `merge_slip`; out of range is a no-op.
    pub fn set_merge_slip(&mut self, id: usize, on: bool) {
        if let Some(slot) = self.merge_slip.get_mut(id) {
            *slot = on;
        }
    }

    /// W81 (D81-1): the element is parked. Out of range gives false.
    pub fn is_parked(&self, id: usize) -> bool {
        self.parked.get(id).copied().unwrap_or(false)
    }

    /// W81 (D81-1): sets or clears `parked`; out of range is a no-op. `parking::update` owns it.
    pub fn set_parked(&mut self, id: usize, on: bool) {
        if let Some(slot) = self.parked.get_mut(id) {
            *slot = on;
        }
    }

    /// W81 (D81-1): at rest now (park and re-entry): stiffness 1, full rest hold, no merge slip,
    /// no previous rect sample and home velocity 0 (the next `update_velocities` starts from the
    /// current rect), state s = 1, maxDev 0, restAlpha 1, maxFDev 0. Out of range is a no-op.
    pub fn rest_now(&mut self, id: usize) {
        if id >= self.cap {
            return;
        }
        wr(&mut self.stiffness, id, 1.0);
        wr(&mut self.rest_hold_s, id, REST_HOLD_S);
        self.set_merge_slip(id, false);
        if let Some(slot) = self.has_prev.get_mut(id) {
            *slot = false;
        }
        wr(&mut self.vel_x, id, 0.0);
        wr(&mut self.vel_y, id, 0.0);
        wr(&mut self.prev_off_x, id, 0.0);
        wr(&mut self.prev_off_y, id, 0.0);
        let base = id * STATE_STRIDE;
        wr(&mut self.state, base + ST_S, 1.0);
        wr(&mut self.state, base + ST_MAX_DEV, 0.0);
        wr(&mut self.state, base + ST_REST_ALPHA, 1.0);
        wr(&mut self.state, base + ST_MAX_F_DEV, 0.0);
    }

    /// W78 (D78-4): slot 5 holds DRAGGED (within ±0.5, like HOVER in `swell_rect`). NaN, an
    /// out-of-range id and every other code are not dragged.
    pub fn is_dragged(&self, id: usize) -> bool {
        (self.field(id, EL_INTERACTION) - INTERACTION_DRAGGED).abs() < 0.5
    }

    /// Slots 6–7 as read by the engine: NaN/Inf → 0, finite values clamped to
    /// ±`HOME_OFFSET_MAX_PX` (W78 ward review M1).
    fn home_offset(&self, id: usize) -> (f32, f32) {
        let c = |v: f32| finite_or(v, 0.0).clamp(-HOME_OFFSET_MAX_PX, HOME_OFFSET_MAX_PX);
        (c(self.field(id, EL_HOME_DX)), c(self.field(id, EL_HOME_DY)))
    }

    /// The DOM rect with the radius clamped to `[0, min(w, h) / 2]`.
    pub fn rect(&self, id: usize) -> Option<Rect> {
        if !self.is_active(id) {
            return None;
        }
        let (w, h) = (self.field(id, EL_W), self.field(id, EL_H));
        Some(Rect {
            x: self.field(id, EL_X),
            y: self.field(id, EL_Y),
            w,
            h,
            r: clamp_radius(w, h, self.field(id, EL_RADIUS)),
        })
    }

    /// B1: DOM rect + `(home_dx, home_dy)`, swelled by `HOVER_SWELL` around
    /// its centre while hovered and not under reduced motion. The same rule
    /// lives in TS as `homeRect()` in `fluid-layout.ts`, except the
    /// ±`HOME_OFFSET_MAX_PX` clamp: TS only writes real pointer deltas, far
    /// inside it (W78 ward review M1).
    pub fn home_rect(&self, id: usize, reduced_motion: bool) -> Option<Rect> {
        let r = self.rect(id)?;
        let (ox, oy) = self.home_offset(id);
        let moved = Rect {
            x: r.x + ox,
            y: r.y + oy,
            ..r
        };
        Some(swell_rect(
            &moved,
            self.field(id, EL_INTERACTION),
            reduced_motion,
        ))
    }

    /// Target = `rest_uv` mapped into the current home rect (spec §2 "T-1000").
    pub fn target_px(&self, id: usize, u: f32, v: f32, reduced_motion: bool) -> Option<(f32, f32)> {
        let r = self.home_rect(id, reduced_motion)?;
        Some((r.x + u * r.w, r.y + v * r.h))
    }

    pub fn viscosity_override(&self, id: usize) -> Option<f32> {
        let v = self.field(id, EL_VISCOSITY);
        if v.is_finite() {
            Some(v.clamp(0.0, 1.0))
        } else {
            None
        }
    }

    pub fn recovery_override(&self, id: usize) -> Option<f32> {
        let v = self.field(id, EL_RECOVERY);
        if v.is_finite() {
            Some(v.clamp(0.2, 3.0))
        } else {
            None
        }
    }

    /// Home velocity in px/s: the rect delta over `dt` and, W78 (D78-3), while the element is
    /// dragged, the drag offset's delta too, so the home spring damps relative to the moving home
    /// (`ElRow::spring_accel`). The offset counts only while slot 5 is DRAGGED: on release TS
    /// writes slot 5 → 0 and the offset → 0 in one frame, and that jump back is the anchor
    /// returning to the DOM rect, not a velocity, so the release adds none (the saturated spring
    /// gives the crawl home). An idle element's offset is ignored likewise. The non-dragged path
    /// is W67's arithmetic, bit for bit. Inactive slots reset.
    pub fn update_velocities(&mut self, dt: f32) {
        for id in 0..self.cap {
            let had_prev = self.has_prev.get(id).copied().unwrap_or(false);
            let dragged = self.is_dragged(id);
            let (ox, oy) = if dragged {
                self.home_offset(id)
            } else {
                (0.0, 0.0)
            };
            let (vx, vy, px, py, offx, offy, has) = match self.rect(id) {
                Some(r) if had_prev && dt > 0.0 => {
                    let mut dx = r.x - rd(&self.prev_x, id);
                    let mut dy = r.y - rd(&self.prev_y, id);
                    if dragged {
                        dx += ox - rd(&self.prev_off_x, id);
                        dy += oy - rd(&self.prev_off_y, id);
                    }
                    (dx / dt, dy / dt, r.x, r.y, ox, oy, true)
                }
                Some(r) => (0.0, 0.0, r.x, r.y, ox, oy, true),
                None => (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, false),
            };
            wr(&mut self.vel_x, id, vx);
            wr(&mut self.vel_y, id, vy);
            wr(&mut self.prev_x, id, px);
            wr(&mut self.prev_y, id, py);
            wr(&mut self.prev_off_x, id, offx);
            wr(&mut self.prev_off_y, id, offy);
            if let Some(slot) = self.has_prev.get_mut(id) {
                *slot = has;
            }
        }
    }

    /// W80 (D80-1): a scroll moved this element's rect by `(dx, dy)` px in buffer space; its
    /// previous rect (the last velocity sample) moves with it, so `update_velocities` sees only
    /// the motion beyond the scroll. Several shifts between two simulating ticks add up. A slot
    /// without a previous sample, or out of range, is a no-op.
    pub fn shift_prev(&mut self, id: usize, dx: f32, dy: f32) {
        if !self.has_prev.get(id).copied().unwrap_or(false) {
            return;
        }
        add(&mut self.prev_x, id, dx);
        add(&mut self.prev_y, id, dy);
    }

    /// W67 ward-review fix: back to the state of a never-used slot (stiffness 1, no rest
    /// hold, no previous rect, rect velocity 0, rest state as `update_rest_state` writes
    /// for an inactive slot). `pool::redistribute` calls it for every inactive slot, so a
    /// hidden (w = 0) slot reused with a new rect inherits neither damage nor a velocity
    /// from the old → new rect jump.
    pub fn reset_slot(&mut self, id: usize) {
        if id >= self.cap {
            return;
        }
        wr(&mut self.stiffness, id, 1.0);
        wr(&mut self.rest_hold_s, id, 0.0);
        if let Some(slot) = self.has_prev.get_mut(id) {
            *slot = false;
        }
        wr(&mut self.prev_x, id, 0.0);
        wr(&mut self.prev_y, id, 0.0);
        wr(&mut self.vel_x, id, 0.0);
        wr(&mut self.vel_y, id, 0.0);
        wr(&mut self.prev_off_x, id, 0.0);
        wr(&mut self.prev_off_y, id, 0.0);
        self.set_merge_slip(id, false);
        self.set_parked(id, false);
        let base = id * STATE_STRIDE;
        wr(&mut self.state, base + ST_S, 1.0);
        wr(&mut self.state, base + ST_MAX_DEV, 0.0);
        wr(&mut self.state, base + ST_REST_ALPHA, 0.0);
        wr(&mut self.state, base + ST_MAX_F_DEV, 0.0);
    }

    /// `s ← max(min(s, cap), S_FLOOR)` (spec §2 stiffness damage). Restarts the rest hold,
    /// writes s to the state view and (W74, D74-7) drops restAlpha to 0 at once: a splash or
    /// shake empties the rect within a few frames, so the rest contour must not fade out over
    /// the hole (the "ghost pill"). A NaN/±inf cap or an out-of-range id is a no-op.
    pub fn damage(&mut self, id: usize, cap: f32) {
        if !cap.is_finite() || id >= self.cap {
            return;
        }
        let s = rd_or(&self.stiffness, id, 1.0).min(cap).max(S_FLOOR);
        wr(&mut self.stiffness, id, s);
        wr(&mut self.rest_hold_s, id, 0.0);
        wr(&mut self.state, id * STATE_STRIDE + ST_S, s);
        wr(&mut self.state, id * STATE_STRIDE + ST_REST_ALPHA, 0.0);
    }

    /// W67: exact integration of ds/dt = (1 − s)/recovery over `dt` for every active
    /// element. The per-element override (slot 9, already clamped to [0.2, 3] s) wins
    /// over `default_recovery_s`.
    pub fn update_stiffness(&mut self, dt: f32, default_recovery_s: f32) {
        if !positive(dt) {
            return;
        }
        let fallback = sanitize_recovery(default_recovery_s);
        for id in 0..self.cap {
            if !self.is_active(id) {
                continue;
            }
            let recovery = self.recovery_override(id).unwrap_or(fallback);
            let s = finite_or(rd_or(&self.stiffness, id, 1.0), 1.0);
            let next = (1.0 - (1.0 - s) * (-dt / recovery).exp()).clamp(S_FLOOR, 1.0);
            wr(&mut self.stiffness, id, next);
            wr(&mut self.state, id * STATE_STRIDE + ST_S, next);
        }
    }

    /// The W67 rest state without the F condition (`max_f_dev` = 0). Kept for the W67 tests;
    /// the api calls `update_rest_state_with_f` (W74, D74-2).
    pub fn update_rest_state(&mut self, id: usize, max_dev: f32, dt: f32, reduced_motion: bool) {
        self.update_rest_state_with_f(id, max_dev, 0.0, dt, reduced_motion);
    }

    /// W67 rest state with hysteresis (spec §2), W74 (D74-2): restAlpha rises (fade REST_FADE_S)
    /// only once `s > REST_S_MIN ∧ maxDev < REST_MAX_DEV_PX ∧ maxFDev < F_REST_TOL` has held for
    /// REST_HOLD_S, and falls at once (same fade) when any breaks. Reduced motion: at rest
    /// (stiffness 1, restAlpha 1, maxDev 0, maxFDev 0). Inactive slot: reset. Writes s, maxDev,
    /// restAlpha and maxFDev (slot 3; a non-finite maxFDev is written as f32::MAX).
    pub fn update_rest_state_with_f(
        &mut self,
        id: usize,
        max_dev: f32,
        max_f_dev: f32,
        dt: f32,
        reduced_motion: bool,
    ) {
        if id >= self.cap {
            return;
        }
        let base = id * STATE_STRIDE;
        if !self.is_active(id) {
            self.set_merge_slip(id, false);
            wr(&mut self.rest_hold_s, id, 0.0);
            wr(&mut self.state, base + ST_S, 1.0);
            wr(&mut self.state, base + ST_MAX_DEV, 0.0);
            wr(&mut self.state, base + ST_REST_ALPHA, 0.0);
            wr(&mut self.state, base + ST_MAX_F_DEV, 0.0);
            return;
        }
        if self.is_parked(id) {
            // W81 (D81-1): a parked element is held at rest (its particles are not simulated).
            self.rest_now(id);
            return;
        }
        if reduced_motion {
            // W67 ward-review fix: under reduced motion the element is at rest (spec §2),
            // so pending damage is dropped instead of frozen until motion returns.
            wr(&mut self.stiffness, id, 1.0);
            self.set_merge_slip(id, false);
            wr(&mut self.rest_hold_s, id, REST_HOLD_S);
            wr(&mut self.state, base + ST_S, 1.0);
            wr(&mut self.state, base + ST_MAX_DEV, 0.0);
            wr(&mut self.state, base + ST_REST_ALPHA, 1.0);
            wr(&mut self.state, base + ST_MAX_F_DEV, 0.0);
            return;
        }
        let s = rd_or(&self.stiffness, id, 1.0);
        let dev = finite_or(max_dev, f32::MAX).max(0.0);
        let fdev = finite_or(max_f_dev, f32::MAX).max(0.0);
        let dt = if dt.is_finite() { dt.max(0.0) } else { 0.0 };
        let holds = s > REST_S_MIN && dev < REST_MAX_DEV_PX && fdev < F_REST_TOL;
        let hold = if holds {
            (rd(&self.rest_hold_s, id) + dt).min(REST_HOLD_S)
        } else {
            0.0
        };
        wr(&mut self.rest_hold_s, id, hold);
        let step = dt / REST_FADE_S;
        let alpha = rd(&self.state, base + ST_REST_ALPHA);
        let alpha = if !holds {
            (alpha - step).max(0.0)
        } else if hold + 1e-6 >= REST_HOLD_S {
            (alpha + step).min(1.0)
        } else {
            alpha
        };
        wr(&mut self.state, base + ST_S, s);
        wr(&mut self.state, base + ST_MAX_DEV, dev);
        wr(&mut self.state, base + ST_REST_ALPHA, alpha);
        wr(&mut self.state, base + ST_MAX_F_DEV, fdev);
        if alpha >= 1.0 {
            // W79 (D79-2): back at rest, the merge slip ends.
            self.set_merge_slip(id, false);
        }
    }

    /// W67 (D67-12), W74 (D74-2): an active element that is stiff (`s > REST_S_MIN`), whose
    /// particles already sit on target (state maxDev < REST_MAX_DEV_PX) and whose F is at rest
    /// (state maxFDev < F_REST_TOL) is at rest immediately: full hold, restAlpha 1.
    /// `FluidCore::redistribute` calls this after refreshing the state, so freshly placed
    /// elements neither fade in nor wobble.
    pub fn settle_if_at_rest(&mut self, id: usize) {
        if !self.is_active(id) {
            return;
        }
        let base = id * STATE_STRIDE;
        let s = rd_or(&self.stiffness, id, 1.0);
        let dev = rd_or(&self.state, base + ST_MAX_DEV, f32::MAX);
        let fdev = rd_or(&self.state, base + ST_MAX_F_DEV, f32::MAX);
        if s > REST_S_MIN && dev < REST_MAX_DEV_PX && fdev < F_REST_TOL {
            wr(&mut self.rest_hold_s, id, REST_HOLD_S);
            wr(&mut self.state, base + ST_REST_ALPHA, 1.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(slot: [f32; ELEMENT_STRIDE]) -> Elements {
        let mut e = Elements::new(2);
        e.buf[..ELEMENT_STRIDE].copy_from_slice(&slot);
        e
    }

    #[test]
    fn given_hover_and_motion_when_home_rect_then_swelled_2_percent_about_centre() {
        let e = with([
            100.0,
            200.0,
            140.0,
            48.0,
            24.0,
            1.0,
            5.0,
            -3.0,
            f32::NAN,
            f32::NAN,
        ]);
        let r = e.home_rect(0, false).unwrap();
        let k = 1.0 + HOVER_SWELL;
        assert!((r.w - 140.0 * k).abs() < 1e-4 && (r.h - 48.0 * k).abs() < 1e-4);
        assert!((r.x + r.w / 2.0 - 175.0).abs() < 1e-4 && (r.y + r.h / 2.0 - 221.0).abs() < 1e-4);
        let calm = e.home_rect(0, true).unwrap();
        assert_eq!(
            calm,
            Rect {
                x: 105.0,
                y: 197.0,
                w: 140.0,
                h: 48.0,
                r: 24.0
            }
        );
    }

    /// Refactor guard, not a red test: pins W64's exact float arithmetic for the
    /// swelled home rect. It passes today; it must still pass, bit for bit, once
    /// W68.8 routes `home_rect` through `swell_rect` (D68-8).
    #[test]
    fn given_hover_with_home_offset_and_odd_sizes_when_home_rect_then_bit_identical_to_w64_arithmetic()
     {
        let (x, y, w, h, r, dx, dy) = (101.3f32, 203.7, 137.9, 47.3, 23.6, 5.3, -3.1); // r < h/2 = 23.65, so rect() does not clamp it
        let e = with([x, y, w, h, r, 1.0, dx, dy, f32::NAN, f32::NAN]);
        let k = 1.0 + HOVER_SWELL;
        assert_eq!(
            e.home_rect(0, false).unwrap(),
            Rect {
                x: (x + dx) - 0.5 * (w * k - w),
                y: (y + dy) - 0.5 * (h * k - h),
                w: w * k,
                h: h * k,
                r: r * k,
            }
        );
    }

    #[test]
    fn given_nan_or_zero_slot_when_queried_then_inactive_and_none() {
        let e = with([f32::NAN, 0.0, 10.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        assert!(!e.is_active(0) && !e.is_active(1) && !e.is_active(99));
        assert_eq!(e.home_rect(0, false), None);
        assert_eq!(e.target_px(5, 0.5, 0.5, false), None);
    }
}

#[cfg(test)]
mod w67_tests {
    use super::*;

    const DT_STEP: f32 = 1.0 / 60.0;
    const DT_SUB: f32 = 1.0 / 480.0;

    fn one_element() -> Elements {
        let mut e = Elements::new(2);
        e.buf[..ELEMENT_STRIDE].copy_from_slice(&[
            100.0,
            50.0,
            140.0,
            48.0,
            24.0,
            0.0,
            0.0,
            0.0,
            f32::NAN,
            f32::NAN,
        ]);
        e
    }

    fn alpha(e: &Elements) -> f32 {
        e.state[ST_REST_ALPHA]
    }

    #[test]
    fn given_rect_velocity_when_elements_updated_then_velocity_from_rect_delta_over_dt() {
        let mut e = one_element();
        e.update_velocities(DT_STEP);
        assert!(e.vel_x[0].abs() < 1e-7, "first sample: 0, not x/dt");
        e.buf[EL_X] = 110.0;
        e.update_velocities(DT_STEP);
        assert!(
            (e.vel_x[0] - 600.0).abs() < 0.05,
            "10 px per 1/60 s = 600 px/s, got {}",
            e.vel_x[0]
        );
        assert!(e.vel_y[0].abs() < 1e-4);
        e.update_velocities(DT_STEP);
        assert!(e.vel_x[0].abs() < 1e-4, "no motion: 0");
    }

    #[test]
    fn given_s_0_25_and_recovery_0_7_when_recovering_then_matches_ds_dt_1_minus_s_over_recovery() {
        let mut e = one_element();
        e.stiffness[0] = 0.25;
        for _ in 0..480 {
            e.update_stiffness(DT_SUB, 0.7);
        }
        let expected = 1.0 - 0.75 * (-1.0f32 / 0.7).exp();
        assert!(
            (e.stiffness[0] - expected).abs() < 1e-4,
            "{} vs {expected}",
            e.stiffness[0]
        );
        assert!(
            (e.state[ST_S] - e.stiffness[0]).abs() < 1e-7,
            "state view carries s"
        );
    }

    #[test]
    fn given_element_recovery_override_when_recovering_then_override_time_constant_used() {
        let mut e = one_element();
        e.buf[EL_RECOVERY] = 0.3;
        e.stiffness[0] = 0.25;
        for _ in 0..480 {
            e.update_stiffness(DT_SUB, 0.7);
        }
        let expected = 1.0 - 0.75 * (-1.0f32 / 0.3).exp();
        assert!(
            (e.stiffness[0] - expected).abs() < 1e-4,
            "{} vs {expected}",
            e.stiffness[0]
        );

        e.buf[EL_RECOVERY] = 50.0;
        e.stiffness[0] = 0.25;
        for _ in 0..480 {
            e.update_stiffness(DT_SUB, 0.7);
        }
        let clamped = 1.0 - 0.75 * (-1.0f32 / 3.0).exp();
        assert!(
            (e.stiffness[0] - clamped).abs() < 1e-4,
            "override clamped to 3 s"
        );
    }

    #[test]
    fn given_damage_below_floor_when_applied_then_s_clamped_to_floor_0_015() {
        let mut e = one_element();
        e.damage(0, 0.001);
        assert!((e.stiffness[0] - S_FLOOR).abs() < 1e-7);
        assert!(
            (e.state[ST_S] - S_FLOOR).abs() < 1e-7,
            "state view carries s"
        );
        e.damage(0, 0.5);
        assert!(
            (e.stiffness[0] - S_FLOOR).abs() < 1e-7,
            "damage only lowers"
        );
        e.damage(0, f32::NAN);
        assert!((e.stiffness[0] - S_FLOOR).abs() < 1e-7, "NaN cap: no-op");
        e.damage(7, 0.1);
        assert!(
            (e.stiffness[0] - S_FLOOR).abs() < 1e-7,
            "out-of-range id: no-op, no panic"
        );
    }

    #[test]
    fn given_s_above_rest_threshold_and_maxdev_below_0_75_for_150ms_when_ticking_then_rest_alpha_rises_to_1_over_120ms()
     {
        let mut e = one_element();
        let mut a = Vec::new();
        for _ in 0..20 {
            e.update_rest_state(0, 0.1, DT_STEP, false);
            a.push(alpha(&e));
        }
        for (k, v) in a.iter().take(8).enumerate() {
            assert!(v.abs() < 1e-7, "step {}: hold < 150 ms, alpha 0", k + 1);
        }
        assert!(a[8] > 0.0 && a[8] < 0.2, "step 9: fade starts ({})", a[8]);
        assert!(a[14] < 1.0, "step 15: still fading");
        assert_eq!(a[15], 1.0, "step 16: 120 ms fade complete");
        assert!(
            (e.state[ST_MAX_DEV] - 0.1).abs() < 1e-7,
            "state view carries maxDev"
        );
    }

    #[test]
    fn given_rest_alpha_1_when_condition_breaks_then_it_falls_immediately_reaching_0_after_120ms() {
        let mut e = one_element();
        for _ in 0..20 {
            e.update_rest_state(0, 0.1, DT_STEP, false);
        }
        let mut a = Vec::new();
        for _ in 0..8 {
            e.update_rest_state(0, 2.0, DT_STEP, false);
            a.push(alpha(&e));
        }
        assert!(a[0] < 1.0, "falls on the first broken step");
        assert!(a[6] > 0.0, "7 steps = 117 ms: not yet 0");
        assert_eq!(a[7], 0.0, "8 steps ≥ 120 ms: 0");

        for _ in 0..20 {
            e.update_rest_state(0, 0.1, DT_STEP, false);
        }
        e.stiffness[0] = 0.5;
        e.update_rest_state(0, 0.1, DT_STEP, false);
        assert!(alpha(&e) < 1.0, "soft stiffness also breaks rest");
    }

    #[test]
    fn given_condition_flickering_under_150ms_when_ticking_then_rest_alpha_stays_0() {
        let mut e = one_element();
        for _ in 0..6 {
            for _ in 0..8 {
                e.update_rest_state(0, 0.1, DT_STEP, false);
                assert_eq!(alpha(&e), 0.0);
            }
            e.update_rest_state(0, 2.0, DT_STEP, false);
            assert_eq!(alpha(&e), 0.0);
        }
    }

    #[test]
    fn given_element_already_on_target_when_redistributed_then_rest_alpha_starts_at_1() {
        let mut e = one_element();
        e.update_rest_state(0, 0.0, 0.0, false);
        assert_eq!(alpha(&e), 0.0, "dt 0 alone never raises alpha");
        e.settle_if_at_rest(0);
        assert_eq!(
            alpha(&e),
            1.0,
            "D67-12: on target and stiff → at rest at once"
        );
        e.update_rest_state(0, 0.1, DT_STEP, false);
        assert_eq!(alpha(&e), 1.0, "the hold is full: stays at rest");

        let mut soft = one_element();
        soft.stiffness[0] = 0.5;
        soft.update_rest_state(0, 0.0, 0.0, false);
        soft.settle_if_at_rest(0);
        assert_eq!(alpha(&soft), 0.0, "a soft element is not settled");

        let mut off = one_element();
        off.update_rest_state(0, 2.0, 0.0, false);
        off.settle_if_at_rest(0);
        assert_eq!(alpha(&off), 0.0, "a deviating element is not settled");

        let mut idle = Elements::new(2);
        idle.settle_if_at_rest(1);
        assert_eq!(
            idle.state[STATE_STRIDE + ST_REST_ALPHA],
            0.0,
            "inactive slot: no-op"
        );
    }

    #[test]
    fn given_s_between_0_94_and_0_96_when_ticking_then_rest_s_min_is_0_95() {
        // D67-1 option 1: REST_S_MIN = 0.95 (spec §2 said 0.98).
        assert!((REST_S_MIN - 0.95).abs() < 1e-7, "{REST_S_MIN}");

        let mut above = one_element();
        above.stiffness[0] = 0.96;
        for _ in 0..20 {
            above.update_rest_state(0, 0.1, DT_STEP, false);
        }
        assert_eq!(alpha(&above), 1.0, "s = 0.96 > REST_S_MIN raises alpha");
        assert!(
            above.rest_hold_s[0] >= REST_HOLD_S - 1e-6,
            "and fills the hold"
        );

        let mut below = one_element();
        below.stiffness[0] = 0.94;
        for _ in 0..20 {
            below.update_rest_state(0, 0.1, DT_STEP, false);
            assert_eq!(alpha(&below), 0.0, "s = 0.94 keeps alpha at 0");
            assert_eq!(below.rest_hold_s[0], 0.0, "and the hold at 0");
        }
        const { assert!(0.1 < REST_MAX_DEV_PX) };
    }

    #[test]
    fn given_max_f_dev_at_or_above_0_05_when_rest_state_updated_then_rest_alpha_never_rises_and_slot_3_carries_it_d74_2()
     {
        let mut e = one_element();
        for _ in 0..20 {
            e.update_rest_state_with_f(0, 0.1, 0.05, DT_STEP, false);
        }
        assert_eq!(alpha(&e), 0.0, "‖F − I‖ = 0.05 is not below F_REST_TOL");
        assert!(
            (e.state[ST_MAX_F_DEV] - 0.05).abs() < 1e-7,
            "slot 3 carries max ‖F − I‖"
        );
        for _ in 0..20 {
            e.update_rest_state_with_f(0, 0.1, 0.049, DT_STEP, false);
        }
        assert_eq!(
            alpha(&e),
            1.0,
            "all three conditions held for 150 ms + the 120 ms fade"
        );
        e.update_rest_state_with_f(0, 0.1, f32::NAN, DT_STEP, false);
        assert!(alpha(&e) < 1.0, "a NaN ‖F − I‖ breaks rest");
        assert_eq!(e.state[ST_MAX_F_DEV], f32::MAX);
        e.update_rest_state_with_f(0, 0.1, 0.5, DT_STEP, true);
        assert_eq!(
            (alpha(&e), e.state[ST_MAX_F_DEV]),
            (1.0, 0.0),
            "reduced motion: at rest, slot 3 = 0"
        );
        e.update_rest_state_with_f(1, 0.0, 0.3, DT_STEP, false);
        assert_eq!(
            e.state[STATE_STRIDE + ST_MAX_F_DEV],
            0.0,
            "inactive slot: slot 3 = 0"
        );
        let mut settling = one_element();
        settling.update_rest_state_with_f(0, 0.0, 0.2, 0.0, false);
        settling.settle_if_at_rest(0);
        assert_eq!(alpha(&settling), 0.0, "D67-12 settle also needs F ≈ I");
        settling.update_rest_state_with_f(0, 0.0, 0.0, 0.0, false);
        settling.settle_if_at_rest(0);
        assert_eq!(alpha(&settling), 1.0);
    }

    #[test]
    fn given_rest_alpha_1_when_damaged_then_rest_alpha_is_0_at_once_d74_7() {
        let mut e = one_element();
        for _ in 0..20 {
            e.update_rest_state(0, 0.1, DT_STEP, false);
        }
        assert_eq!(alpha(&e), 1.0);
        e.damage(0, 0.25);
        assert_eq!(
            alpha(&e),
            0.0,
            "an impulse drops restAlpha at once (no 120 ms fade over a hole)"
        );
        assert_eq!(e.rest_hold_s[0], 0.0);
        let mut nan = one_element();
        for _ in 0..20 {
            nan.update_rest_state(0, 0.1, DT_STEP, false);
        }
        nan.damage(0, f32::NAN);
        assert_eq!(alpha(&nan), 1.0, "a NaN cap is a no-op");
    }
}
