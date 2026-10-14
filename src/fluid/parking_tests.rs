//! W81: parking and resize (slice-6 design §4; spec §2 grid and "Walls and off-screen elements";
//! D81-1, D81-2).
//!
//! Scenario tests drive the real `FluidCore` over the acceptance layout (`scenario_tests`) plus a
//! far card (`FAR_ID`, 320×160 r16, 2400 px down: entirely below the world 1280×800 plus the
//! 200 px margin, so it parks). A page scrolled by `S` px is driven the way TS drives it (W80):
//! every rect is written `S` px higher, then `scroll_shift(0, Δ, 0, 0)` runs before the tick.
//! `set_parking_off(true)` is the test-only switch that runs the W80 engine for comparison.
#![allow(clippy::needless_range_loop)]

use super::api::FluidCore;
use super::elements::Rect;
use super::grid::{Grid, WORLD_MAX_PX};
use super::layout::{FLAG_PARKED, INTERACTION_DRAGGED, ST_MAX_DEV, ST_REST_ALPHA, ST_S};
use super::parking::{Bounds, UNPARK_INSET_PX, bound, inside_by, outside, overlaps, world};
use super::scenario_tests::{AREA_HINT_PX2, CARD, LAYOUT, SEED, acceptance_core, frames, slot};

const DT: f32 = 1.0 / 60.0;
const FAR_ID: usize = 4;
/// Entirely below the bound (800 + 200 px) at scroll 0.
const FAR_RECT: [f32; 5] = [480.0, 2400.0, 320.0, 160.0, 16.0];
/// f32 rounding of a placed position (px).
const PLACE_EPS_PX: f32 = 1e-3;
/// W80's bound for "equal to the unscrolled core up to f32 rounding".
const ROUNDING_PX: f32 = 0.01;
/// Home velocity (px/s) that still counts as zero.
const HOME_V_EPS: f32 = 1e-3;

fn frame(core: &mut FluidCore) -> u32 {
    core.tick(DT, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0)
}

/// The acceptance layout plus the far card, scrolled `scroll_y` px down.
fn write_all(core: &mut FluidCore, scroll_y: f32) {
    for (id, e) in LAYOUT.iter().enumerate() {
        let mut r = *e;
        r[1] -= scroll_y;
        core.write_element(id, slot(r));
    }
    let mut far = FAR_RECT;
    far[1] -= scroll_y;
    core.write_element(FAR_ID, slot(far));
}

fn far_core(parking: bool) -> FluidCore {
    let mut c = FluidCore::new(8000, 32, 1280.0, 800.0, AREA_HINT_PX2, 180.0, SEED);
    c.set_parking_off(!parking);
    write_all(&mut c, 0.0);
    c.redistribute();
    c
}

/// One frame of the page scrolled from `from` to `to` px (no inertia): rects, shift, tick.
fn scroll_frame(core: &mut FluidCore, from: f32, to: f32) {
    write_all(core, to);
    core.scroll_shift(0.0, to - from, 0.0, 0.0);
    frame(core);
}

/// Grid-unit positions and velocities (bits) of the elements' particles, in index order.
fn bits_of(core: &FluidCore, ids: &[usize]) -> Vec<u32> {
    let (pos, vel) = (core.position_bits(), core.velocity_bits());
    let n = core.particle_capacity() as usize;
    let mut out = Vec::new();
    for &id in ids {
        for i in core.particle_indices_of(id as u32) {
            out.extend([pos[i], pos[n + i], vel[i], vel[n + i]]);
        }
    }
    out
}

fn worst_target_dev(core: &FluidCore, id: usize) -> f32 {
    core.particle_indices_of(id as u32)
        .into_iter()
        .map(|i| {
            let (x, y) = core.particle_px(i);
            let (tx, ty) = core.target_px(i).unwrap();
            (x - tx).hypot(y - ty)
        })
        .fold(0.0, f32::max)
}

fn rect(x: f32, y: f32, w: f32, h: f32) -> Rect {
    Rect { x, y, w, h, r: 0.0 }
}

// ---------------------------------------------------------------- unit: geometry, resize

