//! Element table over the TS-written element buffer (spec §2 FFI item 1) and
//! the Rust-written state view (item 4). Element id == slot index.

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
        let e = with([100.0, 200.0, 140.0, 48.0, 24.0, 1.0, 5.0, -3.0, f32::NAN, f32::NAN]);
        let r = e.home_rect(0, false).unwrap();
        let k = 1.0 + HOVER_SWELL;
        assert!((r.w - 140.0 * k).abs() < 1e-4 && (r.h - 48.0 * k).abs() < 1e-4);
        assert!((r.x + r.w / 2.0 - 175.0).abs() < 1e-4 && (r.y + r.h / 2.0 - 221.0).abs() < 1e-4);
        let calm = e.home_rect(0, true).unwrap();
        assert_eq!(calm, Rect { x: 105.0, y: 197.0, w: 140.0, h: 48.0, r: 24.0 });
    }

    #[test]
    fn given_nan_or_zero_slot_when_queried_then_inactive_and_none() {
        let e = with([f32::NAN, 0.0, 10.0, 10.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        assert!(!e.is_active(0) && !e.is_active(1) && !e.is_active(99));
        assert_eq!(e.home_rect(0, false), None);
        assert_eq!(e.target_px(5, 0.5, 0.5, false), None);
    }
}
