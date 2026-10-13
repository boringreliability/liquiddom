//! W80: scroll follows (slice-6 design §3; spec §2 interaction table, scroll row; D80-1, D80-2).
//!
//! Unit tests drive `ScrollShift` and `Grid::scroll_origin`; scenario tests drive the real
//! `FluidCore` over the acceptance layout (`scenario_tests`: three buttons 140×48 r24 at y 260,
//! card 320×180 r16 at y 340, 1280×800, seed 1). A page scrolled by `S` px is driven the way TS
//! drives it: every rect is written `S` px higher, then `scroll_shift(0, Δ, …)` runs before the
//! tick.

use super::api::FluidCore;
use super::grid::{Grid, WORLD_MAX_PX};
use super::layout::INTERACTION_DRAGGED;
use super::scenario_tests::{AREA_HINT_PX2, LAYOUT, SEED, acceptance_core, slot};
use super::scroll::{SCROLL_INERTIA_VMAX_PX_S, ScrollShift};

const DT: f32 = 1.0 / 60.0;
/// NORTH-STAR step 7: 300 px down and back.
const SCROLL_PX: f32 = 300.0;
/// The middle speed of the W80.0 matrix: 10 px per frame.
const STEP_PX: f32 = 10.0;
/// D80-3 (gate): a sustained fast scroll, where W80.0 saw the provisional inertia tear the liquid.
const FAST_STEP_PX: f32 = 30.0;
/// The TS constants (`scroll-tracker.ts`), set at the gate from W80.0 (D80-2 amended):
/// inertia = Δ · 60 · SCROLL_INERTIA px/s, capped at SCROLL_INERTIA_MAX_PX_S · dt · 60 per call.
const SCROLL_INERTIA: f32 = 0.02;
const SCROLL_INERTIA_MAX_PX_S: f32 = 30.0;
/// Step-7 budget (D80-3): 3 s at 60 Hz.
const STEP7_BUDGET_FRAMES: u32 = 180;
/// W80.0 measured 5.80 px at 30 px/frame; bound = 1.5 × that, rounded up (D80-2 consequence).
const INERTIA_MAX_DEV_PX: f32 = 9.0;
/// f32 rounding of the shifted positions (the plan validation measured ≤ 0.0031 px).
const ROUNDING_PX: f32 = 0.01;
const MERGE_ID: usize = 2;
const CARD_ID: usize = 3;

fn frame(core: &mut FluidCore) -> u32 {
    core.tick(DT, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0)
}

/// Writes every acceptance rect `scroll_y` px higher (the page scrolled down by `scroll_y`).
fn write_scrolled(core: &mut FluidCore, scroll_y: f32) {
    for (id, e) in LAYOUT.iter().enumerate() {
        let mut r = *e;
        r[1] -= scroll_y;
        core.write_element(id, slot(r));
    }
}

/// TS's inertia for a 1/60 s frame's scroll delta (D80-2, `scroll-tracker.ts`): the cap is per
/// 1/60 s (`SCROLL_INERTIA_MAX_PX_S · dt · 60`), so at DT it is `SCROLL_INERTIA_MAX_PX_S`.
fn inertia(delta: f32) -> f32 {
    let cap = SCROLL_INERTIA_MAX_PX_S * DT * 60.0;
    (delta * 60.0 * SCROLL_INERTIA).clamp(-cap, cap)
}

/// One frame of a page scrolled from `from` to `to` px: rects, shift, tick.
fn scroll_frame(core: &mut FluidCore, from: f32, to: f32, with_inertia: bool) {
    write_scrolled(core, to);
    let d = to - from;
    let iv = if with_inertia { inertia(d) } else { 0.0 };
    core.scroll_shift(0.0, d, 0.0, iv);
    frame(core);
}

/// Step 7's scroll positions at `step` px per frame: down to SCROLL_PX, then back to 0.
fn step7_path(step: f32) -> Vec<f32> {
    let n = (SCROLL_PX / step).round() as usize;
    let down = (1..=n).map(|k| k as f32 * step);
    let back = (0..n).rev().map(|k| k as f32 * step);
    down.chain(back).collect()
}

fn homed(core: &FluidCore) -> Vec<usize> {
    (0..core.particle_capacity() as usize)
        .filter(|&i| core.target_px(i).is_some())
        .collect()
}

