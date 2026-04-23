---
ward: 27
revision: null
name: "Coordinate System Unification"
epic: "real-world-illusion"
status: "complete"
dependencies: [26]
layer: "both"
estimated_tests: 4
created: "2026-04-22"
completed: "2026-04-23"
---
# Ward 027: Coordinate System Unification

## Scope
Beslut én gang for alle om physics opererer i viewport-relative eller document-relative koordinater. Dokumentér valget i CONTEXT.md. Refactor `PhantomObserver.sync` og pointer-tracking så begge bruger samme reference frame. Edge case: container mode vs fullscreen mode skal begge respektere det valgte koordinatsystem uden ad-hoc offset-korrektioner.

## Inputs
- Scroll-aware base position fra Ward 26 (scroll-håndtering og `base_pos` snap)
- `PhantomObserver.sync` der opdaterer entity-positioner fra DOM rects
- Pointer-tracking der konverterer `clientX/clientY` til entity-space koordinater
- Container mode og fullscreen mode rendering paths

## Outputs
- Dokumenteret koordinatsystem-valg i CONTEXT.md
- Refactored `PhantomObserver.sync` der bruger det valgte koordinatsystem konsistent
- Refactored pointer-tracking der bruger samme reference frame som entities
- Utility-funktioner til koordinat-konvertering (hvis nødvendigt)
- Bruges af alle fremtidige wards der involverer position eller pointer-interaction

## Specification

### Koordinatsystem-Valg
- Analyser trade-offs:
  - **Viewport-relative** (`getBoundingClientRect()`): naturligt match med `clientX/clientY`, men ændrer sig ved scroll
  - **Document-relative** (rect + `scrollX/scrollY`): stabilt ved scroll, men kræver offset ved pointer-events
- Valget dokumenteres i CONTEXT.md med rationale
- Anbefaling: viewport-relative med scroll-guard fra Ward 26 er sandsynligvis simplest

### PhantomObserver.sync Refactor
- `sync()` skal konsistent producere koordinater i det valgte system
- Fjern eventuelle ad-hoc scroll-offset korrektioner der er vokset frem
- Alle entity `base_pos` værdier skal være i samme koordinatsystem

### Pointer-Tracking Refactor
- `mousemove`/`pointermove` handler skal konvertere til samme koordinatsystem som entities
- I container mode: pointer-position skal være relativ til container canvas
- I fullscreen mode: pointer-position skal matche viewport-koordinater
- Én fælles `toPhysicsCoords(clientX, clientY)` utility

### Rust-Side
- Physics-kernelen er agnostisk over for koordinatsystem (den regner i relative offsets)
- Men entity buffer-positioner skal være konsistente — ingen blanding af systemer

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_coordinates_consistent_across_scroll` | Entity-positioner matcher forventede værdier efter scroll (ingen drift) |
| 2 | `test_pointer_and_entity_same_reference_frame` | Pointer-koordinater og entity-koordinater bruger same space — pointer over element giver korrekt hit |
| 3 | `test_container_mode_coordinates_correct` | Container-relative koordinater er korrekte efter unifikation (pointer og entity matcher i container) |
| 4 | `test_fullscreen_mode_coordinates_correct` | Fullscreen-koordinater er korrekte efter unifikation (pointer og entity matcher i fullscreen) |

## Must NOT
- Ikke blande koordinatsystemer mellem pointer og entity (det er hele pointen)
- Ikke bryde container mode
- Ikke introducere per-frame scroll-offset beregninger (Ward 26 håndterer scroll-pause)
- Ikke ændre Rust physics-kernelens interne koordinatlogik

## Must DO
- Dokumentér det valgte koordinatsystem i CONTEXT.md med rationale
- Gør pointer- og entity-positioner altid sammenlignelige uden ad-hoc offsets
- Håndter scroll offset korrekt i begge modes (via Ward 26 snap, ikke per-frame)
- Én `toPhysicsCoords()` utility der bruges konsistent
- Fjern alle ad-hoc offset-korrektioner og erstat med systematisk approach

## Verification
- Alle 4 tests består
- CONTEXT.md indeholder dokumenteret koordinatsystem-valg med rationale
- Manuelt: pointer-interaction virker korrekt i container mode efter scroll
- Manuelt: pointer-interaction virker korrekt i fullscreen mode efter scroll
- Code review: ingen steder i kodebasen blander to forskellige koordinatsystemer
