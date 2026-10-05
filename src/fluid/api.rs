//! `FluidCore`: the whole fluid FFI surface (spec §2 "FFI contract"; plan
//! skeleton §3.2, amended by resolutions B14 and B15). JS sees `FluidCore`.
//! Everything is allocated in the constructor; nothing on the hot path
//! allocates, so the exported pointers stay valid for the core's lifetime.

use wasm_bindgen::prelude::*;

use super::access::rd;
#[cfg(test)]
use super::clock::MAX_STEPS_PER_TICK;
use super::clock::{FIXED_DT_S, FixedClock, SUBSTEPS};
use super::elements::Elements;
use super::grid::{Grid, MIN_PARTICLES_PER_CELL};
use super::interaction::{self, SplashAt};
use super::layout::{DYNAMIC_FIELDS, ELEMENT_STRIDE, STATE_STRIDE, STATIC_FIELDS};
use super::material::{DEFAULT_MATERIAL, Material};
use super::particles::Particles;
use super::pool::{self, PoolScratch};
use super::rng::Rng;
use super::solver::{self, PointerField, Scratch, StepInput, SubstepOpts};
use super::views::Views;

pub const PARTICLES_MIN: u32 = 16;
pub const PARTICLES_MAX: u32 = 65_536;
pub const ELEMENTS_MIN: u32 = 1;
pub const ELEMENTS_MAX: u32 = 256;
/// W67: RNG stream for splash lobes/jitter and shake directions/noise (distinct from
/// the per-slot sampling streams 0–255 that `pool::redistribute` derives).
const RNG_STREAM_INTERACTION: u32 = 0x0067_0001;

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
    /// Simulated seconds. f64 (perf/fix round): an f32 sum of 1/480 s substeps drifts
    /// after ~9 h and freezes after ~18 h. The solver gets it wrapped to the wobble period.
    time_s: f64,
    /// Fix round (D67-14 hiccup): raw (unclamped) seconds since the last rect-velocity
    /// update, so a tick the clock clamped (> 100 ms) or capped (> 3 steps) still divides
    /// the rect delta by the time it really took.
    vel_wall_s: f64,
    /// W67: deterministic RNG for splash and shake.
    interaction_rng: Rng,
    /// Test-only (D67-14): element 0's rect velocity (px/s) as each fixed step of the
    /// last tick saw it. Pre-allocated to MAX_STEPS_PER_TICK, so it never reallocates.
    #[cfg(test)]
    step_vel_trace: Vec<(f32, f32)>,
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
            vel_wall_s: 0.0,
            interaction_rng: Rng::derive(seed, RNG_STREAM_INTERACTION),
            #[cfg(test)]
            step_vel_trace: Vec::with_capacity(MAX_STEPS_PER_TICK as usize),
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

    /// Advances by the raw RAF dt (Rust owns the accumulator) and returns the fixed
    /// steps simulated: 0–3, always 0 under reduced motion (D64-4). The pointer (W68)
    /// and gravity (slice 6, D67-2) arguments are accepted and unused.
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
        if raw_dt_s.is_finite() && raw_dt_s > 0.0 {
            self.vel_wall_s += f64::from(raw_dt_s);
        }
        #[cfg(test)]
        self.step_vel_trace.clear();
        if self.settings.reduced_motion {
            // Spec §2: no simulation; follow rects instantly, even on a 0-step tick.
            // dt 0 keeps prev_* current with velocity 0 (no spike when motion returns).
            self.elements.update_velocities(0.0);
            self.vel_wall_s = 0.0;
            solver::compute_targets(
                &self.particles,
                &self.grid,
                &self.elements,
                true,
                &mut self.scratch,
            );
            solver::pin_to_targets(&mut self.particles, &self.grid, &self.scratch);
            self.refresh_rest_state(true, 0.0, true);
            self.views.write_dynamic(&self.particles, &self.grid);
            return 0;
        }
        let params = self.settings.material.params();
        let dt = FIXED_DT_S / SUBSTEPS as f32;
        if steps > 0 {
            // W67 D67-14: the rect moved once since the last tick that simulated. Its
            // velocity is that delta over this tick's simulated time, shared by every
            // fixed step (per-step sampling gave 3Δ/dt, then 0, then 0).
            let simulated = steps as f32 * FIXED_DT_S;
            self.elements
                .update_velocities(velocity_window_s(simulated, self.vel_wall_s));
            self.vel_wall_s = 0.0;
        }
        for step in 0..steps {
            #[cfg(test)]
            self.step_vel_trace
                .push((rd(&self.elements.vel_x, 0), rd(&self.elements.vel_y, 0)));
            for sub in 0..SUBSTEPS {
                self.elements.update_stiffness(dt, params.recovery_s);
                let input = StepInput {
                    dt,
                    time_s: solver::wobble_time_s(self.time_s),
                    pointer: PointerField::default(),
                };
                // Perf round: maxDev only in the last substep (the one refresh_rest_state
                // reads); the AABB comes from the previous G2P except on the tick's first
                // substep (splash, redistribute or a reduced-motion pin may have moved
                // particles since the last tick).
                let opts = SubstepOpts {
                    measure_dev: sub + 1 == SUBSTEPS,
                    reuse_bounds: step > 0 || sub > 0,
                };
                solver::substep_with(
                    &mut self.particles,
                    &mut self.grid,
                    &self.elements,
                    &params,
                    &input,
                    &mut self.scratch,
                    opts,
                );
                self.time_s += f64::from(dt);
            }
            // maxDev from the last substep's G2P, against the target actually used (D67-10).
            self.refresh_rest_state(false, FIXED_DT_S, false);
        }
        self.views.write_dynamic(&self.particles, &self.grid);
        steps
    }

    /// Splash element `id` at buffer-space (x, y). Ignored under reduced motion, for an
    /// inactive or out-of-range id, for non-finite input, or for strength ≤ 0 (D67-8).
    pub fn splash(&mut self, id: u32, x: f32, y: f32, strength: f32) {
        if self.settings.reduced_motion {
            return;
        }
        interaction::splash(
            &mut self.particles,
            &self.grid,
            &mut self.elements,
            &mut self.interaction_rng,
            SplashAt {
                id,
                x_px: x,
                y_px: y,
                strength,
            },
        );
    }

    /// Shake every active element. Ignored under reduced motion or for strength ≤ 0.
    pub fn shake(&mut self, strength: f32) {
        if self.settings.reduced_motion {
            return;
        }
        interaction::shake(
            &mut self.particles,
            &self.grid,
            &mut self.elements,
            &mut self.interaction_rng,
            strength,
        );
    }

    /// Normalised material (spec §2). NaN → defaults; out of range → clamped.
    /// Mapped onto solver units once per tick (`Material::params`).
    pub fn set_material(&mut self, viscosity: f32, cohesion: f32, recovery: f32) {
        self.settings.material = Material::sanitized(viscosity, cohesion, recovery);
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
        self.refresh_rest_state(rm, 0.0, true);
        // W67 D67-12: elements already on target start at rest (no fade-in, no wobble).
        for id in 0..self.elements.cap {
            self.elements.settle_if_at_rest(id);
        }
        self.views.write_dynamic(&self.particles, &self.grid);
    }

    pub fn set_reduced_motion(&mut self, on: bool) {
        self.settings.reduced_motion = on;
    }
}

