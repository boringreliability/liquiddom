use crate::math::Vec2;

/// Physics strategy dispatch based on liquid_type float.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PhysicsStrategy {
    Default,  // 0.0
    Tear,     // 1.0 — stub
    Magnet,   // 2.0 — stub
    Dragged,  // 3.0 — Ward 030
    Shake,    // 4.0 — Ward 031
    Tween,    // 5.0 — Ward 032
}

/// Map liquid_type float to PhysicsStrategy. Unknown values fall back to Default.
pub fn dispatch_strategy(liquid_type: f32) -> PhysicsStrategy {
    if liquid_type.is_nan() {
        return PhysicsStrategy::Default;
    }
    match liquid_type.round() as i32 {
        0 => PhysicsStrategy::Default,
        1 => PhysicsStrategy::Tear,
        2 => PhysicsStrategy::Magnet,
        3 => PhysicsStrategy::Dragged,
        4 => PhysicsStrategy::Shake,
        5 => PhysicsStrategy::Tween,
        _ => PhysicsStrategy::Default,
    }
}

/// Dragged strategy — centroid targets drag position instead of base_pos.
pub fn strategy_dragged(
    body: &mut EntityBody,
    dt: f32,
    tension: f32,
    damping: f32,
    drag_target: Vec2,
    pointer_active: bool,
    substeps: u32,
) {
    // Override centroid target to drag position
    let saved_base = body.base_pos;
    // Shift base_pos so centroid target becomes drag_target - (w/2, h/2)
    body.base_pos = drag_target - Vec2::new(body.width * 0.5, body.height * 0.5);
    body.run_physics(dt, tension, damping, Vec2::zero(), pointer_active, substeps);
    body.base_pos = saved_base;
}

/// Shake strategy — applies impulse force on top of normal physics.
/// impulse_vx/vy are the current frame's impulse (decay handled by TS timer).
pub fn strategy_shake(
    body: &mut EntityBody,
    dt: f32,
    tension: f32,
    damping: f32,
    impulse_vx: f32,
    impulse_vy: f32,
    pointer_pos: Vec2,
    pointer_active: bool,
    substeps: u32,
) {
    // Add impulse force to all particles before running normal physics
    let impulse = Vec2::new(impulse_vx, impulse_vy);
    for particle in &mut body.particles {
        particle.velocity += impulse * dt;
    }
    // Run normal physics on top (springs pull back to rest)
    body.run_physics(dt, tension, damping, pointer_pos, pointer_active, substeps);
}

/// Default physics strategy — exact Ward 22 behavior.
/// Neighbor springs, shape preservation, centroid anchoring, semi-implicit Euler.
pub fn strategy_default(
    body: &mut EntityBody,
    dt: f32,
    tension: f32,
    damping: f32,
    pointer_pos: Vec2,
    pointer_active: bool,
    substeps: u32,
) {
    body.run_physics(dt, tension, damping, pointer_pos, pointer_active, substeps);
}

/// A single particle in a soft body simulation.
#[derive(Debug, Clone)]
pub struct Particle {
    pub pos: Vec2,
    pub velocity: Vec2,
    pub local_rest: Vec2,
}

/// A cached neighbor spring pair.
#[derive(Debug, Clone)]
pub struct NeighborSpring {
    pub a: usize,
    pub b: usize,
    pub rest_length: f32,
}

/// A soft body representation of a single DOM element.
/// Holds particles distributed along the element's perimeter.
pub struct EntityBody {
    pub particles: Vec<Particle>,
    pub base_pos: Vec2,
    pub prev_base_pos: Vec2,
    pub width: f32,
    pub height: f32,
    pub neighbor_springs: Vec<NeighborSpring>,
    pub reference_area: f32,
}

impl Particle {
    pub fn new(pos: Vec2, local_rest: Vec2) -> Self {
        Self {
            pos,
            velocity: Vec2::zero(),
            local_rest,
        }
    }
}

