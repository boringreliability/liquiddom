//! Rounded-rect geometry, largest-remainder apportionment and seeded
//! progressive sampling (spec §2 "Particle pool and elements", decision D64-3).

use super::access::positive;
use super::rng::Rng;

/// Sample points keep this distance (px) from the rounded-rect outline.
pub const SAMPLE_INSET_PX: f32 = 0.5;
/// Rejection budget per requested point before falling back to the centre.
pub const MAX_TRIES_PER_POINT: usize = 64;

// R2 low-discrepancy sequence (Roberts 2018): plastic number g, step (1/g, 1/g²).
const R2_G: f64 = 1.324_717_957_244_746;
const R2_A1: f64 = 1.0 / R2_G;
const R2_A2: f64 = 1.0 / (R2_G * R2_G);

/// Radius clamped to `[0, min(w, h) / 2]`; NaN, negative or a degenerate rect give 0.
pub fn clamp_radius(w: f32, h: f32, r: f32) -> f32 {
    if !positive(r) || !positive(w) || !positive(h) {
        return 0.0;
    }
    r.min(0.5 * w).min(0.5 * h)
}

pub fn rounded_rect_area(w: f32, h: f32, r: f32) -> f32 {
    if !positive(w) || !positive(h) {
        return 0.0;
    }
    let r = clamp_radius(w, h, r);
    w * h - (4.0 - std::f32::consts::PI) * r * r
}

/// Is the local point `(lx, ly)` inside the rounded rect `[0, w] × [0, h]`?
pub fn inside_rounded_rect(lx: f32, ly: f32, w: f32, h: f32, r: f32) -> bool {
    if !positive(w) || !positive(h) {
        return false;
    }
    if !((0.0..=w).contains(&lx) && (0.0..=h).contains(&ly)) {
        return false;
    }
    let r = clamp_radius(w, h, r);
    let dx = lx - lx.clamp(r, w - r);
    let dy = ly - ly.clamp(r, h - r);
    dx * dx + dy * dy <= r * r
}

/// Largest-remainder apportionment of `total` over `weights` into `out`.
/// Non-finite or non-positive weights get 0. Returns `Σ out`, which equals
/// `total` whenever at least one weight is positive, and 0 otherwise.
pub fn apportion(weights: &[f32], total: u32, out: &mut [u32]) -> u32 {
    for o in out.iter_mut() {
        *o = 0;
    }
    let clean = |w: f32| if positive(w) { f64::from(w) } else { 0.0 };
    let mut sum = 0.0f64;
    for &w in weights {
        sum += clean(w);
    }
    if sum <= 0.0 || total == 0 {
        return 0;
    }
    let total_f = f64::from(total);
    let mut assigned: u32 = 0;
    for (&w, o) in weights.iter().zip(out.iter_mut()) {
        let floor = (total_f * clean(w) / sum).floor().clamp(0.0, total_f) as u32;
        *o = floor;
        assigned = assigned.saturating_add(floor);
    }
    while assigned < total {
        let mut best: Option<usize> = None;
        let mut best_rem = f64::NEG_INFINITY;
        for (i, (&w, &o)) in weights.iter().zip(out.iter()).enumerate() {
            let cw = clean(w);
            if cw <= 0.0 {
                continue;
            }
            let rem = total_f * cw / sum - f64::from(o);
            if rem > best_rem {
                best_rem = rem;
                best = Some(i);
            }
        }
        match best.and_then(|i| out.get_mut(i)) {
            Some(o) => {
                *o += 1;
                assigned += 1;
            }
            None => break,
        }
    }
    assigned
}

