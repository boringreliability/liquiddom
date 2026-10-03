//! `redistribute()`: area apportionment, home assignment, rest sampling and
//! first placement (spec §2 "Particle pool and elements", decision D64-3,
//! plan resolutions B3 and B4).

#[cfg(test)]
#[allow(clippy::needless_range_loop)]
mod tests {
    use super::*;
    use crate::fluid::layout::{EL_H, EL_RADIUS, EL_W, EL_X, EL_Y, ELEMENT_STRIDE};
    use crate::fluid::sampling::inside_rounded_rect;

    const N: usize = 8000;
    const LAYOUT: [[f32; 5]; 4] = [
        [406.0, 260.0, 140.0, 48.0, 24.0],
        [570.0, 260.0, 140.0, 48.0, 24.0],
        [734.0, 260.0, 140.0, 48.0, 24.0],
        [480.0, 340.0, 320.0, 180.0, 16.0],
    ];

    fn put(e: &mut Elements, id: usize, [x, y, w, h, r]: [f32; 5]) {
        let b = id * ELEMENT_STRIDE;
        e.buf[b + EL_X] = x;
        e.buf[b + EL_Y] = y;
        e.buf[b + EL_W] = w;
        e.buf[b + EL_H] = h;
        e.buf[b + EL_RADIUS] = r;
    }

    fn setup() -> (Particles, Elements, Grid, PoolScratch) {
        (
            Particles::new(N),
            Elements::new(32),
            Grid::new(1280.0, 800.0, 6.0, 200.0),
            PoolScratch::new(N, 32),
        )
    }

    fn homes(p: &Particles, id: usize) -> usize {
        p.home.iter().filter(|&&h| h == id as u32).count()
    }

    #[test]
    fn given_four_elements_when_redistribute_then_every_particle_has_a_home_and_counts_follow_area() {
        let (mut p, mut e, g, mut s) = setup();
        for (id, el) in LAYOUT.iter().enumerate() {
            put(&mut e, id, *el);
        }
        assert_eq!(redistribute(&mut p, &mut e, &g, 1, false, &mut s), N as u32);
        assert!(p.home.iter().all(|&h| h < 4));
        let areas: Vec<f32> = LAYOUT.iter().map(|l| rounded_rect_area(l[2], l[3], l[4])).collect();
        let total: f32 = areas.iter().sum();
        for id in 0..4 {
            let n = homes(&p, id);
            assert_eq!(n as u32, e.counts[id]);
            let exact = N as f32 * areas[id] / total;
            assert!((n as f32 - exact).abs() < 1.0 + 1e-3, "element {id}: {n} vs {exact}");
        }
    }

    #[test]
    fn given_first_redistribute_when_particles_unplaced_then_each_starts_at_its_target() {
        let (mut p, mut e, g, mut s) = setup();
        for (id, el) in LAYOUT.iter().enumerate() {
            put(&mut e, id, *el);
        }
        redistribute(&mut p, &mut e, &g, 1, false, &mut s);
        for i in 0..N {
            let h = p.home[i] as usize;
            let (tx, ty) = e.target_px(h, p.rest_u[i], p.rest_v[i], false).unwrap();
            let (x, y) = g.to_px(p.x[i], p.y[i]);
            assert!((x - tx).abs() < 1e-3 && (y - ty).abs() < 1e-3, "particle {i}");
            assert!(p.placed[i]);
            let r = e.rect(h).unwrap();
            assert!(inside_rounded_rect(x - r.x, y - r.y, r.w, r.h, r.r), "particle {i}");
        }
    }

    #[test]
    fn given_element_released_when_redistribute_then_its_particles_keep_position_and_get_new_home() {
        let (mut p, mut e, g, mut s) = setup();
        put(&mut e, 0, LAYOUT[0]);
        put(&mut e, 1, LAYOUT[3]);
        redistribute(&mut p, &mut e, &g, 1, false, &mut s);
        let released: Vec<(usize, u32, u32)> = (0..N)
            .filter(|&i| p.home[i] == 0)
            .map(|i| (i, p.x[i].to_bits(), p.y[i].to_bits()))
            .collect();
        assert!(!released.is_empty());
        e.buf[EL_W] = 0.0;
        assert_eq!(redistribute(&mut p, &mut e, &g, 1, false, &mut s), N as u32);
        for (i, x, y) in released {
            assert_eq!(p.home[i], 1, "particle {i}");
            assert_eq!((p.x[i].to_bits(), p.y[i].to_bits()), (x, y), "particle {i} snapped");
        }
        assert_eq!(homes(&p, 1), N);
    }

    #[test]
    fn given_element_added_when_redistribute_then_kept_particles_keep_identical_rest_uv() {
        let (mut p, mut e, g, mut s) = setup();
        put(&mut e, 0, LAYOUT[3]);
        redistribute(&mut p, &mut e, &g, 1, false, &mut s);
        let before: Vec<(u32, u32)> =
            (0..N).map(|i| (p.rest_u[i].to_bits(), p.rest_v[i].to_bits())).collect();
        put(&mut e, 1, LAYOUT[0]);
        redistribute(&mut p, &mut e, &g, 1, false, &mut s);
        let mut kept = 0;
        for i in 0..N {
            if p.home[i] == 0 {
                kept += 1;
                assert_eq!((p.rest_u[i].to_bits(), p.rest_v[i].to_bits()), before[i], "particle {i}");
            }
        }
        assert_eq!(kept as u32, e.counts[0]);
        assert!(e.counts[1] > 0);
    }

    #[test]
    fn given_no_active_elements_when_redistribute_then_active_particles_zero_and_homes_none() {
        let (mut p, mut e, g, mut s) = setup();
        assert_eq!(redistribute(&mut p, &mut e, &g, 1, false, &mut s), 0);
        assert!(p.home.iter().all(|&h| h == NO_HOME));
        put(&mut e, 0, LAYOUT[0]);
        redistribute(&mut p, &mut e, &g, 1, false, &mut s);
        e.buf[EL_W] = 0.0;
        assert_eq!(redistribute(&mut p, &mut e, &g, 1, false, &mut s), 0);
        assert!(p.home.iter().all(|&h| h == NO_HOME));
        assert!(p.mass.iter().all(|&m| m == 0.0));
    }

    #[test]
    fn given_redistribute_when_masses_computed_then_p_mass_is_area_per_particle_over_cell_squared() {
        let (mut p, mut e, g, mut s) = setup();
        for (id, el) in LAYOUT.iter().enumerate() {
            put(&mut e, id, *el);
        }
        redistribute(&mut p, &mut e, &g, 1, false, &mut s);
        let cell2 = g.cell_px * g.cell_px;
        for i in 0..N {
            let h = p.home[i] as usize;
            assert!((p.mass[i] - e.area_per_particle[h] / cell2).abs() < 1e-6);
        }
        let total: f64 = p.mass.iter().map(|&m| f64::from(m)).sum();
        let area: f64 = LAYOUT.iter().map(|l| f64::from(rounded_rect_area(l[2], l[3], l[4]))).sum();
        let expected = area / f64::from(cell2);
        assert!((total - expected).abs() / expected < 1e-4, "{total} vs {expected}");
    }
}
