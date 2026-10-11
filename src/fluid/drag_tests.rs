//! W78: drag the liquid (slice-5 design §4; spec §2 damage rules, hover and the drag row;
//! D78-3, D78-4, D78-5).
//!
//! Unit tests drive `Elements` and `interaction::hold_dragged` directly; scenario tests drive
//! the real `FluidCore` over the acceptance layout (W68's `pointer_hover_tests` layout: three
//! buttons 140×48 r24 at y 260, card 320×180 r16 at y 340, 1280×800). "Merge" is dragged
//! 150 px straight up into free space, so no neighbour is overlapped: the merge is W79.

use super::api::FluidCore;
use super::elements::Elements;
use super::interaction::{DRAG_STIFFNESS_CAP, hold_dragged};
use super::layout::{
    EL_HOME_DX, EL_HOME_DY, EL_INTERACTION, EL_X, ELEMENT_STRIDE, INTERACTION_DRAGGED,
    INTERACTION_FOCUSED, INTERACTION_HOVER, INTERACTION_IDLE, ST_REST_ALPHA, ST_S, STATE_STRIDE,
};

const DT: f32 = 1.0 / 60.0;

/// x, y, w, h, radius in px.
type Bx = (f32, f32, f32, f32, f32);
const SPLASH: Bx = (406.0, 260.0, 140.0, 48.0, 24.0);
const SPLIT: Bx = (570.0, 260.0, 140.0, 48.0, 24.0);
const MERGE: Bx = (734.0, 260.0, 140.0, 48.0, 24.0);
const CARD: Bx = (480.0, 340.0, 320.0, 180.0, 16.0);
const LAYOUT: [Bx; 4] = [SPLASH, SPLIT, MERGE, CARD];
const MERGE_ID: usize = 2;
const CARD_ID: usize = 3;
/// Σ rounded-rect areas of the layout (3 × 6225.6 + 57380.3), as in pointer_hover_tests.
const AREA_HINT_PX2: f32 = 76_057.0;
/// Tallest element (the card): W64's margin rule B15 gives max(200, 180) = 200 px.
const MAX_ELEMENT_H_PX: f32 = 180.0;
/// The drag: 150 px straight up in 10 frames (900 px/s) into the empty band above the buttons.
const DRAG_DY_PX: f32 = -150.0;
const RAMP_FRAMES: u32 = 10;
/// NORTH-STAR step 5: both re-form within 3 s.
const REFORM_FRAMES: u32 = 180;

