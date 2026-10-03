//! Pre-allocated MPM grid with a per-substep dirty region (spec §2 "Grid";
//! plan resolutions B2, B5, B6, B15). Positions are in grid units: 1 = one
//! cell, origin at `(-margin, -margin)` px.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn given_8000_particles_and_76k_px2_when_choosing_cell_then_sqrt_4a_over_n_clamped_4_to_8() {
        let c = Grid::choose_cell_px(8000, 76_057.0);
        assert!((c - (4.0f32 * 76_057.0 / 8000.0).sqrt()).abs() < 1e-4, "{c}");
        assert!((6.1..6.2).contains(&c), "{c}");
        assert_eq!(Grid::choose_cell_px(8000, 1_000.0), CELL_MIN_PX);
        assert_eq!(Grid::choose_cell_px(8000, 10_000_000.0), CELL_MAX_PX);
    }

    #[test]
    fn given_zero_area_hint_when_choosing_cell_then_8px() {
        for a in [0.0, -5.0, f32::NAN, f32::INFINITY] {
            assert_eq!(Grid::choose_cell_px(8000, a), 8.0, "hint {a}");
        }
        assert_eq!(Grid::choose_cell_px(0, 1000.0), 8.0);
    }

    #[test]
    fn given_world_1280x800_when_grid_built_then_covers_world_plus_200px_margin_each_side() {
        let g = Grid::new(1280.0, 800.0, 6.0, 200.0);
        assert_eq!((g.origin_x_px, g.origin_y_px), (-200.0, -200.0));
        assert!(g.origin_x_px + g.w as f32 * g.cell_px >= 1280.0 + 200.0);
        assert!(g.origin_y_px + g.h as f32 * g.cell_px >= 800.0 + 200.0);
        assert_eq!(g.mass.len(), g.w * g.h);
        assert_eq!(g.mvx.len(), g.w * g.h);
        assert_eq!(g.mvy.len(), g.w * g.h);
    }

    #[test]
    fn given_tallest_element_when_margin_chosen_then_max_of_200_and_its_height() {
        assert_eq!(Grid::margin_px(180.0), 200.0);
        assert_eq!(Grid::margin_px(350.0), 350.0);
        assert_eq!(Grid::margin_px(f32::NAN), 200.0);
        assert_eq!(Grid::new(1280.0, 800.0, 8.0, 350.0).origin_y_px, -350.0);
    }

    #[test]
    fn given_any_fraction_when_bspline_weights_summed_then_one() {
        for k in 0..=100 {
            let f = 0.5 + k as f32 / 100.0;
            let s: f32 = bspline(f).iter().sum();
            assert!((s - 1.0).abs() < 1e-6, "f = {f}: {s}");
        }
    }

    #[test]
    fn given_particle_bounds_when_region_set_then_clear_and_update_touch_only_the_padded_region() {
        let mut g = Grid::new(1280.0, 800.0, 4.0, 200.0);
        let (x0, y0) = g.to_grid(100.0, 100.0);
        let (x1, y1) = g.to_grid(200.0, 150.0);
        g.set_region(x0, y0, x1, y1);
        let r = g.region();
        assert_eq!(r.x0, x0.floor() as usize - REGION_PAD_CELLS);
        assert_eq!(r.x1, x1.floor() as usize + REGION_PAD_CELLS + 1);
        assert_eq!(r.y0, y0.floor() as usize - REGION_PAD_CELLS);
        assert_eq!(r.y1, y1.floor() as usize + REGION_PAD_CELLS + 1);
        let before = g.cells_touched;
        g.clear_region();
        g.update_velocities(1.0 / 480.0, 0.45);
        assert_eq!(g.cells_touched - before, 2 * r.cells() as u64);
        assert!(r.cells() * 50 < g.w * g.h, "{} of {}", r.cells(), g.w * g.h);
    }
}
