//! Seedable xorshift32 RNG (spec §2 "Robustness": same seed + same inputs =
//! the same particle positions).

/// xorshift32 has a fixed point at 0, so seed 0 is replaced by this constant.
pub const SEED_ZERO_SUBSTITUTE: u32 = 0x9e37_79b9;

#[derive(Clone, Debug)]
pub struct Rng {
    state: u32,
}

impl Rng {
    pub fn new(seed: u32) -> Rng {
        Rng {
            state: if seed == 0 {
                SEED_ZERO_SUBSTITUTE
            } else {
                seed
            },
        }
    }

    /// An independent stream `stream` of `seed` (murmur3 finaliser mix), e.g.
    /// one stream per element slot for sampling.
    pub fn derive(seed: u32, stream: u32) -> Rng {
        let mut z = seed ^ stream.wrapping_add(1).wrapping_mul(SEED_ZERO_SUBSTITUTE);
        z ^= z >> 16;
        z = z.wrapping_mul(0x85eb_ca6b);
        z ^= z >> 13;
        z = z.wrapping_mul(0xc2b2_ae35);
        z ^= z >> 16;
        Rng::new(z)
    }

    pub fn next_u32(&mut self) -> u32 {
        let mut s = self.state;
        s ^= s << 13;
        s ^= s >> 17;
        s ^= s << 5;
        self.state = s;
        s
    }

    /// Uniform in `[0, 1)` from the top 24 bits.
    pub fn next_f32(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 * (1.0 / 16_777_216.0)
    }

    pub fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.next_f32()
    }
}

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
