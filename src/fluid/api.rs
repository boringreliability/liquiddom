//! `FluidCore`: the whole fluid FFI surface (spec §2 "FFI contract"; plan
//! skeleton §3.2, amended by resolutions B14 and B15). JS sees `FluidCore`.
//! Everything is allocated in the constructor; nothing on the hot path
//! allocates, so the exported pointers stay valid for the core's lifetime.

use wasm_bindgen::prelude::*;

use super::access::rd;
use super::clock::{FIXED_DT_S, FixedClock, SUBSTEPS};
use super::elements::Elements;
use super::grid::{Grid, MIN_PARTICLES_PER_CELL};
use super::layout::{DYNAMIC_FIELDS, ELEMENT_STRIDE, STATE_STRIDE, STATIC_FIELDS};
use super::material::{DEFAULT_MATERIAL, Material};
use super::particles::Particles;
use super::pool::{self, PoolScratch};
use super::solver::{self, Scratch, StepInput};
use super::views::Views;

pub const PARTICLES_MIN: u32 = 16;
pub const PARTICLES_MAX: u32 = 65_536;
pub const ELEMENTS_MIN: u32 = 1;
pub const ELEMENTS_MAX: u32 = 256;

pub struct Settings {
    pub material: Material,
    pub reduced_motion: bool,
    pub seed: u32,
}

#[wasm_bindgen]
pub struct FluidCore {
    particles: Particles,
    grid: Grid,
    elements: Elements,
    views: Views,
    scratch: Scratch,
    pool_scratch: PoolScratch,
    clock: FixedClock,
    settings: Settings,
    generation: u32,
    active: u32,
    time_s: f32,
}

#[wasm_bindgen]
impl FluidCore {
    /// `particles` is clamped to [16, 65536] and `max_elements` to [1, 256];
    /// TS validates first. The cell size follows B5 from `area_hint_px2`
    /// (≤ 0 or NaN → 8 px), the margin follows B15 from `max_element_h_px`.
    #[wasm_bindgen(constructor)]
    pub fn new(
        particles: u32,
        max_elements: u32,
        world_w_px: f32,
        world_h_px: f32,
        area_hint_px2: f32,
        max_element_h_px: f32,
        seed: u32,
    ) -> FluidCore {
        let n = particles.clamp(PARTICLES_MIN, PARTICLES_MAX);
        let m = max_elements.clamp(ELEMENTS_MIN, ELEMENTS_MAX);
        let grid = Grid::new(
            world_w_px,
            world_h_px,
            Grid::choose_cell_px(n, area_hint_px2),
            Grid::margin_px(max_element_h_px),
        );
        let particles = Particles::new(n as usize);
        let mut views = Views::new(n as usize);
        views.write_dynamic(&particles, &grid);
        views.write_static(&particles);
        FluidCore {
            scratch: Scratch::new(n as usize, m as usize),
            pool_scratch: PoolScratch::new(n as usize, m as usize),
            elements: Elements::new(m as usize),
            particles,
            grid,
            views,
            clock: FixedClock::default(),
            settings: Settings {
                material: DEFAULT_MATERIAL,
                reduced_motion: false,
                seed,
            },
            generation: 0,
            active: 0,
            time_s: 0.0,
        }
    }

    pub fn elements_ptr(&self) -> *const f32 {
        self.elements.buf.as_ptr()
    }

    pub fn dynamic_ptr(&self) -> *const f32 {
        self.views.dynamic.as_ptr()
    }

    pub fn static_ptr(&self) -> *const f32 {
        self.views.statics.as_ptr()
    }

    pub fn state_ptr(&self) -> *const f32 {
        self.elements.state.as_ptr()
    }

    pub fn particle_capacity(&self) -> u32 {
        u32::try_from(self.particles.cap).unwrap_or(u32::MAX)
    }

    pub fn element_capacity(&self) -> u32 {
        u32::try_from(self.elements.cap).unwrap_or(u32::MAX)
    }

    /// 0 (no active element) or `particle_capacity()` (B3).
    pub fn active_particles(&self) -> u32 {
        self.active
    }

    pub fn cell_px(&self) -> f32 {
        self.grid.cell_px
    }

    /// `particles · cell² / 2` (spec §2 density constraint).
    pub fn max_area_px2(&self) -> f32 {
        self.particles.cap as f32 * self.grid.cell_px * self.grid.cell_px / MIN_PARTICLES_PER_CELL
    }

    pub fn element_stride(&self) -> u32 {
        ELEMENT_STRIDE as u32
    }

    pub fn state_stride(&self) -> u32 {
        STATE_STRIDE as u32
    }