/// Fix round (D67-14 hiccup): the time a tick's rect delta is divided by. Normally the
/// simulated time (`steps · FIXED_DT`, unchanged W67 behaviour). Only when the clock
/// lost time, i.e. the raw time since the last velocity update exceeds it by more than
/// half a fixed step (a > 100 ms hiccup clamped, or steps capped at 3), the raw time is
/// used, so the element velocity stays the real Δ/t instead of a spike.
fn velocity_window_s(simulated_s: f32, wall_s: f64) -> f32 {
    let wall = wall_s as f32;
    if wall.is_finite() && wall > simulated_s + 0.5 * FIXED_DT_S {
        wall
    } else {
        simulated_s
    }
}

impl FluidCore {
    /// Rest state of every slot from `scratch.max_dev`. With `measure`, maxDev is first
    /// re-measured against the un-wobbled targets in `scratch.tgt_*` (reduced motion and
    /// redistribute). Without it, it holds the G2P value of the last substep (D67-10).
    fn refresh_rest_state(&mut self, reduced_motion: bool, dt: f32, measure: bool) {
        if measure {
            solver::measure_max_dev(
                &self.particles,
                &self.grid,
                &self.scratch.tgt_x,
                &self.scratch.tgt_y,
                &mut self.scratch.max_dev,
            );
        }
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
            e.area_per_particle,
            e.rest_hold_s,
            e.phase
        ]);
        out.extend(fingerprint![self.views.dynamic, self.views.statics]);
        out.extend(s.fingerprint());
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