fn all_at_rest(core: &FluidCore) -> bool {
    core.rest_alphas().iter().all(|&a| a >= 1.0)
}

// ---------------------------------------------------------------- unit: ScrollShift, Grid

#[test]
fn given_nan_inf_and_huge_values_when_sanitized_then_the_shift_is_finite_and_clamped_and_the_inertia_is_capped()
 {
    let s = ScrollShift::sanitized(f32::NAN, f32::INFINITY, 3000.0, 4000.0, false);
    assert_eq!((s.dx_px, s.dy_px), (0.0, 0.0), "NaN/Inf shift → 0");
    assert!(
        (s.ivx_px_s - 1200.0).abs() < 0.01 && (s.ivy_px_s - 1600.0).abs() < 0.01,
        "speed 5000 capped at {SCROLL_INERTIA_VMAX_PX_S} px/s with its direction: ({}, {})",
        s.ivx_px_s,
        s.ivy_px_s
    );
    let big = ScrollShift::sanitized(1e9, -1e9, f32::MAX, -f32::MAX, false);
    assert_eq!((big.dx_px, big.dy_px), (WORLD_MAX_PX, -WORLD_MAX_PX));
    assert!(
        (big.ivx_px_s.hypot(big.ivy_px_s) - SCROLL_INERTIA_VMAX_PX_S).abs() < 0.5
            && big.ivx_px_s > 0.0
            && big.ivy_px_s < 0.0,
        "|v| overflowing f32 is still capped with its direction: ({}, {})",
        big.ivx_px_s,
        big.ivy_px_s
    );
    let nan_iv = ScrollShift::sanitized(12.5, -3.0, f32::NAN, 10.0, false);
    assert_eq!(
        nan_iv,
        ScrollShift {
            dx_px: 12.5,
            dy_px: -3.0,
            ivx_px_s: 0.0,
            ivy_px_s: 0.0
        },
        "a non-finite inertia is 0; a finite shift is kept, a negative one too (overscroll)"
    );
    let rm = ScrollShift::sanitized(0.0, 10.0, 5.0, 30.0, true);
    assert_eq!(
        (rm.dy_px, rm.ivx_px_s, rm.ivy_px_s),
        (10.0, 0.0, 0.0),
        "reduced motion keeps the shift and drops the inertia"
    );
    assert!(ScrollShift::sanitized(0.0, 0.0, 0.0, 0.0, false).is_none());
    assert!(ScrollShift::sanitized(f32::NAN, f32::NAN, f32::NAN, 0.0, false).is_none());
    assert_eq!(
        SCROLL_INERTIA_VMAX_PX_S, 2000.0,
        "the pointer's cap (D80-1)"
    );
}

#[test]
fn given_scroll_deltas_when_the_grid_origin_is_split_then_whole_cells_plus_the_rest_equal_the_delta_and_the_origin_stays_within_half_a_cell()
 {
    let mut g = Grid::new(1280.0, 800.0, 6.166, 200.0);
    let cell = g.cell_px;
    let mut drift_max = 0.0f32;
    for d in [
        1.0f32, 1.0, 1.0, 10.0, -3.5, 300.0, 2.75, -300.0, 4096.0, -0.25,
    ] {
        let before = g.origin_y_px;
        let (kx, ky) = g.scroll_origin(0.0, d);
        assert_eq!(kx, 0.0, "no x scroll: no whole cells");
        assert_eq!(ky, ky.round(), "whole cells");
        let rest = before - g.origin_y_px;
        assert!(
            (ky * cell + rest - d).abs() < 1e-3,
            "k·cell + rest = d ({ky}·{cell} + {rest} vs {d})"
        );
        drift_max = drift_max.max((g.origin_y_px + 200.0).abs());
    }
    assert!(
        drift_max <= 0.5 * cell + 1e-3,
        "the origin stays within half a cell of −margin: {drift_max} px (cell {cell})"
    );
    assert_eq!(g.origin_x_px, -200.0, "x untouched");
    assert_eq!(g.scroll_origin(f32::NAN, f32::INFINITY), (0.0, 0.0));
}

// ---------------------------------------------------------------- scenario: the shift