    pub fn dynamic_fields(&self) -> u32 {
        DYNAMIC_FIELDS as u32
    }

    pub fn static_fields(&self) -> u32 {
        STATIC_FIELDS as u32
    }

    /// +1 on every `redistribute()`.
    pub fn generation(&self) -> u32 {
        self.generation
    }

    /// Advances by the raw RAF dt (Rust owns the accumulator) and returns the
    /// fixed steps simulated: 0–3, always 0 under reduced motion (D64-4). The
    /// pointer (W68) and gravity (slice 6) arguments are accepted and unused.
    #[allow(clippy::too_many_arguments)]
    pub fn tick(
        &mut self,
        raw_dt_s: f32,
        _px: f32,
        _py: f32,
        _pvx: f32,
        _pvy: f32,
        _pointer_active: bool,
        _gx: f32,
        _gy: f32,
    ) -> u32 {
        let steps = self.clock.advance(raw_dt_s);
        let rm = self.settings.reduced_motion;
        solver::compute_targets(
            &self.particles,
            &self.grid,
            &self.elements,
            rm,
            &mut self.scratch,
        );
        let simulated = if rm {
            solver::pin_to_targets(&mut self.particles, &self.grid, &self.scratch);
            self.refresh_rest_state(true, 0.0);
            0
        } else {
            let dt = FIXED_DT_S / SUBSTEPS as f32;
            for _ in 0..steps {
                self.elements.update_velocities(FIXED_DT_S);
                for _ in 0..SUBSTEPS {
                    let input = StepInput {
                        dt,
                        time_s: self.time_s,
                    };
                    solver::substep(
                        &mut self.particles,
                        &mut self.grid,
                        &self.elements,
                        &input,
                        &self.scratch,
                    );
                    self.time_s += dt;
                }
                self.refresh_rest_state(false, FIXED_DT_S);
            }
            steps
        };
        self.views.write_dynamic(&self.particles, &self.grid);
        simulated
    }

    /// Buffer-space splash. No-op stub in W64; behaviour lands in W67.
    pub fn splash(&mut self, _id: u32, _x: f32, _y: f32, _strength: f32) {}

    /// Global shake. No-op stub in W64; behaviour lands in W67.
    pub fn shake(&mut self, _strength: f32) {}

    /// W64 stores the values; W67 sanitises and maps them.
    pub fn set_material(&mut self, viscosity: f32, cohesion: f32, recovery: f32) {
        self.settings.material = Material {
            viscosity,
            cohesion,
            recovery_s: recovery,
        };
    }

    pub fn redistribute(&mut self) {
        let rm = self.settings.reduced_motion;
        self.active = pool::redistribute(
            &mut self.particles,
            &mut self.elements,
            &self.grid,
            self.settings.seed,
            rm,
            &mut self.pool_scratch,
        );
        self.generation = self.generation.wrapping_add(1);
        self.views.write_static(&self.particles);
        solver::compute_targets(
            &self.particles,
            &self.grid,
            &self.elements,
            rm,
            &mut self.scratch,
        );
        if rm {
            solver::pin_to_targets(&mut self.particles, &self.grid, &self.scratch);
        }
        self.refresh_rest_state(rm, 0.0);
        self.views.write_dynamic(&self.particles, &self.grid);
    }

    pub fn set_reduced_motion(&mut self, on: bool) {
        self.settings.reduced_motion = on;
    }
}

impl FluidCore {
    fn refresh_rest_state(&mut self, reduced_motion: bool, dt: f32) {
        solver::measure_max_dev(
            &self.particles,
            &self.grid,
            &self.scratch.tgt_x,
            &self.scratch.tgt_y,
            &mut self.scratch.max_dev,
        );
        for id in 0..self.elements.cap {
            let dev = rd(&self.scratch.max_dev, id);
            self.elements.update_rest_state(id, dev, dt, reduced_motion);
        }
    }
}

#[cfg(test)]
macro_rules! fingerprint {
    ($($v:expr),* $(,)?) => {
        vec![$(($v.capacity(), $v.as_ptr() as usize)),*]
    };
}

#[cfg(test)]
impl FluidCore {
    pub fn write_element(&mut self, id: usize, slot: [f32; ELEMENT_STRIDE]) {
        let start = id.saturating_mul(ELEMENT_STRIDE);
        if let Some(dst) = self
            .elements
            .buf
            .get_mut(start..start.saturating_add(ELEMENT_STRIDE))
        {
            dst.copy_from_slice(&slot);
        }
    }

    pub fn particle_px(&self, i: usize) -> (f32, f32) {
        self.grid.to_px(self.particles.x[i], self.particles.y[i])
    }

