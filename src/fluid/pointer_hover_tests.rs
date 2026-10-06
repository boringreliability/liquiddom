//! W68: soft pointer field (spec §2 Interaction, D68-3) and hover swell (B1, D68-2/D68-8).
//!
//! Unit tests exercise the pure functions; scenario tests drive the real `FluidCore`
//! over the acceptance layout (3 buttons 140×48 r24 at y 260, card 320×180 r16 at
//! y 340, 1280×800). Slice access goes through `get`/iterators only.

use super::api::FluidCore;
use super::elements::{Rect, swell_rect};
use super::grid::Grid;
use super::interaction::{POINTER_DRAG_PER_S, POINTER_RADIUS_PX, POINTER_VMAX_PX_S, pointer_accel};
use super::layout::{
    ELEMENT_STRIDE, HOVER_SWELL, INTERACTION_DRAGGED, INTERACTION_FOCUSED, INTERACTION_HOVER,
    INTERACTION_IDLE, ST_MAX_DEV, ST_REST_ALPHA,
};
use super::solver::PointerField;

const DT: f32 = 1.0 / 60.0;

/// x, y, w, h, radius in px.
type Bx = (f32, f32, f32, f32, f32);
const SPLASH: Bx = (406.0, 260.0, 140.0, 48.0, 24.0);
const SPLIT: Bx = (570.0, 260.0, 140.0, 48.0, 24.0);
const MERGE: Bx = (734.0, 260.0, 140.0, 48.0, 24.0);
const BUTTONS: [Bx; 3] = [SPLASH, SPLIT, MERGE];
const CARD: Bx = (480.0, 340.0, 320.0, 180.0, 16.0);
const CARD_ID: usize = 3;
const ELEMENT_COUNT: usize = 4;
/// Σ rounded-rect areas of the layout (3 × 6225.6 + 57380.3).
const AREA_HINT_PX2: f32 = 76_057.0;
/// Tallest element (the card), for W64's margin rule B15: max(200, 180) = 200 px.
const MAX_ELEMENT_H_PX: f32 = 180.0;

const SWEEP_FRAMES: u32 = 52;
const SWEEP_Y_PX: f32 = 284.0;
const SWEEP_SPEED_PX_S: f32 = 600.0;
/// Interior "hole" bins: 12×12 px inside each button inset by 8 px
/// (≈15 particles per bin at 8000 particles, P(empty at rest) ≈ 3e-7).
const BIN_PX: f32 = 12.0;
const INSET_PX: f32 = 8.0;
/// px→grid→px round trip at a ~6.2 px cell, so not bit-exact.
const PIN_TOL_PX: f32 = 1e-2;

fn element(b: Bx, interaction: f32) -> [f32; ELEMENT_STRIDE] {
    [
        b.0,
        b.1,
        b.2,
        b.3,
        b.4,
        interaction,
        0.0,
        0.0,
        f32::NAN,
        f32::NAN,
    ]
}

fn scene(seed: u32) -> FluidCore {
    let mut core = FluidCore::new(
        8000,
        32,
        1280.0,
        800.0,
        AREA_HINT_PX2,
        MAX_ELEMENT_H_PX,
        seed,
    );
    for (id, b) in BUTTONS.iter().enumerate() {
        core.write_element(id, element(*b, INTERACTION_IDLE));
    }
    core.write_element(CARD_ID, element(CARD, INTERACTION_IDLE));
    core.redistribute();
    core
}

fn idle(core: &mut FluidCore, frames: u32) {
    for _ in 0..frames {
        let _ = core.tick(DT, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0);
    }
}

fn count(core: &FluidCore) -> usize {
    core.particle_capacity() as usize
}

/// W64's helper returns `None` for a particle without a home. With elements
/// present the whole pool is assigned (B3), so `None` here is a test failure.
fn target(core: &FluidCore, i: usize) -> (f32, f32) {
    core.target_px(i)
        .unwrap_or_else(|| panic!("particle {i} has no home (B3: the whole pool is assigned)"))
}

