//! Pre-allocated MPM grid with a per-substep dirty region (spec §2 "Grid";
//! plan resolutions B2, B5, B6, B15). Positions are in grid units: 1 = one
//! cell, origin at `(-margin, -margin)` px.

use super::access::{add, positive, rd, wr};

pub const CELL_MIN_PX: f32 = 4.0;
pub const CELL_MAX_PX: f32 = 8.0;
pub const GRID_MARGIN_MIN_PX: f32 = 200.0;
/// B5: the cell is chosen so the area hint holds about 4 particles per cell.
pub const PARTICLES_PER_CELL_AT_HINT: f32 = 4.0;
/// Spec §2 density constraint: MPM needs at least 2 particles per cell.
pub const MIN_PARTICLES_PER_CELL: f32 = 2.0;
pub const WORLD_MIN_PX: f32 = 64.0;
pub const WORLD_MAX_PX: f32 = 8192.0;
pub const DEFAULT_WORLD_W_PX: f32 = 1280.0;
pub const DEFAULT_WORLD_H_PX: f32 = 800.0;
/// B6: the dirty region is the particle AABB plus this many cells.
pub const REGION_PAD_CELLS: usize = 2;
/// Extra cells so the 3×3 stencil of a clamped particle never leaves the grid.
const STENCIL_GUARD_CELLS: usize = 3;
/// Cells at each edge whose velocity component into the wall is zeroed.
const WALL_CELLS: usize = 2;

/// Half-open cell range `[x0, x1) × [y0, y1)`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Region {
    pub x0: usize,
    pub y0: usize,
    pub x1: usize,
    pub y1: usize,
}

impl Region {
    pub fn cells(&self) -> usize {
        self.x1.saturating_sub(self.x0) * self.y1.saturating_sub(self.y0)
    }
}

/// Quadratic B-spline stencil of one particle: base node and weights.
#[derive(Clone, Copy, Debug)]
pub struct Stencil {
    pub bx: usize,
    pub by: usize,
    pub fx: f32,
    pub fy: f32,
    pub wx: [f32; 3],
    pub wy: [f32; 3],
}

/// Quadratic B-spline weights for the fractional offset `f ∈ [0.5, 1.5)`.
#[inline]
pub fn bspline(f: f32) -> [f32; 3] {
    [
        0.5 * (1.5 - f) * (1.5 - f),
        0.75 - (f - 1.0) * (f - 1.0),
        0.5 * (f - 0.5) * (f - 0.5),
    ]
}

fn world_extent(v: f32, fallback: f32) -> f32 {
    if positive(v) {
        v.clamp(WORLD_MIN_PX, WORLD_MAX_PX)
    } else {
        fallback
    }
}

pub struct Grid {
    pub cell_px: f32,
    pub inv_cell: f32,
    pub origin_x_px: f32,
    pub origin_y_px: f32,
    pub w: usize,
    pub h: usize,
    pub mass: Vec<f32>,
    /// Momentum after P2G, velocity after `update_velocities` (in place).
    pub mvx: Vec<f32>,
    pub mvy: Vec<f32>,
    pub region: Region,
    /// Diagnostic counter (B6 test): cells cleared plus cells updated.
    pub cells_touched: u64,
}

impl Grid {
    /// B5: `clamp(sqrt(4·A/N), 4, 8)` px; no usable hint gives 8 px.
    pub fn choose_cell_px(particles: u32, area_hint_px2: f32) -> f32 {
        if particles == 0 || !positive(area_hint_px2) {
            return CELL_MAX_PX;
        }
        (PARTICLES_PER_CELL_AT_HINT * area_hint_px2 / particles as f32)
            .sqrt()
            .clamp(CELL_MIN_PX, CELL_MAX_PX)
    }

    /// B15: `max(200, tallest initial element height)` px, decided at create.
    pub fn margin_px(max_element_h_px: f32) -> f32 {
        if max_element_h_px.is_finite() {
            max_element_h_px.clamp(GRID_MARGIN_MIN_PX, WORLD_MAX_PX)
        } else {
            GRID_MARGIN_MIN_PX
        }
    }

