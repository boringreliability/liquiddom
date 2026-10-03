//! Fixed-step accumulator (spec §2 "Timestep"): Rust owns it, the raw RAF dt
//! is clamped to 100 ms, at most 3 fixed steps of 1/60 s run per tick, and the
//! remainder is dropped when the cap is hit (the simulation slows down instead
//! of blowing up). The accumulator is f64 with an epsilon so a 60 Hz RAF gives
//! exactly one step per frame (skeleton review focus #5).

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
