//! Fixed-step accumulator (spec §2 "Timestep"): Rust owns it, the raw RAF dt
//! is clamped to 100 ms, at most 3 fixed steps of 1/60 s run per tick, and the
//! remainder is dropped when the cap is hit (the simulation slows down instead
//! of blowing up). The accumulator is f64 with an epsilon so a 60 Hz RAF gives
//! exactly one step per frame (skeleton review focus #5).

pub const FIXED_DT_S: f32 = 1.0 / 60.0;
pub const MAX_RAW_DT_S: f32 = 0.1;
pub const MAX_STEPS_PER_TICK: u32 = 3;
pub const SUBSTEPS: u32 = 8;
const EPS_S: f64 = 1e-6;

#[derive(Clone, Debug, Default)]
pub struct FixedClock {
    acc_s: f64,
}

impl FixedClock {
    /// Adds `raw_dt_s` and returns how many fixed steps are due (0-3).
    /// NaN, infinite, zero or negative input adds nothing.
    pub fn advance(&mut self, raw_dt_s: f32) -> u32 {
        if !raw_dt_s.is_finite() || raw_dt_s <= 0.0 {
            return 0;
        }
        self.acc_s += f64::from(raw_dt_s.min(MAX_RAW_DT_S));
        let fixed = f64::from(FIXED_DT_S);
        let mut steps = 0;
        while self.acc_s + EPS_S >= fixed {
            if steps == MAX_STEPS_PER_TICK {
                self.acc_s = 0.0;
                break;
            }
            self.acc_s -= fixed;
            steps += 1;
        }
        if self.acc_s < 0.0 {
            self.acc_s = 0.0;
        }
        steps
    }

    pub fn accumulator_s(&self) -> f64 {
        self.acc_s
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn given_raw_dt_one_sixtieth_when_advanced_60_times_then_exactly_60_steps() {
        let mut c = FixedClock::default();
        let steps: u32 = (0..60).map(|_| c.advance(1.0 / 60.0)).sum();
        assert_eq!(steps, 60);
    }

    #[test]
    fn given_raw_dt_250ms_when_advanced_then_clamped_to_100ms_capped_at_3_steps_and_remainder_dropped()
     {
        let mut c = FixedClock::default();
        assert_eq!(c.advance(0.25), MAX_STEPS_PER_TICK);
        assert_eq!(c.accumulator_s(), 0.0);
        assert_eq!(c.advance(0.001), 0, "the dropped remainder must not leak");
    }

    #[test]
    fn given_raw_dt_50ms_when_advanced_then_exactly_3_steps_and_remainders_carry() {
        let mut c = FixedClock::default();
        assert_eq!(c.advance(0.05), 3);
        assert!(c.accumulator_s() < 1e-6, "{}", c.accumulator_s());
        // 40 ms = 2 steps + 6.67 ms carried; 10 ms more makes the third step due.
        let mut c = FixedClock::default();
        assert_eq!(c.advance(0.04), 2);
        assert_eq!(c.advance(0.01), 1);
    }

    #[test]
    fn given_nan_or_negative_dt_when_advanced_then_zero_steps() {
        let mut c = FixedClock::default();
        for dt in [f32::NAN, -0.016, f32::INFINITY, f32::NEG_INFINITY, 0.0] {
            assert_eq!(c.advance(dt), 0, "dt = {dt}");
        }
        assert_eq!(c.accumulator_s(), 0.0);
    }

    #[test]
    fn given_120hz_frames_when_advanced_then_one_step_every_second_frame() {
        let mut c = FixedClock::default();
        let steps: Vec<u32> = (0..8).map(|_| c.advance(1.0 / 120.0)).collect();
        assert_eq!(steps, [0, 1, 0, 1, 0, 1, 0, 1]);
    }
}
