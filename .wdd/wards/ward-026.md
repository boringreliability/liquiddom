---
ward: 26
revision: null
name: "Scroll-Aware Base Position"
epic: "real-world-illusion"
status: "planned"
dependencies: [23]
layer: "typescript"
estimated_tests: 3
created: "2026-04-22"
completed: null
---
# Ward 026: Scroll-Aware Base Position

## Scope
Detect scroll via `scroll` event med rAF-throttling. Mens scroll er aktiv, pause physics substeps (men fortsæt rendering af sidste state så billedet ikke fryser visuelt). Når scroll stopper i 100ms (idle timeout), snap alle `base_pos` til nye `getBoundingClientRect()` værdier og genoptag physics. Dette forhindrer partikel-eksplosion ved hurtig scroll, hvor DOM-elementers viewport-position ændrer sig hurtigere end physics kan følge med.

## Inputs
- Configurable physics fra Ward 23 (substeps, tension/damping der bruges ved genoptagelse)
- Entity buffer med `base_pos` per partikel (eksisterende physics pipeline)
- `getBoundingClientRect()` på observerede DOM-elementer

## Outputs
- `ScrollGuard` modul der håndterer scroll-detection og physics-pause
- `isScrolling: boolean` flag tilgængeligt for physics loop
- Snap-mekanisme der opdaterer `base_pos` i entity buffer efter scroll-stop
- Bruges af Ward 027 (koordinatsystem-unifikation bygger videre på korrekt scroll-håndtering)

## Specification

### Scroll Detection (rAF-throttled)
- Lyt på `scroll` event på `window` (capture phase for at fange alle scroll-containers)
- Throttle via `requestAnimationFrame` — kun én handling per frame uanset antal scroll events
- Ved scroll event: sæt `isScrolling = true` og reset idle timer

### Physics Pause
- Når `isScrolling === true`, skip physics substep-beregning i animation loop
- Fortsæt canvas rendering med sidste kendte partikel-positioner (visuelt statisk, ingen flicker)
- Pointer-interaction kan også pauses under scroll for at undgå stale hit-tests

### Idle Timeout og Snap
- Start en 100ms `setTimeout` ved hvert scroll event (clear previous timer)
- Når timer udløber uden nye scroll events:
  1. Sæt `isScrolling = false`
  2. Kald `getBoundingClientRect()` på alle observerede elementer
  3. Opdater `base_pos` i entity buffer til nye rect-positioner
  4. Genoptag physics — eksisterende spring-tension trækker partikler til nye positioner (smooth convergence)

### Container vs Fullscreen Mode
- I container mode: lyt også på scroll events på container-elementet
- I fullscreen mode: `window` scroll er tilstrækkeligt
- Begge modes bruger samme snap-logik

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_scroll_pauses_physics` | Aktivt scroll event sætter `isScrolling = true` og physics tick udfører ingen substeps |
| 2 | `test_scroll_end_triggers_snap` | 100ms efter sidste scroll event, snapper `base_pos` til nye `getBoundingClientRect()` værdier |
| 3 | `test_particles_converge_after_snap` | Efter snap genoptages physics og partikler konvergerer smooth mod nye positioner via spring forces |

## Must NOT
- Ikke bryde eksisterende non-scroll behavior (statiske sider skal fungere uændret)
- Ikke introducere jank under scroll (rendering fortsætter med cached state)
- Ikke lade physics køre med stale positioner under hurtig scroll
- Ikke blokere main thread med synkrone layout-reads under scroll

## Must DO
- rAF-throttled scroll detection for at undgå performance-overhead
- 100ms idle timeout før snap (konfigurerbar via intern konstant)
- Smooth snap via eksisterende physics convergence (ingen teleportering)
- Fungere i både container mode og fullscreen mode
- Cleanup: fjern scroll listeners ved `destroy()`

## Verification
- Alle 3 tests består
- Manuelt: scroll hurtigt på en side med liquid-elementer — ingen partikel-eksplosion
- Manuelt: stop scroll — partikler glider smooth til nye positioner
- Performance: ingen målbar fps-drop under scroll sammenlignet med uden Ward 026
