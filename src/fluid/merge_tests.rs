//! W79: merge and separate (slice-5 design §5; D79-2, D79-4).
//!
//! Unit tests drive `rects_overlap`, `Elements` and `interaction::hold_dragged` directly;
//! scenario tests drive the real `FluidCore` over the acceptance layout (W78's `drag_tests`
//! layout: three buttons 140×48 r24 at y 260, card 320×180 r16 at y 340, 1280×800). "Merge" is
//! dragged centre to centre into the card: its offset ramps to (−164, +146) px over 10 frames,
//! holds 90 frames (D79-4) and is released. Shared MPM liquid couples neighbours (W78 lesson):
//! no test here demands bit-identical motion next to a pushed neighbour.

use super::api::FluidCore;
use super::elements::{Elements, Rect, rects_overlap};
use super::interaction::{
    DRAG_STIFFNESS_CAP, NEIGHBOUR_MARGIN_PX, NEIGHBOUR_STIFFNESS_CAP, hold_dragged,
};
use super::layout::{
    ELEMENT_STRIDE, INTERACTION_DRAGGED, INTERACTION_IDLE, ST_REST_ALPHA, ST_S, STATE_STRIDE,
};
use super::solver::{
    MERGE_SLIP_MAX_PX_S, MERGE_SLIP_RATE_PER_S, SLIP_MAX_PX_S, SLIP_RATE_PER_S, slip_velocity,
    slip_velocity_at,
};

const DT: f32 = 1.0 / 60.0;

/// x, y, w, h, radius in px.
type Bx = (f32, f32, f32, f32, f32);
const SPLASH: Bx = (406.0, 260.0, 140.0, 48.0, 24.0);
const SPLIT: Bx = (570.0, 260.0, 140.0, 48.0, 24.0);
const MERGE: Bx = (734.0, 260.0, 140.0, 48.0, 24.0);
const CARD: Bx = (480.0, 340.0, 320.0, 180.0, 16.0);
const LAYOUT: [Bx; 4] = [SPLASH, SPLIT, MERGE, CARD];
const SPLASH_ID: usize = 0;
const SPLIT_ID: usize = 1;
const MERGE_ID: usize = 2;
const CARD_ID: usize = 3;
/// Σ rounded-rect areas of the layout, as in drag_tests.
const AREA_HINT_PX2: f32 = 76_057.0;
const MAX_ELEMENT_H_PX: f32 = 180.0;
/// Merge's centre (804, 284) to the card's centre (640, 430), as the e2e drags it.
const TO_CARD: (f32, f32) = (-164.0, 146.0);
const RAMP_FRAMES: u32 = 10;
/// D79-4: the merge is held 90 frames (spike W78.0: a 30-frame hold is only a partial merge).
const HOLD_FRAMES: u32 = 90;
/// NORTH-STAR step 5: both re-form within 3 s.
const REFORM_FRAMES: u32 = 180;
/// W79 plan validation (seed 1, hold 90): room 0.153 with W79, 0.023 with W78 alone.
const ROOM_MIN: f32 = 0.10;
/// W79 plan validation (seed 1, hold 90): Merge in 0.734 with W79, 0.479 with W78 alone.
const MERGE_IN_MIN: f32 = 0.6;

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

/// Frame `f` (1-based) of the drag: the offset ramps linearly to TO_CARD, then holds.
fn drag_frame(core: &mut FluidCore, f: u32) {
    let k = f.min(RAMP_FRAMES) as f32 / RAMP_FRAMES as f32;
    core.write_element(
        MERGE_ID,
        element(MERGE, INTERACTION_DRAGGED, TO_CARD.0 * k, TO_CARD.1 * k),
    );
    idle(core, 1);
}

fn release(core: &mut FluidCore) {
    core.write_element(MERGE_ID, element(MERGE, INTERACTION_IDLE, 0.0, 0.0));
}

