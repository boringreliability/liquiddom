---
ward: 30
revision: null
name: "Dragable Interaction Primitive"
epic: "interaction-primitives"
status: "complete"
dependencies: [13, 19, 29]
layer: "both"
estimated_tests: 4
created: "2026-04-22"
completed: "2026-04-23"
---
# Ward 030: Dragable Interaction Primitive

## Scope
Implementér Dragged-strategien som første rigtige interaction primitive. TS-side: `pointerdown` på et `[data-liquid]` element sætter `liquid_type` til `Dragged` i bufferen, `pointermove` opdaterer drag-pointer position, og `pointerup`/`pointercancel` nulstiller til Default. Rust-side: Dragged-strategien sætter centroid target til drag-pointer position i stedet for `base_pos` — resten af physics (neighbor springs, area preservation) kører normalt. Dette giver naturlig inerti og bounce-back når draget slippes.

## Inputs
- PhysicsStrategy dispatch fra Ward 29 (Dragged variant og strategi-funktion signatur)
- Entity buffer layout med `liquid_type` felt
- Centroid anchoring fra Ward 22 (centroid target position)
- LiquidInstance API fra Ward 13 (event binding på observerede elementer)

## Outputs
- Dragged PhysicsStrategy implementering i Rust
- Pointer event handlers på TS-side der styrer liquid_type og drag-position
- Multi-touch support via `pointerId` tracking
- Bruges af fremtidige wards der bygger på drag (e.g. drag-to-reorder, swipe gestures)

## Specification

### TypeScript — Pointer Event Handling
- Ved `observe()`: tilføj `pointerdown` listener på elementet
- `pointerdown`:
  - Gem `pointerId` i intern `Map<number, { element, startPos }>`
  - Sæt `liquid_type` til `3.0` (Dragged) i entity buffer
  - Skriv pointer-position til dedikerede buffer-felter (drag_target_x, drag_target_y)
  - Kald `element.setPointerCapture(pointerId)` for reliable tracking
- `pointermove`:
  - Opdatér drag_target_x/y i buffer med pointer-position (clientX/Y relativt til canvas/viewport)
  - Kun for aktive pointerId'er i tracking map
- `pointerup` / `pointercancel`:
  - Nulstil `liquid_type` til `0.0` (Default) i buffer
  - Fjern pointerId fra tracking map
  - Kald `element.releasePointerCapture(pointerId)`

### Drag Position i Buffer
- Drag target position skrives til buffer-felter der læses af Rust
- Brug eksisterende reserverede felter eller tilføj 2 ekstra floats til entity layout (drag_target_x, drag_target_y)
- Når liquid_type != Dragged ignoreres disse felter

### Rust — Dragged Strategy
```rust
fn strategy_dragged(
    particles: &mut [Particle],
    config: &PhysicsConfig,
    base_pos: (f32, f32),
    drag_target: (f32, f32),
    dt: f32,
    substeps: u32,
) {
    // Identisk med strategy_default UNDTAGEN:
    // centroid_target = drag_target i stedet for base_pos
    // Neighbor springs, area preservation, damping kører normalt
}
```
- Centroid anchoring kraft peger mod `drag_target` i stedet for `base_pos`
- Alle andre kræfter (neighbor springs, shape preservation) er uændrede
- Når pointer slippes og liquid_type skifter til Default, snapper centroid target tilbage til base_pos — physics-systemet håndterer den naturlige bounce-back

### Multi-Touch
- Hver `pointerId` trackes separat i `Map<number, DragState>`
- Hvert element kan kun dragges af ét pointerId ad gangen (first-come)
- Forskellige elementer kan dragges simultant af forskellige pointers

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_pointerdown_activates_dragged` | pointerdown sætter liquid_type til 3.0 (Dragged) i entity buffer |
| 2 | `test_drag_follows_pointer_with_lag` | Under drag følger entity pointer-position med physics lag — position nærmer sig drag_target men matcher ikke eksakt |
| 3 | `test_pointerup_triggers_bounceback` | pointerup nulstiller liquid_type til 0.0 (Default) og entity returnerer til base_pos via physics |
| 4 | `test_multitouch_via_pointer_id` | Flere samtidige drags tracked via pointerId — hvert element har sin egen drag-state |

## Must NOT
- Ikke bypass physics under drag — brug centroid targeting, ikke direkte position-sæt
- Ikke bryde andre interaction states (hover, focus events skal stadig fungere)
- Ikke antage single-touch — track via pointerId
- Ikke lade drag-state hænge ved manglende pointerup (håndtér pointercancel)

## Must DO
- Sæt liquid_type i buffer via TS pointer event handlers
- Læs liquid_type i Rust tick dispatch og kald strategy_dragged
- Dragged strategi targetter drag-position som centroid i stedet for base_pos
- Ryd pointer state op ved pointerup og pointercancel
- Brug setPointerCapture for reliable pointermove tracking
- Multi-touch support via pointerId tracking map

## Verification
- Alle 4 tests består (TS unit tests for pointer handling + Rust tests for strategy_dragged)
- `cargo test` og `npm test` består
- Demo: drag et [data-liquid] element — det følger fingeren med fluid physics og bouncer tilbage ved slip
- Multi-touch: drag to elementer simultant på touch-device