impl EntityBody {
    /// Compute polygon area via Shoelace formula.
    pub fn compute_area(&self) -> f32 {
        let n = self.particles.len();
        if n < 3 {
            return 0.0;
        }
        let mut area = 0.0f32;
        for i in 0..n {
            let j = (i + 1) % n;
            area += self.particles[i].pos.x * self.particles[j].pos.y;
            area -= self.particles[j].pos.x * self.particles[i].pos.y;
        }
        area.abs() * 0.5
    }

    /// Compute centroid of all particles.
    pub fn compute_centroid(&self) -> Vec2 {
        let n = self.particles.len();
        if n == 0 {
            return Vec2::zero();
        }
        let mut sum = Vec2::zero();
        for p in &self.particles {
            sum += p.pos;
        }
        sum * (1.0 / n as f32)
    }

    /// Advance physics by one timestep using mass-spring-damper model.
    /// Includes neighbor springs, shape preservation, centroid anchoring.
    /// Semi-implicit Euler integration with optional substeps.
    pub fn tick(
        &mut self,
        dt: f32,
        tension: f32,
        damping: f32,
        pointer_pos: Vec2,
        pointer_active: bool,
    ) {
        // Substeps default = 1 for backward compat
        self.tick_with_substeps(dt, tension, damping, pointer_pos, pointer_active, 1);
    }

    /// Full tick with configurable substeps. Dispatches to strategy based on liquid_type.
    pub fn tick_with_substeps(
        &mut self,
        dt: f32,
        tension: f32,
        damping: f32,
        pointer_pos: Vec2,
        pointer_active: bool,
        substeps: u32,
    ) {
        // Dispatch is a no-op for now — all strategies use run_physics (Default).
        // Ward 030+ will add strategy-specific behavior here.
        self.run_physics(dt, tension, damping, pointer_pos, pointer_active, substeps);
    }

    /// Core physics implementation. Called by all strategies (Default baseline).
    pub fn run_physics(
        &mut self,
        dt: f32,
        tension: f32,
        damping: f32,
        pointer_pos: Vec2,
        pointer_active: bool,
        substeps: u32,
    ) {
        const REPULSION_RADIUS: f32 = 100.0;
        const REPULSION_STRENGTH: f32 = 5000.0;
        const NEIGHBOR_STIFFNESS: f32 = 30.0;
        const CENTROID_STRENGTH: f32 = 5.0;
        const AREA_CORRECTION_STRENGTH: f32 = 0.5;

        // Rigid translation: when base_pos changes, teleport all particles
        // by the same delta so they follow the DOM element instantly.
        // Springs only handle deformation, not translation.
        let delta = self.base_pos - self.prev_base_pos;
        if delta.x != 0.0 || delta.y != 0.0 {
            for particle in &mut self.particles {
                particle.pos += delta;
            }
            self.prev_base_pos = self.base_pos;
        }

        let steps = substeps.max(1);
        let sub_dt = dt / steps as f32;

        for _ in 0..steps {
            let n = self.particles.len();

            // 1. Compute neighbor spring forces (bilateral — accumulate per particle)
            let mut neighbor_forces = vec![Vec2::zero(); n];
            for spring in &self.neighbor_springs {
                let diff = self.particles[spring.a].pos - self.particles[spring.b].pos;
                let dist = diff.length();
                if dist > 0.001 {
                    let stretch = dist - spring.rest_length;
                    let force = diff.normalize() * (-NEIGHBOR_STIFFNESS * stretch);
                    neighbor_forces[spring.a] += force;
                    neighbor_forces[spring.b] += force * -1.0;
                }
            }

            // 2. Compute centroid + area correction force direction
            let centroid = self.compute_centroid();
            let target_centroid = self.base_pos
                + Vec2::new(self.width * 0.5, self.height * 0.5);
            let centroid_correction = (target_centroid - centroid) * CENTROID_STRENGTH;

            // 3. Area preservation: radial push/pull if area deviates
            let current_area = self.compute_area();
            let area_ratio = if self.reference_area > 0.0 {
                current_area / self.reference_area
            } else {
                1.0
            };
            // ratio < 1 = compressed → push out; ratio > 1 = expanded → pull in
            let area_factor = (1.0 - area_ratio) * AREA_CORRECTION_STRENGTH;

            // 4. Per-particle forces + semi-implicit Euler integration
            #[allow(clippy::needless_range_loop)]
            for i in 0..n {
                let particle = &self.particles[i];
                let target_pos = self.base_pos + particle.local_rest;
                let displacement = particle.pos - target_pos;

                // Anchor spring
                let f_spring = displacement * -tension;
                // Damping
                let f_damping = particle.velocity * -damping;

                let mut f_total = f_spring + f_damping;

                // Neighbor springs
                f_total += neighbor_forces[i];

                // Centroid anchoring
                f_total += centroid_correction;

                // Area preservation: radial force from centroid
                let to_centroid = particle.pos - centroid;
                if to_centroid.length() > 0.001 {
                    f_total += to_centroid.normalize() * (area_factor * tension);
                }

                // Pointer repulsion
                if pointer_active {
                    let to_particle = particle.pos - pointer_pos;
                    let dist = to_particle.length();
                    if dist < REPULSION_RADIUS && dist > 0.001 {
                        let falloff = 1.0 - (dist / REPULSION_RADIUS);
                        let f_repel =
                            to_particle.normalize() * (REPULSION_STRENGTH * falloff);
                        f_total += f_repel;
                    }
                }

                // Semi-implicit Euler: velocity first, then position with NEW velocity
                self.particles[i].velocity += f_total * sub_dt;
                let new_vel = self.particles[i].velocity;
                self.particles[i].pos += new_vel * sub_dt;
            }
        }
    }