/// Writes exactly `out_u.len()` points (uv in `[0, 1]²`) inside the rounded
/// rect `(w, h, r)`, inset by `SAMPLE_INSET_PX`. The radius is clamped to
/// `min(w, h) / 2`. Progressive: the k-th point depends only on
/// `(w, h, r, rng state)`, never on the count, which is what lets
/// redistribution keep the rest positions of kept particles (D64-3).
/// Degenerate or non-finite rects get the centre `(0.5, 0.5)`.
pub fn sample_rounded_rect(
    w: f32,
    h: f32,
    r: f32,
    rng: &mut Rng,
    out_u: &mut [f32],
    out_v: &mut [f32],
) {
    let inset2 = 2.0 * SAMPLE_INSET_PX;
    let usable = positive(w) && positive(h) && w > inset2 && h > inset2;
    if !usable {
        out_u.fill(0.5);
        out_v.fill(0.5);
        return;
    }
    let (iw, ih) = (w - inset2, h - inset2);
    let ir = (clamp_radius(w, h, r) - SAMPLE_INSET_PX).max(0.0);
    let off_x = f64::from(rng.next_f32());
    let off_y = f64::from(rng.next_f32());
    let n = out_u.len().min(out_v.len());
    let max_tries = n.saturating_mul(MAX_TRIES_PER_POINT).saturating_add(1024);
    let mut k: u64 = 0;
    let mut tries = 0usize;
    for (u, v) in out_u.iter_mut().zip(out_v.iter_mut()) {
        let mut placed = false;
        while tries < max_tries {
            tries += 1;
            k += 1;
            let lx = (off_x + k as f64 * R2_A1).fract() as f32 * iw;
            let ly = (off_y + k as f64 * R2_A2).fract() as f32 * ih;
            if inside_rounded_rect(lx, ly, iw, ih, ir) {
                *u = (lx + SAMPLE_INSET_PX) / w;
                *v = (ly + SAMPLE_INSET_PX) / h;
                placed = true;
                break;
            }
        }
        if !placed {
            *u = 0.5;
            *v = 0.5;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUTTON: (f32, f32, f32) = (140.0, 48.0, 24.0);
    const CARD: (f32, f32, f32) = (320.0, 180.0, 16.0);

    fn sample(w: f32, h: f32, r: f32, seed: u32, n: usize) -> (Vec<f32>, Vec<f32>) {
        let mut u = vec![-1.0; n];
        let mut v = vec![-1.0; n];
        sample_rounded_rect(w, h, r, &mut Rng::new(seed), &mut u, &mut v);
        (u, v)
    }

    #[test]
    fn given_weights_when_apportioning_8000_then_sum_is_exactly_8000_and_each_within_one_of_proportional()
     {
        let b = rounded_rect_area(BUTTON.0, BUTTON.1, BUTTON.2);
        let c = rounded_rect_area(CARD.0, CARD.1, CARD.2);
        let weights = [b, b, b, c, 0.0, f32::NAN];
        let mut out = [0u32; 6];
        assert_eq!(apportion(&weights, 8000, &mut out), 8000);
        assert_eq!(out.iter().sum::<u32>(), 8000);
        let total = 3.0 * b + c;
        for (w, n) in weights.iter().zip(out.iter()).take(4) {
            let exact = 8000.0 * w / total;
            assert!((*n as f32 - exact).abs() < 1.0, "{n} vs {exact}");
        }
        assert_eq!(&out[4..], &[0, 0]);
    }

    #[test]
    fn given_all_zero_or_nan_weights_when_apportioning_then_nothing_is_assigned() {
        let mut out = [7u32; 3];
        assert_eq!(apportion(&[0.0, f32::NAN, -3.0], 8000, &mut out), 0);
        assert_eq!(out, [0, 0, 0]);
    }

    #[test]
    fn given_rounded_rect_when_sampling_n_points_then_exactly_n_points_all_inside() {
        let (w, h, r) = BUTTON;
        let (u, v) = sample(w, h, r, 1, 1000);
        assert_eq!(u.len(), 1000);
        for (&pu, &pv) in u.iter().zip(v.iter()) {
            assert!((0.0..=1.0).contains(&pu) && (0.0..=1.0).contains(&pv));
            assert!(inside_rounded_rect(pu * w, pv * h, w, h, r), "({pu}, {pv})");
        }
        let distinct: std::collections::HashSet<(u32, u32)> = u
            .iter()
            .zip(v.iter())
            .map(|(a, b)| (a.to_bits(), b.to_bits()))
            .collect();
        assert_eq!(distinct.len(), 1000);
    }

    #[test]
    fn given_same_seed_when_sampling_twice_then_uv_bit_identical() {
        let (w, h, r) = CARD;
        let (u1, v1) = sample(w, h, r, 9, 500);
        let (u2, v2) = sample(w, h, r, 9, 500);
        let bits = |x: &[f32]| x.iter().map(|f| f.to_bits()).collect::<Vec<_>>();
        assert_eq!(bits(&u1), bits(&u2));
        assert_eq!(bits(&v1), bits(&v2));
        let (u3, _) = sample(w, h, r, 10, 500);
        assert_ne!(bits(&u1), bits(&u3));
    }

    #[test]
    fn given_more_points_when_sampling_then_the_shorter_sample_is_a_prefix() {
        let (w, h, r) = CARD;
        let (u_short, v_short) = sample(w, h, r, 3, 300);
        let (u_long, v_long) = sample(w, h, r, 3, 400);
        assert_eq!(&u_long[..300], &u_short[..]);
        assert_eq!(&v_long[..300], &v_short[..]);
    }

    #[test]
    fn given_radius_above_half_height_when_sampling_then_radius_clamped_and_no_panic() {
        let (u, v) = sample(140.0, 48.0, 100.0, 1, 400);
        for (&pu, &pv) in u.iter().zip(v.iter()) {
            assert!(inside_rounded_rect(
                pu * 140.0,
                pv * 48.0,
                140.0,
                48.0,
                24.0
            ));
        }
        assert_eq!(clamp_radius(140.0, 48.0, 100.0), 24.0);
    }

    #[test]
    fn given_zero_or_nan_rect_when_sampling_then_returns_without_panic() {
        for (w, h, r) in [
            (0.0, 48.0, 0.0),
            (f32::NAN, 48.0, 4.0),
            (140.0, f32::NAN, 4.0),
            (140.0, 48.0, f32::NAN),
            (f32::INFINITY, 10.0, 0.0),
            (0.8, 0.8, 0.0),
        ] {
            let (u, v) = sample(w, h, r, 1, 16);
            assert!(u.iter().chain(v.iter()).all(|x| (0.0..=1.0).contains(x)));
        }
        assert_eq!(rounded_rect_area(f32::NAN, 1.0, 0.0), 0.0);
    }
}

#[cfg(test)]
mod w67_tests {
    use super::*;
    use std::collections::HashSet;

    /// The acceptance scene's ring spacing: the cell is √(4·76 057 / 8000) ≈ 6.166 px (B5),
    /// so the spacing is ≈ 3.083 px.
    const SPACING: f32 = 3.083;
    /// Acceptance counts (8000 particles over 76 057 px²): about 655 per button and 6035 for the card.
    const SHAPES: [(f32, f32, f32, usize); 2] =
        [(140.0, 48.0, 24.0, 655), (320.0, 180.0, 16.0, 6035)];

    fn layout(w: f32, h: f32, r: f32, n: usize, seed: u32) -> (Vec<f32>, Vec<f32>) {
        let mut u = vec![-1.0; n];
        let mut v = vec![-1.0; n];
        sample_edge_aligned(w, h, r, SPACING, &mut Rng::new(seed), &mut u, &mut v);
        (u, v)
    }

    /// The ring points of a seed-1 layout, in local px.
    fn ring_px(w: f32, h: f32, r: f32, n: usize) -> Vec<(f32, f32)> {
        let m = edge_ring_count(w, h, r, SPACING);
        let (u, v) = layout(w, h, r, n, 1);
        u.iter()
            .zip(v.iter())
            .take(m)
            .map(|(&a, &b)| (a * w, b * h))
            .collect()
    }

    fn bits(x: &[f32]) -> Vec<u32> {
        x.iter().map(|f| f.to_bits()).collect()
    }

    #[test]
    fn given_rounded_rect_when_edge_layout_sampled_then_every_ring_point_on_contour_inset_half_spacing()
     {
        for (w, h, r, n) in SHAPES {
            let m = edge_ring_count(w, h, r, SPACING);
            assert!(m > 50 && m < n, "{w}×{h}: a ring of {m} for {n} particles");
            let ring = ring_px(w, h, r, n);
            assert_eq!(ring.len(), m);
            for (k, &(x, y)) in ring.iter().enumerate() {
                let d = rounded_rect_inward_distance(x, y, w, h, r);
                assert!(
                    (d - 0.5 * SPACING).abs() < 1e-3,
                    "{w}×{h} ring point {k} at ({x}, {y}): inset {d}"
                );
            }
        }
    }

    #[test]
    fn given_edge_ring_when_laid_out_then_neighbour_spacing_coefficient_of_variation_below_0_05() {
        for (w, h, r, n) in SHAPES {
            let ring = ring_px(w, h, r, n);
            let gaps: Vec<f32> = (0..ring.len())
                .map(|k| {
                    let (a, b) = (ring[k], ring[(k + 1) % ring.len()]);
                    (a.0 - b.0).hypot(a.1 - b.1)
                })
                .collect();
            let mean = gaps.iter().sum::<f32>() / gaps.len() as f32;
            let sd =
                (gaps.iter().map(|g| (g - mean).powi(2)).sum::<f32>() / gaps.len() as f32).sqrt();
            assert!(
                sd / mean < 0.05,
                "{w}×{h}: spacing CV {} (mean {mean}, sd {sd})",
                sd / mean
            );
            assert!(
                (mean - SPACING).abs() < 0.05 * SPACING,
                "{w}×{h}: the ring spacing matches the interior spacing: {mean}"
            );
        }
    }

    #[test]
    fn given_edge_layout_when_sampled_then_interior_points_strictly_inside_the_ring() {
        for (w, h, r, n) in SHAPES {
            let m = edge_ring_count(w, h, r, SPACING);
            let (u, v) = layout(w, h, r, n, 1);
            assert_eq!(u.len(), n, "the total count is unchanged");
            assert!(u.iter().chain(v.iter()).all(|x| (0.0..=1.0).contains(x)));
            let interior: Vec<(f32, f32)> = u
                .iter()
                .zip(v.iter())
                .skip(m)
                .map(|(&a, &b)| (a * w, b * h))
                .collect();
            assert_eq!(interior.len(), n - m);
            let min = interior
                .iter()
                .map(|&(x, y)| rounded_rect_inward_distance(x, y, w, h, r))
                .fold(f32::INFINITY, f32::min);
            assert!(
                min >= SPACING - 1e-3,
                "{w}×{h}: interior points keep one spacing from the outline: {min}"
            );
            assert!(
                min > 0.5 * SPACING + 1e-3,
                "{w}×{h}: strictly inside the ring"
            );
            let distinct: HashSet<(u32, u32)> = interior
                .iter()
                .map(|&(x, y)| (x.to_bits(), y.to_bits()))
                .collect();
            assert_eq!(distinct.len(), n - m, "{w}×{h}: no fallback to the centre");
        }
    }

    #[test]
    fn given_same_seed_when_edge_layout_sampled_twice_then_uv_bit_identical_and_ring_seed_independent()
     {
        let (w, h, r, n) = SHAPES[1];
        let m = edge_ring_count(w, h, r, SPACING);
        let (u1, v1) = layout(w, h, r, n, 9);
        let (u2, v2) = layout(w, h, r, n, 9);
        assert_eq!(bits(&u1), bits(&u2));
        assert_eq!(bits(&v1), bits(&v2));
        let (u3, v3) = layout(w, h, r, n, 10);
        assert_eq!(
            bits(&u1[..m]),
            bits(&u3[..m]),
            "the ring depends on the geometry only"
        );
        assert_eq!(bits(&v1[..m]), bits(&v3[..m]));
        assert_ne!(bits(&u1[m..]), bits(&u3[m..]), "the interior is seeded");
        let (u4, v4) = layout(w, h, r, n - 500, 9);
        assert_eq!(
            bits(&u4),
            bits(&u1[..n - 500]),
            "D64-3: a shorter layout is a prefix"
        );
        assert_eq!(bits(&v4), bits(&v1[..n - 500]));
    }

    #[test]
    fn given_rect_too_small_or_non_finite_when_edge_layout_sampled_then_r2_fallback_without_panic()
    {
        assert_eq!(
            edge_ring_count(6.0, 6.0, 0.0, SPACING),
            0,
            "w ≤ 2·spacing: no ring"
        );
        for (w, h, r, s) in [
            (6.0, 6.0, 0.0, SPACING),
            (140.0, 48.0, 24.0, f32::NAN),
            (140.0, 48.0, 24.0, 0.0),
            (140.0, 48.0, 24.0, -3.0),
            (f32::NAN, 48.0, 4.0, SPACING),
            (140.0, f32::INFINITY, 4.0, SPACING),
            (140.0, 48.0, f32::NAN, SPACING),
            (0.8, 0.8, 0.0, SPACING),
        ] {
            let mut u = vec![-1.0; 16];
            let mut v = vec![-1.0; 16];
            sample_edge_aligned(w, h, r, s, &mut Rng::new(1), &mut u, &mut v);
            assert!(
                u.iter().chain(v.iter()).all(|x| (0.0..=1.0).contains(x)),
                "({w}, {h}, {r}, {s})"
            );
        }
        let (mut a, mut b) = (vec![0.0; 16], vec![0.0; 16]);
        let (mut c, mut d) = (vec![0.0; 16], vec![0.0; 16]);
        sample_edge_aligned(6.0, 6.0, 0.0, SPACING, &mut Rng::new(1), &mut a, &mut b);
        sample_rounded_rect(6.0, 6.0, 0.0, &mut Rng::new(1), &mut c, &mut d);
        assert_eq!(
            (bits(&a), bits(&b)),
            (bits(&c), bits(&d)),
            "no ring: exactly W64's R2 layout"
        );
    }
}