fn rest_alpha(core: &FluidCore, id: usize) -> f32 {
    core.state(id)
        .get(ST_REST_ALPHA)
        .copied()
        .unwrap_or(f32::NAN)
}

fn max_dev(core: &FluidCore, id: usize) -> f32 {
    core.state(id).get(ST_MAX_DEV).copied().unwrap_or(f32::NAN)
}

fn all_at_rest(core: &FluidCore) -> bool {
    (0..ELEMENT_COUNT).all(|id| rest_alpha(core, id) >= 1.0)
}

fn inside(b: Bx, x: f32, y: f32) -> bool {
    x >= b.0 && x <= b.0 + b.2 && y >= b.1 && y <= b.1 + b.3
}

fn targets(core: &FluidCore) -> Vec<(f32, f32)> {
    (0..count(core)).map(|i| target(core, i)).collect()
}

/// Number of 12×12 px bins inside the inset rect that contain no particle at all.
fn empty_bins(core: &FluidCore, b: Bx) -> usize {
    let (x0, y0) = (b.0 + INSET_PX, b.1 + INSET_PX);
    let (x1, y1) = (b.0 + b.2 - INSET_PX, b.1 + b.3 - INSET_PX);
    let nx = ((x1 - x0) / BIN_PX).floor() as usize;
    let ny = ((y1 - y0) / BIN_PX).floor() as usize;
    let mut bins = vec![0u32; nx * ny];
    for i in 0..count(core) {
        let (x, y) = core.particle_px(i);
        if !(x.is_finite() && y.is_finite()) || x < x0 || y < y0 {
            continue;
        }
        let ix = ((x - x0) / BIN_PX) as usize;
        let iy = ((y - y0) / BIN_PX) as usize;
        if ix >= nx || iy >= ny {
            continue;
        }
        if let Some(c) = bins.get_mut(iy * nx + ix) {
            *c += 1;
        }
    }
    bins.iter().filter(|&&c| c == 0).count()
}

/// Mean x offset (particle − target) over the particles whose target lies in `b`.
fn mean_dx_in(core: &FluidCore, b: Bx) -> f32 {
    let (mut sum, mut n) = (0.0f32, 0u32);
    for i in 0..count(core) {
        let (tx, ty) = target(core, i);
        if !inside(b, tx, ty) {
            continue;
        }
        let (x, _) = core.particle_px(i);
        sum += x - tx;
        n += 1;
    }
    if n == 0 { 0.0 } else { sum / n as f32 }
}

fn sweep_x(k: u32) -> f32 {
    380.0 + 10.0 * k as f32
}

fn run_sweep(core: &mut FluidCore, mut on_frame: impl FnMut(&FluidCore, u32)) {
    for k in 0..=SWEEP_FRAMES {
        let _ = core.tick(
            DT,
            sweep_x(k),
            SWEEP_Y_PX,
            SWEEP_SPEED_PX_S,
            0.0,
            true,
            0.0,
            0.0,
        );
        on_frame(core, k);
    }
}

fn grid() -> Grid {
    Grid::new(1280.0, 800.0, 8.0, 200.0)
}

fn ptr(x: f32, y: f32, vx: f32, vy: f32) -> PointerField {
    PointerField {
        active: true,
        x_px: x,
        y_px: y,
        vx_px: vx,
        vy_px: vy,
    }
}

// ---------------------------------------------------------------- unit: pointer