// ---- W67: test-only helpers ---------------------------------------------------
#[cfg(test)]
impl FluidCore {
    pub(crate) fn particle_vel_px_s(&self, i: usize) -> (f32, f32) {
        let c = self.grid.cell_px;
        (self.particles.vx[i] * c, self.particles.vy[i] * c)
    }

    pub(crate) fn particle_j(&self, i: usize) -> f32 {
        self.particles.j[i]
    }

    pub(crate) fn set_particle_j(&mut self, i: usize, j: f32) {
        self.particles.j[i] = j;
    }

    pub(crate) fn particle_indices_of(&self, id: u32) -> Vec<usize> {
        self.particles
            .home
            .iter()
            .enumerate()
            .filter(|&(_, &h)| h == id)
            .map(|(i, _)| i)
            .collect()
    }

    pub(crate) fn stiffness_of(&self, id: usize) -> f32 {
        self.elements.stiffness[id]
    }

    pub(crate) fn material_params(&self) -> super::material::MaterialParams {
        self.settings.material.params()
    }

    pub(crate) fn max_j(&self) -> f32 {
        (0..self.particles.cap)
            .filter(|&i| self.particles.home_of(i).is_some())
            .map(|i| self.particles.j[i])
            .fold(f32::NEG_INFINITY, f32::max)
    }

    /// restAlpha of every active element, in slot order.
    pub(crate) fn rest_alphas(&self) -> Vec<f32> {
        (0..self.elements.cap)
            .filter(|&id| self.elements.is_active(id))
            .map(|id| self.state(id)[super::layout::ST_REST_ALPHA])
            .collect()
    }

    pub(crate) fn all_particles_finite(&self) -> bool {
        let p = &self.particles;
        (0..p.cap).filter(|&i| p.home_of(i).is_some()).all(|i| {
            [p.x[i], p.y[i], p.vx[i], p.vy[i], p.j[i]]
                .iter()
                .all(|v| v.is_finite())
                && p.c[i].iter().all(|v| v.is_finite())
        })
    }

    pub(crate) fn min_j(&self) -> f32 {
        (0..self.particles.cap)
            .filter(|&i| self.particles.home_of(i).is_some())
            .map(|i| self.particles.j[i])
            .fold(f32::INFINITY, f32::min)
    }

    /// D67-10: the target the spring used in the last substep, wobble included (px).
    /// Task W67.10 must keep `scratch.tgt_x/tgt_y` as the substep's used target (the plan does).
    pub(crate) fn spring_target_px(&self, i: usize) -> Option<(f32, f32)> {
        let (gx, gy) = (*self.scratch.tgt_x.get(i)?, *self.scratch.tgt_y.get(i)?);
        (gx.is_finite() && gy.is_finite()).then(|| self.grid.to_px(gx, gy))
    }

    pub(crate) fn position_bits(&self) -> Vec<u32> {
        self.particles
            .x
            .iter()
            .chain(self.particles.y.iter())
            .map(|v| v.to_bits())
            .collect()
    }

    pub(crate) fn velocity_bits(&self) -> Vec<u32> {
        self.particles
            .vx
            .iter()
            .chain(self.particles.vy.iter())
            .map(|v| v.to_bits())
            .collect()
    }

    /// Max |x − target| per active element against the UN-wobbled target (px).
    pub(crate) fn max_dev_px(&self) -> Vec<f32> {
        let mut s = Scratch::new(self.particles.cap, self.elements.cap);
        solver::compute_targets(
            &self.particles,
            &self.grid,
            &self.elements,
            self.settings.reduced_motion,
            &mut s,
        );
        solver::measure_max_dev(
            &self.particles,
            &self.grid,
            &s.tgt_x,
            &s.tgt_y,
            &mut s.max_dev,
        );
        (0..self.elements.cap)
            .filter(|&id| self.elements.is_active(id))
            .map(|id| s.max_dev[id])
            .collect()
    }

    /// D67-14: element 0's rect velocity (px/s) as each fixed step of the last tick saw it.
    pub(crate) fn step_velocities(&self) -> &[(f32, f32)] {
        &self.step_vel_trace
    }

    /// Perf/fix round: the simulated time in seconds (f64).
    pub(crate) fn time_s(&self) -> f64 {
        self.time_s
    }

    pub(crate) fn set_time_s(&mut self, t: f64) {
        self.time_s = t;
    }
}

