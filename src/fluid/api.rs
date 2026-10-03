//! `FluidCore`: the whole fluid FFI surface (spec §2 "FFI contract"; plan
//! skeleton §3.2, amended by resolutions B14 and B15). JS sees `FluidCore`.
//! Everything is allocated in the constructor; nothing on the hot path
//! allocates, so the exported pointers stay valid for the core's lifetime.

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fluid::layout::ST_REST_ALPHA;
    use crate::fluid::scenario_tests::{LAYOUT, SEED, acceptance_core, frames, slot};

    #[test]
    fn given_fluid_core_when_querying_strides_then_equal_layout_constants() {
        let c = FluidCore::new(256, 8, 1280.0, 800.0, 0.0, 0.0, 1);
        assert_eq!(c.element_stride(), ELEMENT_STRIDE as u32);
        assert_eq!(c.state_stride(), STATE_STRIDE as u32);
        assert_eq!(c.dynamic_fields(), DYNAMIC_FIELDS as u32);
        assert_eq!(c.static_fields(), STATIC_FIELDS as u32);
        assert_eq!((ELEMENT_STRIDE, STATE_STRIDE, DYNAMIC_FIELDS, STATIC_FIELDS), (10, 4, 7, 3));
    }

    #[test]
    fn given_view_pointers_when_lengths_computed_then_match_capacities() {
        let c = acceptance_core(SEED);
        let (n, m) = (c.particle_capacity() as usize, c.element_capacity() as usize);
        assert_eq!((n, m), (8000, 32));
        assert_eq!(c.views.dynamic.len(), n * DYNAMIC_FIELDS);
        assert_eq!(c.views.statics.len(), n * STATIC_FIELDS);
        assert_eq!(c.elements.buf.len(), m * ELEMENT_STRIDE);
        assert_eq!(c.elements.state.len(), m * STATE_STRIDE);
        for ptr in [c.elements_ptr(), c.dynamic_ptr(), c.static_ptr(), c.state_ptr()] {
            assert!(!ptr.is_null());
        }
    }

    #[test]
    fn given_same_seed_and_inputs_when_two_cores_tick_300_frames_then_dynamic_views_bit_identical() {
        let run = |seed: u32| {
            let mut c = acceptance_core(seed);
            frames(&mut c, 100);
            let mut card = LAYOUT[3];
            card[1] += 50.0;
            c.write_element(3, slot(card));
            frames(&mut c, 200);
            let bits = |v: &[f32]| v.iter().map(|f| f.to_bits()).collect::<Vec<_>>();
            (bits(&c.views.dynamic), bits(&c.views.statics))
        };
        assert_eq!(run(7), run(7));
        assert_ne!(run(7), run(8));
    }

    #[test]
    fn given_nan_rect_or_out_of_range_id_when_tick_splash_or_redistribute_then_no_panic_and_slot_ignored()
     {
        let mut c = FluidCore::new(512, 4, f32::NAN, f32::INFINITY, f32::NAN, f32::NAN, 0);
        c.write_element(0, [f32::NAN; ELEMENT_STRIDE]);
        c.write_element(1, [10.0, 10.0, -5.0, 20.0, 4.0, 0.0, 0.0, 0.0, f32::NAN, f32::NAN]);
        c.write_element(2, [f32::INFINITY, 0.0, 50.0, 50.0, f32::NAN, f32::NAN, f32::NAN, f32::NAN, 9.0, -9.0]);
        c.write_element(99, [1.0; ELEMENT_STRIDE]);
        c.redistribute();
        assert_eq!(c.active_particles(), 0);
        c.tick(f32::NAN, f32::NAN, f32::NAN, f32::INFINITY, f32::NEG_INFINITY, true, f32::NAN, f32::NAN);
        c.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0);
        c.splash(999, f32::NAN, f32::NAN, f32::NAN);
        c.splash(0, 1.0, 1.0, 1.0);
        c.shake(f32::NAN);
        c.set_material(f32::NAN, -1.0, 99.0);
        c.write_element(3, slot([100.0, 100.0, 80.0, 40.0, 1e9]));
        c.redistribute();
        assert_eq!(c.active_particles(), 512);
        assert!((0..512).all(|i| c.home(i) == 3));
        frames(&mut c, 3);
        assert!(c.views.dynamic.iter().all(|v| v.is_finite()));
        assert!(c.elements.state.iter().all(|v| v.is_finite()));
        assert_eq!(c.state(3)[ST_REST_ALPHA], 1.0);
    }

    #[test]
    fn given_tick_with_raw_dt_one_sixtieth_when_called_then_returns_one_step() {
        let mut c = acceptance_core(SEED);
        assert_eq!(c.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0), 1);
        assert_eq!(c.tick(0.25, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0), 3);
        c.set_reduced_motion(true);
        assert_eq!(c.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0), 0);
    }

    #[test]
    fn given_redistribute_when_called_then_generation_increments_by_one() {
        let mut c = FluidCore::new(256, 4, 1280.0, 800.0, 0.0, 0.0, 1);
        assert_eq!(c.generation(), 0);
        c.redistribute();
        assert_eq!(c.generation(), 1);
        c.write_element(0, slot(LAYOUT[0]));
        c.redistribute();
        assert_eq!(c.generation(), 2);
    }

    #[test]
    fn given_area_hint_when_constructed_then_cell_px_and_max_area_follow_resolution_b5() {
        let c = FluidCore::new(8000, 32, 1280.0, 800.0, 76_057.0, 180.0, 1);
        let cell = c.cell_px();
        assert!((cell - (4.0f32 * 76_057.0 / 8000.0).sqrt()).abs() < 1e-4, "{cell}");
        assert!((c.max_area_px2() - 8000.0 * cell * cell / 2.0).abs() < 1.0);
        let d = FluidCore::new(8000, 32, 1280.0, 800.0, 0.0, 0.0, 1);
        assert_eq!(d.cell_px(), 8.0);
        assert_eq!(d.max_area_px2(), 256_000.0);
    }

    #[test]
    fn given_out_of_range_capacities_when_constructed_then_clamped() {
        let c = FluidCore::new(0, 0, 1280.0, 800.0, 0.0, 0.0, 1);
        assert_eq!((c.particle_capacity(), c.element_capacity()), (16, 1));
        let d = FluidCore::new(1_000_000, 10_000, 1280.0, 800.0, 0.0, 0.0, 1);
        assert_eq!((d.particle_capacity(), d.element_capacity()), (65_536, 256));
    }
}