#[test]
fn given_a_zero_shift_and_zero_inertia_when_scroll_shift_then_the_core_is_bit_identical() {
    let mut core = acceptance_core(SEED);
    for _ in 0..10 {
        frame(&mut core);
    }
    let (pos, vel, bounds) = (
        core.position_bits(),
        core.velocity_bits(),
        core.bounds_reusable(),
    );
    core.scroll_shift(0.0, 0.0, 0.0, 0.0);
    core.scroll_shift(f32::NAN, f32::NAN, f32::NAN, f32::NAN);
    assert_eq!(core.position_bits(), pos);
    assert_eq!(core.velocity_bits(), vel);
    assert_eq!(
        core.bounds_reusable(),
        bounds,
        "a no-op keeps the fused AABB"
    );
}

#[test]
fn given_a_scroll_shift_when_called_then_every_homed_particle_moves_by_minus_the_delta_and_the_fused_aabb_is_invalidated()
 {
    let mut core = acceptance_core(SEED);
    frame(&mut core);
    assert!(
        core.bounds_reusable(),
        "precondition: G2P left a fused AABB"
    );
    let ids = homed(&core);
    let before: Vec<(f32, f32)> = ids.iter().map(|&i| core.particle_px(i)).collect();
    write_scrolled(&mut core, 25.0);
    core.scroll_shift(4.0, 25.0, 0.0, 0.0);
    assert!(
        !core.bounds_reusable(),
        "D68-10: the shift invalidates the fused AABB"
    );
    let worst = ids
        .iter()
        .zip(&before)
        .map(|(&i, &(x0, y0))| {
            let (x, y) = core.particle_px(i);
            ((x - (x0 - 4.0)).abs()).max((y - (y0 - 25.0)).abs())
        })
        .fold(0.0f32, f32::max);
    assert!(
        worst < ROUNDING_PX,
        "every homed particle moved by (−4, −25) px; worst error {worst} px"
    );
}

#[test]
fn given_a_page_scrolled_down_and_back_without_inertia_when_a_splash_is_in_flight_then_every_particle_matches_an_unscrolled_core_up_to_f32_rounding()
 {
    for step in [1.0f32, STEP_PX, FAST_STEP_PX, SCROLL_PX] {
        let mut plain = acceptance_core(SEED);
        let mut scrolled = acceptance_core(SEED);
        // Liquid in flight: a strength-1 splash on Merge in both cores at frame 0.
        plain.splash(MERGE_ID as u32, 804.0, 284.0, 1.0);
        scrolled.splash(MERGE_ID as u32, 804.0, 284.0, 1.0);
        let ids = homed(&plain);
        let mut s = 0.0;
        let mut worst = 0.0f32;
        for to in step7_path(step) {
            scroll_frame(&mut scrolled, s, to, false);
            s = to;
            frame(&mut plain);
            for &i in &ids {
                let (ax, ay) = plain.particle_px(i);
                let (bx, by) = scrolled.particle_px(i);
                worst = worst.max((bx - ax).abs()).max((by + s - ay).abs());
            }
        }
        println!("W80 rigid shift at {step} px/frame: worst |scrolled + S − plain| = {worst} px");
        assert!(
            worst < ROUNDING_PX,
            "{step} px/frame: without inertia the scrolled core is the unscrolled one up to f32 rounding ({worst} px)"
        );
        assert_eq!(
            plain.rest_alphas(),
            scrolled.rest_alphas(),
            "the same rest state"
        );
    }
}

#[test]
fn given_a_scroll_with_the_rects_moved_by_it_when_the_next_tick_simulates_then_the_home_velocity_is_0_and_nothing_un_rests()
 {
    let mut core = acceptance_core(SEED);
    for _ in 0..5 {
        frame(&mut core);
    }
    assert!(all_at_rest(&core), "precondition: at rest");
    scroll_frame(&mut core, 0.0, 37.5, false);
    assert_eq!(
        core.step_velocities(),
        &[(0.0f32, 0.0f32)],
        "Splash's rect moved with the scroll: no home velocity (no excitation)"
    );
    assert!(
        all_at_rest(&core),
        "a rigid shift keeps every element at rest"
    );
    // Two shifts between simulating ticks (a 0-step tick in between, as at 120 Hz) add up.
    write_scrolled(&mut core, 45.0);
    core.scroll_shift(0.0, 7.5, 0.0, 0.0);
    assert_eq!(core.tick(0.004, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0), 0);
    write_scrolled(&mut core, 60.0);
    core.scroll_shift(0.0, 15.0, 0.0, 0.0);
    assert_eq!(core.tick(DT, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0), 1);
    let (vx, vy) = core.step_velocities()[0];
    assert!(
        vx.abs() < 1e-3 && vy.abs() < 1e-3,
        "two scrolls between simulating ticks: still no home velocity ({vx}, {vy})"
    );
    assert!(all_at_rest(&core));
}