    /// Allocates the whole grid once: `(world + 2·margin) / cell` plus a
    /// stencil guard. World extents are clamped to `[64, 8192]` px (NaN →
    /// 1280×800); the margin is raised to at least 200 px.
    pub fn new(world_w_px: f32, world_h_px: f32, cell_px: f32, margin_px: f32) -> Grid {
        let cell = if cell_px.is_finite() {
            cell_px.clamp(CELL_MIN_PX, CELL_MAX_PX)
        } else {
            CELL_MAX_PX
        };
        let margin = Grid::margin_px(margin_px);
        let ww = world_extent(world_w_px, DEFAULT_WORLD_W_PX);
        let wh = world_extent(world_h_px, DEFAULT_WORLD_H_PX);
        let inv = 1.0 / cell;
        let w = ((ww + 2.0 * margin) * inv).ceil() as usize + STENCIL_GUARD_CELLS;
        let h = ((wh + 2.0 * margin) * inv).ceil() as usize + STENCIL_GUARD_CELLS;
        let n = w * h;
        Grid {
            cell_px: cell,
            inv_cell: inv,
            origin_x_px: -margin,
            origin_y_px: -margin,
            w,
            h,
            mass: vec![0.0; n],
            mvx: vec![0.0; n],
            mvy: vec![0.0; n],
            region: Region::default(),
            cells_touched: 0,
        }
    }

    #[inline]
    pub fn to_grid(&self, x_px: f32, y_px: f32) -> (f32, f32) {
        (
            (x_px - self.origin_x_px) * self.inv_cell,
            (y_px - self.origin_y_px) * self.inv_cell,
        )
    }

    #[inline]
    pub fn to_px(&self, gx: f32, gy: f32) -> (f32, f32) {
        (
            gx * self.cell_px + self.origin_x_px,
            gy * self.cell_px + self.origin_y_px,
        )
    }

    /// Keeps a position where its 3×3 stencil stays inside the grid (walls).
    #[inline]
    pub fn clamp_pos(&self, gx: f32, gy: f32) -> (f32, f32) {
        let hx = self.w as f32 - 2.001;
        let hy = self.h as f32 - 2.001;
        (
            if gx.is_finite() {
                gx.clamp(1.0, hx)
            } else {
                1.0
            },
            if gy.is_finite() {
                gy.clamp(1.0, hy)
            } else {
                1.0
            },
        )
    }

    #[inline]
    pub fn stencil(&self, gx: f32, gy: f32) -> Stencil {
        let bx = (gx - 0.5).floor().max(0.0);
        let by = (gy - 0.5).floor().max(0.0);
        let fx = gx - bx;
        let fy = gy - by;
        Stencil {
            bx: bx as usize,
            by: by as usize,
            fx,
            fy,
            wx: bspline(fx),
            wy: bspline(fy),
        }
    }

    /// B6: sets the dirty region to the particle AABB (grid units) plus
    /// `REGION_PAD_CELLS`, clamped to the grid.
    pub fn set_region(&mut self, min_gx: f32, min_gy: f32, max_gx: f32, max_gy: f32) {
        let lo = |v: f32| (v.max(0.0).floor() as usize).saturating_sub(REGION_PAD_CELLS);
        let hi = |v: f32, n: usize| {
            (v.max(0.0).floor() as usize)
                .saturating_add(REGION_PAD_CELLS)
                .saturating_add(1)
                .min(n)
        };
        self.region = Region {
            x0: lo(min_gx),
            y0: lo(min_gy),
            x1: hi(max_gx, self.w),
            y1: hi(max_gy, self.h),
        };
    }

    pub fn region(&self) -> Region {
        self.region
    }

    /// Zeroes mass and momentum inside the dirty region only. Cells outside it
    /// may hold stale values; nothing reads them, because every particle
    /// stencil lies inside the region.
    pub fn clear_region(&mut self) {
        let r = self.region;
        for y in r.y0..r.y1 {
            let (a, b) = (y * self.w + r.x0, y * self.w + r.x1);
            if let Some(row) = self.mass.get_mut(a..b) {
                row.fill(0.0);
            }
            if let Some(row) = self.mvx.get_mut(a..b) {
                row.fill(0.0);
            }
            if let Some(row) = self.mvy.get_mut(a..b) {
                row.fill(0.0);
            }
        }
        self.cells_touched += r.cells() as u64;
    }

