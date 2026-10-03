//! Acceptance-layout scenarios (spec §6): three 140×48 r24 buttons at y 260
//! and a 320×180 r16 card at y 340 in a 1280×800 viewport, seed 1.
#![allow(clippy::needless_range_loop)]

use super::api::FluidCore;
use super::clock::SUBSTEPS;
use super::elements::REST_MAX_DEV_PX;
use super::grid::REGION_PAD_CELLS;
use super::layout::{ELEMENT_STRIDE, ST_MAX_DEV, ST_REST_ALPHA};
use super::sampling::rounded_rect_area;

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
    (0..n).map(|_| c.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0)).sum()
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
        assert!(max_dev(&c, id) < REST_MAX_DEV_PX, "element {id}: {}", max_dev(&c, id));
        assert_eq!(rest_alpha(&c, id), 1.0);
    }
    assert_eq!(c.mean_j(), 1.0);
}

#[test]
fn given_particles_displaced_10px_when_ticking_3s_then_max_dev_below_0_75px_and_rest_alpha_1() {
    let mut c = acceptance_core(SEED);
    displace_all(&mut c, 10.0);
    frames(&mut c, 1);
    for id in 0..4 {
        assert!(max_dev(&c, id) > 5.0, "element {id}: {}", max_dev(&c, id));
        assert_eq!(rest_alpha(&c, id), 0.0);
    }
    frames(&mut c, 180);
    for id in 0..4 {
        assert!(max_dev(&c, id) < REST_MAX_DEV_PX, "element {id}: {}", max_dev(&c, id));
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
    frames(&mut c, 180);
    assert!(max_dev(&c, CARD) < REST_MAX_DEV_PX, "{}", max_dev(&c, CARD));
    assert_eq!(rest_alpha(&c, CARD), 1.0);
    for i in 0..8000 {
        if c.home(i) == CARD as u32 {
            let (_, y) = c.particle_px(i);
            assert!(y >= card[1] - 1.0 && y <= card[1] + card[3] + 1.0, "particle {i}: y = {y}");
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
        assert!(dist_to_target(&c, i) < 1e-3, "particle {i}: {}", dist_to_target(&c, i));
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
            assert!(y > card[1] && y < card[1] + card[3], "particle {i}: y = {y}");
        }
    }
}

#[test]
fn given_ticks_between_redistributions_when_running_then_particle_count_and_total_mass_constant() {
    let mut c = acceptance_core(SEED);
    let m0 = c.total_mass();
    let cell = f64::from(c.cell_px());
    let area: f64 = LAYOUT.iter().map(|l| f64::from(rounded_rect_area(l[2], l[3], l[4]))).sum();
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
    assert!(region.cells() <= max_w * max_h, "{} > {}", region.cells(), max_w * max_h);
    assert!(region.cells() * 100 < g.w * g.h, "{} of {}", region.cells(), g.w * g.h);
}