#[test]
fn given_a_dragged_element_when_the_page_scrolls_then_its_particles_and_previous_rect_stay_and_the_others_move()
 {
    let mut core = acceptance_core(SEED);
    let merge = |scroll_y: f32| {
        let mut r = LAYOUT[MERGE_ID];
        r[1] -= scroll_y;
        let mut s = slot(r);
        s[5] = INTERACTION_DRAGGED;
        s[7] = scroll_y; // TS adds the scroll delta to the drag offset (W80.3)
        s
    };
    core.write_element(MERGE_ID, merge(0.0));
    for _ in 0..5 {
        frame(&mut core);
    }
    let merge_ids = core.particle_indices_of(MERGE_ID as u32);
    let card_ids = core.particle_indices_of(CARD_ID as u32);
    let merge_before: Vec<(f32, f32)> = merge_ids.iter().map(|&i| core.particle_px(i)).collect();
    let card_before: Vec<(f32, f32)> = card_ids.iter().map(|&i| core.particle_px(i)).collect();
    // The page scrolls 40 px: every rect is 40 px higher; Merge's home (rect + offset) stays.
    write_scrolled(&mut core, 40.0);
    core.write_element(MERGE_ID, merge(40.0));
    core.scroll_shift(0.0, 40.0, 0.0, 0.0);
    for (k, &i) in merge_ids.iter().enumerate() {
        let (x, y) = core.particle_px(i);
        assert!(
            (x - merge_before[k].0).abs() < ROUNDING_PX
                && (y - merge_before[k].1).abs() < ROUNDING_PX,
            "the dragged liquid stays where it is in the viewport"
        );
    }
    for (k, &i) in card_ids.iter().enumerate() {
        let (x, y) = core.particle_px(i);
        assert!(
            (x - card_before[k].0).abs() < ROUNDING_PX
                && (y - (card_before[k].1 - 40.0)).abs() < ROUNDING_PX,
            "the card's liquid moves with the page"
        );
    }
    frame(&mut core);
    let (vx, vy) = core.home_velocity_of(MERGE_ID);
    assert!(
        vx.abs() < 1e-3 && vy.abs() < 1e-3,
        "rect −40 and offset +40: the dragged home did not move ({vx}, {vy})"
    );
    let (cx, cy) = core.home_velocity_of(CARD_ID);
    assert!(
        cx.abs() < 1e-3 && cy.abs() < 1e-3,
        "the card moved with the page: no home velocity ({cx}, {cy})"
    );
}

#[test]
fn given_scroll_down_with_inertia_when_ticking_then_the_liquid_lags_below_its_home_and_every_rest_alpha_is_1_within_the_step_7_budget()
 {
    // D80-3 (gate): 10 px per frame and a sustained fast scroll at 30 px per frame.
    for step in [STEP_PX, FAST_STEP_PX] {
        let mut core = acceptance_core(SEED);
        let card = core.particle_indices_of(CARD_ID as u32);
        let lag = |core: &FluidCore| {
            card.iter()
                .map(|&i| core.particle_px(i).1 - core.target_px(i).map_or(0.0, |t| t.1))
                .sum::<f32>()
                / card.len() as f32
        };
        let mut s = 0.0;
        let mut max_lag = 0.0f32;
        let mut max_dev = 0.0f32;
        let path = step7_path(step);
        let down = path.len() / 2;
        for (f, to) in path.iter().copied().enumerate() {
            scroll_frame(&mut core, s, to, true);
            s = to;
            if f < down {
                max_lag = max_lag.max(lag(&core));
            }
            max_dev = core.max_dev_px().iter().copied().fold(max_dev, f32::max);
        }
        let mut rest = None;
        for f in 1..=STEP7_BUDGET_FRAMES {
            frame(&mut core);
            if all_at_rest(&core) {
                rest = Some(f);
                break;
            }
        }
        println!(
            "W80 inertia {SCROLL_INERTIA} cap {SCROLL_INERTIA_MAX_PX_S} px/s at {step} px/frame: card lag max {max_lag} px (down), worst maxDev {max_dev} px, every restAlpha 1 after {rest:?} frames"
        );
        assert!(
            max_lag > 0.5,
            "{step} px/frame: scrolling down, the card's liquid lags below its home (ivy > 0): {max_lag} px"
        );
        assert!(
            max_dev < INERTIA_MAX_DEV_PX,
            "{step} px/frame: light inertia: no element leaves its home by {INERTIA_MAX_DEV_PX} px or more ({max_dev} px)"
        );
        assert!(
            rest.is_some(),
            "{step} px/frame: every restAlpha is 1 within {STEP7_BUDGET_FRAMES} frames after the scroll back"
        );
    }
}