    /// P2G scatter of one particle: mass and APIC momentum `m·v + (m·C)·(xᵢ − xₚ)`.
    pub fn p2g(&mut self, st: &Stencil, mass: f32, mvx: f32, mvy: f32, affine: [f32; 4]) {
        let [a00, a01, a10, a11] = affine;
        for (jj, wy) in st.wy.iter().enumerate() {
            let dy = jj as f32 - st.fy;
            let row = (st.by + jj) * self.w + st.bx;
            for (ii, wx) in st.wx.iter().enumerate() {
                let wgt = wx * wy;
                let dx = ii as f32 - st.fx;
                let idx = row + ii;
                add(&mut self.mass, idx, wgt * mass);
                add(&mut self.mvx, idx, wgt * (mvx + a00 * dx + a01 * dy));
                add(&mut self.mvy, idx, wgt * (mvy + a10 * dx + a11 * dy));
            }
        }
    }

    /// Momentum → velocity inside the dirty region, with slip walls at the
    /// grid edges. `_dt` (gravity, slice 6) and `_vmax_cells` (grid CFL cap,
    /// W67) are part of the contract and unused in W64.
    pub fn update_velocities(&mut self, _dt: f32, _vmax_cells: f32) {
        let r = self.region;
        for y in r.y0..r.y1 {
            for x in r.x0..r.x1 {
                let idx = y * self.w + x;
                let m = rd(&self.mass, idx);
                if m <= 0.0 {
                    continue;
                }
                let mut vx = rd(&self.mvx, idx) / m;
                let mut vy = rd(&self.mvy, idx) / m;
                if (x < WALL_CELLS && vx < 0.0) || (x + WALL_CELLS + 1 > self.w && vx > 0.0) {
                    vx = 0.0;
                }
                if (y < WALL_CELLS && vy < 0.0) || (y + WALL_CELLS + 1 > self.h && vy > 0.0) {
                    vy = 0.0;
                }
                wr(&mut self.mvx, idx, vx);
                wr(&mut self.mvy, idx, vy);
            }
        }
        self.cells_touched += r.cells() as u64;
    }

