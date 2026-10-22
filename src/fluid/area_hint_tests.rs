//! W85 (D85-4): `FluidCore::set_area_hint`, the area hint of a core built without one (spec §2
//! grid: B5 cell, B15 margin). Scenario: the acceptance layout (`scenario_tests`), whose hint is
//! `AREA_HINT_PX2` (76 057 px², a 6.17 px cell) and whose tallest element is the 180 px card. A
//! "late" core is built with hint 0 (an adapter app observes after `create()`) and gets
//! `set_area_hint` before its first `redistribute()`; it must equal a core built with the hint.

use super::api::FluidCore;
use super::scenario_tests::{AREA_HINT_PX2, CARD, LAYOUT, SEED, slot};

const DT: f32 = 1.0 / 60.0;
const N: u32 = 8000;
const M: u32 = 32;
const TALLEST_PX: f32 = 180.0;
const FRAMES: usize = 120;
const SPLASH_FRAME: usize = 10;
/// Design resolution 6: scroll deltas before the first batch (sub-cell and long steps, both signs).
const PRE_SCROLL: [(f32, f32); 4] = [(0.0, 13.0), (5.5, 7.25), (-2.0, -3.75), (0.0, 250.0)];
/// Design resolution 6: the replayed lattice origin against a hinted core with the same scroll
/// history (f32 rounding of the per-step split; the plan validation measured 0 px, bit-identical).
const ORIGIN_ROUNDING_PX: f32 = 1e-4;
/// The views after 120 frames with a splash, same comparison (measured 0 px; replaying only the old drift instead gives a 1.17 px origin error).
const VIEW_ROUNDING_PX: f32 = 1e-3;

fn hinted() -> FluidCore {
    FluidCore::new(N, M, 1280.0, 800.0, AREA_HINT_PX2, TALLEST_PX, SEED)
}

fn late() -> FluidCore {
    FluidCore::new(N, M, 1280.0, 800.0, 0.0, 0.0, SEED)
}

fn frame(c: &mut FluidCore) {
    c.tick(DT, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0);
}

/// The acceptance elements and the batch's redistribute.
fn place(c: &mut FluidCore) {
    for (id, e) in LAYOUT.iter().enumerate() {
        c.write_element(id, slot(*e));
    }
    c.redistribute();
}

/// 120 frames after the placement, with a splash on the card's centre at frame 10.
fn run(c: &mut FluidCore) {
    for f in 0..FRAMES {
        if f == SPLASH_FRAME {
            c.splash(CARD as u32, 640.0, 430.0, 1.0);
        }
        frame(c);
    }
}

fn bits(v: &[f32]) -> Vec<u32> {
    v.iter().map(|x| x.to_bits()).collect()
}

fn state_bits(c: &FluidCore) -> Vec<u32> {
    (0..LAYOUT.len())
        .flat_map(|id| c.state(id))
        .map(f32::to_bits)
        .collect()
}

/// Cell, margin, size and lattice origin, as bits.
fn grid_key(c: &FluidCore) -> (u32, u32, usize, usize, u32, u32) {
    let g = c.grid();
    (
        g.cell_px.to_bits(),
        g.margin_px.to_bits(),
        g.w,
        g.h,
        g.origin_x_px.to_bits(),
        g.origin_y_px.to_bits(),
    )
}

#[test]
fn given_a_core_built_without_a_hint_when_set_area_hint_runs_after_0_1_or_5_empty_frames_then_120_frames_with_a_splash_are_bit_identical_to_a_hinted_constructor()
 {
    for k in [0usize, 1, 5] {
        let (mut a, mut b) = (hinted(), late());
        assert_eq!(b.cell_px(), 8.0, "no hint: 8 px");
        for _ in 0..k {
            frame(&mut a);
            frame(&mut b);
        }
        assert!(
            b.set_area_hint(AREA_HINT_PX2, TALLEST_PX),
            "k = {k}: generation 0"
        );
        assert_eq!(grid_key(&b), grid_key(&a), "k = {k}: the grid");
        assert_eq!(
            b.max_area_px2().to_bits(),
            a.max_area_px2().to_bits(),
            "k = {k}"
        );
        place(&mut a);
        place(&mut b);
        run(&mut a);
        run(&mut b);
        assert_eq!(
            bits(b.dynamic_view()),
            bits(a.dynamic_view()),
            "k = {k}: dynamic view"
        );
        assert_eq!(
            bits(b.static_view()),
            bits(a.static_view()),
            "k = {k}: static view"
        );
        assert_eq!(state_bits(&b), state_bits(&a), "k = {k}: state view");
    }
}