fn s_of(core: &FluidCore, id: usize) -> f32 {
    core.state(id).get(ST_S).copied().unwrap_or(f32::NAN)
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

/// `(x, y, w, h)` of a box, optionally moved.
fn rect_of(b: Bx, dx: f32, dy: f32) -> (f32, f32, f32, f32) {
    (b.0 + dx, b.1 + dy, b.2, b.3)
}

fn inside(p: (f32, f32), r: (f32, f32, f32, f32), inset: f32) -> bool {
    p.0 >= r.0 + inset && p.0 <= r.0 + r.2 - inset && p.1 >= r.1 + inset && p.1 <= r.1 + r.3 - inset
}

fn rect(x: f32, y: f32, w: f32, h: f32) -> Rect {
    Rect { x, y, w, h, r: 0.0 }
}

fn elements_with(slots: &[[f32; ELEMENT_STRIDE]]) -> Elements {
    let mut e = Elements::new(slots.len().max(1));
    for (id, s) in slots.iter().enumerate() {
        e.buf[id * ELEMENT_STRIDE..(id + 1) * ELEMENT_STRIDE].copy_from_slice(s);
        e.state[id * STATE_STRIDE + ST_REST_ALPHA] = 1.0;
    }
    e
}

#[test]
fn given_rects_15_or_17_px_apart_when_rects_overlap_with_the_16px_margin_then_only_the_15px_pairs_overlap_on_every_side_and_nan_never_does()
 {
    let a = rect(100.0, 100.0, 50.0, 40.0);
    assert_eq!(NEIGHBOUR_MARGIN_PX, 16.0, "D79-2: the kernel cap");
    for (gap, want) in [(15.0f32, true), (17.0, false)] {
        let right = rect(150.0 + gap, 100.0, 30.0, 30.0);
        let left = rect(100.0 - gap - 30.0, 100.0, 30.0, 30.0);
        let below = rect(100.0, 140.0 + gap, 30.0, 30.0);
        let above = rect(100.0, 100.0 - gap - 30.0, 30.0, 30.0);
        for (b, side) in [
            (right, "right"),
            (left, "left"),
            (below, "below"),
            (above, "above"),
        ] {
            assert_eq!(
                rects_overlap(&a, &b, NEIGHBOUR_MARGIN_PX),
                want,
                "{gap} px {side}"
            );
        }
    }
    assert!(
        !rects_overlap(&a, &rect(166.0, 100.0, 30.0, 30.0), NEIGHBOUR_MARGIN_PX),
        "exactly 16 px apart: open intervals, no overlap"
    );
    assert!(
        rects_overlap(&a, &rect(110.0, 110.0, 5.0, 5.0), 0.0),
        "contained"
    );
    assert!(!rects_overlap(
        &a,
        &rect(f32::NAN, 100.0, 30.0, 30.0),
        NEIGHBOUR_MARGIN_PX
    ));
    assert!(!rects_overlap(
        &rect(100.0, f32::NAN, 50.0, 40.0),
        &a,
        NEIGHBOUR_MARGIN_PX
    ));
}

#[test]
fn given_merge_dragged_onto_the_card_when_hold_dragged_then_the_card_gets_s_at_most_0_2_rest_alpha_0_and_the_merge_slip_and_splash_and_split_are_untouched()
 {
    let mut e = elements_with(&[
        element(SPLASH, INTERACTION_IDLE, 0.0, 0.0),
        element(SPLIT, INTERACTION_IDLE, 0.0, 0.0),
        element(MERGE, INTERACTION_DRAGGED, TO_CARD.0, TO_CARD.1),
        element(CARD, INTERACTION_IDLE, 0.0, 0.0),
    ]);
    hold_dragged(&mut e);
    assert!(
        (e.stiffness[MERGE_ID] - DRAG_STIFFNESS_CAP).abs() < 1e-6,
        "W78: the dragged element is held at 0.5"
    );
    assert!(
        (e.stiffness[CARD_ID] - NEIGHBOUR_STIFFNESS_CAP).abs() < 1e-6,
        "D79-2: the overlapped card is held at 0.2, got {}",
        e.stiffness[CARD_ID]
    );
    assert_eq!(e.state[CARD_ID * STATE_STRIDE + ST_REST_ALPHA], 0.0);
    assert!(
        e.merge_slip(CARD_ID) && e.merge_slip(MERGE_ID),
        "both take the merge slip"
    );
    for id in [SPLASH_ID, SPLIT_ID] {
        assert_eq!(
            e.stiffness[id], 1.0,
            "element {id} is not under the dragged home"
        );
        assert_eq!(e.state[id * STATE_STRIDE + ST_REST_ALPHA], 1.0);
        assert!(!e.merge_slip(id));
    }
}

#[test]
fn given_neighbours_15_and_17_px_from_the_dragged_home_when_hold_dragged_then_only_the_15px_one_is_softened_and_a_second_dragged_element_keeps_its_own_cap()
 {
    // The dragged home is Merge moved 200 px left: (534, 260, 140, 48).
    let near = (674.0 + 15.0, 260.0, 60.0, 48.0, 24.0);
    let far = (534.0, 308.0 + 17.0, 60.0, 48.0, 24.0);
    let mut e = elements_with(&[
        element(MERGE, INTERACTION_DRAGGED, -200.0, 0.0),
        element(near, INTERACTION_IDLE, 0.0, 0.0),
        element(far, INTERACTION_IDLE, 0.0, 0.0),
        element(
            (534.0, 200.0, 140.0, 48.0, 24.0),
            INTERACTION_DRAGGED,
            0.0,
            0.0,
        ),
    ]);
    hold_dragged(&mut e);
    assert!(
        (e.stiffness[1] - NEIGHBOUR_STIFFNESS_CAP).abs() < 1e-6,
        "15 px: softened"
    );
    assert_eq!(e.stiffness[2], 1.0, "17 px: untouched");
    assert!(
        (e.stiffness[3] - DRAG_STIFFNESS_CAP).abs() < 1e-6,
        "a dragged element overlapping another dragged one keeps 0.5, not 0.2"
    );
}

#[test]
fn given_merge_dragged_into_the_card_when_ticking_then_the_cards_s_stays_at_most_0_2_every_held_frame_splash_keeps_s_1_and_split_is_softened_only_while_the_drag_passes_it()
 {
    let mut core = scene(1);
    idle(&mut core, 30);
    assert!(all_at_rest(&core), "precondition: at rest after 30 frames");
    let mut split_min = 1.0f32;
    for f in 1..=RAMP_FRAMES + HOLD_FRAMES {
        drag_frame(&mut core, f);
        assert_eq!(
            s_of(&core, SPLASH_ID),
            1.0,
            "frame {f}: Splash is never under the drag"
        );
        split_min = split_min.min(s_of(&core, SPLIT_ID));
        if f > RAMP_FRAMES {
            assert!(
                s_of(&core, CARD_ID) <= NEIGHBOUR_STIFFNESS_CAP + 1e-6,
                "frame {f}: the card is held at s ≤ 0.2 (D79-2), got {}",
                s_of(&core, CARD_ID)
            );
            assert!(
                rest_alpha(&core, CARD_ID) < 1.0,
                "frame {f}: an overlapped card never rests"
            );
        }
    }
    assert!(
        split_min <= NEIGHBOUR_STIFFNESS_CAP + 1e-6,
        "the ramp passes Split (ramp frames 1–4 overlap it): min s {split_min}"
    );
    assert!(
        s_of(&core, SPLIT_ID) > 0.5,
        "Split recovers once the drag has passed it: s {}",
        s_of(&core, SPLIT_ID)
    );
}

#[test]
fn given_the_drag_released_after_the_merge_when_ticking_then_the_damage_stops_the_cards_s_rises_every_frame_and_its_merge_slip_ends_at_rest()
 {
    let mut core = scene(1);
    idle(&mut core, 30);
    for f in 1..=RAMP_FRAMES + HOLD_FRAMES {
        drag_frame(&mut core, f);
    }
    assert!(
        s_of(&core, CARD_ID) <= NEIGHBOUR_STIFFNESS_CAP + 1e-6,
        "precondition: the card is softened at the release, s {}",
        s_of(&core, CARD_ID)
    );
    assert!(
        core.merge_slip_of(CARD_ID),
        "precondition: the card has the merge slip"
    );
    release(&mut core);
    let mut prev = s_of(&core, CARD_ID);
    let mut passed = None;
    for f in 1..=125u32 {
        idle(&mut core, 1);
        let s = s_of(&core, CARD_ID);
        assert!(
            s > prev,
            "frame {f}: no damage after the release, s rises ({prev} → {s})"
        );
        prev = s;
        if s > 0.95 {
            passed = Some(f);
            break;
        }
    }
    // 0.2 → 0.95 at recovery 0.7 s: 0.7·ln(0.8/0.05) = 1.94 s = 117 frames.
    assert!(passed.is_some(), "s passes 0.95 within 125 frames: {prev}");
    let mut rested = false;
    for _ in 0..REFORM_FRAMES {
        idle(&mut core, 1);
        if rest_alpha(&core, CARD_ID) >= 1.0 {
            rested = true;
            break;
        }
    }
    assert!(rested, "the card rests again");
    assert!(!core.merge_slip_of(CARD_ID), "at rest the merge slip ends");
}

#[test]
fn given_slip_velocity_at_when_called_with_the_merge_rate_then_4_5_per_s_capped_at_240_px_s_and_with_the_base_rate_bit_identical_to_slip_velocity()
 {
    assert_eq!(
        (MERGE_SLIP_RATE_PER_S, MERGE_SLIP_MAX_PX_S),
        (4.5, 240.0),
        "D79-2 (spike W78.0 answer 1)"
    );
    assert_eq!(
        (SLIP_RATE_PER_S, SLIP_MAX_PX_S),
        (3.0, 160.0),
        "the base slip is unchanged"
    );
    let (sx, sy) = slip_velocity_at((10.0, 0.0), 1.0, MERGE_SLIP_RATE_PER_S, MERGE_SLIP_MAX_PX_S);
    assert!(
        (sx - 45.0).abs() < 1e-4 && sy == 0.0,
        "4.5/s × 10 px = 45 px/s: {sx}"
    );
    let (sx, _) = slip_velocity_at(
        (100.0, 0.0),
        1.0,
        MERGE_SLIP_RATE_PER_S,
        MERGE_SLIP_MAX_PX_S,
    );
    assert!((sx - 240.0).abs() < 1e-3, "capped at 240 px/s: {sx}");
    let (sx, _) = slip_velocity_at((10.0, 0.0), 0.5, MERGE_SLIP_RATE_PER_S, MERGE_SLIP_MAX_PX_S);
    assert!((sx - 11.25).abs() < 1e-4, "× s²: {sx}");
    for (off, s) in [
        ((10.0f32, -3.0f32), 1.0f32),
        ((0.7, 0.2), 0.3),
        ((500.0, 1.0), 0.015),
    ] {
        assert_eq!(
            slip_velocity_at(off, s, SLIP_RATE_PER_S, SLIP_MAX_PX_S),
            slip_velocity(off, s, SLIP_MAX_PX_S),
            "the base rate is W67's arithmetic, bit for bit"
        );
    }
}

#[test]
fn given_merge_slip_set_when_the_element_comes_to_rest_its_slot_resets_or_reduced_motion_pins_it_then_it_clears()
 {
    let mut e = elements_with(&[element(CARD, INTERACTION_IDLE, 0.0, 0.0)]);
    e.state[ST_REST_ALPHA] = 0.0;
    e.set_merge_slip(0, true);
    assert!(e.merge_slip(0), "set");
    e.update_rest_state_with_f(0, 0.1, 0.0, DT, false);
    assert!(e.merge_slip(0), "kept while restAlpha < 1");
    for _ in 0..30 {
        e.update_rest_state_with_f(0, 0.1, 0.0, DT, false);
    }
    assert_eq!(e.state[ST_REST_ALPHA], 1.0, "precondition: at rest");
    assert!(!e.merge_slip(0), "cleared at rest");
    e.set_merge_slip(0, true);
    e.reset_slot(0);
    assert!(!e.merge_slip(0), "cleared by reset_slot");
    e.set_merge_slip(0, true);
    e.update_rest_state_with_f(0, 9.0, 0.0, DT, true);
    assert!(
        !e.merge_slip(0),
        "cleared when reduced motion pins the element"
    );
    e.set_merge_slip(7, true);
    assert!(!e.merge_slip(7), "out of range: no-op, false");
}

#[test]
fn given_merge_dragged_into_the_card_held_90_frames_and_released_when_ticking_then_the_card_made_room_merge_sits_inside_they_separate_and_every_rest_alpha_is_1_within_180_frames()
 {
    let mut core = scene(1);
    idle(&mut core, 30);
    for f in 1..=RAMP_FRAMES + HOLD_FRAMES {
        drag_frame(&mut core, f);
    }
    let dragged = rect_of(MERGE, TO_CARD.0, TO_CARD.1);
    let (mut want, mut out) = (0u32, 0u32);
    for i in core.particle_indices_of(CARD_ID as u32) {
        if core.target_px(i).is_some_and(|t| inside(t, dragged, 0.0)) {
            want += 1;
            if !inside(core.particle_px(i), dragged, 0.0) {
                out += 1;
            }
        }
    }
    let room = out as f32 / want.max(1) as f32;
    let merge = core.particle_indices_of(MERGE_ID as u32);
    let merge_in = merge
        .iter()
        .filter(|&&i| inside(core.particle_px(i), dragged, 0.0))
        .count() as f32
        / merge.len().max(1) as f32;
    release(&mut core);
    let mut reformed = None;
    for f in 1..=REFORM_FRAMES {
        idle(&mut core, 1);
        if all_at_rest(&core) {
            reformed = Some(f);
            break;
        }
    }
    let mixing = |a: usize, home: Bx| {
        core.particle_indices_of(a as u32)
            .into_iter()
            .filter(|&i| inside(core.particle_px(i), rect_of(home, 0.0, 0.0), 4.0))
            .count()
    };
    let (m2c, c2m) = (mixing(MERGE_ID, CARD), mixing(CARD_ID, MERGE));
    println!(
        "W79 merge (hold {HOLD_FRAMES}): room {room:.3} ({out}/{want}), Merge in {merge_in:.3}, every restAlpha 1 after {reformed:?} frames, mixing {m2c}/{c2m}"
    );
    assert!(
        room >= ROOM_MIN,
        "the card made room for Merge (displacement merge): {room}"
    );
    assert!(
        merge_in >= MERGE_IN_MIN,
        "Merge's liquid sits in the card: {merge_in}"
    );
    assert!(
        reformed.is_some(),
        "not every element re-formed within {REFORM_FRAMES} frames after the release"
    );
    assert_eq!(
        (m2c, c2m),
        (0, 0),
        "separated: no particle rests in the other's rect"
    );
}

#[test]
fn given_reduced_motion_and_merge_dragged_over_the_card_when_ticking_then_no_element_is_softened() {
    let mut core = scene(1);
    core.set_reduced_motion(true);
    idle(&mut core, 5);
    for f in 1..=RAMP_FRAMES + 20 {
        drag_frame(&mut core, f);
        for id in 0..LAYOUT.len() {
            assert_eq!(
                s_of(&core, id),
                1.0,
                "frame {f}: element {id} under reduced motion"
            );
        }
    }
    assert!(!core.merge_slip_of(CARD_ID));
}
