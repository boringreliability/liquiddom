//! Seedable xorshift32 RNG (spec §2 "Robustness": same seed + same inputs =
//! the same particle positions).

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn given_same_seed_when_drawing_1000_values_then_sequences_identical() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..1000 {
            assert_eq!(a.next_u32(), b.next_u32());
        }
    }

    #[test]
    fn given_seed_zero_when_constructed_then_sequence_is_nondegenerate() {
        let mut r = Rng::new(0);
        let mut seen = HashSet::new();
        for _ in 0..1000 {
            let v = r.next_u32();
            assert_ne!(v, 0);
            seen.insert(v);
        }
        assert!(seen.len() > 990, "only {} distinct values", seen.len());
    }

    #[test]
    fn given_any_seed_when_next_f32_then_value_in_unit_interval() {
        for seed in [0u32, 1, 7, 0xdead_beef, u32::MAX] {
            let mut r = Rng::new(seed);
            for _ in 0..10_000 {
                let v = r.next_f32();
                assert!((0.0..1.0).contains(&v), "seed {seed}: {v}");
            }
        }
    }

    #[test]
    fn given_two_streams_of_one_seed_when_derived_then_sequences_differ() {
        let mut a = Rng::derive(1, 0);
        let mut b = Rng::derive(1, 1);
        let same = (0..64).filter(|_| a.next_u32() == b.next_u32()).count();
        assert!(same < 2, "{same} equal draws");
    }
}
