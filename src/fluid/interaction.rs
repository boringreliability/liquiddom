//! Splash and shake (spec §2 "Interaction"; W67). Implementation: Task W67.8.

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
}