#[test]
fn given_pointer_within_70px_moving_when_accel_evaluated_then_pulled_towards_pointer_velocity_with_weight_1_minus_d_over_r_squared()
 {
    let g = grid();
    let p = ptr(500.0, 300.0, 300.0, 0.0);
    let w = (1.0 - 35.0 / POINTER_RADIUS_PX).powi(2);
    let expected = 300.0 * g.inv_cell * POINTER_DRAG_PER_S * w;

    let (x, y) = g.to_grid(535.0, 300.0);
    let (ax, ay) = pointer_accel(x, y, 0.0, 0.0, &p, &g);
    assert!(
        (ax - expected).abs() <= 1e-3 * expected.abs(),
        "ax {ax} vs {expected}"
    );
    assert!(
        ay.abs() < 1e-6,
        "no vertical component for horizontal pointer motion: {ay}"
    );

    // Same distance on the diagonal: identical pull, still no radial component.
    let s = 35.0 / std::f32::consts::SQRT_2;
    let (x, y) = g.to_grid(500.0 + s, 300.0 + s);
    let (ax_d, ay_d) = pointer_accel(x, y, 0.0, 0.0, &p, &g);
    assert!(
        (ax_d - expected).abs() <= 1e-3 * expected.abs(),
        "diagonal ax {ax_d}"
    );
    assert!(
        ay_d.abs() < 1e-6,
        "diagonal ay {ay_d} must be 0 (no radial push)"
    );

    // A particle already moving with the pointer feels nothing.
    let (x, y) = g.to_grid(535.0, 300.0);
    let (ax_c, ay_c) = pointer_accel(x, y, 300.0 * g.inv_cell, 0.0, &p, &g);
    assert!(
        ax_c.abs() < 1e-4 && ay_c.abs() < 1e-4,
        "co-moving: ({ax_c}, {ay_c})"
    );
}

#[test]
fn given_particle_at_or_beyond_70px_when_accel_evaluated_then_zero() {
    let g = grid();
    let p = ptr(500.0, 300.0, 800.0, -400.0);
    for d in [70.0f32, 70.5, 100.0, 900.0] {
        let (x, y) = g.to_grid(500.0 + d, 300.0);
        assert_eq!(pointer_accel(x, y, 0.0, 0.0, &p, &g), (0.0, 0.0), "d = {d}");
    }
}

#[test]
fn given_static_pointer_over_resting_liquid_when_accel_evaluated_then_zero_so_no_radial_push() {
    let g = grid();
    let p = ptr(500.0, 300.0, 0.0, 0.0);
    for d in [0.0f32, 1.0, 10.0, 35.0, 69.0] {
        let (x, y) = g.to_grid(500.0 + d, 300.0 - 0.5 * d);
        let (ax, ay) = pointer_accel(x, y, 0.0, 0.0, &p, &g);
        assert!(ax.is_finite() && ay.is_finite(), "finite at d = {d}");
        assert!(
            ax.abs() < 1e-9 && ay.abs() < 1e-9,
            "static pointer pushed at d = {d}: ({ax}, {ay})"
        );
    }
}

#[test]
fn given_inactive_pointer_when_accel_evaluated_then_zero() {
    let g = grid();
    let mut p = ptr(500.0, 300.0, 800.0, 0.0);
    p.active = false;
    let (x, y) = g.to_grid(510.0, 300.0);
    assert_eq!(pointer_accel(x, y, 0.0, 0.0, &p, &g), (0.0, 0.0));
}

#[test]
fn given_nan_or_infinite_pointer_when_sanitized_then_inactive() {
    let cases = [
        (f32::NAN, 1.0, 0.0, 0.0),
        (1.0, f32::INFINITY, 0.0, 0.0),
        (1.0, 1.0, f32::NAN, 0.0),
        (1.0, 1.0, 0.0, f32::NEG_INFINITY),
    ];
    for (x, y, vx, vy) in cases {
        let s = PointerField::sanitized(x, y, vx, vy, true);
        assert!(!s.active, "({x}, {y}, {vx}, {vy}) must be inactive");
        assert_eq!((s.x_px, s.y_px, s.vx_px, s.vy_px), (0.0, 0.0, 0.0, 0.0));
    }
    let off = PointerField::sanitized(10.0, 20.0, 30.0, 40.0, false);
    assert!(!off.active);
    const { assert!(!PointerField::INACTIVE.active) };
}

