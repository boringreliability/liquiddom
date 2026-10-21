//! W83 (D83-1, D83-2, D83-4): gravity as a high-pass, so only changes in gravity act.
//!
//! TS hands the page's gravity to every `tick(…, gx, gy)` in px/s² (CSS axes: x right, y down;
//! `strength · normalize(vector)` for `fixed`, the projected device tilt for `orientation`, 0 for
//! `none` and under reduced motion). Rust keeps a low-pass `g_lp` per core (f64, advanced once per
//! fixed step with `a = 1 − exp(−FIXED_DT/τ)`, so a 0-step tick changes nothing and the result does
//! not depend on the frame rate) and hands the grid `GRAVITY_SCALE · (g − g_lp)`, clamped to
//! `GRAVITY_CLAMP_PX_S2`, for the cells with mass (`Grid::update_velocities`, after momentum →
//! velocity, before the walls and the CFL cap). A constant gravity therefore moves nothing: a
//! change sloshes the liquid and the unchanged home spring brings it home (D83-1, a subtle lean).
//! Below `GRAVITY_SNAP_PX_S2` the high-pass snaps to exactly 0 (`g_lp = g`), so ≈ 8τ after a change
//! the engine runs bit-identical to a core without gravity (W83.0 Q4: a low-pass alone never
//! reaches g). `seed` (`FluidCore::seed_gravity`) sets `g_lp = g`: TS seeds at `create()`, on a
//! source switch, on the first orientation reading and when reduced motion ends (D83-4), so none
//! of them sloshes. Under reduced motion `tick` seeds on every call (no gravity acts).

use super::clock::FIXED_DT_S;

/// D83-2: the high-passed gravity is scaled by this before it reaches the grid.
pub const GRAVITY_SCALE: f32 = 1.5;
/// D83-2: the low-pass time constant (s).
pub const GRAVITY_TAU_S: f32 = 0.5;
/// D83-1: `|GRAVITY_SCALE · g_hp|` is clamped to this (px/s²), below the home spring's saturation
/// (`a_max` 3200 px/s² at full stiffness), so the liquid never leaves its element (W83.0 Q1).
pub const GRAVITY_CLAMP_PX_S2: f32 = 2000.0;
/// D83-1: `|g_hp|` below this (px/s²) snaps to exactly 0 (a lean ≤ 0.003 px at scale 1.5).
pub const GRAVITY_SNAP_PX_S2: f32 = 0.5;
/// Input sanitising: each axis of g is clamped to ± this (px/s²); NaN and ±Inf give 0.
pub const GRAVITY_INPUT_MAX_PX_S2: f32 = 1.0e5;

/// Per axis: a finite value is clamped to ±`GRAVITY_INPUT_MAX_PX_S2`; NaN and ±Inf give 0.
pub fn sanitized(gx: f32, gy: f32) -> (f32, f32) {
    let axis = |v: f32| {
        if v.is_finite() {
            v.clamp(-GRAVITY_INPUT_MAX_PX_S2, GRAVITY_INPUT_MAX_PX_S2)
        } else {
            0.0
        }
    };
    (axis(gx), axis(gy))
}

/// The low-pass step `a = 1 − exp(−FIXED_DT/τ)` (per fixed step).
fn low_pass_alpha() -> f64 {
    1.0 - (-f64::from(FIXED_DT_S) / f64::from(GRAVITY_TAU_S)).exp()
}

/// The per-core gravity low-pass of D83-1 (px/s², f64).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HighPass {
    lp_x: f64,
    lp_y: f64,
}

impl Default for HighPass {
    /// `g_lp = 0`: a core nobody seeds treats its first gravity as a change.
    fn default() -> HighPass {
        HighPass {
            lp_x: 0.0,
            lp_y: 0.0,
        }
    }
}

impl HighPass {
    /// D83-4: `g_lp = g` (sanitised), so the next step with the same g returns exactly 0.
    pub fn seed(&mut self, gx: f32, gy: f32) {
        let (x, y) = sanitized(gx, gy);
        self.lp_x = f64::from(x);
        self.lp_y = f64::from(y);
    }

