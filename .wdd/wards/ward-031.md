---
ward: 31
revision: null
name: "Impulse Injection Primitive"
epic: "interaction-primitives"
status: "planned"
dependencies: [13, 29]
layer: "both"
estimated_tests: 3
created: "2026-04-22"
completed: null
---
# Ward 031: Impulse Injection Primitive

## Scope
API til at injicere en impulse-kraft i en entity fra TypeScript. Use cases: error shake, success bounce, attention pulse. Rust-side: Shake-strategien anvender dæmpet oscillation på alle partikler i entityen. TS API: `instance.impulse(element, { direction, magnitude, duration })`. Impulsen decayer over den angivne duration og returnerer automatisk til Default-strategi når den er færdig.

## Inputs
- PhysicsStrategy dispatch fra Ward 29 (Shake variant og strategi-funktion signatur)
- Entity buffer layout med `liquid_type` felt
- Physics stabilization fra Ward 22 (damping, centroid anchoring)
- LiquidInstance API fra Ward 13

## Outputs
- `instance.impulse(element, options)` metode på public API
- Shake PhysicsStrategy implementering i Rust med dæmpet oscillation
- Auto-decay: Shake returnerer til Default efter duration
- Bruges af fremtidige wards der bygger på impulse (e.g. notification animations, transition effects)

## Specification

### TypeScript — Impulse API
```typescript
interface ImpulseOptions {
  direction?: [number, number];  // Normalized direction vector [dx, dy], default [1, 0]
  magnitude?: number;            // Kraft-styrke i pixels, default 10
  duration?: number;             // Decay-tid i milliseconds, default 300
}

// På LiquidInstance:
impulse(element: Element, options?: ImpulseOptions): void;
```

- `impulse()` validerer at element er observeret (throw hvis ikke)
- Skriver impulse-parametre til entity buffer: direction, magnitude, start_time, duration
- Sætter `liquid_type` til `4.0` (Shake) i buffer
- Flere kald til `impulse()` på samme element overskriver forrige (last-write-wins)

### Impulse Data i Buffer
- Impulse kræver ekstra buffer-felter per entity: `impulse_dx`, `impulse_dy`, `impulse_magnitude`, `impulse_start_time`, `impulse_duration`
- Alternativt: pack direction+magnitude i færre felter via `impulse_vx = dx * magnitude`, `impulse_vy = dy * magnitude`
- Disse felter ignoreres når liquid_type != Shake

### Rust — Shake Strategy
```rust
fn strategy_shake(
    particles: &mut [Particle],
    config: &PhysicsConfig,
    base_pos: (f32, f32),
    impulse_vx: f32,
    impulse_vy: f32,
    elapsed: f32,    // tid siden impulse start
    duration: f32,   // total impulse duration
    dt: f32,
    substeps: u32,
) {
    // 1. Beregn decay factor: 1.0 - (elapsed / duration), clamped til [0, 1]
    // 2. Anvend dæmpet oscillation:
    //    offset = impulse_v * decay * sin(elapsed * frequency)
    // 3. Tilføj offset som kraft til alle partikler
    // 4. Kør normal physics (neighbor springs, shape preservation, centroid anchoring mod base_pos)
    // 5. Hvis elapsed >= duration: sæt liquid_type tilbage til 0.0 (Default)
}
```

- Oscillation frequency er fast (e.g. 30 Hz) for konsistent feel
- Decay er lineær: kraft aftager jævnt over duration
- Centroid anchoring mod `base_pos` sikrer at entity returnerer til hvileposition
- Når duration er udløbet skriver Rust `liquid_type = 0.0` direkte i buffer (auto-reset)

### Composability
- Overlappende impulses: nyt `impulse()` kald overskriver aktivt Shake med nye parametre
- Impulse adderer til eksisterende physics-kræfter (ikke erstatning)
- Direction [0, 0] med magnitude > 0 giver radial "pulse" effekt (alle retninger)

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_impulse_changes_velocity` | Kald til impulse tilføjer velocity til partikler — positions ændrer sig mere end uden impulse |
| 2 | `test_impulse_decays_to_equilibrium` | Efter duration er entityens partikler returneret til hvileposition (< threshold afvigelse fra base_pos) |
| 3 | `test_multiple_impulses_compose` | Overlappende impulses: andet kald overskriver første, entity opfører sig korrekt uden explosion eller stuck state |

## Must NOT
- Ikke erstatte eksisterende physics-kræfter — impulse adderer til dem
- Ikke lade entity permanent i Shake state — auto-reset til Default efter duration
- Ikke allokere per-impulse — brug eksisterende buffer-felter
- Ikke kræve at bruger manuelt resetter liquid_type efter impulse

## Must DO
- Eksponér `instance.impulse()` på public API med TypeScript types
- Decay impulse over konfigurerbar duration (default 300ms)
- Returnér automatisk til Default strategi når impulse er færdig (Rust skriver liquid_type=0.0)
- Impulse-kraft adderer til normale physics-kræfter
- Validér at element er observeret før impulse accepteres

## Verification
- Alle 3 tests består (TS unit test for API + Rust tests for strategy_shake)
- `cargo test` og `npm test` består
- Demo: klik en knap der kalder `impulse()` — element ryster og vender tilbage til hvile
- Edge case: kald `impulse()` hurtigt gentagne gange — ingen explosion eller drift
