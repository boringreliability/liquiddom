//! W82 (D82-5): the viewport in buffer px, for the shake's edge mirror.
//!
//! Rust stays DOM-blind: TS passes the visible window's size (`innerWidth × innerHeight` in body
//! mode, the container's client box in container mode) through `FluidCore::set_viewport(w, h)`,
//! at `create()` and from every `resizeCanvas()`. Buffer space starts at the viewport's top-left
//! corner, so the viewport is `[0, w] × [0, h]`. The world stays `max(screen, inner)` (W81).
//!
//! The rule: when an element's home rect lies within `EDGE_MIRROR_PX` of a viewport edge, the
//! outward component of its shake direction is mirrored, so it sloshes inward instead of being
//! clipped flat at the edge (W82.0 Q3: the landing's dark card and "Sign in"). An element farther
//! than `EDGE_MIRROR_PX` from every edge keeps its direction bit for bit.

use super::elements::Rect;
use super::grid::WORLD_MAX_PX;

/// D82-5: an edge this close to the home rect mirrors the shake's outward component (px). It is
/// above the measured shake travel at strength 1 (69 px, W82.0 Q3).
pub const EDGE_MIRROR_PX: f32 = 80.0;

/// The viewport extent per axis in buffer px; 0 = unknown (no mirror on that axis).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Viewport {
    pub w: f32,
    pub h: f32,
}

impl Viewport {
    /// Before the first `set_viewport`: no mirror at all (a core driven without TS, e.g. the Rust
    /// tests, behaves exactly as before W82).
    pub const UNKNOWN: Viewport = Viewport { w: 0.0, h: 0.0 };

    /// Per axis: a finite, positive extent is kept, clamped to `WORLD_MAX_PX`; NaN, ±Inf, 0 and
    /// negative values give 0 (unknown).
    pub fn sanitized(w: f32, h: f32) -> Viewport {
        let _ = (w, h, WORLD_MAX_PX); // W82.1 red stub: W82.2 keeps the finite, positive extents
        Viewport::UNKNOWN
    }
}

/// One axis: `d` is the direction component, `[lo, hi]` the rect's extent, `extent` the
/// viewport's. Near the low edge a negative `d` flips, near the high edge a positive one; a rect
/// near both edges of an axis (nothing is inward), an unknown extent or a non-finite rect keeps `d`.
fn mirror_axis(d: f32, lo: f32, hi: f32, extent: f32) -> f32 {
    let _ = (lo, hi, extent); // W82.1 red stub: W82.2 mirrors the outward component
    d
}

