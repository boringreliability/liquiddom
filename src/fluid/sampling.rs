//! Rounded-rect geometry, largest-remainder apportionment and seeded
//! progressive sampling (spec §2 "Particle pool and elements", decision D64-3).

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
            assert!(inside_rounded_rect(pu * 140.0, pv * 48.0, 140.0, 48.0, 24.0));
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