#[test]
fn given_reduced_motion_when_scroll_shift_with_inertia_then_no_velocity_is_added_and_the_shift_still_applies()
 {
    let mut core = acceptance_core(SEED);
    core.set_reduced_motion(true);
    frame(&mut core);
    let vel = core.velocity_bits();
    let ids = homed(&core);
    let y0: Vec<f32> = ids.iter().map(|&i| core.particle_px(i).1).collect();
    core.scroll_shift(0.0, 10.0, 0.0, 500.0);
    assert_eq!(
        core.velocity_bits(),
        vel,
        "reduced motion: inertia 0 (D80-1)"
    );
    for (k, &i) in ids.iter().enumerate() {
        assert!(
            (core.particle_px(i).1 - (y0[k] - 10.0)).abs() < ROUNDING_PX,
            "the shift applies"
        );
    }
    write_scrolled(&mut core, 10.0);
    frame(&mut core);
    assert!(all_at_rest(&core), "the pin follows the rects");
}

#[test]
fn given_a_shift_that_carries_particles_past_the_grid_when_scroll_shift_then_every_position_stays_inside_the_grid()
 {
    let mut core = acceptance_core(SEED);
    frame(&mut core);
    // W80 ward review I1: the rects move with the (clamped) scroll first, as TS writes them;
    // an element whose rect stayed is not shifted.
    write_scrolled(&mut core, WORLD_MAX_PX);
    core.scroll_shift(0.0, 1e30, 0.0, 0.0);
    let ids = homed(&core);
    let g = core.grid();
    let top = g.to_px(1.0, 1.0).1;
    for &i in &ids {
        let (x, y) = core.particle_px(i);
        assert!(x.is_finite() && y.is_finite());
        let (gx, gy) = g.to_grid(x, y);
        let (cx, cy) = g.clamp_pos(gx, gy);
        assert!(
            (cx - gx).abs() < 1e-3 && (cy - gy).abs() < 1e-3,
            "inside the grid"
        );
        assert!(
            (y - top).abs() < ROUNDING_PX,
            "a shift of 8192 px (clamped from 1e30) puts every particle on the top wall: {y} vs {top}"
        );
    }
    for _ in 0..3 {
        frame(&mut core);
    }
    assert!(core.all_particles_finite());
}

#[test]
fn given_the_acceptance_area_hint_when_constructed_then_the_cell_is_not_a_whole_px_divisor_of_the_scroll_steps()
 {
    // Guards the lattice-phase test above: with a whole-px cell a 10 px step could hide a
    // sub-cell error. B5: sqrt(4 · 76057 / 8000) ≈ 6.167 px.
    let core = acceptance_core(SEED);
    let cell = core.cell_px();
    assert!((cell - (4.0f32 * AREA_HINT_PX2 / 8000.0).sqrt()).abs() < 1e-4);
    assert!((STEP_PX / cell).fract() > 0.1 && (1.0 / cell).fract() > 0.1);
}

// ------------------------------------- W80 ward review I1: fixed and sticky elements (54–56)

/// The card's restAlpha (the acceptance layout's slot 3).
fn card_rest(core: &FluidCore) -> f32 {
    core.state(CARD_ID)[super::layout::ST_REST_ALPHA]
}

/// One frame of a page scrolled from `from` to `to` px in which the card's rect is `card_y`
/// (every other rect moves with the page): rects, shift, tick.
fn scroll_frame_card_at(core: &mut FluidCore, from: f32, to: f32, card_y: f32, with_inertia: bool) {
    write_scrolled(core, to);
    let mut r = LAYOUT[CARD_ID];
    r[1] = card_y;
    core.write_element(CARD_ID, slot(r));
    let d = to - from;
    let iv = if with_inertia { inertia(d) } else { 0.0 };
    core.scroll_shift(0.0, d, 0.0, iv);
    frame(core);
}