/// D82-5: the shake direction `(dx, dy)` of an element whose home rect is `r` (buffer px), with
/// its outward components mirrored near the viewport's edges.
pub fn mirror_outward(dx: f32, dy: f32, r: &Rect, vp: Viewport) -> (f32, f32) {
    (
        mirror_axis(dx, r.x, r.x + r.w, vp.w),
        mirror_axis(dy, r.y, r.y + r.h, vp.h),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fluid::api::FluidCore;
    use crate::fluid::scenario_tests::slot;

    const VW: f32 = 1280.0;
    const VH: f32 = 800.0;
    const VP: Viewport = Viewport { w: VW, h: VH };

    #[test]
    fn given_set_viewport_values_when_sanitized_then_finite_positive_extents_are_kept_up_to_world_max_and_the_rest_is_unknown()
     {
        assert_eq!(Viewport::sanitized(1280.0, 800.0), VP);
        assert_eq!(
            Viewport::sanitized(1e9, 0.5),
            Viewport {
                w: WORLD_MAX_PX,
                h: 0.5
            }
        );
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, 0.0, -0.0, -10.0] {
            assert_eq!(
                Viewport::sanitized(bad, 800.0),
                Viewport { w: 0.0, h: 800.0 },
                "w {bad}"
            );
            assert_eq!(
                Viewport::sanitized(1280.0, bad),
                Viewport { w: 1280.0, h: 0.0 },
                "h {bad}"
            );
        }
        let mut c = FluidCore::new(256, 4, 1280.0, 800.0, 0.0, 0.0, 1);
        assert_eq!(
            c.viewport_of(),
            Viewport::UNKNOWN,
            "no mirror before the first call"
        );
        c.set_viewport(1440.0, f32::NAN);
        assert_eq!(c.viewport_of(), Viewport { w: 1440.0, h: 0.0 });
        c.set_viewport(1280.0, 800.0);
        assert_eq!(c.viewport_of(), VP);
    }

    #[test]
    fn given_a_home_rect_within_80_px_of_a_viewport_edge_when_mirrored_then_only_the_outward_component_flips()
     {
        // The landing's dark card: right edge 64 px from the viewport's (x 848–1216).
        let card = (848.0, 488.0, 368.0, 196.0);
        let m = |dx: f32, dy: f32, (x, y, w, h): (f32, f32, f32, f32)| {
            mirror_outward(dx, dy, &Rect { x, y, w, h, r: 0.0 }, VP)
        };
        assert_eq!(m(0.6, 0.8, card), (-0.6, 0.8), "outward right flips");
        assert_eq!(m(-0.6, 0.8, card), (-0.6, 0.8), "inward stays");
        // "Sign in": 36 px from the top.
        let pill = (1100.0, 18.0, 96.0, 40.0);
        assert_eq!(m(0.3, -0.95, pill), (0.3, 0.95), "outward up flips");
        assert_eq!(m(0.3, 0.95, pill), (0.3, 0.95));
        // Left and bottom edges; both axes at a corner.
        assert_eq!(m(-1.0, 0.0, (40.0, 300.0, 100.0, 40.0)), (1.0, 0.0));
        assert_eq!(m(0.0, 1.0, (500.0, 700.0, 100.0, 40.0)), (0.0, -1.0));
        assert_eq!(m(0.6, 0.8, (1180.0, 740.0, 60.0, 30.0)), (-0.6, -0.8));
        // The bound: 79 px is near, 81 px is not.
        assert_eq!(m(1.0, 0.0, (601.0, 300.0, 600.0, 40.0)), (-1.0, 0.0));
        assert_eq!(m(1.0, 0.0, (599.0, 300.0, 600.0, 40.0)), (1.0, 0.0));
        // Farther than 80 px from every edge: bit-identical.
        let (dx, dy) = (0.123_456_7_f32, -0.987_654_3_f32);
        let far = m(dx, dy, (300.0, 200.0, 400.0, 300.0));
        assert_eq!(
            (far.0.to_bits(), far.1.to_bits()),
            (dx.to_bits(), dy.to_bits())
        );
        // Near both edges of an axis (nothing is inward), an unknown axis, a non-finite rect: unchanged.
        assert_eq!(m(1.0, 0.0, (20.0, 300.0, 1240.0, 40.0)), (1.0, 0.0));
        let corner = Rect {
            x: 1250.0,
            y: 10.0,
            w: 20.0,
            h: 20.0,
            r: 0.0,
        };
        assert_eq!(
            mirror_outward(1.0, -1.0, &corner, Viewport::UNKNOWN),
            (1.0, -1.0)
        );
        assert_eq!(m(1.0, -1.0, (f32::NAN, f32::NAN, 20.0, 20.0)), (1.0, -1.0));
        // Fix round 1 (a): exactly 80 px from the edge is not near (strict <). Right gap 80, left gap 600.
        assert_eq!(m(1.0, 0.0, (600.0, 300.0, 600.0, 40.0)), (1.0, 0.0));
        // (b): a rect entirely beyond the right edge is nearest the edge: its outward x flips.
        assert_eq!(m(1.0, 0.0, (1300.0, 300.0, 50.0, 40.0)), (-1.0, 0.0));
        // (c): a partially unknown viewport mirrors the known axis only.
        let half = Viewport { w: 1280.0, h: 0.0 };
        let r = Rect {
            x: 1180.0,
            y: 740.0,
            w: 60.0,
            h: 30.0,
            r: 0.0,
        };
        assert_eq!(mirror_outward(0.6, 0.8, &r, half), (-0.6, 0.8));
    }

    /// Mean x and y velocity (px/s) of element `id`'s particles.
    fn mean_vel(c: &FluidCore, id: u32) -> (f32, f32) {
        let ids = c.particle_indices_of(id);
        let n = ids.len().max(1) as f32;
        let (sx, sy) = ids.iter().fold((0.0f32, 0.0f32), |(ax, ay), &i| {
            let (vx, vy) = c.particle_vel_px_s(i);
            (ax + vx, ay + vy)
        });
        (sx / n, sy / n)
    }

    /// A pill near the right edge (id 0) and a card far from every edge (id 1), 1280×800.
    fn edge_core(seed: u32, viewport: bool) -> FluidCore {
        let mut c = FluidCore::new(4000, 4, 1280.0, 800.0, 40_000.0, 160.0, seed);
        c.write_element(0, slot([1100.0, 360.0, 140.0, 48.0, 24.0]));
        c.write_element(1, slot([400.0, 300.0, 320.0, 160.0, 16.0]));
        c.redistribute();
        if viewport {
            c.set_viewport(1280.0, 800.0);
        }
        c
    }

    #[test]
    fn given_an_element_40_px_from_the_right_edge_whose_shake_points_outward_when_shaken_with_the_viewport_then_its_x_velocity_is_mirrored_bit_for_bit_and_the_far_card_is_untouched()
     {
        // Seeds are deterministic: find the first whose direction for the pill points right.
        let seed = (1..64)
            .find(|&s| {
                let mut c = edge_core(s, false);
                c.shake(1.0);
                mean_vel(&c, 0).0 > 1.0
            })
            .expect("a seed whose pill shakes outward");
        let mut plain = edge_core(seed, false);
        let mut mirrored = edge_core(seed, true);
        plain.shake(1.0);
        mirrored.shake(1.0);
        for &i in &plain.particle_indices_of(0) {
            let (pvx, pvy) = plain.particle_vel_px_s(i);
            let (mvx, mvy) = mirrored.particle_vel_px_s(i);
            assert_eq!(mvx.to_bits(), (-pvx).to_bits(), "particle {i}: vx mirrored");
            assert_eq!(mvy.to_bits(), pvy.to_bits(), "particle {i}: vy kept");
        }
        for &i in &plain.particle_indices_of(1) {
            let (p, m) = (plain.particle_vel_px_s(i), mirrored.particle_vel_px_s(i));
            assert_eq!(
                (p.0.to_bits(), p.1.to_bits()),
                (m.0.to_bits(), m.1.to_bits()),
                "particle {i}: far from every edge, bit-identical"
            );
        }
        // Inward now: no particle of the pill reaches past the right edge while it sloshes.
        let mut worst = f32::MIN;
        for _ in 0..40 {
            mirrored.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0);
            for &i in &mirrored.particle_indices_of(0) {
                worst = worst.max(mirrored.particle_px(i).0);
            }
        }
        assert!(
            worst <= 1280.0,
            "the pill stays inside the viewport: max x {worst}"
        );
    }

    #[test]
    fn given_no_element_within_80_px_of_an_edge_when_shaken_and_ticked_with_and_without_the_viewport_then_the_core_is_bit_identical()
     {
        let run = |viewport: bool| {
            let mut c = crate::fluid::scenario_tests::acceptance_core(1);
            if viewport {
                c.set_viewport(1280.0, 800.0);
            }
            c.shake(2.0);
            crate::fluid::scenario_tests::frames(&mut c, 60);
            c.dynamic_view()
                .iter()
                .map(|v| v.to_bits())
                .collect::<Vec<_>>()
        };
        assert_eq!(run(false), run(true));
    }

    #[test]
    fn given_reduced_motion_when_set_viewport_and_shake_then_nothing_moves() {
        let mut c = edge_core(1, true);
        c.set_reduced_motion(true);
        c.shake(2.0);
        for &i in &c.particle_indices_of(0) {
            assert_eq!(c.particle_vel_px_s(i), (0.0, 0.0), "particle {i}");
        }
    }
}
