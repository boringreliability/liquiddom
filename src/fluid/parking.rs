//! W81 red stub (D81-1): parking. Task W81.2 replaces this whole file.

use super::elements::{Elements, Rect};
use super::grid::Grid;
use super::particles::Particles;

/// D81-1: a parked element comes back once its home rect is this many px inside the bound on
/// every side (or once it overlaps the world).
pub const UNPARK_INSET_PX: f32 = 64.0;

/// A box in buffer px, `[x0, x1] × [y0, y1]`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

const NOWHERE: Bounds = Bounds {
    x0: 0.0,
    y0: 0.0,
    x1: 0.0,
    y1: 0.0,
};

pub fn bound(_g: &Grid) -> Bounds {
    NOWHERE
}

pub fn world(_g: &Grid) -> Bounds {
    NOWHERE
}

pub fn outside(_r: &Rect, _b: &Bounds) -> bool {
    false
}

pub fn inside_by(_r: &Rect, _b: &Bounds, _inset: f32) -> bool {
    false
}

pub fn overlaps(_r: &Rect, _b: &Bounds) -> bool {
    false
}

pub fn update(_p: &mut Particles, _g: &Grid, _e: &mut Elements, _reduced_motion: bool) -> bool {
    false
}

pub fn sync_particles(_p: &mut Particles, _g: &Grid, _e: &Elements, _reduced_motion: bool) {}
