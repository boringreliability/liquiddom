//! Global material (spec §2 "Material parameters"). W64 only stores the values
//! TS sends; W67 adds `Material::sanitized`, `MaterialParams` and the mapping
//! onto solver constants.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Material {
    pub viscosity: f32,
    pub cohesion: f32,
    pub recovery_s: f32,
}

pub const DEFAULT_MATERIAL: Material = Material {
    viscosity: 0.5,
    cohesion: 0.5,
    recovery_s: 0.7,
};

impl Default for Material {
    fn default() -> Self {
        DEFAULT_MATERIAL
    }
}

// ---- W67: sanitising and mapping onto solver units (spec §2) -------------------
//
// The public material is normalised: `viscosity` and `cohesion` in [0, 1],
// `recovery` in seconds [0.2, 3]. Cohesion is global only: one TENSION_MAX for
// the whole liquid.

pub const VISCOSITY_MIN_PX2_S: f32 = 100.0;
pub const VISCOSITY_MAX_PX2_S: f32 = 2000.0;
pub const TENSION_MAX_MIN: f32 = 0.02;
pub const TENSION_MAX_MAX: f32 = 0.30;
pub const RECOVERY_MIN_S: f32 = 0.2;
pub const RECOVERY_MAX_S: f32 = 3.0;

/// The material in solver units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MaterialParams {
    /// Kinematic viscosity in px²/s (log-mapped 100–2000).
    pub viscosity_px2_s: f32,
    /// Plastic yield on stretch: J ≤ 1 + tension_max (linear 0.02–0.30).
    pub tension_max: f32,
    /// Stiffness recovery time constant in seconds.
    pub recovery_s: f32,
}

fn unit_or(value: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 1.0)
    } else {
        fallback
    }
}

/// `viscosity` [0,1] → px²/s on a log scale: 100·20^v (0.5 ≈ 447).
pub fn map_viscosity(viscosity: f32) -> f32 {
    let v = unit_or(viscosity, DEFAULT_MATERIAL.viscosity);
    VISCOSITY_MIN_PX2_S * (VISCOSITY_MAX_PX2_S / VISCOSITY_MIN_PX2_S).powf(v)
}

/// `cohesion` [0,1] → TENSION_MAX, linear 0.02–0.30 (0.5 = 0.16).
pub fn map_cohesion(cohesion: f32) -> f32 {
    let c = unit_or(cohesion, DEFAULT_MATERIAL.cohesion);
    TENSION_MAX_MIN + (TENSION_MAX_MAX - TENSION_MAX_MIN) * c
}

/// Seconds clamped to [0.2, 3]; NaN/±inf → the 0.7 s default.
pub fn sanitize_recovery(recovery_s: f32) -> f32 {
    if recovery_s.is_finite() {
        recovery_s.clamp(RECOVERY_MIN_S, RECOVERY_MAX_S)
    } else {
        DEFAULT_MATERIAL.recovery_s
    }
}

impl Material {
    pub fn sanitized(viscosity: f32, cohesion: f32, recovery_s: f32) -> Material {
        Material {
            viscosity: unit_or(viscosity, DEFAULT_MATERIAL.viscosity),
            cohesion: unit_or(cohesion, DEFAULT_MATERIAL.cohesion),
            recovery_s: sanitize_recovery(recovery_s),
        }
    }

    pub fn params(&self) -> MaterialParams {
        MaterialParams {
            viscosity_px2_s: map_viscosity(self.viscosity),
            tension_max: map_cohesion(self.cohesion),
            recovery_s: sanitize_recovery(self.recovery_s),
        }
    }
}

#[cfg(test)]
mod w67_tests {
    use super::*;

    #[test]
    fn given_viscosity_0_and_1_when_mapped_then_100_and_2000() {
        assert!((map_viscosity(0.0) - 100.0).abs() < 1e-3);
        assert!((map_viscosity(1.0) - 2000.0).abs() < 1e-2);
    }

    #[test]
    fn given_viscosity_0_5_when_mapped_then_about_447() {
        let v = map_viscosity(0.5);
        assert!((v - 447.21).abs() < 0.05, "100·20^0.5 = 447.2, got {v}");
    }

    #[test]
    fn given_cohesion_0_5_when_mapped_then_0_16_and_bounds_0_02_0_30() {
        assert!((map_cohesion(0.5) - 0.16).abs() < 1e-6);
        assert!((map_cohesion(0.0) - 0.02).abs() < 1e-6);
        assert!((map_cohesion(1.0) - 0.30).abs() < 1e-6);
        assert!((map_cohesion(-3.0) - 0.02).abs() < 1e-6, "clamped below");
        assert!((map_cohesion(7.0) - 0.30).abs() < 1e-6, "clamped above");
        assert!(
            (map_cohesion(f32::NAN) - 0.16).abs() < 1e-6,
            "NaN → default 0.5"
        );
    }

    #[test]
    fn given_recovery_nan_or_out_of_range_when_sanitized_then_default_0_7_or_clamped_0_2_3() {
        assert!((Material::sanitized(0.5, 0.5, f32::NAN).recovery_s - 0.7).abs() < 1e-6);
        assert!((Material::sanitized(0.5, 0.5, 0.05).recovery_s - 0.2).abs() < 1e-6);
        assert!((Material::sanitized(0.5, 0.5, 10.0).recovery_s - 3.0).abs() < 1e-6);
        let m = Material::sanitized(f32::NAN, f32::INFINITY, 1.0);
        assert!((m.viscosity - 0.5).abs() < 1e-6);
        assert!((m.cohesion - 0.5).abs() < 1e-6);
    }

    #[test]
    fn given_default_material_when_mapped_then_params_match_spec_defaults() {
        let p = DEFAULT_MATERIAL.params();
        assert!((p.viscosity_px2_s - 447.21).abs() < 0.05);
        assert!((p.tension_max - 0.16).abs() < 1e-6);
        assert!((p.recovery_s - 0.7).abs() < 1e-6);
    }
}
