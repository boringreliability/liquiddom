//! SoA particle state in grid units (spec §2: `x, y, vx, vy, C(4), J, F(4),
//! home, rest_u, rest_v, flags`), plus the per-generation rank and mass.

use super::access::{wr, wr4};
use super::layout::{FLAG_PARKED, FLAG_TORN};

pub const NO_HOME: u32 = u32::MAX;
pub const IDENTITY: [f32; 4] = [1.0, 0.0, 0.0, 1.0];

pub struct Particles {
    pub cap: usize,
    pub x: Vec<f32>,
    pub y: Vec<f32>,
    pub vx: Vec<f32>,
    pub vy: Vec<f32>,
    /// APIC affine matrix `[c00, c01, c10, c11]`.
    pub c: Vec<[f32; 4]>,
    pub j: Vec<f32>,
    /// Render-only deformation gradient (slice 4); identity until then.
    pub f: Vec<[f32; 4]>,
    pub home: Vec<u32>,
    /// Index of this particle within its home's rest sample (D64-3).
    pub rank: Vec<u32>,
    pub rest_u: Vec<f32>,
    pub rest_v: Vec<f32>,
    pub flags: Vec<u32>,
    pub placed: Vec<bool>,
    /// B4: per-generation volume = mass (rest density 1), in cell² units.
    pub mass: Vec<f32>,
}

impl Particles {
    pub fn new(cap: usize) -> Particles {
        Particles {
            cap,
            x: vec![0.0; cap],
            y: vec![0.0; cap],
            vx: vec![0.0; cap],
            vy: vec![0.0; cap],
            c: vec![[0.0; 4]; cap],
            j: vec![1.0; cap],
            f: vec![IDENTITY; cap],
            home: vec![NO_HOME; cap],
            rank: vec![0; cap],
            rest_u: vec![0.5; cap],
            rest_v: vec![0.5; cap],
            flags: vec![0; cap],
            placed: vec![false; cap],
            mass: vec![0.0; cap],
        }
    }

    #[inline]
    pub fn home_of(&self, i: usize) -> Option<usize> {
        match self.home.get(i) {
            Some(&h) if h != NO_HOME => Some(h as usize),
            _ => None,
        }
    }

    /// W81 (D81-1): the particle carries `FLAG_PARKED` (its element is parked). Out of range: false.
    #[inline]
    pub fn is_parked(&self, i: usize) -> bool {
        self.flags.get(i).is_some_and(|f| f & FLAG_PARKED != 0)
    }

    /// v = 0, C = 0, J = 1, and (W74) `reset_deformation`: the reduced-motion pin leaves no
    /// particle torn.
    pub fn reset_kinematics(&mut self, i: usize) {
        wr(&mut self.vx, i, 0.0);
        wr(&mut self.vy, i, 0.0);
        wr4(&mut self.c, i, [0.0; 4]);
        wr(&mut self.j, i, 1.0);
        self.reset_deformation(i);
    }

    /// W74 (D74-2, D74-3): F = I and `torn` cleared; other flag bits, positions and velocities
    /// stay. Used by `reset_kinematics` and by `pool::redistribute` for a refilled particle,
    /// whose new rest_uv makes its old render-only F meaningless.
    pub fn reset_deformation(&mut self, i: usize) {
        wr4(&mut self.f, i, IDENTITY);
        if let Some(flags) = self.flags.get_mut(i) {
            *flags &= !FLAG_TORN;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fluid::layout::FLAG_TORN;

    #[test]
    fn given_a_torn_particle_with_deformed_f_when_reset_kinematics_then_f_identity_torn_cleared_other_flag_bits_kept()
     {
        let mut p = Particles::new(2);
        p.f[1] = [1.7, 0.2, -0.1, 0.4];
        p.flags[1] = FLAG_TORN | 4;
        p.reset_kinematics(1);
        assert_eq!(p.f[1], IDENTITY);
        assert_eq!(p.flags[1], 4, "torn cleared, other bits kept");
        assert_eq!(p.flags[0], 0, "other particles untouched");
        p.reset_kinematics(9); // out of range: no panic
    }
}
