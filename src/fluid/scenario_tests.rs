//! Acceptance-layout scenarios (spec §6): three 140×48 r24 buttons at y 260
//! and a 320×180 r16 card at y 340 in a 1280×800 viewport, seed 1.
#![allow(clippy::needless_range_loop)]

use super::api::FluidCore;
use super::clock::SUBSTEPS;
use super::elements::REST_MAX_DEV_PX;
use super::grid::{CELL_MIN_PX, REGION_PAD_CELLS};
use super::layout::{ELEMENT_STRIDE, HOME_NONE, HOVER_SWELL, ST_MAX_DEV, ST_REST_ALPHA};
use super::sampling::{inside_rounded_rect, rounded_rect_area};
use super::solver::{SPRING_K, SPRING_ZETA};

/// The rest threshold as a literal (D64-13), so the scenarios cannot be satisfied by
/// loosening the implementation's constant.
const REST_MAX_DEV: f32 = 0.75;

#[test]
fn given_the_approved_decisions_when_reading_the_constants_then_they_equal_the_literals() {
    assert_eq!(REST_MAX_DEV_PX, 0.75);
    assert_eq!(SPRING_K, 220.0);
    assert_eq!(SPRING_ZETA, 0.8);
    assert_eq!(HOVER_SWELL, 0.02);
    assert_eq!(HOME_NONE, -1.0);
    assert_eq!(SUBSTEPS, 8);
    assert_eq!(REGION_PAD_CELLS, 2);
    assert_eq!(CELL_MIN_PX, 4.0);
}

pub const SEED: u32 = 1;
pub const AREA_HINT_PX2: f32 = 76_057.0;
pub const CARD: usize = 3;
pub const LAYOUT: [[f32; 5]; 4] = [
    [406.0, 260.0, 140.0, 48.0, 24.0],
    [570.0, 260.0, 140.0, 48.0, 24.0],
    [734.0, 260.0, 140.0, 48.0, 24.0],
    [480.0, 340.0, 320.0, 180.0, 16.0],
];

pub fn slot([x, y, w, h, r]: [f32; 5]) -> [f32; ELEMENT_STRIDE] {
    [x, y, w, h, r, 0.0, 0.0, 0.0, f32::NAN, f32::NAN]
}

pub fn acceptance_core(seed: u32) -> FluidCore {
    let mut c = FluidCore::new(8000, 32, 1280.0, 800.0, AREA_HINT_PX2, 180.0, seed);
    for (id, e) in LAYOUT.iter().enumerate() {
        c.write_element(id, slot(*e));
    }
    c.redistribute();
    c
}

/// Ticks `n` frames at 60 Hz; returns the fixed steps simulated.
pub fn frames(c: &mut FluidCore, n: usize) -> u32 {
    (0..n)
        .map(|_| c.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0))
        .sum()
}

fn max_dev(c: &FluidCore, id: usize) -> f32 {
    c.state(id)[ST_MAX_DEV]
}

fn rest_alpha(c: &FluidCore, id: usize) -> f32 {
    c.state(id)[ST_REST_ALPHA]
}

fn dist_to_target(c: &FluidCore, i: usize) -> f32 {
    let (x, y) = c.particle_px(i);
    let (tx, ty) = c.target_px(i).unwrap();
    ((x - tx).powi(2) + (y - ty).powi(2)).sqrt()
}

fn displace_all(c: &mut FluidCore, dx: f32) {
    for i in 0..c.particle_capacity() as usize {
        let (x, y) = c.particle_px(i);
        c.set_particle_px(i, x + dx, y);
    }
}

#[test]
fn given_elements_at_rest_when_ticking_120_frames_then_max_dev_below_0_75px() {
    let mut c = acceptance_core(SEED);
    assert_eq!(frames(&mut c, 120), 120);
    for id in 0..4 {
        assert!(
            max_dev(&c, id) < REST_MAX_DEV,
            "element {id}: {}",
            max_dev(&c, id)
        );
        assert_eq!(rest_alpha(&c, id), 1.0);
    }
    assert_eq!(c.mean_j(), 1.0);
}

#[test]
fn given_particles_displaced_10px_when_ticking_1s_then_max_dev_below_0_75px_and_rest_alpha_1() {
    let mut c = acceptance_core(SEED);
    displace_all(&mut c, 10.0);
    frames(&mut c, 1);
    for id in 0..4 {
        assert!(max_dev(&c, id) > 5.0, "element {id}: {}", max_dev(&c, id));
        // W67 D67-12: elements start settled, and restAlpha now fades over 120 ms (≈ 0.86 after one frame).
        assert!(
            rest_alpha(&c, id) < 1.0,
            "element {id}: {}",
            rest_alpha(&c, id)
        );
    }
    frames(&mut c, 60);
    for id in 0..4 {
        assert!(
            max_dev(&c, id) < REST_MAX_DEV,
            "element {id}: {}",
            max_dev(&c, id)
        );
        assert_eq!(rest_alpha(&c, id), 1.0);
    }
}