#[cfg(test)]
mod w67_tests {
    use super::FluidCore;

    #[test]
    fn given_set_material_when_called_then_cohesion_applies_globally_only() {
        let mut core = FluidCore::new(2000, 4, 640.0, 480.0, 12_452.0, 48.0, 3);
        core.write_element(
            0,
            [
                100.0,
                100.0,
                140.0,
                48.0,
                24.0,
                0.0,
                0.0,
                0.0,
                f32::NAN,
                f32::NAN,
            ],
        );
        core.write_element(
            1,
            [
                300.0,
                100.0,
                140.0,
                48.0,
                24.0,
                0.0,
                0.0,
                0.0,
                0.9,
                f32::NAN,
            ],
        );
        core.redistribute();
        core.set_material(0.5, 0.0, 0.7);
        assert!((core.material_params().tension_max - 0.02).abs() < 1e-6);
        core.splash(0, 170.0, 124.0, 2.0);
        core.splash(1, 370.0, 124.0, 2.0);
        for _ in 0..30 {
            core.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0);
            assert!(
                core.max_j() <= 1.02 + 1e-5,
                "one global TENSION_MAX caps every element, incl. the viscosity override: {}",
                core.max_j()
            );
        }
        core.set_material(0.5, 1.0, 0.7);
        assert!((core.material_params().tension_max - 0.30).abs() < 1e-6);
        core.set_material(f32::NAN, f32::NAN, f32::NAN);
        let p = core.material_params();
        assert!(
            (p.tension_max - 0.16).abs() < 1e-6 && (p.recovery_s - 0.7).abs() < 1e-6,
            "NaN → defaults"
        );
    }

    #[test]
    fn given_rect_moved_once_in_a_three_step_tick_when_ticking_then_all_three_steps_use_delta_over_three_fixed_dt()
     {
        use crate::fluid::clock::FIXED_DT_S;
        let button = [
            100.0,
            100.0,
            140.0,
            48.0,
            24.0,
            0.0,
            0.0,
            0.0,
            f32::NAN,
            f32::NAN,
        ];
        let mut core = FluidCore::new(2000, 4, 640.0, 480.0, 6_226.0, 48.0, 3);
        core.write_element(0, button);
        core.redistribute();
        assert_eq!(
            core.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0),
            1
        );
        assert_eq!(
            core.step_velocities(),
            &[(0.0f32, 0.0f32)],
            "the first sample has no velocity"
        );

        let mut moved = button;
        moved[0] += 15.0;
        core.write_element(0, moved);
        assert_eq!(
            core.tick(0.05, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0),
            3,
            "50 ms = 3 fixed steps"
        );
        let expected = 15.0 / (3.0 * FIXED_DT_S);
        let seen = core.step_velocities().to_vec();
        assert_eq!(seen.len(), 3, "one entry per fixed step");
        for (k, &(vx, vy)) in seen.iter().enumerate() {
            assert!(
                (vx - expected).abs() < 0.05,
                "step {}: {vx} px/s, expected Δ/(3·dt) = {expected} (no 3Δ/dt spike, no 0)",
                k + 1
            );
            assert!(vy.abs() < 1e-4);
        }

        assert_eq!(
            core.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0),
            1
        );
        assert!(
            core.step_velocities()[0].0.abs() < 1e-4,
            "the rect stopped: 0 px/s"
        );
    }
}

#[cfg(test)]
mod perf_fix_round_tests {
    use super::{FluidCore, velocity_window_s};
    use crate::fluid::clock::FIXED_DT_S;
    use crate::fluid::layout::ELEMENT_STRIDE;
    use crate::fluid::solver::{WOBBLE_PERIOD_S, wobble_offset_px, wobble_time_s};

    const BUTTON: [f32; ELEMENT_STRIDE] = [
        100.0,
        100.0,
        140.0,
        48.0,
        24.0,
        0.0,
        0.0,
        0.0,
        f32::NAN,
        f32::NAN,
    ];

    fn core() -> FluidCore {
        let mut core = FluidCore::new(2000, 4, 640.0, 480.0, 6_226.0, 48.0, 3);
        core.write_element(0, BUTTON);
        core.redistribute();
        core
    }

