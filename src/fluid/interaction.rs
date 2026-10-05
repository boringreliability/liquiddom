//! Splash and shake (spec §2 "Interaction"; W67). W68 adds the soft pointer field here.
//!
//! Both add velocity to particles and damage element stiffness, so the liquid
//! goes soft and then re-forms (T-1000). They draw only from the core's
//! interaction RNG stream: same seed + same call sequence = bit-identical velocities.

use std::f32::consts::TAU;

use super::access::{add, rd, wr};
use super::elements::{Elements, S_FLOOR};
use super::grid::Grid;
use super::particles::Particles;
use super::rng::Rng;

/// Splash speed at strength 1, px/s (D67-3).
pub const SPLASH_SPEED_PX_S: f32 = 950.0;
/// Splash radius = max(110 px, 0.75 · element diagonal) (D67-3).
pub const SPLASH_RADIUS_MIN_PX: f32 = 110.0;
pub const SPLASH_RADIUS_PER_DIAGONAL: f32 = 0.75;
/// Angular jitter per particle (±rad), so the sheet tears into fingers.
pub const SPLASH_ANGLE_JITTER_RAD: f32 = 0.45;
/// Shake speed at strength 1, px/s (D67-3); noise ±0.45 per particle.
pub const SHAKE_SPEED_PX_S: f32 = 520.0;
pub const SHAKE_NOISE: f32 = 0.9;
/// Spec §2: shake sets s ← min(s, 0.4).
pub const SHAKE_STIFFNESS_CAP: f32 = 0.4;
pub const STRENGTH_MAX: f32 = 2.0;

/// The scalars of `FluidCore::splash` (buffer-space px).
#[derive(Clone, Copy, Debug)]
pub struct SplashAt {
    pub id: u32,
    pub x_px: f32,
    pub y_px: f32,
    pub strength: f32,
}

/// Strength in (0, 2]. NaN, ±inf and ≤ 0 → None (D67-8: 0 is a no-op).
pub fn sanitize_strength(strength: f32) -> Option<f32> {
    if !strength.is_finite() || strength <= 0.0 {
        return None;
    }
    Some(strength.min(STRENGTH_MAX))
}

/// Spec §2: splash sets s ← min(s, 0.25·(2 − strength)), at least s_floor.
pub fn splash_stiffness_cap(strength: f32) -> f32 {
    (0.25 * (2.0 - strength)).max(S_FLOOR)
}

/// Two seeded low-frequency angular lobes: jets and fingers instead of a uniform ring.
struct Lobes {
    k1: f32,
    k2: f32,
    phase1: f32,
    phase2: f32,
}

impl Lobes {
    fn draw(rng: &mut Rng) -> Lobes {
        let k1 = 4.0 + (rng.next_f32() * 4.0).floor();
        let k2 = k1 + 2.0 + (rng.next_f32() * 3.0).floor();
        let phase1 = rng.next_f32() * TAU;
        let phase2 = rng.next_f32() * TAU;
        Lobes {
            k1,
            k2,
            phase1,
            phase2,
        }
    }

    /// Angular gain in [0.3, 1.2].
    fn gain(&self, theta: f32) -> f32 {
        let raw = 0.6 * (self.k1 * theta + self.phase1).sin()
            + 0.4 * (self.k2 * theta + self.phase2).sin();
        0.3 + 0.9 * (raw.max(-0.2) + 0.2) / 1.2
    }
}