#[test]
fn given_rect_moved_50px_when_ticking_then_particles_converge_to_new_rect_targets() {
    let mut c = acceptance_core(SEED);
    let mut card = LAYOUT[CARD];
    card[1] += 50.0;
    c.write_element(CARD, slot(card));
    frames(&mut c, 1);
    assert!(max_dev(&c, CARD) > 40.0, "{}", max_dev(&c, CARD));
    frames(&mut c, 60);
    assert!(max_dev(&c, CARD) < REST_MAX_DEV, "{}", max_dev(&c, CARD));
    assert_eq!(rest_alpha(&c, CARD), 1.0);
    for i in 0..8000 {
        if c.home(i) == CARD as u32 {
            let (x, y) = c.particle_px(i);
            // Inside the new rounded rect, inflated by the rest threshold.
            let t = REST_MAX_DEV;
            assert!(
                inside_rounded_rect(
                    x - (card[0] - t),
                    y - (card[1] - t),
                    card[2] + 2.0 * t,
                    card[3] + 2.0 * t,
                    card[4] + t
                ),
                "particle {i}: ({x}, {y})"
            );
        }
    }
}

#[test]
fn given_reduced_motion_when_ticking_then_every_particle_equals_target_and_rest_alpha_is_1() {
    let mut c = acceptance_core(SEED);
    c.set_reduced_motion(true);
    displace_all(&mut c, 10.0);
    assert_eq!(frames(&mut c, 1), 0);
    for i in 0..8000 {
        assert!(
            dist_to_target(&c, i) < 1e-3,
            "particle {i}: {}",
            dist_to_target(&c, i)
        );
    }
    for id in 0..4 {
        assert_eq!(rest_alpha(&c, id), 1.0);
        assert_eq!(max_dev(&c, id), 0.0);
    }
}

#[test]
fn given_reduced_motion_when_rect_moves_then_particles_follow_in_same_tick() {
    let mut c = acceptance_core(SEED);
    c.set_reduced_motion(true);
    let mut card = LAYOUT[CARD];
    card[1] += 50.0;
    c.write_element(CARD, slot(card));
    // 1 ms: no fixed step is due, the pin still follows the rect.
    assert_eq!(c.tick(0.001, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0), 0);
    for i in 0..8000 {
        if c.home(i) == CARD as u32 {
            assert!(dist_to_target(&c, i) < 1e-3);
            let (_, y) = c.particle_px(i);
            assert!(
                y > card[1] && y < card[1] + card[3],
                "particle {i}: y = {y}"
            );
        }
    }
}

#[test]
fn given_ticks_between_redistributions_when_running_then_particle_count_and_total_mass_constant() {
    let mut c = acceptance_core(SEED);
    let m0 = c.total_mass();
    let cell = f64::from(c.cell_px());
    let area: f64 = LAYOUT
        .iter()
        .map(|l| f64::from(rounded_rect_area(l[2], l[3], l[4])))
        .sum();
    assert!((m0 - area / (cell * cell)).abs() / m0 < 1e-3);
    assert_eq!(c.active_particles(), 8000);
    for k in 0..300 {
        if k == 100 {
            displace_all(&mut c, 10.0);
        }
        c.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0);
        assert_eq!(c.total_mass().to_bits(), m0.to_bits(), "frame {k}");
        assert_eq!(c.active_particles(), 8000);
    }
}

#[test]
fn given_300_ticks_when_running_then_every_vec_capacity_and_data_pointer_unchanged() {
    let mut c = acceptance_core(SEED);
    let before = c.buffer_fingerprint();
    frames(&mut c, 150);
    let mut card = LAYOUT[CARD];
    card[0] += 30.0;
    c.write_element(CARD, slot(card));
    frames(&mut c, 150);
    c.redistribute();
    c.set_reduced_motion(true);
    frames(&mut c, 1);
    assert_eq!(c.buffer_fingerprint(), before);
}