#[test]
fn given_a_core_that_redistributed_when_set_area_hint_runs_then_it_returns_false_and_changes_nothing()
 {
    let mut c = late();
    place(&mut c);
    frame(&mut c);
    let before = (
        grid_key(&c),
        bits(c.dynamic_view()),
        c.max_area_px2().to_bits(),
    );
    assert!(!c.set_area_hint(AREA_HINT_PX2, TALLEST_PX));
    assert_eq!(
        (
            grid_key(&c),
            bits(c.dynamic_view()),
            c.max_area_px2().to_bits()
        ),
        before
    );
    // A redistribute that placed nothing still counts (generation 1): the rule is the generation.
    let mut e = late();
    e.redistribute();
    assert!(!e.set_area_hint(AREA_HINT_PX2, TALLEST_PX));
    assert_eq!(e.cell_px(), 8.0);
}

#[test]
fn given_non_finite_or_non_positive_input_when_set_area_hint_runs_then_the_grid_equals_the_constructors_for_the_same_input()
 {
    let cases: [(f32, f32); 7] = [
        (f32::NAN, f32::NAN),
        (-1.0, -5.0),
        (0.0, 0.0),
        (f32::INFINITY, f32::INFINITY),
        (f32::NEG_INFINITY, 1e9),
        (1.0, 50.0),
        (AREA_HINT_PX2, 900.0),
    ];
    for (area, tallest) in cases {
        let made = FluidCore::new(N, M, 1280.0, 800.0, area, tallest, SEED);
        let mut c = late();
        assert!(
            c.set_area_hint(area, tallest),
            "area {area}, tallest {tallest}"
        );
        assert_eq!(
            grid_key(&c),
            grid_key(&made),
            "area {area}, tallest {tallest}"
        );
    }
    // The documented values: no usable area → 8 px, no usable height → a 200 px margin, a tiny
    // area → the 4 px floor; while the generation is 0 every call rebuilds.
    let mut c = late();
    assert!(c.set_area_hint(f32::NAN, f32::NAN));
    assert_eq!((c.cell_px(), c.grid().margin_px), (8.0, 200.0));
    assert!(c.set_area_hint(1.0, -5.0));
    assert_eq!((c.cell_px(), c.grid().margin_px), (4.0, 200.0));
}

#[test]
fn given_a_world_grown_by_resize_world_and_a_viewport_when_set_area_hint_runs_then_the_grid_covers_the_grown_world_and_the_viewport_is_kept()
 {
    let (mut a, mut b) = (hinted(), late());
    for c in [&mut a, &mut b] {
        assert!(c.resize_world(2000.0, 1200.0));
        c.set_viewport(1500.0, 900.0);
    }
    assert!(b.set_area_hint(AREA_HINT_PX2, TALLEST_PX));
    assert_eq!(grid_key(&b), grid_key(&a));
    assert_eq!((b.grid().world_w_px, b.grid().world_h_px), (2000.0, 1200.0));
    assert_eq!(b.viewport_of(), a.viewport_of());
}

#[test]
fn given_a_scroll_before_the_first_batch_when_set_area_hint_runs_then_the_lattice_and_120_frames_with_a_splash_match_a_hinted_core_with_the_same_scroll_history()
 {
    let (mut a, mut b) = (hinted(), late());
    for (dx, dy) in PRE_SCROLL {
        for c in [&mut a, &mut b] {
            c.scroll_shift(dx, dy, 0.0, 0.0);
            frame(c);
        }
    }
    assert!(b.set_area_hint(AREA_HINT_PX2, TALLEST_PX));
    let (ga, gb) = (a.grid(), b.grid());
    assert_eq!(
        (gb.cell_px, gb.margin_px, gb.w, gb.h),
        (ga.cell_px, ga.margin_px, ga.w, ga.h)
    );
    let ox = (gb.origin_x_px - ga.origin_x_px).abs();
    let oy = (gb.origin_y_px - ga.origin_y_px).abs();
    println!("W85 pre-batch scroll: origin |Δ| x {ox} y {oy} px");
    assert!(
        ox <= ORIGIN_ROUNDING_PX && oy <= ORIGIN_ROUNDING_PX,
        "origin Δ {ox}, {oy}"
    );
    place(&mut a);
    place(&mut b);
    run(&mut a);
    run(&mut b);
    let worst = a
        .dynamic_view()
        .iter()
        .zip(b.dynamic_view())
        .filter(|(x, y)| x.is_finite() && y.is_finite())
        .map(|(x, y)| (x - y).abs())
        .fold(0.0f32, f32::max);
    println!("W85 pre-batch scroll: dynamic view max |Δ| {worst}");
    assert!(worst <= VIEW_ROUNDING_PX, "dynamic view Δ {worst}");
    assert_eq!(
        bits(b.static_view()),
        bits(a.static_view()),
        "the same placement"
    );
}