    pub fn set_particle_px(&mut self, i: usize, x: f32, y: f32) {
        let (gx, gy) = self.grid.to_grid(x, y);
        self.particles.x[i] = gx;
        self.particles.y[i] = gy;
    }

    pub fn target_px(&self, i: usize) -> Option<(f32, f32)> {
        let h = self.particles.home_of(i)?;
        let (u, v) = (self.particles.rest_u[i], self.particles.rest_v[i]);
        self.elements
            .target_px(h, u, v, self.settings.reduced_motion)
    }

    pub fn state(&self, id: usize) -> [f32; STATE_STRIDE] {
        let b = id * STATE_STRIDE;
        self.elements.state[b..b + STATE_STRIDE].try_into().unwrap()
    }

    pub fn home(&self, i: usize) -> u32 {
        self.particles.home[i]
    }

    pub fn rest_uv(&self, i: usize) -> (f32, f32) {
        (self.particles.rest_u[i], self.particles.rest_v[i])
    }

    pub fn mean_j(&self) -> f32 {
        self.particles.j.iter().sum::<f32>() / self.particles.cap as f32
    }

    pub fn total_mass(&self) -> f64 {
        self.particles.mass.iter().map(|&m| f64::from(m)).sum()
    }

    pub fn grid(&self) -> &Grid {
        &self.grid
    }

    pub fn dynamic_view(&self) -> &[f32] {
        &self.views.dynamic
    }

    pub fn static_view(&self) -> &[f32] {
        &self.views.statics
    }

    /// (capacity, data pointer) of every Vec the core owns (B7 test).
    pub fn buffer_fingerprint(&self) -> Vec<(usize, usize)> {
        let (p, g, e, s, ps) = (
            &self.particles,
            &self.grid,
            &self.elements,
            &self.scratch,
            &self.pool_scratch,
        );
        let mut out = fingerprint![
            p.x, p.y, p.vx, p.vy, p.c, p.j, p.f, p.home, p.rank, p.rest_u, p.rest_v, p.flags,
            p.placed, p.mass
        ];
        out.extend(fingerprint![g.mass, g.mvx, g.mvy]);
        out.extend(fingerprint![
            e.buf,
            e.state,
            e.prev_x,
            e.prev_y,
            e.has_prev,
            e.vel_x,
            e.vel_y,
            e.stiffness,
            e.rest_w,
            e.rest_h,
            e.counts,
            e.area_per_particle
        ]);
        out.extend(fingerprint![self.views.dynamic, self.views.statics]);
        out.extend(fingerprint![s.tgt_x, s.tgt_y, s.max_dev]);
        out.extend(fingerprint![
            ps.weights, ps.counts, ps.starts, ps.next, ps.u, ps.v
        ]);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fluid::layout::ST_REST_ALPHA;
    use crate::fluid::scenario_tests::{LAYOUT, SEED, acceptance_core, frames, slot};

    #[test]
    fn given_fluid_core_when_querying_strides_then_equal_layout_constants() {
        let c = FluidCore::new(256, 8, 1280.0, 800.0, 0.0, 0.0, 1);
        assert_eq!(c.element_stride(), ELEMENT_STRIDE as u32);
        assert_eq!(c.state_stride(), STATE_STRIDE as u32);
        assert_eq!(c.dynamic_fields(), DYNAMIC_FIELDS as u32);
        assert_eq!(c.static_fields(), STATIC_FIELDS as u32);
        assert_eq!(
            (ELEMENT_STRIDE, STATE_STRIDE, DYNAMIC_FIELDS, STATIC_FIELDS),
            (10, 4, 7, 3)
        );
    }

    #[test]
    fn given_view_pointers_when_lengths_computed_then_match_capacities() {
        let c = acceptance_core(SEED);
        let (n, m) = (
            c.particle_capacity() as usize,
            c.element_capacity() as usize,
        );
        assert_eq!((n, m), (8000, 32));
        assert_eq!(c.views.dynamic.len(), n * DYNAMIC_FIELDS);
        assert_eq!(c.views.statics.len(), n * STATIC_FIELDS);
        assert_eq!(c.elements.buf.len(), m * ELEMENT_STRIDE);
        assert_eq!(c.elements.state.len(), m * STATE_STRIDE);
        for ptr in [
            c.elements_ptr(),
            c.dynamic_ptr(),
            c.static_ptr(),
            c.state_ptr(),
        ] {
            assert!(!ptr.is_null());
        }
    }

    #[test]
    fn given_same_seed_and_inputs_when_two_cores_tick_300_frames_then_dynamic_views_bit_identical()
    {
        let run = |seed: u32| {
            let mut c = acceptance_core(seed);
            frames(&mut c, 100);
            let mut card = LAYOUT[3];
            card[1] += 50.0;
            c.write_element(3, slot(card));
            frames(&mut c, 200);
            let bits = |v: &[f32]| v.iter().map(|f| f.to_bits()).collect::<Vec<_>>();
            (bits(&c.views.dynamic), bits(&c.views.statics))
        };
        assert_eq!(run(7), run(7));
        assert_ne!(run(7), run(8));
    }

    #[test]
    fn given_nan_rect_or_out_of_range_id_when_tick_splash_or_redistribute_then_no_panic_and_slot_ignored()
     {
        let mut c = FluidCore::new(512, 4, f32::NAN, f32::INFINITY, f32::NAN, f32::NAN, 0);
        c.write_element(0, [f32::NAN; ELEMENT_STRIDE]);
        c.write_element(
            1,
            [
                10.0,
                10.0,
                -5.0,
                20.0,
                4.0,
                0.0,
                0.0,
                0.0,
                f32::NAN,
                f32::NAN,
            ],
        );
        c.write_element(
            2,
            [
                f32::INFINITY,
                0.0,
                50.0,
                50.0,
                f32::NAN,
                f32::NAN,
                f32::NAN,
                f32::NAN,
                9.0,
                -9.0,
            ],
        );
        c.write_element(99, [1.0; ELEMENT_STRIDE]);
        c.redistribute();
        assert_eq!(c.active_particles(), 0);
        c.tick(
            f32::NAN,
            f32::NAN,
            f32::NAN,
            f32::INFINITY,
            f32::NEG_INFINITY,
            true,
            f32::NAN,
            f32::NAN,
        );
        c.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0);
        c.splash(999, f32::NAN, f32::NAN, f32::NAN);
        c.splash(0, 1.0, 1.0, 1.0);
        c.shake(f32::NAN);
        c.set_material(f32::NAN, -1.0, 99.0);
        c.write_element(3, slot([100.0, 100.0, 80.0, 40.0, 1e9]));
        c.redistribute();
        assert_eq!(c.active_particles(), 512);
        assert!((0..512).all(|i| c.home(i) == 3));
        frames(&mut c, 3);
        assert!(c.views.dynamic.iter().all(|v| v.is_finite()));
        assert!(c.elements.state.iter().all(|v| v.is_finite()));
        assert_eq!(c.state(3)[ST_REST_ALPHA], 1.0);
    }