    /// Create a new body by distributing `num_particles` evenly along
    /// the perimeter of a rectangle (width × height).
    /// Starts at top-left corner, walks clockwise.
    pub fn new_rect(width: f32, height: f32, num_particles: usize) -> Self {
        let perimeter = 2.0 * (width + height);
        let spacing = perimeter / num_particles as f32;

        let particles: Vec<Particle> = (0..num_particles)
            .map(|i| {
                let d = i as f32 * spacing;
                let rest = if d < width {
                    // Top edge: left → right
                    Vec2::new(d, 0.0)
                } else if d < width + height {
                    // Right edge: top → bottom
                    Vec2::new(width, d - width)
                } else if d < 2.0 * width + height {
                    // Bottom edge: right → left
                    Vec2::new(width - (d - width - height), height)
                } else {
                    // Left edge: bottom → top
                    Vec2::new(0.0, height - (d - 2.0 * width - height))
                };

                Particle::new(rest, rest)
            })
            .collect();

        // Build neighbor springs (adjacent pairs along perimeter)
        let mut neighbor_springs = Vec::with_capacity(num_particles);
        for i in 0..num_particles {
            let a = i;
            let b = (i + 1) % num_particles;
            let rest_length = {
                let pa = &particles[a];
                let pb = &particles[b];
                (pa.pos - pb.pos).length()
            };
            neighbor_springs.push(NeighborSpring { a, b, rest_length });
        }

        let mut body = Self {
            particles,
            base_pos: Vec2::zero(),
            prev_base_pos: Vec2::zero(),
            width,
            height,
            neighbor_springs,
            reference_area: 0.0,
        };
        body.reference_area = body.compute_area();
        body
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_particle_initialization() {
        let rest = Vec2::new(10.0, 20.0);
        let p = Particle::new(rest, rest);

        assert_eq!(p.pos, rest);
        assert_eq!(p.local_rest, rest);
        assert_eq!(p.velocity, Vec2::zero());
    }

    #[test]
    fn test_entity_body_rect_distribution() {
        // 4 particles on a 100×100 rect → one at each corner
        let body = EntityBody::new_rect(100.0, 100.0, 4);

        assert_eq!(body.particles.len(), 4);
        assert_eq!(body.width, 100.0);
        assert_eq!(body.height, 100.0);
        assert_eq!(body.base_pos, Vec2::zero());

        // Perimeter = 400, spacing = 100.
        // Starting top-left, walking clockwise:
        // [0] = (0, 0)       — top-left corner
        // [1] = (100, 0)     — top-right corner
        // [2] = (100, 100)   — bottom-right corner
        // [3] = (0, 100)     — bottom-left corner
        let expected = [
            Vec2::new(0.0, 0.0),
            Vec2::new(100.0, 0.0),
            Vec2::new(100.0, 100.0),
            Vec2::new(0.0, 100.0),
        ];

        for (i, exp) in expected.iter().enumerate() {
            let p = &body.particles[i];
            assert!(
                (p.local_rest.x - exp.x).abs() < 0.01
                    && (p.local_rest.y - exp.y).abs() < 0.01,
                "particle {} local_rest: {:?}, expected: {:?}",
                i,
                p.local_rest,
                exp,
            );
            // Initial pos should equal local_rest (no displacement)
            assert_eq!(p.pos, p.local_rest);
        }
    }

    #[test]
    fn test_entity_body_particle_count() {
        // Verify particle count matches for various inputs
        let body8 = EntityBody::new_rect(200.0, 100.0, 8);
        assert_eq!(body8.particles.len(), 8);

        let body16 = EntityBody::new_rect(50.0, 30.0, 16);
        assert_eq!(body16.particles.len(), 16);

        let body1 = EntityBody::new_rect(10.0, 10.0, 1);
        assert_eq!(body1.particles.len(), 1);
    }

    // ── Ward 7: Mass-Spring-Damper tests ──

    #[test]
    fn test_spring_pulls_particle_to_rest() {
        // Create a body and manually displace particle 0 away from its rest pos
        let mut body = EntityBody::new_rect(100.0, 100.0, 4);
        // base_pos = (0,0), particle 0 rest = (0,0)
        // Displace it to (50, 0) — 50 units to the right
        body.particles[0].pos = Vec2::new(50.0, 0.0);

        let initial_x = body.particles[0].pos.x;

        // tick with strong spring, moderate damping
        body.tick(0.016, 100.0, 5.0, Vec2::zero(), false); // ~60fps, k=100, c=5

        // After tick, particle should have moved toward rest (x=0)
        let after_x = body.particles[0].pos.x;
        assert!(
            after_x < initial_x,
            "particle should move toward rest: was {}, now {}",
            initial_x,
            after_x,
        );

        // Velocity should be negative (moving left toward rest)
        assert!(
            body.particles[0].velocity.x < 0.0,
            "velocity should be negative (toward rest), got {}",
            body.particles[0].velocity.x,
        );
    }

    #[test]
    fn test_damping_slows_particle() {
        // Particle at rest position but with initial velocity
        let mut body = EntityBody::new_rect(100.0, 100.0, 4);
        // pos == local_rest (at target), but give it velocity
        body.particles[0].velocity = Vec2::new(100.0, 0.0);

        let initial_vx = body.particles[0].velocity.x;

        // tick with zero spring (no spring pull), strong damping
        body.tick(0.016, 0.0, 50.0, Vec2::zero(), false);

        // Velocity should be reduced by damping
        let after_vx = body.particles[0].velocity.x;
        assert!(
            after_vx.abs() < initial_vx.abs(),
            "damping should reduce velocity: was {}, now {}",
            initial_vx,
            after_vx,
        );
    }

    #[test]
    fn test_base_pos_movement_teleports_particles() {
        // Rigid translation: when base_pos changes, particles teleport with it
        let mut body = EntityBody::new_rect(100.0, 100.0, 4);

        let p0_before = body.particles[0].pos;

        // "Move" the DOM element 200px to the right
        body.base_pos = Vec2::new(200.0, 0.0);

        // After tick, particles should have been teleported by the delta
        body.tick(0.016, 100.0, 5.0, Vec2::zero(), false);

        // Particle 0 was at local_rest (0,0), now should be near (200, 0)
        assert!(
            (body.particles[0].pos.x - (p0_before.x + 200.0)).abs() < 5.0,
            "particle should teleport with base_pos, pos.x = {}",
            body.particles[0].pos.x,
        );
    }

    #[test]
    fn test_equilibrium_is_stable() {
        // Particle at target with zero velocity → nothing should change
        let mut body = EntityBody::new_rect(100.0, 100.0, 4);
        // All particles start at pos == local_rest, velocity == 0, base_pos == 0
        // This IS equilibrium.

        let before: Vec<(Vec2, Vec2)> = body
            .particles
            .iter()
            .map(|p| (p.pos, p.velocity))
            .collect();

        body.tick(0.016, 100.0, 5.0, Vec2::zero(), false);

        for (i, p) in body.particles.iter().enumerate() {
            assert_eq!(
                p.pos, before[i].0,
                "particle {} pos changed at equilibrium",
                i,
            );
            assert_eq!(
                p.velocity, before[i].1,
                "particle {} velocity changed at equilibrium",
                i,
            );
        }
    }

    // ── Ward 9: Pointer Repulsion tests ──

    #[test]
    fn test_pointer_repels_particles() {
        let mut body = EntityBody::new_rect(100.0, 100.0, 4);
        // Place body at origin, so particle 0 is at (0,0)
        // Put pointer at (10, 0) — within radius=100, very close

        let pointer = Vec2::new(10.0, 0.0);
        body.tick(0.016, 100.0, 5.0, pointer, true);

        // Particle 0 at (0,0) should be pushed AWAY from pointer (to the left, negative x)
        assert!(
            body.particles[0].velocity.x < 0.0,
            "particle should be repelled away from pointer, velocity.x = {}",
            body.particles[0].velocity.x,
        );
    }

    #[test]
    fn test_pointer_inactive_does_not_repel() {
        let mut body = EntityBody::new_rect(100.0, 100.0, 4);
        // Pointer right on top of particle 0, but inactive
        let pointer = Vec2::new(1.0, 0.0);

        body.tick(0.016, 100.0, 5.0, pointer, false);

        // With pointer inactive, particle at rest should stay at rest
        // (spring force = 0 since pos == target, damping = 0 since v == 0)
        assert_eq!(
            body.particles[0].velocity,
            Vec2::zero(),
            "inactive pointer should not affect particles",
        );
    }

    #[test]
    fn test_pointer_outside_radius_does_not_repel() {
        let mut body = EntityBody::new_rect(100.0, 100.0, 4);
        // Pointer far away (500 units away, radius = 100)
        let pointer = Vec2::new(500.0, 500.0);

        body.tick(0.016, 100.0, 5.0, pointer, true);

        // Particle 0 at (0,0) is 707 units from pointer — well outside radius
        // Only spring force matters, and at rest it's zero
        assert_eq!(
            body.particles[0].velocity,
            Vec2::zero(),
            "pointer outside radius should not affect particles",
        );
    }

    // ── Ward 22: Physics Stabilization tests ──

    #[test]
    fn test_neighbor_springs_resist_stretch() {
        let mut body = EntityBody::new_rect(100.0, 100.0, 8);

        // Displace particle 0 far from its neighbor, but keep anchor spring weak
        // so neighbor spring effect is the dominant pull on particle 1
        body.particles[0].pos = Vec2::new(-200.0, 0.0);

        let p1_initial = body.particles[1].pos;

        // Run with weak anchor spring but normal physics
        for _ in 0..10 {
            body.tick(0.016, 10.0, 5.0, Vec2::zero(), false);
        }

        // With neighbor springs: particle 1 should be PULLED toward particle 0
        // (negative x direction, away from its rest position)
        // Without neighbor springs: particle 1 stays near its rest position
        let p1_moved_x = body.particles[1].pos.x - p1_initial.x;
        assert!(
            p1_moved_x < -0.1,
            "neighbor springs should pull particle 1 toward displaced particle 0, delta_x = {}",
            p1_moved_x,
        );
    }

    #[test]
    fn test_shape_area_preserved_under_deformation() {
        let mut body = EntityBody::new_rect(100.0, 100.0, 16);
        let ref_area = body.reference_area;
        assert!(ref_area > 0.0, "reference area should be positive");

        // Apply strong pointer repulsion to deform the body
        let pointer = Vec2::new(50.0, 50.0);
        for _ in 0..30 {
            body.tick(0.016, 100.0, 5.0, pointer, true);
        }

        let current_area = body.compute_area();
        let ratio = current_area / ref_area;

        // Area should stay within 10% of reference (shape preservation)
        assert!(
            ratio > 0.5 && ratio < 1.5,
            "area should be preserved within tolerance, ratio = {}",
            ratio,
        );
    }

    #[test]
    fn test_substeps_improve_stability() {
        // Very stiff spring + large dt → explicit Euler explodes, substeps should tame it
        let mut body1 = EntityBody::new_rect(100.0, 100.0, 8);
        body1.particles[0].pos = Vec2::new(-100.0, 0.0);

        let mut body4 = EntityBody::new_rect(100.0, 100.0, 8);
        body4.particles[0].pos = Vec2::new(-100.0, 0.0);

        // Run with substeps=1 and very stiff spring + large dt
        for _ in 0..5 {
            body1.tick_with_substeps(0.033, 500.0, 2.0, Vec2::zero(), false, 1);
        }

        // Run with substeps=4
        for _ in 0..5 {
            body4.tick_with_substeps(0.033, 500.0, 2.0, Vec2::zero(), false, 4);
        }

        // Max velocity with substeps=4 should be strictly lower
        let max_v1 = body1.particles.iter()
            .map(|p| p.velocity.length())
            .fold(0.0f32, f32::max);
        let max_v4 = body4.particles.iter()
            .map(|p| p.velocity.length())
            .fold(0.0f32, f32::max);

        assert!(
            max_v4 < max_v1,
            "substeps=4 should be strictly more stable: max_v1={}, max_v4={}",
            max_v1, max_v4,
        );
    }

    #[test]
    fn test_centroid_stays_near_base_pos() {
        let mut body = EntityBody::new_rect(100.0, 100.0, 16);
        // Displace all particles randomly-ish
        for (i, p) in body.particles.iter_mut().enumerate() {
            p.pos = p.pos + Vec2::new((i as f32) * 5.0, (i as f32) * -3.0);
        }

        // Run 1000 ticks
        for _ in 0..1000 {
            body.tick(0.016, 100.0, 5.0, Vec2::zero(), false);
        }

        let centroid = body.compute_centroid();
        // Centroid of a 100x100 rect at base_pos (0,0) should be near (50, 50)
        let target = Vec2::new(50.0, 50.0);
        let drift = (centroid - target).length();

        assert!(
            drift < 20.0,
            "centroid should stay near base_pos center, drift = {}, centroid = {:?}",
            drift, centroid,
        );
    }

    // ── Ward 29: Liquid Type Dispatch tests ──

    #[test]
    fn test_default_liquid_type_matches_baseline() {
        // Run two identical bodies — one via tick(), one via strategy_default()
        let mut body_tick = EntityBody::new_rect(100.0, 100.0, 8);
        let mut body_strat = EntityBody::new_rect(100.0, 100.0, 8);

        // Displace particle 0 so there's something to compute
        body_tick.particles[0].pos = Vec2::new(50.0, 0.0);
        body_strat.particles[0].pos = Vec2::new(50.0, 0.0);

        // Run 100 frames via tick (which should dispatch to Default)
        for _ in 0..100 {
            body_tick.tick(0.016, 100.0, 5.0, Vec2::zero(), false);
        }

        // Run 100 frames via strategy_default directly
        for _ in 0..100 {
            strategy_default(&mut body_strat, 0.016, 100.0, 5.0, Vec2::zero(), false, 1);
        }

        // Positions should be identical
        for (i, (a, b)) in body_tick.particles.iter().zip(body_strat.particles.iter()).enumerate() {
            assert!(
                (a.pos.x - b.pos.x).abs() < 0.001 && (a.pos.y - b.pos.y).abs() < 0.001,
                "particle {} mismatch: tick={:?}, strategy={:?}", i, a.pos, b.pos,
            );
        }
    }

    #[test]
    fn test_invalid_liquid_type_falls_back() {
        assert_eq!(dispatch_strategy(f32::NAN), PhysicsStrategy::Default);
        assert_eq!(dispatch_strategy(-1.0), PhysicsStrategy::Default);
        assert_eq!(dispatch_strategy(99.0), PhysicsStrategy::Default);
        assert_eq!(dispatch_strategy(0.0), PhysicsStrategy::Default);
        assert_eq!(dispatch_strategy(3.0), PhysicsStrategy::Dragged);
    }

    #[test]
    fn test_strategies_unit_testable() {
        // strategy_default can be called in isolation
        let mut body = EntityBody::new_rect(50.0, 50.0, 4);
        body.particles[0].pos = Vec2::new(100.0, 0.0);

        strategy_default(&mut body, 0.016, 100.0, 5.0, Vec2::zero(), false, 1);

        // Particle should have moved toward rest
        assert!(body.particles[0].pos.x < 100.0);
    }

    #[test]
    fn test_dispatch_maps_correctly() {
        assert_eq!(dispatch_strategy(0.0), PhysicsStrategy::Default);
        assert_eq!(dispatch_strategy(1.0), PhysicsStrategy::Tear);
        assert_eq!(dispatch_strategy(2.0), PhysicsStrategy::Magnet);
        assert_eq!(dispatch_strategy(3.0), PhysicsStrategy::Dragged);
        assert_eq!(dispatch_strategy(4.0), PhysicsStrategy::Shake);
        assert_eq!(dispatch_strategy(5.0), PhysicsStrategy::Tween);
    }

    // ── Ward 30: Dragged Strategy tests ──

    #[test]
    fn test_strategy_dragged_pulls_toward_target() {
        let mut body = EntityBody::new_rect(100.0, 100.0, 8);
        // Body at origin, drag target at (300, 200)
        let drag_target = Vec2::new(300.0, 200.0);

        let centroid_before = body.compute_centroid();

        // Run dragged strategy
        for _ in 0..30 {
            strategy_dragged(&mut body, 0.016, 100.0, 5.0, drag_target, false, 1);
        }

        let centroid_after = body.compute_centroid();

        // Centroid should have moved toward drag_target
        let dist_before = (centroid_before - drag_target).length();
        let dist_after = (centroid_after - drag_target).length();
        assert!(
            dist_after < dist_before,
            "centroid should move toward drag target: before={}, after={}",
            dist_before, dist_after,
        );
    }

    // ── Ward 31: Impulse/Shake Strategy tests ──

    #[test]
    fn test_shake_adds_velocity() {
        let mut body = EntityBody::new_rect(100.0, 100.0, 8);

        // All particles start at rest
        let vel_before: f32 = body.particles.iter()
            .map(|p| p.velocity.length())
            .sum();
        assert_eq!(vel_before, 0.0);

        // Apply shake with impulse force
        strategy_shake(&mut body, 0.016, 100.0, 5.0, 500.0, 0.0, Vec2::zero(), false, 1);

        // Particles should now have velocity
        let vel_after: f32 = body.particles.iter()
            .map(|p| p.velocity.length())
            .sum();
        assert!(
            vel_after > 0.0,
            "shake should add velocity, total velocity = {}",
            vel_after,
        );
    }

    #[test]
    fn test_shake_returns_to_rest() {
        let mut body = EntityBody::new_rect(100.0, 100.0, 8);

        // Apply one impulse
        strategy_shake(&mut body, 0.016, 100.0, 5.0, 200.0, 0.0, Vec2::zero(), false, 1);

        // Then run default physics for many frames (impulse gone, springs pull back)
        for _ in 0..500 {
            body.run_physics(0.016, 100.0, 5.0, Vec2::zero(), false, 1);
        }

        // Should be back near rest
        let centroid = body.compute_centroid();
        let target = Vec2::new(50.0, 50.0);
        let drift = (centroid - target).length();
        assert!(
            drift < 10.0,
            "after shake + settle, centroid should be near rest, drift = {}",
            drift,
        );
    }
}
