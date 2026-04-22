---
ward: 29
revision: null
name: "Liquid Type Dispatch Architecture"
epic: "interaction-primitives"
status: "planned"
dependencies: [23]
layer: "rust"
estimated_tests: 4
created: "2026-04-22"
completed: null
---
# Ward 029: Liquid Type Dispatch Architecture

## Scope
Refaktorér `EntityBody::tick` til at dispatche på `liquid_type` feltet i entity-bufferen. Definér enum `PhysicsStrategy { Default, Tear, Magnet, Dragged, Shake, Tween }` hvor hver variant mapper til en separat strategi-funktion der modtager identiske inputs men kan anvende forskellige kræfter. Default-strategien matcher nuværende Ward 22 opførsel præcis (1:1 kopi). Denne ward tilføjer kun dispatch-infrastrukturen — ingen nye strategier implementeres ud over Default stub.

## Inputs
- Physics stabilization layer fra Ward 22 (neighbor springs, substeps, centroid anchoring, semi-implicit Euler)
- Configurable materials fra Ward 23 (`PhysicsConfig` struct med tension, damping, substeps etc.)
- `liquid_type` float felt i entity buffer (allerede reserveret i buffer layout)

## Outputs
- `PhysicsStrategy` enum med alle planlagte varianter
- `dispatch_strategy(liquid_type: f32) -> PhysicsStrategy` funktion der mapper float til enum
- Separate strategi-funktioner: `strategy_default(...)`, `strategy_tear(...)`, `strategy_magnet(...)` etc.
- Default-strategi som eksakt kopi af nuværende Ward 22 tick-logik
- Bruges af Ward 030 (Dragged strategi), Ward 031 (Shake strategi), fremtidige interaction primitives

## Specification

### PhysicsStrategy Enum
```rust
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PhysicsStrategy {
    Default,   // 0.0 — nuværende Ward 22 opførsel
    Tear,      // 1.0 — placeholder stub
    Magnet,    // 2.0 — placeholder stub
    Dragged,   // 3.0 — placeholder stub (Ward 030)
    Shake,     // 4.0 — placeholder stub (Ward 031)
    Tween,     // 5.0 — placeholder stub
}
```

### Float-til-Enum Mapping
- `liquid_type` læses som `f32` fra entity buffer
- Mapping via `round()` til nærmeste integer, derefter match
- Ukendte værdier (< 0, > 5, NaN) falder tilbage til `Default`
- Mapping-funktion er `pub` for testbarhed

### Dispatch i Tick
- I `EntityBody::tick` (eller tilsvarende tick-loop): læs `liquid_type` fra buffer, dispatch til strategi-funktion
- Alle strategi-funktioner har identisk signatur:
  ```rust
  fn strategy_default(
      particles: &mut [Particle],
      config: &PhysicsConfig,
      base_pos: (f32, f32),
      dt: f32,
      substeps: u32,
  )
  ```
- Ikke-implementerede strategier (`Tear`, `Magnet`, `Tween`) kalder `strategy_default` som fallback

### Default Strategi
- Eksakt kopi af nuværende Ward 22 tick-logik: neighbor springs, shape preservation, centroid anchoring, semi-implicit Euler
- Ingen ændring i opførsel — bitwise identiske resultater for `liquid_type = 0.0`
- Koden flyttes ud af tick-metoden og ind i `strategy_default` funktion

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_default_liquid_type_matches_baseline` | Default strategi (liquid_type=0.0) producerer identiske resultater som Ward 22 tick — sammenlign partikelpositioner efter 100 frames |
| 2 | `test_dispatch_overhead_minimal` | Dispatch tilføjer negligibel overhead: < 5% af tick-tid sammenlignet med direkte kald |
| 3 | `test_invalid_liquid_type_falls_back` | Ukendte liquid_type værdier (NaN, -1.0, 99.0) bruger Default strategi uden panic |
| 4 | `test_strategies_unit_testable` | Hver strategi-funktion kan kaldes direkte med test-data uden at gå igennem tick-dispatch |

## Must NOT
- Ikke ændre eksisterende physics behavior for Default strategi — output skal være identisk med Ward 22
- Ikke implementere nye strategier ud over Default stub (Tear/Magnet/Tween returnerer Default)
- Ikke bryde WASM API kompatibilitet — buffer layout og eksporterede funktioner uændret
- Ikke allokere per-dispatch (enum match er zero-cost)

## Must DO
- Definér `PhysicsStrategy` enum med alle planlagte varianter
- Dispatch i tick baseret på `liquid_type` float fra buffer
- Default strategi er eksakt kopi af nuværende Ward 22 logik
- Hver strategi er en separat `pub fn` for testbarhed og isolation
- Ukendte liquid_type værdier falder sikkert tilbage til Default
- Alle strategi-funktioner har identisk signatur

## Verification
- `cargo test` består alle 4 tests
- `cargo clippy` giver 0 warnings
- Benchmark: tick med dispatch er inden for 5% af baseline uden dispatch
- Eksisterende demo/tests fra Ward 22-23 kører uændret