#[test]
fn given_a_fixed_element_when_the_page_scrolls_300_px_and_back_then_its_liquid_stays_put_with_home_velocity_0_and_rest_alpha_1_while_the_others_are_shifted()
 {
    let mut core = acceptance_core(SEED);
    for _ in 0..5 {
        frame(&mut core);
    }
    assert!(all_at_rest(&core), "precondition: at rest");
    let card = core.particle_indices_of(CARD_ID as u32);
    let split = core.particle_indices_of(1);
    let card0: Vec<(f32, f32)> = card.iter().map(|&i| core.particle_px(i)).collect();
    let split0: Vec<(f32, f32)> = split.iter().map(|&i| core.particle_px(i)).collect();
    // The first frame, checked between the shift and the tick: the card (position: fixed, its
    // rect never moves) is not shifted, Split (moves with the page) is.
    write_scrolled(&mut core, STEP_PX);
    core.write_element(CARD_ID, slot(LAYOUT[CARD_ID]));
    core.scroll_shift(0.0, STEP_PX, 0.0, inertia(STEP_PX));
    let card_moved = card
        .iter()
        .zip(&card0)
        .map(|(&i, &(x0, y0))| {
            let (x, y) = core.particle_px(i);
            (x - x0).abs().max((y - y0).abs())
        })
        .fold(0.0f32, f32::max);
    let split_err = split
        .iter()
        .zip(&split0)
        .map(|(&i, &(x0, y0))| {
            let (x, y) = core.particle_px(i);
            (x - x0).abs().max((y - (y0 - STEP_PX)).abs())
        })
        .fold(0.0f32, f32::max);
    assert!(
        card_moved < ROUNDING_PX,
        "the fixed card's liquid stays put in px ({card_moved} px)"
    );
    assert!(
        split_err < ROUNDING_PX,
        "Split's liquid moves with the page ({split_err} px)"
    );
    frame(&mut core);
    let mut s = STEP_PX;
    let mut worst_v = 0.0f32;
    let mut worst_other_v = 0.0f32;
    let mut min_rest = card_rest(&core);
    for to in step7_path(STEP_PX).into_iter().skip(1) {
        scroll_frame_card_at(&mut core, s, to, LAYOUT[CARD_ID][1], true);
        s = to;
        let (vx, vy) = core.home_velocity_of(CARD_ID);
        worst_v = worst_v.max(vx.abs()).max(vy.abs());
        for id in 0..CARD_ID {
            let (ox, oy) = core.home_velocity_of(id);
            worst_other_v = worst_other_v.max(ox.abs()).max(oy.abs());
        }
        min_rest = min_rest.min(card_rest(&core));
    }
    println!(
        "W80 I1 fixed card at {STEP_PX} px/frame: worst card home velocity {worst_v} px/s, others {worst_other_v} px/s, card restAlpha min {min_rest}"
    );
    assert_eq!(
        worst_v, 0.0,
        "the fixed card's rect never moved: home velocity 0 in every frame"
    );
    assert!(
        worst_other_v < 1e-3,
        "the buttons moved with the page: no home velocity ({worst_other_v} px/s)"
    );
    assert_eq!(
        min_rest, 1.0,
        "the fixed card never leaves rest during the scroll"
    );
}

