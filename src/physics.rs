use crate::math::Vec2;

/// A single particle in a soft body simulation.
#[derive(Debug, Clone)]
pub struct Particle {
    pub pos: Vec2,
    pub velocity: Vec2,
    pub local_rest: Vec2,
}

/// A soft body representation of a single DOM element.
/// Holds particles distributed along the element's perimeter.
pub struct EntityBody {
    pub particles: Vec<Particle>,
    pub base_pos: Vec2,
    pub width: f32,
    pub height: f32,
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
    /// Advance physics by one timestep using mass-spring-damper model.
    /// F = -tension * displacement - damping * velocity (Hooke's law)
    /// Euler integration with mass = 1.0.
    pub fn tick(&mut self, dt: f32, tension: f32, damping: f32) {
        for particle in &mut self.particles {
            // 1. Target position = element's DOM position + particle's rest offset
            let target_pos = self.base_pos + particle.local_rest;

            // 2. Displacement from target (how far off are we?)
            let displacement = particle.pos - target_pos;

            // 3. Spring force pulls toward target: F_spring = -k * x
            let f_spring = displacement * -tension;

            // 4. Damping force resists velocity: F_damping = -c * v
            let f_damping = particle.velocity * -damping;

            // 5. Total force (mass = 1.0, so acceleration = force)
            let f_total = f_spring + f_damping;

            // 6. Euler integration: velocity first, then position
            particle.velocity += f_total * dt;
            particle.pos += particle.velocity * dt;
        }
    }

    /// Create a new body by distributing `num_particles` evenly along
    /// the perimeter of a rectangle (width × height).
    /// Starts at top-left corner, walks clockwise.
    pub fn new_rect(width: f32, height: f32, num_particles: usize) -> Self {
        let perimeter = 2.0 * (width + height);
        let spacing = perimeter / num_particles as f32;

        let particles = (0..num_particles)
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

        Self {
            particles,
            base_pos: Vec2::zero(),
            width,
            height,
        }
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
        body.tick(0.016, 100.0, 5.0); // ~60fps, k=100, c=5

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
        body.tick(0.016, 0.0, 50.0);

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
    fn test_base_pos_movement_drags_particles() {
        // Simulate DOM element moving: base_pos shifts, particles lag behind
        let mut body = EntityBody::new_rect(100.0, 100.0, 4);
        // Initially everything at rest

        // "Move" the DOM element 200px to the right
        body.base_pos = Vec2::new(200.0, 0.0);

        // Particles are still at their old positions (local_rest relative to old base)
        // After tick, spring should start pulling them toward new target
        body.tick(0.016, 100.0, 5.0);

        // Particle 0: target = base_pos + local_rest = (200, 0) + (0, 0) = (200, 0)
        // It was at (0, 0), so spring pulls it right
        assert!(
            body.particles[0].velocity.x > 0.0,
            "particle should be pulled toward new base_pos, velocity.x = {}",
            body.particles[0].velocity.x,
        );
        assert!(
            body.particles[0].pos.x > 0.0,
            "particle should have moved toward new base_pos, pos.x = {}",
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

        body.tick(0.016, 100.0, 5.0);

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
}