    /// G2P gather: velocity and the APIC affine matrix `C = 4·Σ w·v·(xᵢ − xₚ)ᵀ`
    /// (`D⁻¹ = 4` for quadratic weights with dx = 1).
    pub fn g2p(&self, st: &Stencil) -> (f32, f32, [f32; 4]) {
        let (mut vx, mut vy) = (0.0f32, 0.0f32);
        let (mut c00, mut c01, mut c10, mut c11) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
        for (jj, wy) in st.wy.iter().enumerate() {
            let dy = jj as f32 - st.fy;
            let row = (st.by + jj) * self.w + st.bx;
            for (ii, wx) in st.wx.iter().enumerate() {
                let wgt = wx * wy;
                let dx = ii as f32 - st.fx;
                let gvx = rd(&self.mvx, row + ii);
                let gvy = rd(&self.mvy, row + ii);
                vx += wgt * gvx;
                vy += wgt * gvy;
                c00 += 4.0 * wgt * gvx * dx;
                c01 += 4.0 * wgt * gvx * dy;
                c10 += 4.0 * wgt * gvy * dx;
                c11 += 4.0 * wgt * gvy * dy;
            }
        }
        (vx, vy, [c00, c01, c10, c11])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn given_8000_particles_and_76k_px2_when_choosing_cell_then_sqrt_4a_over_n_clamped_4_to_8() {
        let c = Grid::choose_cell_px(8000, 76_057.0);
        assert!(
            (c - (4.0f32 * 76_057.0 / 8000.0).sqrt()).abs() < 1e-4,
            "{c}"
        );
        assert!((6.1..6.2).contains(&c), "{c}");
        assert_eq!(Grid::choose_cell_px(8000, 1_000.0), CELL_MIN_PX);
        assert_eq!(Grid::choose_cell_px(8000, 10_000_000.0), CELL_MAX_PX);
    }

    #[test]
    fn given_zero_area_hint_when_choosing_cell_then_8px() {
        for a in [0.0, -5.0, f32::NAN, f32::INFINITY] {
            assert_eq!(Grid::choose_cell_px(8000, a), 8.0, "hint {a}");
        }
        assert_eq!(Grid::choose_cell_px(0, 1000.0), 8.0);
    }

    #[test]
    fn given_world_1280x800_when_grid_built_then_covers_world_plus_200px_margin_each_side() {
        let g = Grid::new(1280.0, 800.0, 6.0, 200.0);
        assert_eq!((g.origin_x_px, g.origin_y_px), (-200.0, -200.0));
        assert!(g.origin_x_px + g.w as f32 * g.cell_px >= 1280.0 + 200.0);
        assert!(g.origin_y_px + g.h as f32 * g.cell_px >= 800.0 + 200.0);
        assert_eq!(g.mass.len(), g.w * g.h);
        assert_eq!(g.mvx.len(), g.w * g.h);
        assert_eq!(g.mvy.len(), g.w * g.h);
    }

    #[test]
    fn given_tallest_element_when_margin_chosen_then_max_of_200_and_its_height() {
        assert_eq!(Grid::margin_px(180.0), 200.0);
        assert_eq!(Grid::margin_px(350.0), 350.0);
        assert_eq!(Grid::margin_px(f32::NAN), 200.0);
        assert_eq!(Grid::new(1280.0, 800.0, 8.0, 350.0).origin_y_px, -350.0);
    }

    #[test]
    fn given_any_fraction_when_bspline_weights_summed_then_one() {
        for k in 0..=100 {
            let f = 0.5 + k as f32 / 100.0;
            let s: f32 = bspline(f).iter().sum();
            assert!((s - 1.0).abs() < 1e-6, "f = {f}: {s}");
        }
    }

    #[test]
    fn given_particle_bounds_when_region_set_then_clear_and_update_touch_only_the_padded_region() {
        let mut g = Grid::new(1280.0, 800.0, 4.0, 200.0);
        let (x0, y0) = g.to_grid(100.0, 100.0);
        let (x1, y1) = g.to_grid(200.0, 150.0);
        g.set_region(x0, y0, x1, y1);
        let r = g.region();
        assert_eq!(r.x0, x0.floor() as usize - REGION_PAD_CELLS);
        assert_eq!(r.x1, x1.floor() as usize + REGION_PAD_CELLS + 1);
        assert_eq!(r.y0, y0.floor() as usize - REGION_PAD_CELLS);
        assert_eq!(r.y1, y1.floor() as usize + REGION_PAD_CELLS + 1);
        let before = g.cells_touched;
        g.clear_region();
        g.update_velocities(1.0 / 480.0, 0.45);
        assert_eq!(g.cells_touched - before, 2 * r.cells() as u64);
        assert!(r.cells() * 50 < g.w * g.h, "{} of {}", r.cells(), g.w * g.h);
    }
}

#[cfg(test)]
mod w67_tests {
    use super::cap_speed;

    #[test]
    fn given_speed_above_cap_when_capped_then_scaled_to_cap_and_direction_kept() {
        let (x, y) = cap_speed(30.0, 40.0, 25.0);
        assert!((x - 15.0).abs() < 1e-5 && (y - 20.0).abs() < 1e-5);
        let (x, y) = cap_speed(3.0, 4.0, 25.0);
        assert!(
            (x - 3.0).abs() < 1e-7 && (y - 4.0).abs() < 1e-7,
            "below the cap: unchanged"
        );
    }

    #[test]
    fn given_non_finite_velocity_when_capped_then_zero() {
        for (vx, vy) in [
            (f32::NAN, 1.0),
            (1.0, f32::INFINITY),
            (f32::NEG_INFINITY, f32::NAN),
        ] {
            let (x, y) = cap_speed(vx, vy, 25.0);
            assert!(x.abs() < f32::MIN_POSITIVE && y.abs() < f32::MIN_POSITIVE);
        }
    }
}
