//! W80 (D80-1, slice-6 design §3): scroll follows. W80.1 (red) stubs; W80.2 replaces this file.

use super::elements::Elements;
use super::interaction::POINTER_VMAX_PX_S;

/// W80 (D80-1): the inertia's last-line cap in Rust, px/s (the soft pointer field's cap).
pub const SCROLL_INERTIA_VMAX_PX_S: f32 = POINTER_VMAX_PX_S;

/// One frame's scroll, sanitised (`ScrollShift::sanitized`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ScrollShift {
    pub dx_px: f32,
    pub dy_px: f32,
    pub ivx_px_s: f32,
    pub ivy_px_s: f32,
}

impl ScrollShift {
    pub const NONE: ScrollShift = ScrollShift {
        dx_px: 0.0,
        dy_px: 0.0,
        ivx_px_s: 0.0,
        ivy_px_s: 0.0,
    };

    /// W80.1 (red) stub: W80.2 sanitises.
    pub fn sanitized(_dx: f32, _dy: f32, _ivx: f32, _ivy: f32, _rm: bool) -> ScrollShift {
        ScrollShift::NONE
    }

    pub fn is_none(&self) -> bool {
        self.dx_px == 0.0 && self.dy_px == 0.0 && self.ivx_px_s == 0.0 && self.ivy_px_s == 0.0
    }
}

/// W80.1 (red) stub: W80.2 skips a dragged element.
pub fn shifts_with_scroll(_e: &Elements, _id: usize) -> bool {
    true
}