#[test]
fn given_one_small_element_in_1280x800_world_when_ticking_then_grid_work_is_bounded_by_particle_aabb()
 {
    let mut c = FluidCore::new(8000, 4, 1280.0, 800.0, 5_000.0, 50.0, SEED);
    c.write_element(0, slot([100.0, 100.0, 100.0, 50.0, 0.0]));
    c.redistribute();
    let before = c.grid().cells_touched;
    assert_eq!(frames(&mut c, 1), 1);
    let g = c.grid();
    let region = g.region();
    let touched = g.cells_touched - before;
    assert_eq!(touched, 2 * u64::from(SUBSTEPS) * region.cells() as u64);
    let cell = c.cell_px();
    let max_w = (100.0 / cell).ceil() as usize + 2 * REGION_PAD_CELLS + 2;
    let max_h = (50.0 / cell).ceil() as usize + 2 * REGION_PAD_CELLS + 2;
    assert!(
        region.cells() <= max_w * max_h,
        "{} > {}",
        region.cells(),
        max_w * max_h
    );
    assert!(
        region.cells() * 100 < g.w * g.h,
        "{} of {}",
        region.cells(),
        g.w * g.h
    );
}

#[test]
fn given_huge_finite_home_offset_for_5_frames_when_restored_then_particles_finite_and_rest_within_60_frames()
 {
    let mut c = acceptance_core(SEED);
    let mut huge = slot(LAYOUT[CARD]);
    huge[6] = 1e38;
    c.write_element(CARD, huge);
    frames(&mut c, 5);
    c.write_element(CARD, slot(LAYOUT[CARD]));
    frames(&mut c, 60);
    assert!(c.dynamic_view().iter().all(|v| v.is_finite()));
    assert!(max_dev(&c, CARD) < REST_MAX_DEV, "{}", max_dev(&c, CARD));
    assert_eq!(rest_alpha(&c, CARD), 1.0);
}

// ---- W67: dynamics scenarios (spec §6 Rust list) -------------------------------
mod w67 {
    use super::{CARD, LAYOUT, acceptance_core, slot};
    use crate::fluid::api::FluidCore;

    const FPS: f32 = 60.0;
    /// D67-1 option 1: spec §6 step 3, amended in W67.
    const REFORM_SPLASH_BUDGET_S: f32 = 3.0;
    /// Spec §6 step 6.
    const REFORM_SHAKE_BUDGET_S: f32 = 3.0;
    const SPLASH: usize = 0;
    const SPLIT: usize = 1;

    fn centre(id: usize) -> (f32, f32) {
        let [x, y, w, h, _] = LAYOUT[id];
        (x + 0.5 * w, y + 0.5 * h)
    }

    fn frame(core: &mut FluidCore) {
        assert_eq!(
            core.tick(1.0 / 60.0, -1.0e4, -1.0e4, 0.0, 0.0, false, 0.0, 0.0),
            1
        );
    }

    fn all_at_rest(core: &FluidCore) -> bool {
        let a = core.rest_alphas();
        a.len() == 4 && a.iter().all(|&x| x >= 1.0)
    }

    fn frames_until_rest(core: &mut FluidCore, max: u32) -> Option<u32> {
        (1..=max).find(|_| {
            frame(core);
            all_at_rest(core)
        })
    }

    fn settled_core(seed: u32) -> FluidCore {
        let mut core = acceptance_core(seed);
        for _ in 0..60 {
            frame(&mut core);
        }
        assert!(
            all_at_rest(&core),
            "precondition: at rest after 1 s idle, {:?}",
            core.rest_alphas()
        );
        core
    }

    fn budget_frames(seconds: f32, already: u32) -> u32 {
        ((seconds * FPS).round() as u32).saturating_sub(already)
    }

    fn run_stress(core: &mut FluidCore) {
        for f in 0..600u32 {
            let [x, y, w, h, r] = LAYOUT[SPLASH];
            let dx = if (420..480).contains(&f) {
                (f - 420) as f32 / 60.0 * 164.0
            } else {
                0.0
            };
            core.write_element(SPLASH, slot([x + dx, y, w, h, r]));
            let px = 300.0 + ((f * 7) % 700) as f32;
            core.tick(1.0 / 60.0, px, 284.0, 420.0, 0.0, true, 0.0, 0.0);
            match f {
                60 => {
                    let (cx, cy) = centre(SPLASH);
                    core.splash(SPLASH as u32, cx, cy, 1.0);
                }
                200 => {
                    let (cx, cy) = centre(CARD);
                    core.splash(CARD as u32, cx, cy, 2.0);
                }
                330 => core.shake(1.0),
                _ => {}
            }
        }
    }

    #[test]
    fn given_stress_sequence_pointer_splash_shake_when_run_then_mean_j_within_5_percent_of_1() {
        let mut core = acceptance_core(1);
        run_stress(&mut core);
        let j = core.mean_j();
        assert!((j - 1.0).abs() <= 0.05, "mean J {j}");
    }

