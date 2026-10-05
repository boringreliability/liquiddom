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
