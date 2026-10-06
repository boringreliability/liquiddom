//! `redistribute()`: area apportionment, home assignment, rest sampling and
//! first placement (spec §2 "Particle pool and elements", decision D64-3,
//! plan resolutions B3 and B4).
//!
//! Stable assignment: each element's rest set is a progressive sequence
//! seeded by `(seed, slot)`, and a particle keeps its `rank` in that
//! sequence. A particle whose home is still active and whose rank is still
//! below the new count keeps its home AND its exact `rest_uv`. Only the
//! surplus ranks are freed and refilled. Never-placed particles snap to their
//! target; already-placed particles keep `x, y` (they crawl, never snap).
//!
//! W67 (D67-13): each element's rest set is the edge ring (ranks below
//! `edge_ring_count`, fixed per rect and core) followed by the progressive R2
//! interior, so the stable assignment above still holds.

use super::access::{positive, rd, rd_or, rd_u32, wr, wr_u32};
use super::elements::Elements;
use super::grid::Grid;
use super::particles::{NO_HOME, Particles};
use super::rng::Rng;
use super::sampling::{apportion, ring_spacing_px, rounded_rect_area, sample_edge_aligned};

/// Pre-allocated scratch so `redistribute` never allocates (B7).
pub struct PoolScratch {
    pub weights: Vec<f32>,
    pub counts: Vec<u32>,
    pub starts: Vec<u32>,
    pub next: Vec<u32>,
    pub u: Vec<f32>,
    pub v: Vec<f32>,
}

impl PoolScratch {
    pub fn new(particles: usize, elements: usize) -> PoolScratch {
        PoolScratch {
            weights: vec![0.0; elements],
            counts: vec![0; elements],
            starts: vec![0; elements],
            next: vec![0; elements],
            u: vec![0.5; particles],
            v: vec![0.5; particles],
        }
    }
}