#[test]
fn given_pointer_speed_above_vmax_when_sanitized_then_clamped_to_vmax_preserving_direction() {
    let s = PointerField::sanitized(100.0, 200.0, 3000.0, 4000.0, true);
    assert!(s.active);
    assert_eq!((s.x_px, s.y_px), (100.0, 200.0));
    let speed = s.vx_px.hypot(s.vy_px);
    assert!((speed - POINTER_VMAX_PX_S).abs() < 1e-2, "speed {speed}");
    assert!((s.vx_px - 1200.0).abs() < 1e-2 && (s.vy_px - 1600.0).abs() < 1e-2);
    let slow = PointerField::sanitized(0.0, 0.0, 300.0, -400.0, true);
    assert_eq!((slow.vx_px, slow.vy_px), (300.0, -400.0));
    // Huge but finite: no overflow to inf in the speed (hypot), still clamped.
    let huge = PointerField::sanitized(0.0, 0.0, 1e30, -1e30, true);
    assert!(huge.active && huge.vx_px.is_finite() && huge.vy_px.is_finite());
    assert!((huge.vx_px.hypot(huge.vy_px) - POINTER_VMAX_PX_S).abs() < 1.0);
}

// ------------------------------------------------------------------ unit: swell

#[test]
fn given_hover_interaction_when_swelled_then_rect_grows_2_percent_about_its_centre_with_radius() {
    let r = Rect {
        x: 100.0,
        y: 50.0,
        w: 200.0,
        h: 100.0,
        r: 16.0,
    };
    let s = swell_rect(&r, INTERACTION_HOVER, false);
    let k = 1.0 + HOVER_SWELL;
    assert!(
        (HOVER_SWELL - 0.02).abs() < 1e-7,
        "HOVER_SWELL is the spec's 2 %"
    );
    assert!((s.w - 200.0 * k).abs() < 1e-4 && (s.h - 100.0 * k).abs() < 1e-4);
    assert!((s.x + 0.5 * s.w - 200.0).abs() < 1e-4, "centre x kept");
    assert!((s.y + 0.5 * s.h - 100.0).abs() < 1e-4, "centre y kept");
    assert!((s.x - 98.0).abs() < 1e-4 && (s.y - 49.0).abs() < 1e-4);
    assert!((s.r - 16.0 * k).abs() < 1e-4, "radius scales with the rect");
}

#[test]
fn given_idle_focus_or_dragged_interaction_when_swelled_then_rect_unchanged() {
    let r = Rect {
        x: 100.0,
        y: 50.0,
        w: 200.0,
        h: 100.0,
        r: 16.0,
    };
    for i in [INTERACTION_IDLE, INTERACTION_FOCUSED, INTERACTION_DRAGGED] {
        let s = swell_rect(&r, i, false);
        assert_eq!(
            (s.x, s.y, s.w, s.h, s.r),
            (100.0, 50.0, 200.0, 100.0, 16.0),
            "interaction {i}"
        );
    }
}

#[test]
fn given_reduced_motion_or_nan_interaction_when_swelled_then_rect_unchanged() {
    let r = Rect {
        x: 100.0,
        y: 50.0,
        w: 200.0,
        h: 100.0,
        r: 16.0,
    };
    let rm = swell_rect(&r, INTERACTION_HOVER, true);
    assert_eq!(
        (rm.x, rm.y, rm.w, rm.h, rm.r),
        (100.0, 50.0, 200.0, 100.0, 16.0)
    );
    let nan = swell_rect(&r, f32::NAN, false);
    assert_eq!(
        (nan.x, nan.y, nan.w, nan.h, nan.r),
        (100.0, 50.0, 200.0, 100.0, 16.0)
    );
}

// ------------------------------------------------------------- scenario: hover

