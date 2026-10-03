//! The two particle views TS reads (spec §2 FFI items 2 and 3, amended by B14):
//! dynamic SoA `x, y, f00, f01, f10, f11, flags` (px) every tick, static SoA
//! `home, rest_u, rest_v` at redistribution. Field stride = particle capacity.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn given_redistribute_when_reading_static_view_then_home_rest_u_rest_v_in_soa_order() {
        let mut p = Particles::new(4);
        p.home = vec![2, NO_HOME, 0, 1];
        p.rest_u = vec![0.1, 0.2, 0.3, 0.4];
        p.rest_v = vec![0.5, 0.6, 0.7, 0.8];
        let mut v = Views::new(4);
        v.write_static(&p);
        assert_eq!(v.statics.len(), 4 * STATIC_FIELDS);
        assert_eq!(&v.statics[STAT_HOME * 4..STAT_HOME * 4 + 4], &[2.0, HOME_NONE, 0.0, 1.0]);
        assert_eq!(&v.statics[STAT_REST_U * 4..STAT_REST_U * 4 + 4], &[0.1, 0.2, 0.3, 0.4]);
        assert_eq!(&v.statics[STAT_REST_V * 4..STAT_REST_V * 4 + 4], &[0.5, 0.6, 0.7, 0.8]);
    }

    #[test]
    fn given_tick_when_reading_dynamic_view_then_x_y_in_px_f_identity_and_flags_zero() {
        let g = Grid::new(1280.0, 800.0, 8.0, 200.0);
        let mut p = Particles::new(2);
        let (ax, ay) = g.to_grid(100.0, 50.0);
        let (bx, by) = g.to_grid(640.0, 400.0);
        p.x = vec![ax, bx];
        p.y = vec![ay, by];
        let mut v = Views::new(2);
        v.write_dynamic(&p, &g);
        assert_eq!(v.dynamic.len(), 2 * DYNAMIC_FIELDS);
        let at = |field: usize, i: usize| v.dynamic[field * 2 + i];
        assert!((at(DYN_X, 0) - 100.0).abs() < 1e-3 && (at(DYN_Y, 0) - 50.0).abs() < 1e-3);
        assert!((at(DYN_X, 1) - 640.0).abs() < 1e-3 && (at(DYN_Y, 1) - 400.0).abs() < 1e-3);
        for i in 0..2 {
            assert_eq!(
                [at(DYN_F00, i), at(DYN_F01, i), at(DYN_F10, i), at(DYN_F11, i), at(DYN_FLAGS, i)],
                [1.0, 0.0, 0.0, 1.0, 0.0]
            );
        }
    }
}