    #[test]
    fn given_stress_sequence_when_run_then_no_nan_or_inf_and_every_f_finite_with_det_positive() {
        let mut core = acceptance_core(1);
        run_stress(&mut core);
        assert!(core.all_particles_finite());
        assert!(core.min_det_f() > 0.0, "min det F {}", core.min_det_f());
    }

    #[test]
    fn given_stress_sequence_when_run_then_particle_count_and_mass_exactly_constant() {
        let mut core = acceptance_core(1);
        let count = core.active_particles();
        let mass = core.total_mass().to_bits();
        run_stress(&mut core);
        assert_eq!(core.active_particles(), count);
        assert_eq!(count, core.particle_capacity());
        assert_eq!(
            core.total_mass().to_bits(),
            mass,
            "no redistribute during the stress: mass bit-identical"
        );
    }

    #[test]
    fn given_strength_1_splash_on_button_when_ticking_then_rest_alpha_1_within_3_s() {
        let mut core = settled_core(1);
        let (cx, cy) = centre(SPLASH);
        core.splash(SPLASH as u32, cx, cy, 1.0);
        for _ in 0..10 {
            frame(&mut core);
        }
        assert!(
            core.rest_alphas()[SPLASH] < 1.0,
            "the splash softened the Splash button"
        );
        let frames = frames_until_rest(&mut core, budget_frames(REFORM_SPLASH_BUDGET_S, 10));
        eprintln!("W67 D67-1 evidence: splash re-form after {frames:?} (+10) frames");
        assert!(
            frames.is_some(),
            "every restAlpha back to 1 within {REFORM_SPLASH_BUDGET_S} s"
        );
        assert!(
            core.max_dev_px().iter().all(|&d| d < 0.75),
            "at rest the particles sit on the real target"
        );
    }

    #[test]
    fn given_shake_strength_1_when_ticking_then_all_rest_alpha_1_within_3_s() {
        let mut core = settled_core(1);
        core.shake(1.0);
        for _ in 0..10 {
            frame(&mut core);
        }
        assert!(
            core.rest_alphas().iter().all(|&a| a < 1.0),
            "everything sloshes"
        );
        let frames = frames_until_rest(&mut core, budget_frames(REFORM_SHAKE_BUDGET_S, 10));
        eprintln!("W67 D67-1 evidence: shake re-form after {frames:?} (+10) frames");
        assert!(
            frames.is_some(),
            "every restAlpha back to 1 within {REFORM_SHAKE_BUDGET_S} s"
        );
    }

    #[test]
    fn given_same_seed_and_inputs_when_stress_sequence_run_twice_then_positions_bit_identical() {
        let mut a = acceptance_core(42);
        let mut b = acceptance_core(42);
        run_stress(&mut a);
        run_stress(&mut b);
        assert_eq!(a.position_bits(), b.position_bits());
    }

    #[test]
    fn given_gravity_args_when_ticking_then_positions_identical_to_zero_gravity_until_slice_6() {
        let mut a = settled_core(5);
        let mut b = settled_core(5);
        let (cx, cy) = centre(SPLIT);
        a.splash(SPLIT as u32, cx, cy, 1.0);
        b.splash(SPLIT as u32, cx, cy, 1.0);
        for _ in 0..60 {
            a.tick(1.0 / 60.0, -1.0e4, -1.0e4, 0.0, 0.0, false, 0.0, 980.0);
            b.tick(1.0 / 60.0, -1.0e4, -1.0e4, 0.0, 0.0, false, 0.0, 0.0);
        }
        assert_eq!(
            a.position_bits(),
            b.position_bits(),
            "D67-2: gravity has no effect before slice 6"
        );
    }

    #[test]
    #[ignore = "slice 6: gravity in the grid update (spec §6 interim state, D67-2)"]
    fn given_gravity_when_ticking_then_liquid_falls() {
        let mut core = settled_core(5);
        let ids = core.particle_indices_of(CARD as u32);
        let mean_y = |c: &FluidCore| {
            ids.iter().map(|&i| c.particle_px(i).1).sum::<f32>() / ids.len().max(1) as f32
        };
        let before = mean_y(&core);
        core.shake(0.5);
        for _ in 0..60 {
            core.tick(1.0 / 60.0, -1.0e4, -1.0e4, 0.0, 0.0, false, 0.0, 980.0);
        }
        assert!(
            mean_y(&core) > before + 5.0,
            "the card's liquid sags under gravity"
        );
    }
}