/// Radial splash on the particles of element `at.id` within the splash radius.
/// Neighbours are hit only by the flying liquid (D67-3). Hit particles get J = 1.
/// Returns false and changes nothing for an inactive or out-of-range id, non-finite
/// coordinates, or a strength that `sanitize_strength` rejects.
pub fn splash(p: &mut Particles, g: &Grid, e: &mut Elements, rng: &mut Rng, at: SplashAt) -> bool {
    let Some(strength) = sanitize_strength(at.strength) else {
        return false;
    };
    if !(at.x_px.is_finite() && at.y_px.is_finite()) {
        return false;
    }
    let id = at.id as usize;
    let Some(rect) = e.rect(id) else {
        return false;
    };
    let radius = SPLASH_RADIUS_MIN_PX.max(SPLASH_RADIUS_PER_DIAGONAL * rect.w.hypot(rect.h));
    let speed = SPLASH_SPEED_PX_S * strength * g.inv_cell;
    let lobes = Lobes::draw(rng);
    for i in 0..p.cap {
        if p.home_of(i) != Some(id) {
            continue;
        }
        let (px, py) = g.to_px(rd(&p.x, i), rd(&p.y, i));
        let (dx, dy) = (px - at.x_px, py - at.y_px);
        let d = dx.hypot(dy);
        if d.is_nan() || d >= radius {
            continue;
        }
        let (ux, uy) = if d > 1e-3 {
            (dx / d, dy / d)
        } else {
            (1.0, 0.0)
        };
        let (sin_a, cos_a) = ((rng.next_f32() - 0.5) * 2.0 * SPLASH_ANGLE_JITTER_RAD).sin_cos();
        let (rx, ry) = (ux * cos_a - uy * sin_a, ux * sin_a + uy * cos_a);
        let gain =
            (1.0 - d / radius).sqrt() * lobes.gain(dy.atan2(dx)) * (0.8 + 0.4 * rng.next_f32());
        add(&mut p.vx, i, rx * speed * gain);
        add(&mut p.vy, i, ry * speed * gain);
        wr(&mut p.j, i, 1.0);
    }
    e.damage(id, splash_stiffness_cap(strength));
    true
}

/// Global shake: each active element gets one seeded direction, each particle gets
/// noise, and every active element goes soft (s ← min(s, 0.4)).
pub fn shake(p: &mut Particles, g: &Grid, e: &mut Elements, rng: &mut Rng, strength: f32) -> bool {
    let Some(strength) = sanitize_strength(strength) else {
        return false;
    };
    let speed = SHAKE_SPEED_PX_S * strength * g.inv_cell;
    let stream = rng.next_u32();
    for i in 0..p.cap {
        let Some(h) = p.home_of(i) else {
            continue;
        };
        if !e.is_active(h) {
            continue;
        }
        let angle = Rng::derive(stream, u32::try_from(h).unwrap_or(u32::MAX)).next_f32() * TAU;
        let (dir_y, dir_x) = angle.sin_cos();
        let nx = rng.next_f32() - 0.5;
        let ny = rng.next_f32() - 0.5;
        add(&mut p.vx, i, (dir_x + SHAKE_NOISE * nx) * speed);
        add(&mut p.vy, i, (dir_y + SHAKE_NOISE * ny) * speed);
    }
    for id in 0..e.cap {
        if e.is_active(id) {
            e.damage(id, SHAKE_STIFFNESS_CAP);
        }
    }
    true
}

#[cfg(test)]
mod w67_tests {
    use crate::fluid::api::FluidCore;
    use crate::fluid::elements::S_FLOOR;
    use crate::fluid::layout::ELEMENT_STRIDE;

    const BUTTON: [f32; ELEMENT_STRIDE] = [
        100.0,
        100.0,
        140.0,
        48.0,
        24.0,
        0.0,
        0.0,
        0.0,
        f32::NAN,
        f32::NAN,
    ];
    const BUTTON_2: [f32; ELEMENT_STRIDE] = [
        300.0,
        100.0,
        140.0,
        48.0,
        24.0,
        0.0,
        0.0,
        0.0,
        f32::NAN,
        f32::NAN,
    ];
    const CENTRE: (f32, f32) = (170.0, 124.0);
    /// rounded_rect_area(140, 48, 24) ≈ 6226 px² per button; the tallest element is 48 px.
    const BUTTON_AREA_PX2: f32 = 6_226.0;
    const BUTTON_H_PX: f32 = 48.0;

    fn button_core(seed: u32) -> FluidCore {
        let mut core = FluidCore::new(2000, 4, 640.0, 480.0, BUTTON_AREA_PX2, BUTTON_H_PX, seed);
        core.write_element(0, BUTTON);
        core.redistribute();
        core
    }