#[test]
fn given_the_world_and_margin_when_the_bounds_are_read_then_outside_inside_by_and_overlaps_follow_d81_1()
 {
    let g = Grid::new(1280.0, 800.0, 6.166, 200.0);
    let b = bound(&g);
    assert_eq!(
        b,
        Bounds {
            x0: -200.0,
            y0: -200.0,
            x1: 1480.0,
            y1: 1000.0
        }
    );
    assert_eq!(
        world(&g),
        Bounds {
            x0: 0.0,
            y0: 0.0,
            x1: 1280.0,
            y1: 800.0
        }
    );
    assert_eq!(UNPARK_INSET_PX, 64.0, "D81-1");
    assert!(
        outside(&rect(480.0, 1000.0, 320.0, 160.0), &b),
        "touching the bound counts as outside"
    );
    assert!(
        !outside(&rect(480.0, 999.0, 320.0, 160.0), &b),
        "1 px inside: not outside"
    );
    assert!(
        outside(&rect(-400.0, 300.0, 200.0, 48.0), &b),
        "left of the bound"
    );
    assert!(
        inside_by(&rect(480.0, 776.0, 320.0, 160.0), &b, 64.0),
        "bottom edge at 1000 − 64"
    );
    assert!(!inside_by(&rect(480.0, 777.0, 320.0, 160.0), &b, 64.0));
    assert!(
        inside_by(&rect(-136.0, 300.0, 200.0, 48.0), &b, 64.0),
        "left edge at −200 + 64"
    );
    assert!(
        !inside_by(&rect(-150.0, 300.0, 200.0, 48.0), &b, 64.0),
        "left edge 50 px inside: not 64"
    );
    assert!(
        inside_by(&rect(1096.0, 300.0, 320.0, 48.0), &b, 64.0),
        "right edge at 1480 − 64"
    );
    assert!(
        !inside_by(&rect(1100.0, 300.0, 320.0, 48.0), &b, 64.0),
        "right edge 60 px inside: not 64"
    );
    assert!(
        inside_by(&rect(0.0, 0.0, 1280.0, 800.0), &b, 64.0),
        "inside by ≥ 64 on all four sides"
    );
    assert!(overlaps(&rect(480.0, 799.0, 320.0, 160.0), &world(&g)));
    assert!(
        !overlaps(&rect(480.0, 800.0, 320.0, 160.0), &world(&g)),
        "touching the world is no overlap"
    );
    let nan = rect(f32::NAN, 0.0, 10.0, 10.0);
    assert!(
        !outside(&nan, &b) && !inside_by(&nan, &b, 64.0) && !overlaps(&nan, &b),
        "NaN: none of them"
    );
}

#[test]
fn given_a_world_when_resize_world_then_it_grows_never_shrinks_clamps_and_keeps_the_origin_and_the_lattice_phase()
 {
    let mut g = Grid::new(1280.0, 800.0, 6.166, 200.0);
    g.scroll_origin(0.0, 157.0); // a W80 drift of the lattice origin
    let (ox, oy, base) = (g.origin_x_px, g.origin_y_px, g.base_origin_px);
    let (w0, h0) = (g.w, g.h);
    assert!(!g.resize_world(1000.0, 600.0), "smaller: no change");
    assert!(
        !g.resize_world(f32::NAN, -5.0),
        "NaN and ≤ 0 keep both axes"
    );
    assert_eq!(
        (g.w, g.h, g.world_w_px, g.world_h_px),
        (w0, h0, 1280.0, 800.0)
    );
    assert!(g.resize_world(1920.0, 700.0), "wider: grows (height kept)");
    assert_eq!((g.world_w_px, g.world_h_px), (1920.0, 800.0));
    let fresh = Grid::new(1920.0, 800.0, 6.166, 200.0);
    assert_eq!(
        (g.w, g.h),
        (fresh.w, fresh.h),
        "the same cells as a grid built for that world"
    );
    assert_eq!(g.mass.len(), g.w * g.h);
    assert_eq!((g.mvx.len(), g.mvy.len()), (g.w * g.h, g.w * g.h));
    assert_eq!(
        (g.origin_x_px, g.origin_y_px, g.base_origin_px),
        (ox, oy, base),
        "origin and base kept: the lattice phase survives the resize"
    );
    assert!(
        g.resize_world(1e9, f32::INFINITY),
        "clamped to WORLD_MAX_PX; Inf keeps its axis"
    );
    assert_eq!((g.world_w_px, g.world_h_px), (WORLD_MAX_PX, 800.0));
    assert!(
        !g.resize_world(WORLD_MAX_PX + 1.0, 800.0),
        "at the cap: no change"
    );
}