fn element(b: Bx, interaction: f32, dx: f32, dy: f32) -> [f32; ELEMENT_STRIDE] {
    [
        b.0,
        b.1,
        b.2,
        b.3,
        b.4,
        interaction,
        dx,
        dy,
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
    for (id, b) in LAYOUT.iter().enumerate() {
        core.write_element(id, element(*b, INTERACTION_IDLE, 0.0, 0.0));
    }
    core.redistribute();
    core
}

fn idle(core: &mut FluidCore, frames: u32) {
    for _ in 0..frames {
        let _ = core.tick(DT, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0);
    }
}

/// Frame `f` (1-based) of the ramp: the offset grows linearly to DRAG_DY_PX, then holds.
fn ramp_dy(f: u32) -> f32 {
    DRAG_DY_PX * f.min(RAMP_FRAMES) as f32 / RAMP_FRAMES as f32
}

fn drag_merge(core: &mut FluidCore, dx: f32, dy: f32) {
    core.write_element(MERGE_ID, element(MERGE, INTERACTION_DRAGGED, dx, dy));
}

fn release_merge(core: &mut FluidCore) {
    core.write_element(MERGE_ID, element(MERGE, INTERACTION_IDLE, 0.0, 0.0));
}

fn rest_alpha(core: &FluidCore, id: usize) -> f32 {
    core.state(id)
        .get(ST_REST_ALPHA)
        .copied()
        .unwrap_or(f32::NAN)
}

fn all_at_rest(core: &FluidCore) -> bool {
    (0..LAYOUT.len()).all(|id| rest_alpha(core, id) >= 1.0)
}

fn positions(core: &FluidCore, id: usize) -> Vec<(f32, f32)> {
    core.particle_indices_of(id as u32)
        .into_iter()
        .map(|i| core.particle_px(i))
        .collect()
}

fn centroid(core: &FluidCore, id: usize) -> (f32, f32) {
    let ps = positions(core, id);
    let n = ps.len().max(1) as f32;
    let (sx, sy) = ps
        .iter()
        .fold((0.0f32, 0.0f32), |(sx, sy), &(x, y)| (sx + x, sy + y));
    (sx / n, sy / n)
}

fn elements_with(slots: &[[f32; ELEMENT_STRIDE]]) -> Elements {
    let mut e = Elements::new(slots.len().max(1));
    for (id, s) in slots.iter().enumerate() {
        e.buf[id * ELEMENT_STRIDE..(id + 1) * ELEMENT_STRIDE].copy_from_slice(s);
    }
    e
}

// ---------------------------------------------------------------- unit: Elements

#[test]
fn given_slot_5_values_when_is_dragged_then_true_only_within_half_of_dragged() {
    let mut e = elements_with(&[element(MERGE, INTERACTION_DRAGGED, 0.0, 0.0)]);
    assert!(e.is_dragged(0), "3 is DRAGGED");
    for v in [
        INTERACTION_IDLE,
        INTERACTION_HOVER,
        INTERACTION_FOCUSED,
        2.4,
        3.6,
        f32::NAN,
        f32::INFINITY,
    ] {
        e.buf[EL_INTERACTION] = v;
        assert!(!e.is_dragged(0), "{v} is not DRAGGED");
    }
    assert!(
        !e.is_dragged(1) && !e.is_dragged(usize::MAX),
        "an out-of-range id is never dragged"
    );
}

#[test]
fn given_a_dragged_element_whose_offset_grows_when_update_velocities_then_the_home_velocity_includes_the_offset_delta()
 {
    let mut e = elements_with(&[element(MERGE, INTERACTION_DRAGGED, 0.0, 0.0)]);
    e.update_velocities(DT); // first sample: 0
    e.buf[EL_HOME_DX] = -6.0;
    e.buf[EL_HOME_DY] = 4.0;
    e.update_velocities(DT);
    assert!(
        (e.vel_x[0] + 360.0).abs() < 0.05 && (e.vel_y[0] - 240.0).abs() < 0.05,
        "offset (−6, +4) px in 1/60 s = (−360, 240) px/s, got ({}, {})",
        e.vel_x[0],
        e.vel_y[0]
    );
    e.buf[EL_X] += 2.0;
    e.buf[EL_HOME_DX] = -12.0;
    e.update_velocities(DT);
    assert!(
        (e.vel_x[0] + 240.0).abs() < 0.05,
        "rect +2 px and offset −6 px in 1/60 s: −240 px/s, got {}",
        e.vel_x[0]
    );
    assert!(
        e.vel_y[0].abs() < 1e-3,
        "offset y unchanged: 0, got {}",
        e.vel_y[0]
    );
}

#[test]
fn given_a_drag_released_or_a_stray_offset_on_an_idle_element_when_update_velocities_then_the_offset_adds_no_velocity()
 {
    let mut e = elements_with(&[
        element(MERGE, INTERACTION_DRAGGED, -150.0, 80.0),
        element(SPLIT, INTERACTION_IDLE, 0.0, 0.0),
    ]);
    e.update_velocities(DT);
    e.update_velocities(DT);
    assert!(
        e.vel_x[0].abs() < 1e-3 && e.vel_y[0].abs() < 1e-3,
        "a drag held still: 0"
    );
    // Release: slot 5 → 0 and the offset → 0 in one frame. The anchor returns to the DOM rect;
    // no −offset/dt spike (+9000, −4800 px/s) reaches the spring damping (design resolution 3).
    e.buf[EL_INTERACTION] = INTERACTION_IDLE;
    e.buf[EL_HOME_DX] = 0.0;
    e.buf[EL_HOME_DY] = 0.0;
    e.update_velocities(DT);
    assert!(
        e.vel_x[0].abs() < 1e-3 && e.vel_y[0].abs() < 1e-3,
        "release frame: 0, got ({}, {})",
        e.vel_x[0],
        e.vel_y[0]
    );
    // An idle element's offset (TS never writes one) is not a velocity either.
    e.buf[ELEMENT_STRIDE + EL_HOME_DX] = 40.0;
    e.update_velocities(DT);
    assert!(
        e.vel_x[1].abs() < 1e-3,
        "idle offset: 0, got {}",
        e.vel_x[1]
    );
}

#[test]
fn given_d78_cap_when_hold_dragged_then_a_dragged_element_gets_s_at_most_0_5_and_rest_alpha_0_and_an_idle_one_is_untouched()
 {
    assert_eq!(
        DRAG_STIFFNESS_CAP, 0.5,
        "spec §2: drag sets s ← min(s, 0.5)"
    );
    let mut e = elements_with(&[
        element(MERGE, INTERACTION_DRAGGED, 0.0, -40.0),
        element(SPLIT, INTERACTION_IDLE, 0.0, 0.0),
    ]);
    for id in 0..2 {
        e.state[id * STATE_STRIDE + ST_REST_ALPHA] = 1.0;
    }
    hold_dragged(&mut e);
    assert_eq!(
        (e.stiffness[0], e.state[ST_S], e.state[ST_REST_ALPHA]),
        (0.5, 0.5, 0.0),
        "dragged: s 0.5, restAlpha 0 (D78-5)"
    );
    assert_eq!(
        (e.stiffness[1], e.state[STATE_STRIDE + ST_REST_ALPHA]),
        (1.0, 1.0),
        "idle: untouched"
    );
    e.stiffness[0] = 0.2;
    hold_dragged(&mut e);
    assert_eq!(
        e.stiffness[0], 0.2,
        "min(s, cap): a softer element stays softer"
    );
}

// ------------------------------------------------------------ scenario: FluidCore

#[test]
fn given_merge_dragged_then_held_still_when_ticking_90_frames_then_its_s_never_exceeds_0_5_its_rest_alpha_stays_0_and_the_others_keep_s_1()
 {
    let mut core = scene(1);
    idle(&mut core, 30);
    for f in 1..=90u32 {
        drag_merge(&mut core, 0.0, ramp_dy(f));
        idle(&mut core, 1);
        let s = core.stiffness_of(MERGE_ID);
        assert!(
            s <= DRAG_STIFFNESS_CAP + 1e-6,
            "frame {f}: Merge s {s} > 0.5 (D78-3)"
        );
        assert_eq!(
            rest_alpha(&core, MERGE_ID),
            0.0,
            "frame {f}: a dragged element never rests (D78-5)"
        );
        for id in [0, 1, CARD_ID] {
            assert_eq!(
                core.stiffness_of(id),
                1.0,
                "frame {f}: element {id} is not softened in W78"
            );
        }
    }
}

#[test]
fn given_merge_dragged_150px_up_when_ticking_then_its_liquid_follows_the_displaced_home() {
    let mut core = scene(1);
    idle(&mut core, 30);
    for f in 1..=RAMP_FRAMES + 50 {
        drag_merge(&mut core, 0.0, ramp_dy(f));
        idle(&mut core, 1);
    }
    let (cx, cy) = centroid(&core, MERGE_ID);
    let (hx, hy) = (
        MERGE.0 + MERGE.2 / 2.0,
        MERGE.1 + MERGE.3 / 2.0 + DRAG_DY_PX,
    );
    assert!(
        (cx - hx).abs() < 8.0 && (cy - hy).abs() < 8.0,
        "Merge's liquid sits at its displaced home: centroid ({cx}, {cy}) vs ({hx}, {hy})"
    );
}

/// 30 idle frames, Merge displaced 150 px up (as a held drag when `dragged`, else as a stray idle
/// offset Rust still honours), 60 frames to settle, then 30 frames with the pointer resting at the
/// displaced centre while moving at 600 px/s (+x). Split (94 px away) and the card (206 px) are
/// outside the 70 px field.
fn pointer_run(dragged: bool, pointer: bool) -> Vec<(f32, f32)> {
    let mut core = scene(1);
    idle(&mut core, 30);
    let interaction = if dragged {
        INTERACTION_DRAGGED
    } else {
        INTERACTION_IDLE
    };
    core.write_element(MERGE_ID, element(MERGE, interaction, 0.0, DRAG_DY_PX));
    idle(&mut core, 60);
    let (px, py) = (
        MERGE.0 + MERGE.2 / 2.0,
        MERGE.1 + MERGE.3 / 2.0 + DRAG_DY_PX,
    );
    for _ in 0..30 {
        let _ = core.tick(DT, px, py, 600.0, 0.0, pointer, 0.0, 0.0);
    }
    positions(&core, MERGE_ID)
}

#[test]
fn given_the_pointer_moving_over_dragged_merge_when_ticking_then_its_liquid_moves_as_without_the_pointer_and_an_idle_merge_is_pushed()
 {
    let (with, without) = (pointer_run(true, true), pointer_run(true, false));
    let worst = with
        .iter()
        .zip(&without)
        .map(|(a, b)| (a.0 - b.0).abs().max((a.1 - b.1).abs()))
        .fold(0.0f32, f32::max);
    assert!(
        worst < 1e-3,
        "the pointer field skips the dragged element's particles (D78-4): worst {worst} px"
    );
    let (idle_with, idle_without) = (pointer_run(false, true), pointer_run(false, false));
    let mean_dx = idle_with
        .iter()
        .zip(&idle_without)
        .map(|(a, b)| a.0 - b.0)
        .sum::<f32>()
        / idle_with.len().max(1) as f32;
    assert!(
        mean_dx >= 0.5,
        "control: the same pointer pushes an idle Merge's liquid (+x), mean dx {mean_dx} px"
    );
}

#[test]
fn given_merge_dragged_150px_up_held_60_frames_and_released_when_ticking_then_it_never_rests_while_dragged_and_every_rest_alpha_is_1_within_180_frames()
 {
    let mut core = scene(1);
    idle(&mut core, 30);
    assert!(all_at_rest(&core), "precondition: at rest after 30 frames");
    for f in 1..=RAMP_FRAMES + 60 {
        drag_merge(&mut core, 0.0, ramp_dy(f));
        idle(&mut core, 1);
    }
    assert!(
        rest_alpha(&core, MERGE_ID) < 1.0,
        "held 60 frames at its displaced home: still not at rest (D78-5)"
    );
    release_merge(&mut core);
    let mut reformed = None;
    for f in 1..=REFORM_FRAMES {
        idle(&mut core, 1);
        if all_at_rest(&core) {
            reformed = Some(f);
            break;
        }
    }
    println!("W78 drag re-form after release: {reformed:?} frames");
    assert!(
        reformed.is_some(),
        "not every element re-formed within {REFORM_FRAMES} frames after the release"
    );
}