    fn two_button_core(seed: u32) -> FluidCore {
        let mut core = FluidCore::new(
            2000,
            4,
            640.0,
            480.0,
            2.0 * BUTTON_AREA_PX2,
            BUTTON_H_PX,
            seed,
        );
        core.write_element(0, BUTTON);
        core.write_element(1, BUTTON_2);
        core.redistribute();
        core
    }

    fn mean_velocity(core: &FluidCore, id: u32) -> (f32, f32) {
        let ids = core.particle_indices_of(id);
        let n = ids.len().max(1) as f32;
        let (sx, sy) = ids.iter().fold((0.0f32, 0.0f32), |(ax, ay), &i| {
            let (vx, vy) = core.particle_vel_px_s(i);
            (ax + vx, ay + vy)
        });
        (sx / n, sy / n)
    }

    #[test]
    fn given_splash_when_applied_then_hit_particles_get_j_1_and_outward_velocity_with_seeded_lobes()
    {
        let mut core = button_core(7);
        let ids = core.particle_indices_of(0);
        assert!(ids.len() > 1000);
        for &i in &ids {
            core.set_particle_j(i, 0.8);
        }
        core.splash(0, CENTRE.0, CENTRE.1, 1.0);
        let mut band = Vec::new();
        for &i in &ids {
            assert!(
                (core.particle_j(i) - 1.0).abs() < 1e-7,
                "J reset to 1 for hit particle {i}"
            );
            let (px, py) = core.particle_px(i);
            let (vx, vy) = core.particle_vel_px_s(i);
            let (dx, dy) = (px - CENTRE.0, py - CENTRE.1);
            let d = dx.hypot(dy);
            if d > 2.0 {
                assert!(dx * vx + dy * vy > 0.0, "particle {i} moves outward");
            }
            if (30.0..40.0).contains(&d) {
                band.push(vx.hypot(vy));
            }
        }
        assert!(band.len() > 20);
        let max = band.iter().copied().fold(0.0f32, f32::max);
        let min = band.iter().copied().fold(f32::INFINITY, f32::min);
        assert!(
            max > 1.5 * min,
            "angular lobes: speeds in the 30–40 px band vary (min {min}, max {max})"
        );
    }

    #[test]
    fn given_same_seed_when_splashing_twice_then_identical_velocities() {
        let mut a = button_core(7);
        let mut b = button_core(7);
        let mut c = button_core(8);
        for core in [&mut a, &mut b, &mut c] {
            core.splash(0, CENTRE.0, CENTRE.1, 1.0);
        }
        assert_eq!(a.velocity_bits(), b.velocity_bits());
        assert_ne!(
            a.velocity_bits(),
            c.velocity_bits(),
            "another seed gives other lobes"
        );
    }

    #[test]
    fn given_invalid_id_or_nan_coords_when_splash_then_no_op() {
        let mut core = button_core(7);
        let before = core.velocity_bits();
        core.splash(9, CENTRE.0, CENTRE.1, 1.0);
        core.splash(2, CENTRE.0, CENTRE.1, 1.0);
        core.splash(u32::MAX, CENTRE.0, CENTRE.1, 1.0);
        core.splash(0, f32::NAN, CENTRE.1, 1.0);
        core.splash(0, CENTRE.0, f32::INFINITY, 1.0);
        core.splash(0, CENTRE.0, CENTRE.1, f32::NAN);
        assert_eq!(core.velocity_bits(), before);
        assert!((core.stiffness_of(0) - 1.0).abs() < 1e-7);
    }

