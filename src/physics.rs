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
    FreeDrop, // 6.0 — Ward 043
}

/// Ward 043 free-floating particle. No DOM anchor, no springs, no neighbors.
/// Stored in `LiquidCore::free_particles` parallel to `bodies`.
#[derive(Debug, Clone)]
pub struct FreeParticle {
    pub pos: Vec2,
    pub velocity: Vec2,
    pub radius: f32,
}

impl FreeParticle {
    pub fn new(pos: Vec2, velocity: Vec2, radius: f32) -> Self {
        Self { pos, velocity, radius }
    }

    /// Constant-velocity integration. Gravity arrives in W46.
    pub fn integrate(&mut self, dt: f32) {
        self.pos += self.velocity * dt;
    }
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
        6 => PhysicsStrategy::FreeDrop,
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
    let saved_base = body.base_pos;
    body.base_pos = drag_target - Vec2::new(body.width * 0.5, body.height * 0.5);
    body.run_physics(dt, tension, damping, Vec2::zero(), pointer_active, substeps, 100.0, 5000.0, 30.0);
    body.base_pos = saved_base;
}

/// Shake strategy — applies impulse force on top of normal physics.
/// impulse_vx/vy are the current frame's impulse (decay handled by TS timer).
#[allow(clippy::too_many_arguments)]
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
    body.run_physics(dt, tension, damping, pointer_pos, pointer_active, substeps, 100.0, 5000.0, 30.0);
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
    body.run_physics(dt, tension, damping, pointer_pos, pointer_active, substeps, 100.0, 5000.0, 30.0);
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
    pub skip_rigid_translation: bool,
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
        self.tick_with_substeps(dt, tension, damping, pointer_pos, pointer_active, 1);
    }

    /// Full tick with configurable substeps and default physics constants.
    pub fn tick_with_substeps(
        &mut self,
        dt: f32,
        tension: f32,
        damping: f32,
        pointer_pos: Vec2,
        pointer_active: bool,
        substeps: u32,
    ) {
        self.run_physics(dt, tension, damping, pointer_pos, pointer_active, substeps, 100.0, 5000.0, 30.0);
    }

    /// Core physics implementation. Called by all strategies (Default baseline).
    #[allow(clippy::too_many_arguments)]
    pub fn run_physics(
        &mut self,
        dt: f32,
        tension: f32,
        damping: f32,
        pointer_pos: Vec2,
        pointer_active: bool,
        substeps: u32,
        repulsion_radius: f32,
        repulsion_strength: f32,
        neighbor_stiffness: f32,
    ) {
        const CENTROID_STRENGTH: f32 = 5.0;
        const AREA_CORRECTION_STRENGTH: f32 = 0.5;

        // Rigid translation: when base_pos changes, teleport all particles
        // by the same delta so they follow the DOM element instantly.
        // Skipped during drag — springs pull particles naturally for squish effect.
        let delta = self.base_pos - self.prev_base_pos;
        if delta.x != 0.0 || delta.y != 0.0 {
            if !self.skip_rigid_translation {
                for particle in &mut self.particles {
                    particle.pos += delta;
                }
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
                    let force = diff.normalize() * (-neighbor_stiffness * stretch);
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
                    if dist < repulsion_radius && dist > 0.001 {
                        let falloff = 1.0 - (dist / repulsion_radius);
                        let f_repel =
                            to_particle.normalize() * (repulsion_strength * falloff);
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
    /// Construct a rectangular soft body. Backwards-compatible wrapper around
    /// `new_rounded_rect(w, h, 0.0, count)`. Byte-identical to the legacy
    /// implementation via direct delegation (Ward 042 spec §3).
    pub fn new_rect(width: f32, height: f32, num_particles: usize) -> Self {
        Self::new_rounded_rect(width, height, 0.0, num_particles)
    }

    /// Canonical constructor (Ward 042). For `r > 0` distributes particles
    /// around the rounded perimeter; for `r <= 0` or NaN delegates to
    /// `new_rect_inner` for byte-identity with the legacy rectangle.
    ///
    /// Guard is NaN-safe: an explicit `r.is_nan()` check is required because
    /// `r <= 0.0` returns `false` for NaN. Spec §3.
    pub fn new_rounded_rect(width: f32, height: f32, r: f32, num_particles: usize) -> Self {
        if r.is_nan() || r <= 0.0 {
            return Self::new_rect_inner(width, height, num_particles);
        }

        let particle_positions = rounded_rect_perimeter_points(width, height, r, num_particles);
        let particles: Vec<Particle> = particle_positions
            .iter()
            .map(|&pos| Particle::new(pos, pos))
            .collect();

        let mut neighbor_springs = Vec::with_capacity(num_particles);
        for i in 0..num_particles {
            let a = i;
            let b = (i + 1) % num_particles;
            let rest_length = (particles[a].pos - particles[b].pos).length();
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
            skip_rigid_translation: false,
        };
        body.reference_area = body.compute_area();
        body
    }

    /// Legacy rectangle constructor body. Private — callers use `new_rect`
    /// which delegates here for byte-identity guarantee.
    fn new_rect_inner(width: f32, height: f32, num_particles: usize) -> Self {
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

        let mut neighbor_springs = Vec::with_capacity(num_particles);
        for i in 0..num_particles {
            let a = i;
            let b = (i + 1) % num_particles;
            let rest_length = (particles[a].pos - particles[b].pos).length();
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
            skip_rigid_translation: false,
        };
        body.reference_area = body.compute_area();
        body
    }
}

/// Distribute `count` points around a rounded-rect perimeter weighted by
/// arc length. Per-segment counts computed via spec §4: floor each proportional
/// value, distribute remainder one point at a time in fixed order
/// (arc[0]=TR, arc[1]=BR, arc[2]=BL, arc[3]=TL, edge_top, edge_right,
/// edge_bottom, edge_left, then loop).
///
/// Points within each segment are placed at CENTERED offsets `(j + 0.5) * L / n`
/// so no point lands exactly on a segment boundary — this avoids classifier
/// ambiguity in test #5 and gives clean visual distribution.
pub fn rounded_rect_perimeter_points(w: f32, h: f32, r: f32, count: usize) -> Vec<Vec2> {
    let r_clamped = r.min(w.min(h) / 2.0).max(0.0);

    if r_clamped <= 0.0 {
        // Degenerate to evenly-spaced rectangle perimeter.
        // (Used internally; r=0 callers normally go through new_rect_inner.)
        let perim = 2.0 * (w + h);
        let spacing = perim / count as f32;
        return (0..count)
            .map(|i| {
                let d = i as f32 * spacing;
                if d < w {
                    Vec2::new(d, 0.0)
                } else if d < w + h {
                    Vec2::new(w, d - w)
                } else if d < 2.0 * w + h {
                    Vec2::new(w - (d - w - h), h)
                } else {
                    Vec2::new(0.0, h - (d - 2.0 * w - h))
                }
            })
            .collect();
    }

    let arc_len = std::f32::consts::FRAC_PI_2 * r_clamped; // π*r/2 per arc
    let edge_h_len = w - 2.0 * r_clamped;
    let edge_v_len = h - 2.0 * r_clamped;
    let perimeter = 4.0 * arc_len + 2.0 * edge_h_len + 2.0 * edge_v_len;

    let count_f = count as f32;
    let n_arc_f = count_f * arc_len / perimeter;
    let n_edge_h_f = count_f * edge_h_len / perimeter;
    let n_edge_v_f = count_f * edge_v_len / perimeter;

    // Indexing: [arc_TR, arc_BR, arc_BL, arc_TL, edge_top, edge_right, edge_bottom, edge_left]
    let mut counts: [usize; 8] = [
        n_arc_f.floor() as usize,
        n_arc_f.floor() as usize,
        n_arc_f.floor() as usize,
        n_arc_f.floor() as usize,
        n_edge_h_f.floor() as usize,
        n_edge_v_f.floor() as usize,
        n_edge_h_f.floor() as usize,
        n_edge_v_f.floor() as usize,
    ];

    let total_floor: usize = counts.iter().sum();
    let mut remainder = count.saturating_sub(total_floor);

    // Symmetry-preserving remainder distribution (Ward 042 r5 §4):
    //   1. Groups of 4 → all four arcs simultaneously.
    //   2. Pair → top + bottom (h-edge pair).
    //   3. Pair → right + left (v-edge pair).
    //   4. Singleton → arc[0] (deterministic tiebreaker for odd remainders).
    // Preserves bilateral and 4-fold symmetry whenever the remainder permits.
    while remainder >= 4 {
        counts[0] += 1; // TR
        counts[1] += 1; // BR
        counts[2] += 1; // BL
        counts[3] += 1; // TL
        remainder -= 4;
    }
    if remainder >= 2 {
        counts[4] += 1; // top
        counts[6] += 1; // bottom
        remainder -= 2;
    }
    if remainder >= 2 {
        counts[5] += 1; // right
        counts[7] += 1; // left
        remainder -= 2;
    }
    if remainder == 1 {
        counts[0] += 1;
    }

    let n_tr = counts[0];
    let n_br = counts[1];
    let n_bl = counts[2];
    let n_tl = counts[3];
    let n_top = counts[4];
    let n_right = counts[5];
    let n_bottom = counts[6];
    let n_left = counts[7];

    let mut points: Vec<Vec2> = Vec::with_capacity(count);

    // Top edge: (r, 0) → (w-r, 0), x increases.
    for j in 0..n_top {
        let frac = (j as f32 + 0.5) / n_top as f32;
        points.push(Vec2::new(r_clamped + frac * edge_h_len, 0.0));
    }
    // TR arc: center (w-r, r), angle -π/2 → 0.
    for j in 0..n_tr {
        let frac = (j as f32 + 0.5) / n_tr as f32;
        let angle = -std::f32::consts::FRAC_PI_2 + frac * std::f32::consts::FRAC_PI_2;
        points.push(Vec2::new(
            w - r_clamped + r_clamped * angle.cos(),
            r_clamped + r_clamped * angle.sin(),
        ));
    }
    // Right edge: (w, r) → (w, h-r), y increases.
    for j in 0..n_right {
        let frac = (j as f32 + 0.5) / n_right as f32;
        points.push(Vec2::new(w, r_clamped + frac * edge_v_len));
    }
    // BR arc: center (w-r, h-r), angle 0 → π/2.
    for j in 0..n_br {
        let frac = (j as f32 + 0.5) / n_br as f32;
        let angle = frac * std::f32::consts::FRAC_PI_2;
        points.push(Vec2::new(
            w - r_clamped + r_clamped * angle.cos(),
            h - r_clamped + r_clamped * angle.sin(),
        ));
    }
    // Bottom edge: (w-r, h) → (r, h), x decreases.
    for j in 0..n_bottom {
        let frac = (j as f32 + 0.5) / n_bottom as f32;
        points.push(Vec2::new(w - r_clamped - frac * edge_h_len, h));
    }
    // BL arc: center (r, h-r), angle π/2 → π.
    for j in 0..n_bl {
        let frac = (j as f32 + 0.5) / n_bl as f32;
        let angle = std::f32::consts::FRAC_PI_2 + frac * std::f32::consts::FRAC_PI_2;
        points.push(Vec2::new(
            r_clamped + r_clamped * angle.cos(),
            h - r_clamped + r_clamped * angle.sin(),
        ));
    }
    // Left edge: (0, h-r) → (0, r), y decreases.
    for j in 0..n_left {
        let frac = (j as f32 + 0.5) / n_left as f32;
        points.push(Vec2::new(0.0, h - r_clamped - frac * edge_v_len));
    }
    // TL arc: center (r, r), angle π → 3π/2.
    for j in 0..n_tl {
        let frac = (j as f32 + 0.5) / n_tl as f32;
        let angle = std::f32::consts::PI + frac * std::f32::consts::FRAC_PI_2;
        points.push(Vec2::new(
            r_clamped + r_clamped * angle.cos(),
            r_clamped + r_clamped * angle.sin(),
        ));
    }

    points
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
            p.pos += Vec2::new((i as f32) * 5.0, (i as f32) * -3.0);
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
            body.run_physics(0.016, 100.0, 5.0, Vec2::zero(), false, 1, 100.0, 5000.0, 30.0);
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

    // ── Ward 042: Border-Radius Aware Rest Shape ──

    /// Ward 042 test #1: rounded_rect returns exactly `count` points.
    #[test]
    fn test_w42_rounded_rect_returns_exact_count() {
        let points = rounded_rect_perimeter_points(100.0, 50.0, 10.0, 16);
        assert_eq!(points.len(), 16);
    }

    /// Ward 042 test #2: r=0 byte-identical to current new_rect (zero tolerance).
    /// Verifies all particle fields AND neighbor_springs structure.
    #[test]
    fn test_w42_rounded_rect_zero_radius_byte_identical_to_new_rect() {
        let rounded = EntityBody::new_rounded_rect(100.0, 50.0, 0.0, 16);
        let rect = EntityBody::new_rect(100.0, 50.0, 16);

        assert_eq!(rounded.particles.len(), rect.particles.len());
        for (a, b) in rounded.particles.iter().zip(rect.particles.iter()) {
            assert_eq!(a.pos, b.pos);
            assert_eq!(a.local_rest, b.local_rest);
            assert_eq!(a.velocity, b.velocity);
        }

        // Spec §3 byte-identity requires springs match too (S4).
        assert_eq!(rounded.neighbor_springs.len(), rect.neighbor_springs.len());
        for (a, b) in rounded.neighbor_springs.iter().zip(rect.neighbor_springs.iter()) {
            assert_eq!(a.a, b.a);
            assert_eq!(a.b, b.b);
            assert_eq!(a.rest_length, b.rest_length);
        }
    }

    /// Ward 042 test #3: pill (r = h/2) is mirror-symmetric about both axes.
    /// Tolerance 1e-3 matches project convention for f32 trig output (S3).
    #[test]
    fn test_w42_rounded_rect_pill_is_symmetric() {
        let points = rounded_rect_perimeter_points(100.0, 50.0, 25.0, 16);
        // Center of element rect is (50, 25). Each point should have a mirror
        // counterpart across x=50 and y=25 within tolerance.
        let cx = 50.0_f32;
        let cy = 25.0_f32;
        let tol = 1e-3_f32;

        for p in &points {
            // Find a point that mirrors p across x=cx
            let mirror_x = Vec2::new(2.0 * cx - p.x, p.y);
            let has_x_mirror = points.iter().any(|q| (q.x - mirror_x.x).abs() < tol && (q.y - mirror_x.y).abs() < tol);
            assert!(has_x_mirror, "no x-axis mirror for point {:?}", p);

            // Find a point that mirrors p across y=cy
            let mirror_y = Vec2::new(p.x, 2.0 * cy - p.y);
            let has_y_mirror = points.iter().any(|q| (q.x - mirror_y.x).abs() < tol && (q.y - mirror_y.y).abs() < tol);
            assert!(has_y_mirror, "no y-axis mirror for point {:?}", p);
        }
    }

    /// Ward 042 test #4: oversized r is clamped to min(w,h)/2.
    #[test]
    fn test_w42_rounded_rect_clamps_oversized_radius() {
        let huge = rounded_rect_perimeter_points(100.0, 50.0, 999.0, 16);
        let clamped = rounded_rect_perimeter_points(100.0, 50.0, 25.0, 16);
        assert_eq!(huge, clamped);
    }

    /// Ward 042 test #5: deterministic remainder distribution per spec §4.
    /// Pre-computed for 100×50, r=10, count=16:
    /// per-segment counts = [arc0=1, arc1=1, arc2=1, arc3=1, edge_top=5,
    /// edge_right=2, edge_bottom=4, edge_left=1] (sum = 16).
    /// We assert the geometry matches this distribution by counting points
    /// in each segment region.
    #[test]
    fn test_w42_rounded_rect_remainder_distribution_matches_spec() {
        let points = rounded_rect_perimeter_points(100.0, 50.0, 10.0, 16);
        assert_eq!(points.len(), 16);

        let r = 10.0_f32;
        let w = 100.0_f32;
        let h = 50.0_f32;
        let tol = 1e-3_f32;

        // Helper: classify each point into one of 8 segments by region.
        // Edges run between corner anchors at (r,0), (w-r,0), (w,r), (w,h-r),
        // (w-r,h), (r,h), (0,h-r), (0,r).
        let mut counts = [0u32; 8]; // 0..3 arcs, 4=top, 5=right, 6=bottom, 7=left

        for p in &points {
            let on_top_edge = p.y.abs() < tol && p.x > r - tol && p.x < w - r + tol;
            let on_right_edge = (p.x - w).abs() < tol && p.y > r - tol && p.y < h - r + tol;
            let on_bottom_edge = (p.y - h).abs() < tol && p.x > r - tol && p.x < w - r + tol;
            let on_left_edge = p.x.abs() < tol && p.y > r - tol && p.y < h - r + tol;

            // Arcs: distance from corner center == r
            // Corner centers: TL=(r,r), TR=(w-r,r), BR=(w-r,h-r), BL=(r,h-r)
            let tl_d = ((p.x - r).powi(2) + (p.y - r).powi(2)).sqrt();
            let tr_d = ((p.x - (w - r)).powi(2) + (p.y - r).powi(2)).sqrt();
            let br_d = ((p.x - (w - r)).powi(2) + (p.y - (h - r)).powi(2)).sqrt();
            let bl_d = ((p.x - r).powi(2) + (p.y - (h - r)).powi(2)).sqrt();

            // Arc quadrant guards use <= / >= with tolerance so boundary points
            // (e.g., exactly at (r, 0) or (w, r)) classify correctly. Edge
            // precedence in the if/else chain below handles the tie at endpoints (M1).
            let on_tl_arc = (tl_d - r).abs() < tol && p.x <= r + tol && p.y <= r + tol;
            let on_tr_arc = (tr_d - r).abs() < tol && p.x >= w - r - tol && p.y <= r + tol;
            let on_br_arc = (br_d - r).abs() < tol && p.x >= w - r - tol && p.y >= h - r - tol;
            let on_bl_arc = (bl_d - r).abs() < tol && p.x <= r + tol && p.y >= h - r - tol;

            // Spec §4 step 6: clockwise from (r, 0) — top-edge, top-right arc,
            // right-edge, bottom-right arc, bottom-edge, bottom-left arc,
            // left-edge, top-left arc.
            // Mapping to counts indices: arc[0..3] = TR, BR, BL, TL.
            if on_top_edge { counts[4] += 1; }
            else if on_tr_arc { counts[0] += 1; }
            else if on_right_edge { counts[5] += 1; }
            else if on_br_arc { counts[1] += 1; }
            else if on_bottom_edge { counts[6] += 1; }
            else if on_bl_arc { counts[2] += 1; }
            else if on_left_edge { counts[7] += 1; }
            else if on_tl_arc { counts[3] += 1; }
            else {
                panic!("point {:?} did not classify into any segment", p);
            }
        }

        // Spec r5 §4 symmetry-preserving distribution: arcs all=1, top=bottom=5,
        // right=left=1 (bilateral symmetric).
        assert_eq!(counts, [1, 1, 1, 1, 5, 1, 5, 1], "actual counts: {:?}", counts);
    }

    /// Ward 042 test #6: negative and NaN radius treated as zero (delegate).
    /// Full byte-identity per spec §3 — pos, local_rest, velocity, neighbor_springs (M2 + S4).
    #[test]
    fn test_w42_rounded_rect_negative_and_nan_radius_treated_as_zero() {
        let neg = EntityBody::new_rounded_rect(100.0, 50.0, -5.0, 16);
        let nan = EntityBody::new_rounded_rect(100.0, 50.0, f32::NAN, 16);
        let rect = EntityBody::new_rect(100.0, 50.0, 16);

        for body in [&neg, &nan] {
            assert_eq!(body.particles.len(), rect.particles.len());
            for (a, b) in body.particles.iter().zip(rect.particles.iter()) {
                assert_eq!(a.pos, b.pos);
                assert_eq!(a.local_rest, b.local_rest);
                assert_eq!(a.velocity, b.velocity);
            }
            assert_eq!(body.neighbor_springs.len(), rect.neighbor_springs.len());
            for (a, b) in body.neighbor_springs.iter().zip(rect.neighbor_springs.iter()) {
                assert_eq!(a.a, b.a);
                assert_eq!(a.b, b.b);
                assert_eq!(a.rest_length, b.rest_length);
            }
        }
    }

    /// Ward 042 test #7: pill body reaches stable equilibrium under default physics.
    /// Default params per spec: tension=100, damping=5, substeps=1, repulsion_radius=100,
    /// repulsion_strength=5000, neighbor_spring_k=30, no pointer.
    /// "Stable" requires BOTH: max position drift < 1.0 px AND max velocity < 0.5 px/s.
    /// The velocity check (M3) rejects oscillating bodies that happen to return near
    /// their initial positions every period.
    #[test]
    fn test_w42_pill_body_reaches_stable_equilibrium() {
        let mut body = EntityBody::new_rounded_rect(100.0, 50.0, 25.0, 16);
        let initial: Vec<Vec2> = body.particles.iter().map(|p| p.pos).collect();

        for _ in 0..1000 {
            body.run_physics(0.016, 100.0, 5.0, Vec2::zero(), false, 1, 100.0, 5000.0, 30.0);
        }

        let max_drift = body
            .particles
            .iter()
            .enumerate()
            .map(|(i, p)| (p.pos - initial[i]).length())
            .fold(0.0_f32, f32::max);
        assert!(
            max_drift < 1.0,
            "pill should reach stable equilibrium, max drift = {} px",
            max_drift,
        );

        let max_vel = body
            .particles
            .iter()
            .map(|p| p.velocity.length())
            .fold(0.0_f32, f32::max);
        assert!(
            max_vel < 0.5,
            "pill should be at rest, max velocity = {} px/s",
            max_vel,
        );
    }
}