// ---------------------------------------------------------------- scenario: parking

#[test]
fn given_an_element_entirely_below_the_world_plus_margin_when_redistributed_and_ticked_then_it_is_parked_at_rest_and_every_one_of_its_particles_carries_flag_parked()
 {
    let mut c = far_core(true);
    assert!(c.is_parked_of(FAR_ID), "parked from the first redistribute");
    for id in 0..4 {
        assert!(!c.is_parked_of(id), "acceptance element {id} is on screen");
    }
    let far = c.particle_indices_of(FAR_ID as u32);
    assert!(
        far.len() > 1000,
        "the far card keeps its share of the budget: {}",
        far.len()
    );
    assert_eq!(
        c.parked_particles(),
        far.len(),
        "exactly the far card's particles are flagged"
    );
    frames(&mut c, 30);
    let s = c.state(FAR_ID);
    assert_eq!(
        (s[ST_S], s[ST_MAX_DEV], s[ST_REST_ALPHA]),
        (1.0, 0.0, 1.0),
        "held at rest"
    );
    let n = c.particle_capacity() as usize;
    let flags = &c.dynamic_view()[6 * n..7 * n];
    for i in far {
        assert_eq!(
            flags[i] as u32 & FLAG_PARKED,
            FLAG_PARKED,
            "particle {i}: the dynamic view carries FLAG_PARKED"
        );
    }
}

#[test]
fn given_a_parked_element_when_ticking_with_a_splash_a_shake_and_the_pointer_then_its_particles_are_untouched_and_it_stays_at_rest()
 {
    let mut c = far_core(true);
    frames(&mut c, 2);
    let before = bits_of(&c, &[FAR_ID]);
    c.splash(FAR_ID as u32, 640.0, 2480.0, 1.0);
    c.shake(1.0);
    for _ in 0..60 {
        c.tick(DT, 640.0, 2480.0, 800.0, -400.0, true, 0.0, 0.0);
    }
    assert_eq!(
        bits_of(&c, &[FAR_ID]),
        before,
        "no P2G, G2P, splash, shake or pointer on a parked element"
    );
    assert_eq!(
        c.state(FAR_ID)[ST_REST_ALPHA],
        1.0,
        "a splash on a parked element is ignored"
    );
    assert_eq!(
        c.stiffness_of(FAR_ID),
        1.0,
        "a shake does not damage a parked element"
    );
    assert!(
        c.state(CARD)[ST_REST_ALPHA] < 1.0,
        "the shake reached the on-screen card"
    );
}

#[test]
fn given_a_parked_far_element_when_the_others_splash_shake_and_scroll_then_their_simulation_is_bit_identical_to_the_unparked_engine_and_touches_fewer_cells()
 {
    let run = |parking: bool| {
        let mut c = far_core(parking);
        frames(&mut c, 10);
        c.splash(CARD as u32, 640.0, 430.0, 1.0);
        frames(&mut c, 110);
        c.shake(1.0);
        let touched0 = c.grid().cells_touched;
        frames(&mut c, 60);
        let touched = c.grid().cells_touched - touched0;
        for k in 1..=10 {
            scroll_frame(&mut c, (k - 1) as f32 * 10.0, k as f32 * 10.0);
        }
        frames(&mut c, 120);
        (bits_of(&c, &[0, 1, 2, 3]), touched)
    };
    let (on, touched_on) = run(true);
    let (off, touched_off) = run(false);
    let same = on.iter().zip(&off).filter(|(a, b)| a == b).count();
    println!(
        "[W81 parking] identical words {same}/{}; cells touched in 60 shake frames: parked {touched_on}, unparked {touched_off} (ratio {:.3})",
        on.len(),
        touched_on as f64 / touched_off as f64
    );
    assert_eq!(
        on, off,
        "the on-screen elements do not notice the parked element"
    );
    assert!(
        (touched_on as f64) <= 0.5 * touched_off as f64,
        "the parked element's particles leave the dirty region: {touched_on} vs {touched_off} cells"
    );
}