    #[test]
    fn given_a_300ms_hiccup_with_a_rect_move_when_ticking_then_velocity_is_delta_over_the_wall_time()
     {
        let mut core = core();
        assert_eq!(
            core.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0),
            1
        );
        let mut moved = BUTTON;
        moved[0] += 30.0;
        core.write_element(0, moved);
        // 300 ms raw: the clock clamps it to 100 ms and caps it at 3 fixed steps (50 ms).
        assert_eq!(core.tick(0.3, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0), 3);
        let wall = 30.0 / 0.3;
        let simulated = 30.0 / (3.0 * FIXED_DT_S);
        for &(vx, vy) in core.step_velocities() {
            assert!(
                (vx - wall).abs() < 0.01 * wall,
                "{vx} px/s, expected Δ/0.3 s = {wall}, not Δ/0.05 s = {simulated}"
            );
            assert!(vy.abs() < 1e-4);
        }
        // The next normal tick measures from the hiccup on: no move, no velocity.
        core.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0);
        assert!(core.step_velocities()[0].0.abs() < 1e-4);
    }

    #[test]
    fn given_ordinary_frame_jitter_when_choosing_the_velocity_window_then_simulated_time_is_kept() {
        // D67-14 is unchanged unless the clock lost time.
        assert_eq!(velocity_window_s(FIXED_DT_S, 1.0 / 60.0), FIXED_DT_S);
        assert_eq!(velocity_window_s(FIXED_DT_S, 0.02), FIXED_DT_S);
        assert_eq!(velocity_window_s(FIXED_DT_S, 0.004), FIXED_DT_S);
        assert_eq!(velocity_window_s(3.0 * FIXED_DT_S, 0.05), 3.0 * FIXED_DT_S);
        assert_eq!(velocity_window_s(3.0 * FIXED_DT_S, 0.3), 0.3);
        assert_eq!(velocity_window_s(FIXED_DT_S, f64::INFINITY), FIXED_DT_S);
    }

    #[test]
    fn given_time_at_20_hours_when_ticking_then_dt_still_advances_the_wobble_time() {
        let twenty_h = 20.0 * 3600.0;
        // The W67 f32 clock would be frozen here: one 1/480 s substep is below half an ulp.
        let frozen = 72_000.0f32;
        assert_eq!(frozen + 1.0 / 480.0, frozen, "f32 stops advancing at 20 h");

        let mut core = core();
        core.set_time_s(twenty_h);
        let before = wobble_time_s(core.time_s());
        assert_eq!(
            core.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0),
            1
        );
        let advanced = core.time_s() - twenty_h;
        assert!(
            (advanced - f64::from(FIXED_DT_S)).abs() < 1e-9,
            "simulated time advanced by {advanced} s"
        );
        let after = wobble_time_s(core.time_s());
        let step = f64::from(after - before).rem_euclid(WOBBLE_PERIOD_S);
        assert!(
            (step - f64::from(FIXED_DT_S)).abs() < 1e-5,
            "wobble time advanced by {step} s"
        );
        assert!(core.dynamic_view().iter().all(|v| v.is_finite()));
    }

    #[test]
    fn given_wobble_time_wrapped_to_the_period_when_evaluated_then_the_wobble_is_unchanged() {
        for k in 0..50 {
            let t = 0.37 + k as f64 * 0.731;
            let wrapped = wobble_time_s(t + 3.0 * WOBBLE_PERIOD_S);
            let (ax, ay) = wobble_offset_px(t as f32, 40.0, 12.0, 0.7, 0.0);
            let (bx, by) = wobble_offset_px(wrapped, 40.0, 12.0, 0.7, 0.0);
            assert!(
                (ax - bx).abs() < 1e-4 && (ay - by).abs() < 1e-4,
                "t {t}: ({ax}, {ay}) vs ({bx}, {by})"
            );
        }
        assert_eq!(wobble_time_s(f64::NAN), 0.0);
        assert_eq!(wobble_time_s(-1.0), (WOBBLE_PERIOD_S - 1.0) as f32);
    }
}

#[cfg(test)]
mod ward_fix_tests {
    //! W67 whole-ward review fixes (items 1–3).
    use super::FluidCore;
    use crate::fluid::elements::REST_MAX_DEV_PX;
    use crate::fluid::layout::{EL_W, ELEMENT_STRIDE, ST_REST_ALPHA};

    const BUTTON: [f32; ELEMENT_STRIDE] = [
        100.0,
        100.0,
        140.0,
        48.0,
        24.0,
        0.0,
        0.0,
        0.0,
        f32::NAN,
        f32::NAN,
    ];
    const BUTTON_2: [f32; ELEMENT_STRIDE] = [
        300.0,
        100.0,
        140.0,
        48.0,
        24.0,
        0.0,
        0.0,
        0.0,
        f32::NAN,
        f32::NAN,
    ];

