//! Element table over the TS-written element buffer (spec §2 FFI item 1) and
//! the Rust-written state view (item 4). Element id == slot index.

use super::access::{finite_or, positive, rd, rd_or, wr};
use super::layout::{
    EL_H, EL_HOME_DX, EL_HOME_DY, EL_INTERACTION, EL_RADIUS, EL_RECOVERY, EL_VISCOSITY, EL_W, EL_X,
    EL_Y, ELEMENT_STRIDE, HOVER_SWELL, INTERACTION_HOVER, ST_MAX_DEV, ST_RESERVED, ST_REST_ALPHA,
    ST_S, STATE_STRIDE,
};
use super::sampling::clamp_radius;

pub const S_FLOOR: f32 = 0.015;
pub const REST_S_MIN: f32 = 0.98;
pub const REST_MAX_DEV_PX: f32 = 0.75;
pub const REST_HOLD_S: f32 = 0.150;
pub const REST_FADE_S: f32 = 0.120;

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
    pub stiffness: Vec<f32>,
    pub rest_w: Vec<f32>,
    pub rest_h: Vec<f32>,
    pub counts: Vec<u32>,
    pub area_per_particle: Vec<f32>,
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
            stiffness: vec![1.0; cap],
            rest_w: vec![0.0; cap],
            rest_h: vec![0.0; cap],
            counts: vec![0; cap],
            area_per_particle: vec![0.0; cap],
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
    /// lives in TS as `homeRect()` in `fluid-layout.ts`.
    pub fn home_rect(&self, id: usize, reduced_motion: bool) -> Option<Rect> {
        let r = self.rect(id)?;
        let mut out = Rect {
            x: r.x + finite_or(self.field(id, EL_HOME_DX), 0.0),
            y: r.y + finite_or(self.field(id, EL_HOME_DY), 0.0),
            ..r
        };
        let hovered = (self.field(id, EL_INTERACTION) - INTERACTION_HOVER).abs() < 0.5;
        if hovered && !reduced_motion {
            let k = 1.0 + HOVER_SWELL;
            out.x -= 0.5 * (r.w * k - r.w);
            out.y -= 0.5 * (r.h * k - r.h);
            out.w = r.w * k;
            out.h = r.h * k;
            out.r = r.r * k;
        }
        Some(out)
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

    /// Rect velocity from the rect delta over `dt` (px/s). Inactive slots reset.
    pub fn update_velocities(&mut self, dt: f32) {
        for id in 0..self.cap {
            let had_prev = self.has_prev.get(id).copied().unwrap_or(false);
            let (vx, vy, px, py, has) = match self.rect(id) {
                Some(r) if had_prev && dt > 0.0 => (
                    (r.x - rd(&self.prev_x, id)) / dt,
                    (r.y - rd(&self.prev_y, id)) / dt,
                    r.x,
                    r.y,
                    true,
                ),
                Some(r) => (0.0, 0.0, r.x, r.y, true),
                None => (0.0, 0.0, 0.0, 0.0, false),
            };
            wr(&mut self.vel_x, id, vx);
            wr(&mut self.vel_y, id, vy);
            wr(&mut self.prev_x, id, px);
            wr(&mut self.prev_y, id, py);
            if let Some(slot) = self.has_prev.get_mut(id) {
                *slot = has;
            }
        }
    }

    /// `s ← max(min(s, cap), S_FLOOR)` (spec §2 stiffness damage).
    pub fn damage(&mut self, id: usize, cap: f32) {
        if let Some(s) = self.stiffness.get_mut(id) {
            let capped = s.min(cap);
            *s = if capped < S_FLOOR { S_FLOOR } else { capped };
        }
    }

    /// W64 (decision D64-2): binary rest state, `restAlpha = 1` when
    /// `s > 0.98 && maxDev < 0.75 px` (always under reduced motion), else 0.
    /// W67 replaces this with the 150 ms hold and the 120 ms fade.
    pub fn update_rest_state(&mut self, id: usize, max_dev: f32, _dt: f32, reduced_motion: bool) {
        if id >= self.cap {
            return;
        }
        let base = id * STATE_STRIDE;
        if !self.is_active(id) {
            wr(&mut self.state, base + ST_S, 1.0);
            wr(&mut self.state, base + ST_MAX_DEV, 0.0);
            wr(&mut self.state, base + ST_REST_ALPHA, 0.0);
            wr(&mut self.state, base + ST_RESERVED, 0.0);
            return;
        }
        let s = rd_or(&self.stiffness, id, 1.0);
        let dev = if reduced_motion {
            0.0
        } else {
            finite_or(max_dev, f32::MAX)
        };
        let at_rest = reduced_motion || (s > REST_S_MIN && dev < REST_MAX_DEV_PX);
        wr(&mut self.state, base + ST_S, s);
        wr(&mut self.state, base + ST_MAX_DEV, dev);
        wr(
            &mut self.state,
            base + ST_REST_ALPHA,
            if at_rest { 1.0 } else { 0.0 },
        );
        wr(&mut self.state, base + ST_RESERVED, 0.0);
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

    #[test]
    fn given_nan_or_zero_slot_when_queried_then_inactive_and_none() {
        let e = with([f32::NAN, 0.0, 10.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        assert!(!e.is_active(0) && !e.is_active(1) && !e.is_active(99));
        assert_eq!(e.home_rect(0, false), None);
        assert_eq!(e.target_px(5, 0.5, 0.5, false), None);
    }
}
