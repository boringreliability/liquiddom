---
ward: 23
revision: null
name: "Configurable Materials and Runtime Options"
epic: "library-maturity"
status: "complete"
dependencies: [22]
layer: "both"
estimated_tests: 3
created: "2026-03-31"
completed: "2026-04-22"
---
# Ward 023: Configurable Materials and Runtime Options

## Scope
Eksponér fysik- og rendering-parametre som bruger-konfigurerbar config: tension, damping, repulsion radius/strength, max dt, particle count og substeps. Tilbyd optional presets (`goo`, `jelly`, `firm`) for hurtig setup. Validér config ved init for at fange ugyldige værdier tidligt.

## Inputs
- Physics stabilization layer fra Ward 22 (neighbor springs, substeps, centroid anchoring)
- Alle tunable parametre i Rust-kernelen der pt. er hardcoded

## Outputs
- `LiquidConfig` TypeScript interface med alle tunable felter
- `MaterialPreset` type med navngivne presets
- Config-validering funktion
- Rust-side: config struct der modtages via FFI og bruges i physics step
- Bruges af Ward 024 (exported som del af public API)

## Specification

### LiquidConfig Interface (TypeScript)
```typescript
interface LiquidConfig {
  tension?: number;         // Spring stiffness (default 0.3)
  damping?: number;         // Velocity damping (default 0.7)
  repulsionRadius?: number; // Particle repulsion radius (default 15)
  repulsionStrength?: number; // Repulsion force multiplier (default 1.0)
  maxDt?: number;           // Max timestep cap in ms (default 32)
  particleCount?: number;   // Particles per entity edge (default 8)
  substeps?: number;        // Physics substeps per frame (default 1)
  neighborSpringK?: number; // Neighbor spring stiffness (default 0.1)
}
```

### Material Presets
- `goo`: høj damping (0.9), lav tension (0.15), høj repulsion — langsom, klæbrig bevægelse
- `jelly`: medium tension (0.4), medium damping (0.6), substeps=2 — bouncende, elastisk
- `firm`: høj tension (0.8), lav damping (0.3), substeps=4 — hurtig tilbagevenden, stram form

### Preset API
- `LiquidDOM.presets.goo`, `.jelly`, `.firm` returnerer frozen `LiquidConfig` objekter
- Presets kan overrides: `{ ...LiquidDOM.presets.jelly, tension: 0.5 }`

### Config Validering
- Alle numeriske værdier skal være finite og >= 0
- `particleCount` skal være integer >= 3
- `substeps` skal være integer >= 1
- `maxDt` skal være > 0
- Ved ugyldig config: throw `TypeError` med specifik besked om hvilket felt der fejler

### Rust-Side Config
- `PhysicsConfig` struct der modtager værdier via FFI (flattened f32 array eller struct pointer)
- Default-værdier i Rust matcher TypeScript defaults
- Config opdateres per-entity eller globalt

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_custom_tension_damping_applied` | Custom tension og damping værdier ændrer physics behavior (partikel med høj tension returnerer hurtigere) |
| 2 | `test_preset_creates_expected_config` | `presets.jelly` returnerer config med korrekte default-værdier og er frozen |
| 3 | `test_config_validated_at_init` | Ugyldig config (negativ tension, particleCount=1, NaN damping) kaster TypeError med beskrivende besked |

## Must NOT
- Ikke bryde eksisterende API — alle config-felter er optional med sane defaults
- Ikke tillade NaN, Infinity eller negative værdier i config
- Ikke kopiere config-værdier per frame (sæt én gang, læs via reference)
- Ikke hardcode physics-parametre i Rust-kernelen længere

## Must DO
- Alle felter optional med documented defaults
- Presets som frozen objekter der kan spreades
- Validér config synkront ved init/observe — fail fast
- TypeScript types eksporteres for forbrugere
- Rust PhysicsConfig struct med From-trait fra FFI-input

## Verification
- Alle 3 tests består (TypeScript unit tests + Rust tests for config struct)
- `cargo clippy` og `tsc --noEmit` giver 0 errors
- Demo: skift mellem presets og se visuel forskel i animation