/// FNV-1a 64 over the words of a run (positions, velocities, dynamic view).
fn golden_hash(run: &(Vec<u32>, Vec<u32>, Vec<u32>)) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for w in run.0.iter().chain(&run.1).chain(&run.2) {
        for b in w.to_le_bytes() {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    h
}

/// Captured at the W81 red, where the stubs carry the W80 numerics (parking is not wired into the
/// tick yet), by hashing `run(false)` of the test below. It must never change in W81.
const W80_GOLDEN: u64 = 1_710_035_767_997_873_519;

#[test]
fn given_no_element_ever_leaves_the_bound_when_splashing_shaking_and_scrolling_300_px_then_the_core_is_bit_identical_with_parking_on_and_off()
 {
    let run = |parking: bool| {
        let mut c = acceptance_core(SEED);
        c.set_parking_off(!parking);
        frames(&mut c, 10);
        c.splash(CARD as u32, 640.0, 430.0, 1.0);
        frames(&mut c, 50);
        c.shake(1.0);
        let mut at = 0.0;
        for k in (1..=30).chain((0..30).rev()) {
            let to = k as f32 * 10.0;
            for (id, e) in LAYOUT.iter().enumerate() {
                let mut r = *e;
                r[1] -= to;
                c.write_element(id, slot(r));
            }
            c.scroll_shift(0.0, to - at, 0.0, 0.0);
            at = to;
            frame(&mut c);
        }
        frames(&mut c, 60);
        (
            c.position_bits(),
            c.velocity_bits(),
            c.dynamic_view()
                .iter()
                .map(|v| v.to_bits())
                .collect::<Vec<_>>(),
        )
    };
    let off = run(false);
    let on = run(true);
    assert_eq!(
        golden_hash(&off),
        W80_GOLDEN,
        "parking off equals the W80 engine"
    );
    assert_eq!(
        golden_hash(&on),
        W80_GOLDEN,
        "parking changes nothing while no element is parked (W80 bit-identity)"
    );
}

#[test]
fn given_a_parked_element_scrolled_into_view_when_it_overlaps_the_world_then_in_that_frame_it_is_unparked_at_rest_with_every_particle_on_its_target_and_it_stays_at_rest()
 {
    let mut c = far_core(true);
    frames(&mut c, 30);
    let mut at = 0.0f32;
    let mut entered = None;
    for k in 1..=70 {
        let to = k as f32 * 30.0;
        scroll_frame(&mut c, at, to);
        at = to;
        let top = FAR_RECT[1] - to;
        if top < 800.0 {
            entered = Some(to);
            break;
        }
        assert!(
            c.is_parked_of(FAR_ID),
            "still parked with its top at {top} px (below the world)"
        );
    }
    let to = entered.expect("the far card reached the world");
    assert!(
        !c.is_parked_of(FAR_ID),
        "unparked in the frame it overlaps the world (scroll {to})"
    );
    let s = c.state(FAR_ID);
    assert_eq!(
        (s[ST_S], s[ST_REST_ALPHA]),
        (1.0, 1.0),
        "at rest in that frame"
    );
    let dev = worst_target_dev(&c, FAR_ID);
    println!(
        "[W81 re-entry] scroll {to} px: worst |x − target| {dev:.6} px, restAlpha {}",
        s[ST_REST_ALPHA]
    );
    assert!(
        dev < PLACE_EPS_PX,
        "every particle placed on its target: {dev} px"
    );
    assert_eq!(
        c.parked_particles(),
        count_parked_others(&c),
        "only the elements still out of the bound are flagged"
    );
    let (vx, vy) = c.home_velocity_of(FAR_ID);
    assert!(
        vx.abs() < HOME_V_EPS && vy.abs() < HOME_V_EPS,
        "home velocity 0 in the entering frame (the scroll is rigid): ({vx}, {vy})"
    );
    for k in 0..20 {
        scroll_frame(&mut c, at, at + 10.0);
        at += 10.0;
        if k == 0 {
            let (vx, vy) = c.home_velocity_of(FAR_ID);
            assert!(
                vx.abs() < HOME_V_EPS && vy.abs() < HOME_V_EPS,
                "home velocity 0 after the first rigid scroll frame: ({vx}, {vy})"
            );
        }
        assert_eq!(
            c.state(FAR_ID)[ST_REST_ALPHA],
            1.0,
            "a rigid scroll keeps the re-entered card at rest"
        );
    }
    frames(&mut c, 60);
    assert_eq!(
        c.state(FAR_ID)[ST_REST_ALPHA],
        1.0,
        "still at rest a second later"
    );
    let (vx, vy) = c.home_velocity_of(FAR_ID);
    assert!(
        vx.abs() < 1e-3 && vy.abs() < 1e-3,
        "home velocity 0 after re-entry: ({vx}, {vy})"
    );
}

#[test]
fn given_a_parked_element_that_enters_the_world_on_a_0_step_tick_when_ticked_then_it_is_unparked_at_rest_and_placed_on_its_targets()
 {
    let mut c = far_core(true);
    frames(&mut c, 5);
    assert!(c.is_parked_of(FAR_ID));
    write_all(&mut c, 1700.0); // the card at y 700: in the world
    c.scroll_shift(0.0, 1700.0, 0.0, 0.0);
    // 0.004 s is below one fixed step: the tick runs 0 steps (spec §2: parking also runs then).
    assert_eq!(c.tick(0.004, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0), 0);
    assert!(!c.is_parked_of(FAR_ID), "unparked on a 0-step tick");
    assert_eq!(c.state(FAR_ID)[ST_REST_ALPHA], 1.0, "at rest");
    let dev = worst_target_dev(&c, FAR_ID);
    assert!(
        dev < PLACE_EPS_PX,
        "placed on its targets on a 0-step tick: {dev} px"
    );
    assert_eq!(c.parked_particles(), 0);
}

fn count_parked_others(c: &FluidCore) -> usize {
    (0..4)
        .filter(|&id| c.is_parked_of(id))
        .map(|id| c.particle_indices_of(id as u32).len())
        .sum()
}

#[test]
fn given_a_parked_element_near_the_bound_when_its_rect_jitters_by_5_px_then_it_does_not_flap_and_it_unparks_only_64_px_inside()
 {
    let mut c = FluidCore::new(4000, 8, 1280.0, 800.0, AREA_HINT_PX2, 180.0, SEED);
    let pill = |y: f32| slot([406.0, y, 140.0, 48.0, 24.0]);
    c.write_element(0, slot(LAYOUT[CARD]));
    c.write_element(1, pill(1001.0)); // 1 px below the bound
    c.redistribute();
    assert!(c.is_parked_of(1));
    for k in 0..40 {
        // ±5 px around 3 px inside the bound: never 64 px inside, never in the world.
        c.write_element(
            1,
            pill(1000.0 - 48.0 - 3.0 + if k % 2 == 0 { 5.0 } else { -5.0 }),
        );
        frame(&mut c);
        assert!(
            c.is_parked_of(1),
            "frame {k}: inside the bound but not 64 px inside: stays parked"
        );
    }
    c.write_element(1, pill(1000.0 - 48.0 - 64.0));
    frame(&mut c);
    assert!(!c.is_parked_of(1), "64 px inside the bound: unparked");
    for k in 0..40 {
        c.write_element(1, pill(1000.0 - 48.0 + if k % 2 == 0 { 5.0 } else { -5.0 }));
        frame(&mut c);
        assert!(
            !c.is_parked_of(1),
            "frame {k}: partly inside the bound: stays unparked"
        );
    }
    c.write_element(1, pill(1000.0));
    frame(&mut c);
    assert!(c.is_parked_of(1), "entirely outside again: parked");
}

#[test]
fn given_a_dragged_element_outside_the_bound_when_ticking_then_it_is_never_parked_and_a_parked_element_that_becomes_dragged_unparks_at_once()
 {
    let mut c = far_core(true);
    assert!(c.is_parked_of(FAR_ID));
    let mut dragged = slot(FAR_RECT);
    dragged[5] = INTERACTION_DRAGGED;
    c.write_element(FAR_ID, dragged);
    frame(&mut c);
    assert!(
        !c.is_parked_of(FAR_ID),
        "a dragged element is never parked (D81-1)"
    );
    assert_eq!(c.parked_particles(), 0);
    frames(&mut c, 10);
    assert!(!c.is_parked_of(FAR_ID), "and stays unparked while dragged");
    c.write_element(FAR_ID, slot(FAR_RECT));
    frame(&mut c);
    assert!(c.is_parked_of(FAR_ID), "released far outside: parked again");
}

#[test]
fn given_a_parked_element_when_the_page_scrolls_then_scroll_shift_leaves_its_particles_alone() {
    let mut c = far_core(true);
    frames(&mut c, 2);
    let before = bits_of(&c, &[FAR_ID]);
    for k in 1..=10 {
        scroll_frame(&mut c, (k - 1) as f32 * 7.0, k as f32 * 7.0);
        assert!(c.is_parked_of(FAR_ID));
    }
    assert_eq!(
        bits_of(&c, &[FAR_ID]),
        before,
        "scroll_shift skips a parked element (shifts_with_scroll)"
    );
}

#[test]
fn given_a_parked_element_when_redistributed_then_it_keeps_its_area_share_and_when_it_is_unobserved_its_particles_start_on_their_new_visible_targets()
 {
    let pill = |x: f32| slot([x, 300.0, 140.0, 48.0, 24.0]);
    let mut c = FluidCore::new(8000, 8, 1280.0, 800.0, AREA_HINT_PX2, 180.0, SEED);
    c.write_element(0, pill(200.0));
    c.write_element(1, slot(FAR_RECT));
    c.redistribute();
    frames(&mut c, 30);
    assert!(c.is_parked_of(1));
    let (a, far) = (
        c.particle_indices_of(0).len(),
        c.particle_indices_of(1).len(),
    );
    assert!(
        far > 6 * a,
        "the parked card keeps its area share (D81-1): pill {a}, card {far}"
    );
    assert_eq!(c.parked_particles(), far);
    // The card is unobserved (TS zeroes its slot) and a second pill observed in the same batch.
    c.write_element(1, [0.0; 10]);
    c.write_element(2, pill(600.0));
    c.redistribute();
    assert_eq!(c.parked_particles(), 0, "no particle keeps FLAG_PARKED");
    let dev = worst_target_dev(&c, 2);
    assert!(
        dev < PLACE_EPS_PX,
        "the new pill's particles all come from the card: placed on target, never crawl in from the wall ({dev} px)"
    );
    assert!(
        worst_target_dev(&c, 0) < 0.75,
        "the first pill only gained particles from the card"
    );
    assert_eq!(
        (c.state(0)[ST_REST_ALPHA], c.state(2)[ST_REST_ALPHA]),
        (1.0, 1.0),
        "both pills start at rest"
    );
    frames(&mut c, 30);
    assert_eq!(c.rest_alphas(), vec![1.0, 1.0]);
}

#[test]
fn given_reduced_motion_when_an_element_is_out_of_the_bound_then_it_is_parked_the_pin_skips_it_and_re_entry_places_it_on_its_target()
 {
    let mut c = far_core(true);
    c.set_reduced_motion(true);
    frames(&mut c, 3);
    assert!(c.is_parked_of(FAR_ID), "parking holds under reduced motion");
    let before = bits_of(&c, &[FAR_ID]);
    frames(&mut c, 3);
    assert_eq!(
        bits_of(&c, &[FAR_ID]),
        before,
        "the reduced-motion pin skips parked particles"
    );
    write_all(&mut c, 1700.0); // the card at y 700: in the world
    c.scroll_shift(0.0, 1700.0, 0.0, 0.0);
    frame(&mut c);
    assert!(!c.is_parked_of(FAR_ID));
    let dev = worst_target_dev(&c, FAR_ID);
    assert!(
        dev < PLACE_EPS_PX,
        "placed exactly on its reduced-motion target: {dev} px"
    );
    assert_eq!(c.state(FAR_ID)[ST_REST_ALPHA], 1.0);
}

#[test]
fn given_an_inactive_element_when_ticking_then_it_is_never_parked_and_a_parked_slot_that_goes_inactive_loses_the_flag()
 {
    let mut c = far_core(true);
    assert!(c.is_parked_of(FAR_ID));
    c.write_element(FAR_ID, [0.0; 10]); // w = 0: inactive (hidden or unobserved)
    frame(&mut c);
    assert!(!c.is_parked_of(FAR_ID), "an inactive slot is never parked");
    assert_eq!(c.parked_particles(), 0, "its particles lose FLAG_PARKED");
    frames(&mut c, 5);
    assert!(c.all_particles_finite());
}

// ---------------------------------------------------------------- scenario: resize_world

#[test]
fn given_a_core_when_resize_world_grows_it_then_particles_and_every_non_grid_buffer_stay_and_an_element_inside_the_new_bound_unparks()
 {
    let mut c = far_core(true);
    frames(&mut c, 30);
    let fp = c.buffer_fingerprint();
    let pos = c.position_bits();
    assert!(!c.resize_world(1280.0, 800.0), "same size: no reallocation");
    assert!(!c.resize_world(f32::NAN, f32::NAN));
    assert_eq!(c.buffer_fingerprint(), fp, "no reallocation at all");
    assert!(c.resize_world(1280.0, 2600.0), "taller: grows");
    assert_eq!(c.world_px(), (1280.0, 2600.0));
    assert_eq!(
        c.position_bits(),
        pos,
        "every particle keeps its grid position"
    );
    let after = c.buffer_fingerprint();
    let grid_entries = [14usize, 15, 16]; // g.mass, g.mvx, g.mvy (buffer_fingerprint order)
    for (k, (a, b)) in fp.iter().zip(&after).enumerate() {
        if !grid_entries.contains(&k) {
            assert_eq!(
                a, b,
                "buffer {k} is not reallocated: views and pointers stay valid"
            );
        }
    }
    frame(&mut c);
    assert!(
        !c.is_parked_of(FAR_ID),
        "the card at y 2400 now overlaps the world (D81-2 grows the bound)"
    );
    assert_eq!(c.state(FAR_ID)[ST_REST_ALPHA], 1.0, "unparked at rest");
    assert!(!c.resize_world(1000.0, 1000.0), "never shrinks");
    frames(&mut c, 30);
    assert!(c.all_particles_finite());
}

#[test]
fn given_a_page_scrolled_150_px_before_and_after_resize_world_when_a_splash_is_in_flight_then_every_particle_matches_an_unscrolled_resized_core_up_to_f32_rounding()
 {
    let run = |scrolled: bool| {
        let mut c = acceptance_core(SEED);
        frames(&mut c, 10);
        c.splash(CARD as u32, 640.0, 430.0, 1.0);
        let mut at = 0.0f32;
        let path: Vec<f32> = (1..=15)
            .map(|k| k as f32 * 10.0)
            .chain((16..=30).map(|k| k as f32 * 10.0))
            .chain((0..30).rev().map(|k| k as f32 * 10.0))
            .collect();
        for (n, to) in path.into_iter().enumerate() {
            if n == 15 {
                assert!(c.resize_world(1920.0, 1080.0));
            }
            let s = if scrolled { to } else { 0.0 };
            for (id, e) in LAYOUT.iter().enumerate() {
                let mut r = *e;
                r[1] -= s;
                c.write_element(id, slot(r));
            }
            if scrolled {
                c.scroll_shift(0.0, to - at, 0.0, 0.0);
            }
            at = to;
            frame(&mut c);
        }
        frames(&mut c, 30);
        let n = c.particle_capacity() as usize;
        (0..n).map(|i| c.particle_px(i)).collect::<Vec<_>>()
    };
    let a = run(true);
    let b = run(false);
    let worst = a
        .iter()
        .zip(&b)
        .map(|(p, q)| (p.0 - q.0).abs().max((p.1 - q.1).abs()))
        .fold(0.0, f32::max);
    println!("[W81 resize] worst |scrolled − unscrolled| after a resize mid-scroll: {worst:.5} px");
    assert!(
        worst <= ROUNDING_PX,
        "the lattice phase survives the resize: {worst} px"
    );
}