/// Returns the number of particles with a home: 0 when no element is
/// active, otherwise exactly `p.cap` (B3).
pub fn redistribute(
    p: &mut Particles,
    e: &mut Elements,
    g: &Grid,
    seed: u32,
    reduced_motion: bool,
    s: &mut PoolScratch,
) -> u32 {
    // 1. Counts proportional to rounded-rect area (largest remainder).
    for id in 0..e.cap {
        let area = e.rect(id).map_or(0.0, |r| rounded_rect_area(r.w, r.h, r.r));
        wr(&mut s.weights, id, area);
    }
    let total = u32::try_from(p.cap).unwrap_or(u32::MAX);
    let assigned = apportion(&s.weights, total, &mut s.counts);

    // 2. Rest samples per element, stored contiguously by element id: the edge ring
    //    first, then the R2 interior (W67, D67-13).
    let spacing = ring_spacing_px(g.cell_px);
    let mut start = 0usize;
    for id in 0..e.cap {
        let n = rd_u32(&s.counts, id) as usize;
        wr_u32(&mut s.starts, id, u32::try_from(start).unwrap_or(u32::MAX));
        wr_u32(&mut s.next, id, 0);
        let rect = e.rect(id);
        if let Some(r) = rect
            && n > 0
            && let (Some(ou), Some(ov)) =
                (s.u.get_mut(start..start + n), s.v.get_mut(start..start + n))
        {
            let mut rng = Rng::derive(seed, u32::try_from(id).unwrap_or(u32::MAX));
            sample_edge_aligned(r.w, r.h, r.r, spacing, &mut rng, ou, ov);
        }
        if rect.is_none() {
            // W67 ward-review fix: an inactive slot starts fresh when it is reused.
            e.reset_slot(id);
        }
        let area = rd(&s.weights, id);
        wr_u32(&mut e.counts, id, u32::try_from(n).unwrap_or(u32::MAX));
        wr(
            &mut e.area_per_particle,
            id,
            if n > 0 { area / n as f32 } else { 0.0 },
        );
        wr(&mut e.rest_w, id, rect.map_or(0.0, |r| r.w));
        wr(&mut e.rest_h, id, rect.map_or(0.0, |r| r.h));
        start += n;
    }

    // 3. Keep pass: home still active and rank still inside the new count.
    for i in 0..p.cap {
        match p.home_of(i) {
            Some(h) if rd_u32(&p.rank, i) < rd_u32(&s.counts, h) => {
                let k = rd_u32(&s.next, h);
                wr_u32(&mut s.next, h, k.saturating_add(1));
            }
            _ => wr_u32(&mut p.home, i, NO_HOME),
        }
    }

    // 4. Freed particles fill the missing ranks, in index order.
    let mut cursor = 0usize;
    for i in 0..p.cap {
        if p.home_of(i).is_some() {
            continue;
        }
        while cursor < e.cap && rd_u32(&s.next, cursor) >= rd_u32(&s.counts, cursor) {
            cursor += 1;
        }
        if cursor >= e.cap {
            break;
        }
        let k = rd_u32(&s.next, cursor);
        wr_u32(&mut p.home, i, u32::try_from(cursor).unwrap_or(NO_HOME));
        wr_u32(&mut p.rank, i, k);
        wr_u32(&mut s.next, cursor, k.saturating_add(1));
    }

    // 5. Rest uv, per-generation mass (B4) and first placement.
    let cell2 = g.cell_px * g.cell_px;
    for i in 0..p.cap {
        let Some(h) = p.home_of(i) else {
            wr(&mut p.mass, i, 0.0);
            continue;
        };
        let k = rd_u32(&s.starts, h) as usize + rd_u32(&p.rank, i) as usize;
        let (u, v) = (rd_or(&s.u, k, 0.5), rd_or(&s.v, k, 0.5));
        wr(&mut p.rest_u, i, u);
        wr(&mut p.rest_v, i, v);
        let app = rd(&e.area_per_particle, h);
        wr(
            &mut p.mass,
            i,
            if positive(app) { app / cell2 } else { 0.0 },
        );
        let placed = p.placed.get(i).copied().unwrap_or(true);
        if !placed && let Some((tx, ty)) = e.target_px(h, u, v, reduced_motion) {
            let (gx, gy) = g.to_grid(tx, ty);
            let (gx, gy) = g.clamp_pos(gx, gy);
            wr(&mut p.x, i, gx);
            wr(&mut p.y, i, gy);
            p.reset_kinematics(i);
            if let Some(flag) = p.placed.get_mut(i) {
                *flag = true;
            }
        }
    }
    assigned
}

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
    fn given_four_elements_when_redistribute_then_every_particle_has_a_home_and_counts_follow_area()
    {
        let (mut p, mut e, g, mut s) = setup();
        for (id, el) in LAYOUT.iter().enumerate() {
            put(&mut e, id, *el);
        }
        assert_eq!(redistribute(&mut p, &mut e, &g, 1, false, &mut s), N as u32);
        assert!(p.home.iter().all(|&h| h < 4));
        let areas: Vec<f32> = LAYOUT
            .iter()
            .map(|l| rounded_rect_area(l[2], l[3], l[4]))
            .collect();
        let total: f32 = areas.iter().sum();
        for id in 0..4 {
            let n = homes(&p, id);
            assert_eq!(n as u32, e.counts[id]);
            let exact = N as f32 * areas[id] / total;
            assert!(
                (n as f32 - exact).abs() < 1.0 + 1e-3,
                "element {id}: {n} vs {exact}"
            );
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
            assert!(
                (x - tx).abs() < 1e-3 && (y - ty).abs() < 1e-3,
                "particle {i}"
            );
            assert!(p.placed[i]);
            let r = e.rect(h).unwrap();
            assert!(
                inside_rounded_rect(x - r.x, y - r.y, r.w, r.h, r.r),
                "particle {i}"
            );
        }
    }

    #[test]
    fn given_element_released_when_redistribute_then_its_particles_keep_position_and_get_new_home()
    {
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
            assert_eq!(
                (p.x[i].to_bits(), p.y[i].to_bits()),
                (x, y),
                "particle {i} snapped"
            );
        }
        assert_eq!(homes(&p, 1), N);
    }

    #[test]
    fn given_element_added_when_redistribute_then_kept_particles_keep_identical_rest_uv() {
        let (mut p, mut e, g, mut s) = setup();
        put(&mut e, 0, LAYOUT[3]);
        redistribute(&mut p, &mut e, &g, 1, false, &mut s);
        let before: Vec<(u32, u32)> = (0..N)
            .map(|i| (p.rest_u[i].to_bits(), p.rest_v[i].to_bits()))
            .collect();
        put(&mut e, 1, LAYOUT[0]);
        redistribute(&mut p, &mut e, &g, 1, false, &mut s);
        // W67 D67-13 changed the layout: kept ranks below `edge_ring_count` are ring points.
        // The ring spacing is fixed per core, so this now also proves the ring does not move.
        let mut kept = 0;
        for i in 0..N {
            if p.home[i] == 0 {
                kept += 1;
                assert_eq!(
                    (p.rest_u[i].to_bits(), p.rest_v[i].to_bits()),
                    before[i],
                    "particle {i}"
                );
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
    fn given_redistribute_when_masses_computed_then_p_mass_is_area_per_particle_over_cell_squared()
    {
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
        let area: f64 = LAYOUT
            .iter()
            .map(|l| f64::from(rounded_rect_area(l[2], l[3], l[4])))
            .sum();
        let expected = area / f64::from(cell2);
        assert!(
            (total - expected).abs() / expected < 1e-4,
            "{total} vs {expected}"
        );
    }
}

#[cfg(test)]
mod w67_tests {
    use super::*;
    use crate::fluid::layout::{EL_H, EL_RADIUS, EL_W, EL_X, EL_Y, ELEMENT_STRIDE};
    use crate::fluid::sampling::{edge_ring_count, ring_spacing_px, rounded_rect_inward_distance};
    use crate::fluid::scenario_tests::LAYOUT;

    const N: usize = 8000;

    #[test]
    fn given_edge_layout_when_redistributed_then_counts_per_element_unchanged_and_ring_ranks_first()
    {
        let (mut p, mut e) = (Particles::new(N), Elements::new(32));
        let g = Grid::new(1280.0, 800.0, 6.0, 200.0);
        let mut s = PoolScratch::new(N, 32);
        for (id, &[x, y, w, h, r]) in LAYOUT.iter().enumerate() {
            let b = id * ELEMENT_STRIDE;
            e.buf[b + EL_X] = x;
            e.buf[b + EL_Y] = y;
            e.buf[b + EL_W] = w;
            e.buf[b + EL_H] = h;
            e.buf[b + EL_RADIUS] = r;
        }
        assert_eq!(redistribute(&mut p, &mut e, &g, 1, false, &mut s), N as u32);

        let weights: Vec<f32> = (0..32)
            .map(|id| {
                LAYOUT
                    .get(id)
                    .map_or(0.0, |l| rounded_rect_area(l[2], l[3], l[4]))
            })
            .collect();
        let mut expected = [0u32; 32];
        apportion(&weights, N as u32, &mut expected);
        assert_eq!(
            &e.counts[..],
            &expected[..],
            "D67-13 leaves the counts to the largest-remainder apportionment"
        );

        let spacing = ring_spacing_px(g.cell_px);
        assert!(
            (spacing - 3.0).abs() < 1e-6,
            "cell 6 px → spacing 3 px: {spacing}"
        );
        for (id, &[_, _, w, h, r]) in LAYOUT.iter().enumerate() {
            let ring = u32::try_from(edge_ring_count(w, h, r, spacing)).unwrap();
            assert!(
                ring > 0 && ring < e.counts[id],
                "element {id}: ring {ring} of {}",
                e.counts[id]
            );
            let mut on_ring = 0;
            for i in (0..N).filter(|&i| p.home[i] == id as u32) {
                let d = rounded_rect_inward_distance(p.rest_u[i] * w, p.rest_v[i] * h, w, h, r);
                if p.rank[i] < ring {
                    assert!(
                        (d - 0.5 * spacing).abs() < 1e-3,
                        "element {id} rank {}: inset {d}",
                        p.rank[i]
                    );
                    on_ring += 1;
                } else {
                    assert!(
                        d >= spacing - 1e-3,
                        "element {id} rank {}: interior inset {d}",
                        p.rank[i]
                    );
                }
            }
            assert_eq!(
                on_ring, ring,
                "element {id}: exactly the first {ring} ranks form the ring"
            );
        }
    }
}
