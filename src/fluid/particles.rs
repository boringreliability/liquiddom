//! SoA particle state in grid units (spec §2: `x, y, vx, vy, C(4), J, F(4),
//! home, rest_u, rest_v, flags`), plus the per-generation rank and mass.

use super::access::{wr, wr4};

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

    /// v = 0, C = 0, J = 1, F = I.
    pub fn reset_kinematics(&mut self, i: usize) {
        wr(&mut self.vx, i, 0.0);
        wr(&mut self.vy, i, 0.0);
        wr4(&mut self.c, i, [0.0; 4]);
        wr(&mut self.j, i, 1.0);
        wr4(&mut self.f, i, IDENTITY);
    }
}
