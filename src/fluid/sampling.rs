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