#[test]
fn given_card_hovered_when_ticking_then_its_targets_swell_2_percent_about_centre_and_other_elements_unchanged()
 {
    let mut core = scene(1);
    idle(&mut core, 30);
    assert!(all_at_rest(&core), "precondition: at rest");
    let t0 = targets(&core);

    core.write_element(CARD_ID, element(CARD, INTERACTION_HOVER));
    idle(&mut core, 1);

    let (cx, cy) = (CARD.0 + 0.5 * CARD.2, CARD.1 + 0.5 * CARD.3);
    let k = 1.0 + HOVER_SWELL;
    let mut max_shift = 0.0f32;
    for (i, &(x0, y0)) in t0.iter().enumerate() {
        let (x1, y1) = target(&core, i);
        if inside(CARD, x0, y0) {
            let (ex, ey) = (cx + k * (x0 - cx), cy + k * (y0 - cy));
            assert!(
                (x1 - ex).abs() < 0.3 && (y1 - ey).abs() < 0.3,
                "card particle {i}: target ({x1}, {y1}) vs swelled ({ex}, {ey})"
            );
            max_shift = max_shift.max((x1 - x0).abs());
        } else {
            assert!(
                (x1 - x0).abs() < 0.3 && (y1 - y0).abs() < 0.3,
                "non-card particle {i} moved"
            );
        }
    }
    assert!(
        max_shift >= 3.0,
        "edge targets must move ≈3.2 px, got {max_shift}"
    );
}

#[test]
fn given_card_focused_when_ticking_then_targets_unchanged() {
    let mut core = scene(1);
    idle(&mut core, 30);
    let t0 = targets(&core);
    core.write_element(CARD_ID, element(CARD, INTERACTION_FOCUSED));
    idle(&mut core, 1);
    for (i, &(x0, y0)) in t0.iter().enumerate() {
        let (x1, y1) = target(&core, i);
        assert!(
            (x1 - x0).abs() < 1e-3 && (y1 - y0).abs() < 1e-3,
            "focus moved target {i}"
        );
    }
}

#[test]
fn given_reduced_motion_and_card_hovered_when_ticking_then_targets_unchanged() {
    let mut core = scene(1);
    idle(&mut core, 30);
    let t0 = targets(&core);
    core.set_reduced_motion(true);
    core.write_element(CARD_ID, element(CARD, INTERACTION_HOVER));
    idle(&mut core, 1);
    for (i, &(x0, y0)) in t0.iter().enumerate() {
        let (x1, y1) = target(&core, i);
        assert!(
            (x1 - x0).abs() < 1e-3 && (y1 - y0).abs() < 1e-3,
            "RM swelled target {i}"
        );
    }
}

// ----------------------------------------------------------- scenario: pointer

#[test]
fn given_static_pointer_over_split_when_ticking_1s_then_every_element_stays_at_rest_below_0_75px() {
    let mut core = scene(1);
    idle(&mut core, 30);
    for _ in 0..60 {
        let _ = core.tick(DT, 640.0, 284.0, 0.0, 0.0, true, 0.0, 0.0);
    }
    for id in 0..ELEMENT_COUNT {
        assert!(
            rest_alpha(&core, id) >= 1.0,
            "element {id} left rest under a static pointer"
        );
        assert!(
            max_dev(&core, id) < 0.75,
            "element {id} maxDev {}",
            max_dev(&core, id)
        );
    }
}

/// Guard, not a red test (W67 ignores the pointer, so it probably passes today).
/// Not bit-exact: D68-3's `-v*k` damps any particle motion, so a still pointer
/// may nudge particles slightly. It catches a radial term creeping into the
/// solver loop, which would push the liquid away from the pointer.
#[test]
fn given_still_pointer_inside_radius_when_ticking_60_frames_then_positions_match_inactive_run_within_0_05px()
 {
    let run = |active: bool| {
        let mut core = scene(1);
        idle(&mut core, 30);
        for _ in 0..60 {
            let _ = core.tick(DT, 640.0, 284.0, 0.0, 0.0, active, 0.0, 0.0);
        }
        (0..count(&core))
            .map(|i| core.particle_px(i))
            .collect::<Vec<_>>()
    };
    let (with_ptr, without) = (run(true), run(false));
    let max_d = with_ptr
        .iter()
        .zip(&without)
        .map(|(a, b)| (a.0 - b.0).abs().max((a.1 - b.1).abs()))
        .fold(0.0f32, f32::max);
    assert!(
        max_d < 0.05,
        "still pointer displaced a particle by {max_d} px"
    );
}

