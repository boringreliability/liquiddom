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