    /// The low-pass `g_lp` (px/s²).
    pub fn low_pass(&self) -> (f64, f64) {
        (self.lp_x, self.lp_y)
    }

    /// One fixed step with gravity `g` (px/s², sanitised): returns the body acceleration for the
    /// grid, `GRAVITY_SCALE · (g − g_lp)` clamped to `GRAVITY_CLAMP_PX_S2` along its direction
    /// (px/s²), then advances the low-pass by `a · (g − g_lp)`. Below `GRAVITY_SNAP_PX_S2` it sets
    /// `g_lp = g` and returns exactly `(0, 0)`.
    pub fn step(&mut self, gx: f32, gy: f32) -> (f32, f32) {
        let (x, y) = sanitized(gx, gy);
        let (gx, gy) = (f64::from(x), f64::from(y));
        let (hx, hy) = (gx - self.lp_x, gy - self.lp_y);
        let snap = f64::from(GRAVITY_SNAP_PX_S2);
        if hx * hx + hy * hy < snap * snap {
            // W83.0 Q4: exactly 0 from here on, so the grid skips gravity bit for bit.
            self.lp_x = gx;
            self.lp_y = gy;
            return (0.0, 0.0);
        }
        let scale = f64::from(GRAVITY_SCALE);
        let (mut ax, mut ay) = (scale * hx, scale * hy);
        let norm = ax.hypot(ay);
        let clamp = f64::from(GRAVITY_CLAMP_PX_S2);
        if norm > clamp {
            ax *= clamp / norm;
            ay *= clamp / norm;
        }
        let a = low_pass_alpha();
        self.lp_x += a * hx;
        self.lp_y += a * hy;
        (ax as f32, ay as f32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fluid::api::FluidCore;
    use crate::fluid::scenario_tests::{AREA_HINT_PX2, CARD, LAYOUT, SEED, acceptance_core, slot};

    const DT: f32 = 1.0 / 60.0;
    /// Portrait upright: straight down.
    const DOWN: (f32, f32) = (0.0, 980.0);
    /// A 90° tilt from DOWN: to the right.
    const SIDE: (f32, f32) = (980.0, 0.0);
    /// A 90° step at full strength snaps after 239 fixed steps (W83.0 Q4: 1386 px/s² · e^(−k/30) < 0.5).
    const SNAP_FRAMES: u32 = 240;

    fn tick_g(c: &mut FluidCore, (gx, gy): (f32, f32)) {
        assert_eq!(c.tick(DT, -1.0e4, -1.0e4, 0.0, 0.0, false, gx, gy), 1);
    }

    fn centre(id: usize) -> (f32, f32) {
        let [x, y, w, h, _] = LAYOUT[id];
        (x + 0.5 * w, y + 0.5 * h)
    }

    /// Positions, velocities and the dynamic view (x, y, F, flags), bit for bit.
    fn state_bits(c: &FluidCore) -> Vec<u32> {
        let mut v = c.position_bits();
        v.extend(c.velocity_bits());
        v.extend(c.dynamic_view().iter().map(|x| x.to_bits()));
        v
    }

    #[test]
    fn given_the_approved_decisions_when_reading_the_gravity_constants_then_they_equal_the_literals()
     {
        assert_eq!(GRAVITY_SCALE, 1.5, "D83-2");
        assert_eq!(GRAVITY_TAU_S, 0.5, "D83-2");
        assert_eq!(GRAVITY_CLAMP_PX_S2, 2000.0, "D83-1");
        assert_eq!(GRAVITY_SNAP_PX_S2, 0.5, "D83-1");
        assert_eq!(GRAVITY_INPUT_MAX_PX_S2, 1.0e5);
    }

    #[test]
    fn given_gravity_input_when_sanitized_then_finite_values_are_kept_up_to_1e5_and_nan_or_inf_gives_0()
     {
        assert_eq!(sanitized(300.0, -500.0), (300.0, -500.0));
        assert_eq!(sanitized(1.0e9, -1.0e9), (1.0e5, -1.0e5));
        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            assert_eq!(sanitized(bad, 980.0), (0.0, 980.0), "gx {bad}");
            assert_eq!(sanitized(980.0, bad), (980.0, 0.0), "gy {bad}");
        }
        let mut hp = HighPass::default();
        hp.seed(f32::NAN, 980.0);
        assert_eq!(hp.low_pass(), (0.0, 980.0));
    }

    #[test]
    fn given_a_90_degree_step_when_the_high_pass_steps_then_it_starts_at_the_scaled_change_decays_with_tau_and_snaps_to_exactly_0()
     {
        // Strength 600: the change (600, −600) scaled by 1.5 stays below the clamp.
        let mut hp = HighPass::default();
        hp.seed(0.0, 600.0);
        assert_eq!(
            hp.step(0.0, 600.0),
            (0.0, 0.0),
            "a constant gravity moves nothing"
        );
        assert_eq!(hp.step(600.0, 0.0), (900.0, -900.0), "1.5 · (g − g_lp)");
        // After τ = 30 fixed steps the change has decayed to e⁻¹ (a = 1 − e^(−1/30)).
        for _ in 1..30 {
            hp.step(600.0, 0.0);
        }
        let (ax, ay) = hp.step(600.0, 0.0);
        let expected = 900.0 * (-1.0f32).exp();
        assert!(
            (ax - expected).abs() < 0.01 && (ay + expected).abs() < 0.01,
            "after τ: ({ax}, {ay}), expected ±{expected}"
        );
        // |g − g_lp| = 849 · e^(−k/30) < 0.5 from k = 224 on: then exactly 0, for good.
        let mut snapped = None;
        for k in 31..400 {
            if hp.step(600.0, 0.0) == (0.0, 0.0) {
                snapped = Some(k);
                break;
            }
        }
        let k = snapped.expect("the high-pass snaps");
        assert!((220..=228).contains(&k), "snapped at step {k}");
        assert_eq!(hp.low_pass(), (600.0, 0.0), "the snap sets g_lp = g");
        for _ in 0..60 {
            let (ax, ay) = hp.step(600.0, 0.0);
            assert_eq!((ax.to_bits(), ay.to_bits()), (0, 0));
        }
    }

    #[test]
    fn given_a_180_degree_flip_at_double_strength_when_stepped_then_the_output_is_clamped_to_2000_px_s2_along_the_change()
     {
        let mut hp = HighPass::default();
        hp.seed(0.0, 1960.0);
        let (ax, ay) = hp.step(0.0, -1960.0);
        assert_eq!(ax, 0.0);
        assert!((ay + 2000.0).abs() < 1e-3, "clamped: {ay}");
        // A 90° step at full strength: 1.5 · 1386 = 2079 px/s², clamped, direction (1, −1) kept.
        let mut hp = HighPass::default();
        hp.seed(DOWN.0, DOWN.1);
        let (ax, ay) = hp.step(SIDE.0, SIDE.1);
        assert!((ax.hypot(ay) - 2000.0).abs() < 1e-2, "|a| {}", ax.hypot(ay));
        assert!((ax + ay).abs() < 1e-3, "along (1, −1): ({ax}, {ay})");
    }

    #[test]
    fn given_a_seeded_low_pass_when_stepped_with_the_same_gravity_then_every_step_returns_exactly_0()
     {
        for g in [(0.0, 0.0), DOWN, (300.0, -500.0), (-1.0e5, 1.0e5)] {
            let mut hp = HighPass::default();
            hp.seed(g.0, g.1);
            for _ in 0..600 {
                let (ax, ay) = hp.step(g.0, g.1);
                assert_eq!((ax.to_bits(), ay.to_bits()), (0, 0), "{g:?}");
            }
        }
    }

    /// The acceptance stress of `scenario_tests` (pointer sweep, two splashes, a shake, a rect
    /// move) plus a 60 px scroll and reduced motion on and off, every tick with gravity `g`.
    fn stress(g: Option<(f32, f32)>) -> Vec<u32> {
        let mut c = acceptance_core(1);
        let (gx, gy) = g.unwrap_or((0.0, 0.0));
        if g.is_some() {
            c.seed_gravity(gx, gy);
        }
        for f in 0..600u32 {
            let scroll = if (540..555).contains(&f) {
                (f - 539) as f32 * 4.0
            } else if f >= 555 {
                60.0
            } else {
                0.0
            };
            for (id, e) in LAYOUT.iter().enumerate() {
                let mut r = *e;
                if id == 0 && (420..480).contains(&f) {
                    r[0] += (f - 420) as f32 / 60.0 * 164.0;
                }
                r[1] -= scroll;
                c.write_element(id, slot(r));
            }
            if (540..555).contains(&f) {
                c.scroll_shift(0.0, 4.0, 0.0, 0.0);
            }
            if f == 580 {
                c.set_reduced_motion(true);
            }
            if f == 590 {
                c.set_reduced_motion(false);
            }
            let px = 300.0 + ((f * 7) % 700) as f32;
            c.tick(DT, px, 284.0, 420.0, 0.0, true, gx, gy);
            match f {
                60 => {
                    let (cx, cy) = centre(0);
                    c.splash(0, cx, cy, 1.0);
                }
                200 => {
                    let (cx, cy) = centre(CARD);
                    c.splash(CARD as u32, cx, cy, 2.0);
                }
                330 => c.shake(1.0),
                _ => {}
            }
        }
        state_bits(&c)
    }

    #[test]
    fn given_gravity_none_and_a_seeded_constant_vector_when_the_acceptance_stress_runs_then_the_core_state_is_bit_identical()
     {
        let none = stress(None);
        assert!(stress(Some(DOWN)) == none, "(0, 980) seeded at create");
        assert!(
            stress(Some((300.0, -500.0))) == none,
            "(300, −500) seeded at create"
        );
    }

    /// The acceptance core takes a 90° tilt; after `at` frames A keeps the tilted gravity while B
    /// is re-seeded to 0 and ticks without gravity; both then take a card splash and 60 frames.
    fn after_tilt(at: u32, drop_gravity: bool) -> Vec<u32> {
        let mut c = acceptance_core(1);
        c.seed_gravity(DOWN.0, DOWN.1);
        for _ in 0..at {
            tick_g(&mut c, SIDE);
        }
        let g = if drop_gravity {
            c.seed_gravity(0.0, 0.0);
            (0.0, 0.0)
        } else {
            SIDE
        };
        let (cx, cy) = centre(CARD);
        c.splash(CARD as u32, cx, cy, 1.0);
        for _ in 0..60 {
            tick_g(&mut c, g);
        }
        state_bits(&c)
    }

    #[test]
    fn given_a_90_degree_tilt_when_the_snap_engages_then_the_core_runs_bit_identical_to_one_without_gravity_and_not_before()
     {
        assert!(
            after_tilt(60, false) != after_tilt(60, true),
            "1 s after the tilt the high-pass still acts"
        );
        assert!(
            after_tilt(SNAP_FRAMES, false) == after_tilt(SNAP_FRAMES, true),
            "after the snap gravity no longer reaches the engine"
        );
    }

    #[test]
    fn given_reduced_motion_when_gravity_turns_and_motion_returns_then_nothing_sloshes() {
        let mut c = acceptance_core(1);
        c.seed_gravity(DOWN.0, DOWN.1);
        for _ in 0..30 {
            tick_g(&mut c, DOWN);
        }
        c.set_reduced_motion(true);
        for _ in 0..10 {
            assert_eq!(
                c.tick(DT, -1.0e4, -1.0e4, 0.0, 0.0, false, SIDE.0, SIDE.1),
                0
            );
        }
        c.set_reduced_motion(false);
        for f in 0..120 {
            tick_g(&mut c, SIDE);
            let a = c.rest_alphas();
            assert!(a.iter().all(|&x| x == 1.0), "frame {f}: {a:?}");
        }
        assert_eq!(
            c.gravity_of().low_pass(),
            (980.0, 0.0),
            "under reduced motion the low-pass followed g"
        );
    }

    #[test]
    fn given_ticks_of_different_length_when_gravity_turns_then_the_low_pass_advances_once_per_fixed_step_not_per_tick()
     {
        let mut a = acceptance_core(1);
        a.seed_gravity(DOWN.0, DOWN.1);
        a.tick(0.0, -1.0e4, -1.0e4, 0.0, 0.0, false, SIDE.0, SIDE.1);
        assert_eq!(
            a.gravity_of().low_pass(),
            (f64::from(DOWN.0), f64::from(DOWN.1)),
            "a 0-step tick changes nothing"
        );
        let mut b = acceptance_core(1);
        b.seed_gravity(DOWN.0, DOWN.1);
        let steps = b.tick(3.0 * DT, -1.0e4, -1.0e4, 0.0, 0.0, false, SIDE.0, SIDE.1);
        assert!(
            steps >= 2,
            "one long tick runs several fixed steps: {steps}"
        );
        let mut c = acceptance_core(1);
        c.seed_gravity(DOWN.0, DOWN.1);
        for _ in 0..steps {
            tick_g(&mut c, SIDE);
        }
        assert_ne!(
            b.gravity_of().low_pass(),
            (f64::from(DOWN.0), f64::from(DOWN.1)),
            "the steps advanced the low-pass"
        );
        assert_eq!(
            b.gravity_of().low_pass(),
            c.gravity_of().low_pass(),
            "one tick of N steps equals N ticks of one step"
        );
    }

    #[test]
    fn given_non_finite_gravity_when_seeded_and_ticked_then_nothing_panics_and_the_core_equals_one_without_gravity()
     {
        let run = |g: (f32, f32)| {
            let mut c = acceptance_core(1);
            c.seed_gravity(g.0, g.1);
            let (cx, cy) = centre(CARD);
            c.splash(CARD as u32, cx, cy, 1.0);
            for _ in 0..60 {
                tick_g(&mut c, g);
            }
            assert!(c.all_particles_finite(), "{g:?}");
            state_bits(&c)
        };
        let zero = run((0.0, 0.0));
        assert!(run((f32::NAN, f32::INFINITY)) == zero);
        assert!(run((f32::NEG_INFINITY, f32::NAN)) == zero);
    }

    #[test]
    fn given_a_parked_element_when_gravity_tilts_then_its_particles_are_bit_unchanged_while_the_others_lean()
     {
        const FAR: usize = 4;
        let mut c = FluidCore::new(8000, 32, 1280.0, 800.0, AREA_HINT_PX2, 180.0, SEED);
        for (id, e) in LAYOUT.iter().enumerate() {
            c.write_element(id, slot(*e));
        }
        // 2400 px down: beyond the world plus the 200 px margin, so it parks (W81).
        c.write_element(FAR, slot([480.0, 2400.0, 320.0, 160.0, 16.0]));
        c.redistribute();
        c.seed_gravity(DOWN.0, DOWN.1);
        for _ in 0..30 {
            tick_g(&mut c, DOWN);
        }
        assert!(c.is_parked_of(FAR), "precondition: the far card is parked");
        let far = |c: &FluidCore| -> Vec<u32> {
            let (pos, vel) = (c.position_bits(), c.velocity_bits());
            let n = c.particle_capacity() as usize;
            c.particle_indices_of(FAR as u32)
                .into_iter()
                .flat_map(|i| [pos[i], pos[n + i], vel[i], vel[n + i]])
                .collect()
        };
        let before = far(&c);
        assert!(
            !before.is_empty(),
            "precondition: the far card owns particles"
        );
        let mut leaned = false;
        for _ in 0..60 {
            tick_g(&mut c, SIDE);
            leaned |= c.rest_alphas().iter().any(|&a| a < 1.0);
        }
        assert!(leaned, "the tilt leans the on-screen elements");
        assert!(
            far(&c) == before,
            "parked particles skip the grid (W81): gravity never reaches them"
        );
    }
}