#[test]
fn given_pointer_sweeping_across_buttons_when_ticking_then_liquid_follows_pointer_direction_and_no_interior_bin_empties()
 {
    let mut core = scene(1);
    idle(&mut core, 30);
    for (n, b) in BUTTONS.iter().enumerate() {
        assert_eq!(
            empty_bins(&core, *b),
            0,
            "precondition: button {n} has empty bins at rest"
        );
    }
    let mut max_mean_dx = 0.0f32;
    run_sweep(&mut core, |c, k| {
        for (n, b) in BUTTONS.iter().enumerate() {
            let e = empty_bins(c, *b);
            assert_eq!(
                e, 0,
                "button {n}: {e} empty interior bins at sweep frame {k} (hole)"
            );
        }
        max_mean_dx = max_mean_dx.max(mean_dx_in(c, SPLIT));
    });
    assert!(
        max_mean_dx >= 0.5,
        "Split liquid must follow the pointer (+x), max mean dx {max_mean_dx}"
    );
}

#[test]
fn given_pointer_sweep_then_pointer_inactive_when_ticking_then_every_rest_alpha_returns_to_1_within_3s()
 {
    let mut core = scene(1);
    idle(&mut core, 30);
    let mut left_rest = false;
    run_sweep(&mut core, |c, _| left_rest |= !all_at_rest(c));
    assert!(
        left_rest,
        "the sweep must disturb the liquid (restAlpha < 1 somewhere)"
    );
    let mut reformed_at = None;
    for f in 1..=180u32 {
        idle(&mut core, 1);
        if all_at_rest(&core) {
            reformed_at = Some(f);
            break;
        }
    }
    assert!(reformed_at.is_some(), "not re-formed within 3 s");
}

#[test]
fn given_reduced_motion_and_active_pointer_sweep_when_ticking_then_every_particle_stays_on_its_target()
 {
    let mut core = scene(1);
    core.set_reduced_motion(true);
    idle(&mut core, 1);
    run_sweep(&mut core, |c, k| {
        for i in 0..count(c) {
            let (x, y) = c.particle_px(i);
            let (tx, ty) = target(c, i);
            assert!(
                (x - tx).abs() < PIN_TOL_PX && (y - ty).abs() < PIN_TOL_PX,
                "particle {i} off target at frame {k}"
            );
        }
    });
}

#[test]
fn given_nan_pointer_inputs_when_ticking_then_no_panic_and_positions_finite() {
    let mut core = scene(1);
    idle(&mut core, 5);
    for _ in 0..10 {
        let _ = core.tick(DT, f32::NAN, 284.0, f32::INFINITY, 0.0, true, 0.0, 0.0);
        let _ = core.tick(DT, 640.0, 284.0, f32::NAN, f32::NAN, true, 0.0, 0.0);
        let _ = core.tick(DT, 640.0, 284.0, 1e30, -1e30, true, 0.0, 0.0);
    }
    for i in 0..count(&core) {
        let (x, y) = core.particle_px(i);
        assert!(x.is_finite() && y.is_finite(), "particle {i} not finite");
    }
}