    fn frame(core: &mut FluidCore) -> u32 {
        core.tick(1.0 / 60.0, 0.0, 0.0, 0.0, 0.0, false, 0.0, 0.0)
    }

    /// Item 1: a slot that was shaken, hidden (w = 0) and reused with a new rect starts
    /// fresh: stiffness 1, no inherited rest hold, no rect velocity from old → new rect.
    #[test]
    fn given_a_shaken_slot_hidden_and_reused_with_a_new_rect_when_redistributed_then_it_starts_fresh()
     {
        let mut core = FluidCore::new(2000, 4, 640.0, 480.0, 6_226.0, 48.0, 3);
        core.write_element(0, BUTTON);
        core.write_element(1, BUTTON_2);
        core.redistribute();
        for _ in 0..5 {
            frame(&mut core);
        }
        core.shake(1.0);
        frame(&mut core);
        frame(&mut core);
        assert!(core.stiffness_of(0) < 0.5, "the shake softened slot 0");

        // Hide slot 0 (w = 0) and redistribute, no tick in between.
        let mut hidden = BUTTON;
        hidden[EL_W] = 0.0;
        core.write_element(0, hidden);
        core.redistribute();

        // Reuse slot 0 with a new rect 200 px lower and redistribute.
        let mut moved = BUTTON;
        moved[1] += 200.0;
        core.write_element(0, moved);
        core.redistribute();
        assert_eq!(
            core.stiffness_of(0),
            1.0,
            "a reused slot starts at full stiffness"
        );

        // Reused particles crawl from where they were (pool contract), so to isolate the
        // slot state from that crawl, put slot 0's particles on target and redistribute
        // again (same rects: stable assignment). D67-12 must then settle it at once.
        for i in core.particle_indices_of(0) {
            let (tx, ty) = core.target_px(i).unwrap();
            core.set_particle_px(i, tx, ty);
        }
        core.redistribute();
        assert_eq!(
            core.state(0)[ST_REST_ALPHA],
            1.0,
            "D67-12: a fresh, on-target slot is at rest immediately"
        );

        assert_eq!(frame(&mut core), 1);
        let (vx, vy) = core.step_velocities()[0];
        assert!(
            vx.abs() < 1e-4 && vy.abs() < 1e-4,
            "no rect velocity from the old → new rect jump: ({vx}, {vy}) px/s"
        );
    }

    /// Item 2: a splash before the first redistribute (no particle has a home yet)
    /// changes nothing: no damage, no motion.
    #[test]
    fn given_an_active_rect_without_redistribute_when_splashed_then_stiffness_and_particles_unchanged()
     {
        let mut core = FluidCore::new(2000, 4, 640.0, 480.0, 6_226.0, 48.0, 3);
        core.write_element(0, BUTTON);
        let (pos, vel) = (core.position_bits(), core.velocity_bits());
        core.splash(0, 170.0, 124.0, 1.0);
        assert_eq!(
            core.stiffness_of(0),
            1.0,
            "nothing was hit, nothing is damaged"
        );
        assert_eq!(core.position_bits(), pos);
        assert_eq!(core.velocity_bits(), vel);
    }

    /// Item 3: under reduced motion the element is at rest (spec §2), so the damage of a
    /// shake does not survive an RM on → off round trip.
    #[test]
    fn given_a_shake_then_reduced_motion_on_and_off_when_ticking_then_rest_alpha_stays_1_and_no_wobble()
     {
        let mut core = FluidCore::new(2000, 4, 640.0, 480.0, 6_226.0, 48.0, 3);
        core.write_element(0, BUTTON);
        core.redistribute();
        frame(&mut core);
        core.shake(1.0);
        core.set_reduced_motion(true);
        frame(&mut core);
        assert_eq!(core.state(0)[ST_REST_ALPHA], 1.0);
        core.set_reduced_motion(false);
        for k in 0..3 {
            frame(&mut core);
            assert_eq!(
                core.state(0)[ST_REST_ALPHA],
                1.0,
                "frame {k} after RM off: still at rest (stiffness {})",
                core.stiffness_of(0)
            );
            let dev = core.max_dev_px()[0];
            assert!(
                dev < REST_MAX_DEV_PX,
                "frame {k}: no wobble, maxDev {dev} px"
            );
        }
    }
}