    #[test]
    fn given_tick_with_raw_dt_one_sixtieth_when_called_then_returns_one_step() {
        let mut c = acceptance_core(SEED);
        assert_eq!(c.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0), 1);
        assert_eq!(c.tick(0.25, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0), 3);
        c.set_reduced_motion(true);
        assert_eq!(c.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0), 0);
    }

    #[test]
    fn given_redistribute_when_called_then_generation_increments_by_one() {
        let mut c = FluidCore::new(256, 4, 1280.0, 800.0, 0.0, 0.0, 1);
        assert_eq!(c.generation(), 0);
        c.redistribute();
        assert_eq!(c.generation(), 1);
        c.write_element(0, slot(LAYOUT[0]));
        c.redistribute();
        assert_eq!(c.generation(), 2);
    }

    #[test]
    fn given_area_hint_when_constructed_then_cell_px_and_max_area_follow_resolution_b5() {
        let c = FluidCore::new(8000, 32, 1280.0, 800.0, 76_057.0, 180.0, 1);
        let cell = c.cell_px();
        assert!(
            (cell - (4.0f32 * 76_057.0 / 8000.0).sqrt()).abs() < 1e-4,
            "{cell}"
        );
        assert!((c.max_area_px2() - 8000.0 * cell * cell / 2.0).abs() < 1.0);
        let d = FluidCore::new(8000, 32, 1280.0, 800.0, 0.0, 0.0, 1);
        assert_eq!(d.cell_px(), 8.0);
        assert_eq!(d.max_area_px2(), 256_000.0);
    }

    #[test]
    fn given_out_of_range_capacities_when_constructed_then_clamped() {
        let c = FluidCore::new(0, 0, 1280.0, 800.0, 0.0, 0.0, 1);
        assert_eq!((c.particle_capacity(), c.element_capacity()), (16, 1));
        let d = FluidCore::new(1_000_000, 10_000, 1280.0, 800.0, 0.0, 0.0, 1);
        assert_eq!((d.particle_capacity(), d.element_capacity()), (65_536, 256));
    }
}