#[test]
fn given_same_seed_and_pointer_sweep_when_run_twice_then_positions_bit_identical() {
    let run = || {
        let mut core = scene(7);
        idle(&mut core, 30);
        run_sweep(&mut core, |_, _| {});
        (0..count(&core))
            .map(|i| {
                let (x, y) = core.particle_px(i);
                (x.to_bits(), y.to_bits())
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(run(), run());
}

// ------------------------------------------- D68-10: fused AABB invalidation

/// W67's perf round reuses the particle AABB that the previous G2P collected
/// (`SubstepOpts::reuse_bounds`). Every path that changes particles outside a
/// substep's G2P must forget it (D68-10). The pointer path is covered in
/// `solver.rs` (`given_active_pointer_over_the_block_…`): its invalidation happens
/// before the tick's substeps, which leave a fresh AABB behind.
#[test]
fn given_ticked_core_when_redistribute_splash_shake_reduced_motion_tick_or_set_particle_px_then_fused_aabb_invalidated()
 {
    type Path = (&'static str, fn(&mut FluidCore));
    let paths: [Path; 5] = [
        ("redistribute", |c| c.redistribute()),
        ("splash", |c| c.splash(1, 640.0, 284.0, 1.0)),
        ("shake", |c| c.shake(1.0)),
        ("reduced-motion tick", |c| {
            c.set_reduced_motion(true);
            idle(c, 1);
        }),
        ("set_particle_px", |c| c.set_particle_px(0, 100.0, 100.0)),
    ];
    for (name, path) in paths {
        let mut core = scene(1);
        idle(&mut core, 1);
        assert!(
            core.bounds_reusable(),
            "precondition ({name}): a simulated tick leaves a valid fused AABB"
        );
        path(&mut core);
        assert!(
            !core.bounds_reusable(),
            "{name} must invalidate the fused AABB (D68-10)"
        );
    }
}

// ------------------------------------------------ W70: drag and readable bulge

#[test]
fn given_d70_3_when_reading_the_pointer_constants_then_drag_is_12_per_s_and_radius_stays_70_px() {
    assert_eq!(
        POINTER_DRAG_PER_S, 12.0,
        "D70-3: lowest of [12, 24] (W70 measurements)"
    );
    assert_eq!(POINTER_RADIUS_PX, 70.0);
}

/// D70-3/D70-5 as amended (A2): a 600 px/s sweep through the pills drags each pill's liquid
/// ≥ 5 px in the sweep direction (mean particle x shift from rest, max over the sweep).
/// Measured pre-plan: drag 6 → 2.86 / 3.33 / 3.10 px, drag 12 → 6.33 / 6.81 / 6.56 px.
const BULGE_MIN_PX: f32 = 5.0;

#[test]
fn given_600px_s_sweep_through_the_pills_when_ticking_then_each_pills_liquid_shifts_at_least_5px_in_the_sweep_direction()
 {
    let mut core = scene(1);
    idle(&mut core, 60);
    assert!(all_at_rest(&core), "precondition: at rest");
    let rest: Vec<(f32, f32)> = (0..count(&core)).map(|i| core.particle_px(i)).collect();
    let ids: Vec<Vec<usize>> = (0..BUTTONS.len() as u32)
        .map(|id| core.particle_indices_of(id))
        .collect();
    let mut best = [f32::NEG_INFINITY; 3];
    run_sweep(&mut core, |c, _| {
        for (b, pill) in ids.iter().enumerate() {
            let n = pill.len().max(1) as f32;
            let dx = pill
                .iter()
                .map(|&i| c.particle_px(i).0 - rest.get(i).map_or(0.0, |r| r.0))
                .sum::<f32>()
                / n;
            if let Some(slot) = best.get_mut(b) {
                *slot = slot.max(dx);
            }
        }
    });
    eprintln!("W70 D70-3 evidence: max mean x shift per pill [Splash, Split, Merge] = {best:?} px");
    for (b, &dx) in best.iter().enumerate() {
        assert!(
            dx >= BULGE_MIN_PX,
            "pill {b}: mean x shift {dx} px < {BULGE_MIN_PX} px (bulge not readable)"
        );
    }
}