#[test]
fn given_a_sticky_element_that_sticks_and_unsticks_mid_scroll_when_the_page_scrolls_then_it_switches_between_following_and_staying_and_its_home_velocity_is_at_most_half_the_step()
 {
    // The card is `position: sticky; top: 240px`: it scrolls with the page until its top
    // reaches 240 (scroll 100), then stays there, and follows again below scroll 100.
    let stuck_at = |scroll: f32| (LAYOUT[CARD_ID][1] - scroll).max(240.0);
    // 10 px per frame reaches 100 exactly; 15 px per frame sticks mid-frame (90 → 105). No
    // inertia, so only the switch can un-rest the card.
    for step in [STEP_PX, 15.0f32] {
        let mut core = acceptance_core(SEED);
        for _ in 0..5 {
            frame(&mut core);
        }
        let mut s = 0.0;
        let mut worst_v = 0.0f32;
        let mut min_rest = 1.0f32;
        let n = (210.0 / step).round() as usize;
        let path: Vec<f32> = (1..=n)
            .map(|k| k as f32 * step)
            .chain((0..n).rev().map(|k| k as f32 * step))
            .collect();
        for to in path {
            let (y_before, y_after) = (stuck_at(s), stuck_at(to));
            scroll_frame_card_at(&mut core, s, to, y_after, false);
            let (vx, vy) = core.home_velocity_of(CARD_ID);
            // Velocity window = 1/60 s (one fixed step per frame).
            let residual_px = vx.abs().max(vy.abs()) * DT;
            worst_v = worst_v.max(residual_px);
            let rect_moved = (y_after - y_before).abs();
            let d = (to - s).abs();
            if rect_moved == 0.0 || rect_moved == d {
                assert!(
                    residual_px < 1e-3,
                    "{step} px/frame, scroll {s} → {to}: the card either stuck or followed, home velocity {vy} px/s"
                );
            }
            s = to;
            min_rest = min_rest.min(card_rest(&core));
        }
        println!(
            "W80 I1 sticky card at {step} px/frame: worst home-velocity residual {worst_v} px per frame, card restAlpha min {min_rest}"
        );
        assert!(
            worst_v <= 0.5 * step + 1e-3,
            "{step} px/frame: a frame that sticks mid-way leaves at most half the step to the home velocity ({worst_v} px)"
        );
        if step == STEP_PX {
            assert_eq!(min_rest, 1.0, "a clean switch never leaves rest");
        }
        let mut rest = None;
        for f in 1..=STEP7_BUDGET_FRAMES {
            frame(&mut core);
            if all_at_rest(&core) {
                rest = Some(f);
                break;
            }
        }
        assert!(
            rest.is_some(),
            "{step} px/frame: every restAlpha is 1 within the step-7 budget"
        );
    }
}

#[test]
fn given_an_element_observed_in_the_frame_the_page_scrolls_when_scroll_shift_then_it_follows_without_a_previous_sample_like_an_unscrolled_core()
 {
    const NEW_ID: usize = 4;
    const NEW_RECT: [f32; 5] = [200.0, 600.0, 120.0, 40.0, 20.0];
    let mut plain = acceptance_core(SEED);
    let mut core = acceptance_core(SEED);
    for _ in 0..5 {
        frame(&mut plain);
        frame(&mut core);
    }
    // observe(): TS writes the rect at observe time and the batched redistribute places the
    // liquid there (no velocity sample yet). In `core` the page then scrolls 25 px before the
    // next frame; `plain` does not scroll.
    for c in [&mut plain, &mut core] {
        c.write_element(NEW_ID, slot(NEW_RECT));
        c.redistribute();
    }
    let ids = core.particle_indices_of(NEW_ID as u32);
    assert!(!ids.is_empty(), "precondition: the new element has liquid");
    let before: Vec<(f32, f32)> = ids.iter().map(|&i| core.particle_px(i)).collect();
    write_scrolled(&mut core, 25.0);
    let mut r = NEW_RECT;
    r[1] -= 25.0;
    core.write_element(NEW_ID, slot(r));
    core.scroll_shift(0.0, 25.0, 0.0, 0.0);
    let worst = ids
        .iter()
        .zip(&before)
        .map(|(&i, &(x0, y0))| {
            let (x, y) = core.particle_px(i);
            (x - x0).abs().max((y - (y0 - 25.0)).abs())
        })
        .fold(0.0f32, f32::max);
    assert!(
        worst < ROUNDING_PX,
        "no previous sample: the new element follows the scroll ({worst} px)"
    );
    frame(&mut plain);
    frame(&mut core);
    let (vx, vy) = core.home_velocity_of(NEW_ID);
    assert!(
        vx == 0.0 && vy == 0.0,
        "its first velocity sample is 0 ({vx}, {vy})"
    );
    let drift = ids
        .iter()
        .map(|&i| {
            let (ax, ay) = plain.particle_px(i);
            let (bx, by) = core.particle_px(i);
            (bx - ax).abs().max((by + 25.0 - ay).abs())
        })
        .fold(0.0f32, f32::max);
    assert!(
        drift < ROUNDING_PX,
        "after the frame its liquid is the unscrolled one moved by the scroll ({drift} px)"
    );
    assert_eq!(
        plain.rest_alphas(),
        core.rest_alphas(),
        "the same rest state"
    );
}