    #[test]
    fn given_shake_when_applied_then_each_element_gets_seeded_direction_plus_particle_noise() {
        let mut core = two_button_core(7);
        core.shake(1.0);
        for id in [0u32, 1] {
            let (mx, my) = mean_velocity(&core, id);
            let speed = mx.hypot(my);
            assert!(
                (speed - 520.0).abs() < 52.0,
                "element {id}: mean speed {speed} ≈ 520 px/s"
            );
            let ids = core.particle_indices_of(id);
            let var = ids.iter().fold(0.0f32, |acc, &i| {
                let (vx, vy) = core.particle_vel_px_s(i);
                acc + (vx - mx).powi(2) + (vy - my).powi(2)
            }) / ids.len().max(1) as f32;
            assert!(
                var.sqrt() > 20.0,
                "element {id}: per-particle noise present ({})",
                var.sqrt()
            );
        }
        let mut same = two_button_core(7);
        same.shake(1.0);
        assert_eq!(core.velocity_bits(), same.velocity_bits());
        let mut other = two_button_core(8);
        other.shake(1.0);
        let (ax, ay) = mean_velocity(&core, 0);
        let (bx, by) = mean_velocity(&other, 0);
        assert!(
            (ay.atan2(ax) - by.atan2(bx)).abs() > 1e-3,
            "the direction is seeded"
        );
    }

    #[test]
    fn given_reduced_motion_when_splash_or_shake_then_ignored() {
        let mut core = button_core(7);
        core.set_reduced_motion(true);
        core.splash(0, CENTRE.0, CENTRE.1, 2.0);
        core.shake(2.0);
        assert!(
            core.velocity_bits()
                .iter()
                .all(|&b| f32::from_bits(b).abs() < f32::MIN_POSITIVE)
        );
        assert!((core.stiffness_of(0) - 1.0).abs() < 1e-7);
        assert_eq!(
            core.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0),
            0,
            "D64-4: 0 steps under RM"
        );
        assert!(core.rest_alphas().iter().all(|&a| a == 1.0));
    }

    #[test]
    fn given_splash_strength_1_when_damaged_then_s_at_most_0_25() {
        let mut core = button_core(7);
        core.splash(0, CENTRE.0, CENTRE.1, 1.0);
        assert!(
            core.stiffness_of(0) <= 0.25 + 1e-6,
            "{}",
            core.stiffness_of(0)
        );
    }

    #[test]
    fn given_splash_strength_2_when_damaged_then_s_equals_floor_0_015() {
        let mut core = button_core(7);
        core.splash(0, CENTRE.0, CENTRE.1, 2.0);
        assert!((core.stiffness_of(0) - S_FLOOR).abs() < 1e-7);
    }

    #[test]
    fn given_shake_when_damaged_then_s_at_most_0_4() {
        let mut core = two_button_core(7);
        core.shake(1.0);
        assert!(core.stiffness_of(0) <= 0.4 + 1e-6);
        assert!(core.stiffness_of(1) <= 0.4 + 1e-6);
    }

    #[test]
    fn given_strength_0_when_splash_or_shake_then_no_op() {
        let mut core = button_core(7);
        let before = core.velocity_bits();
        core.splash(0, CENTRE.0, CENTRE.1, 0.0);
        core.shake(0.0);
        assert_eq!(core.velocity_bits(), before);
        assert!(
            (core.stiffness_of(0) - 1.0).abs() < 1e-7,
            "D67-8: no damage at strength 0"
        );
    }

    #[test]
    fn given_d67_3_constants_when_read_then_splash_and_shake_values_pinned() {
        use crate::fluid::interaction::{
            SHAKE_NOISE, SHAKE_SPEED_PX_S, SHAKE_STIFFNESS_CAP, SPLASH_RADIUS_MIN_PX,
            SPLASH_RADIUS_PER_DIAGONAL, SPLASH_SPEED_PX_S, STRENGTH_MAX,
        };
        assert_eq!(SPLASH_SPEED_PX_S, 950.0, "speed 950 px/s · strength");
        assert_eq!(SPLASH_RADIUS_MIN_PX, 110.0, "radius floor 110 px");
        assert_eq!(SPLASH_RADIUS_PER_DIAGONAL, 0.75);
        assert_eq!(SHAKE_SPEED_PX_S, 520.0);
        assert_eq!(SHAKE_NOISE, 0.9);
        assert_eq!(SHAKE_STIFFNESS_CAP, 0.4);
        assert_eq!(STRENGTH_MAX, 2.0);
    }
}
