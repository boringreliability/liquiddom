---
ward: 32
revision: null
name: "Position Tween Primitive"
epic: "interaction-primitives"
status: "planned"
dependencies: [13, 29]
layer: "both"
estimated_tests: 3
created: "2026-04-22"
completed: null
---
# Ward 032: Position Tween Primitive

## Scope
Tween-strategi der bevæger `base_pos` mellem to punkter over tid mens physics kører ovenpå. Use case: liquid tabs/nav hvor elementer morfer mellem positioner. API: `instance.tween(element, { toX, toY, duration, easing })`. Under tween kører nuværende physics på den animerede `base_pos`, så partiklerne oplever smooth bevægelse med spring-respons ovenpå. Når tween er fuldført, returneres til Default strategy og `base_pos` forbliver på slutpositionen.

## Inputs
- Liquid Type Dispatch Architecture fra Ward 29 (strategy-baseret type dispatch der muliggør tween som en strategi)
- Entity buffer med `base_pos` per partikel (eksisterende physics pipeline)
- Eksisterende animation loop med `dt` per frame

## Outputs
- `instance.tween(element, opts)` metode på public API
- `TweenStrategy` der implementerer strategy-interfacet fra Ward 29
- Tween-state per element: `startPos`, `endPos`, `elapsed`, `duration`, `easingFn`
- Cancel-mekanisme: `instance.cancelTween(element)` eller nyt tween-kald overskriver eksisterende
- Bruges af demo-scenes og fremtidige interaction primitives der kræver animeret repositionering

## Specification

### Tween API
- `instance.tween(element, { toX, toY, duration, easing? })` starter en tween
- `toX`/`toY` er target `base_pos` i canvas-koordinater
- `duration` er i millisekunder
- `easing` er valgfri, default `"linear"`. Understøtter mindst `"linear"` og `"ease-out"`
- Returnerer et `TweenHandle` med `cancel()` metode
- Hvis element allerede har en aktiv tween, erstattes den (nyt startpunkt = nuværende interpolerede position)

### TweenStrategy (Ward 29 integration)
- Implementerer strategy-interfacet fra Ward 29's type dispatch
- Registreres som strategy for elementet når tween startes
- Hver frame: beregn interpoleret `base_pos` baseret på `elapsed / duration` og easing-funktion
- Opdater `base_pos` i entity buffer med interpoleret værdi
- Physics substeps kører derefter normalt med den opdaterede `base_pos` — spring forces beregnes relativt til den tweenede position

### Easing Functions
- `linear(t)`: returnerer `t` direkte
- `ease-out(t)`: `1 - (1 - t)^2` (quadratic ease-out, decelererende kurve)
- Easing-funktioner tager `t` i `[0, 1]` og returnerer `[0, 1]`
- Extensible: intern map fra string til easing-funktion, kan udvides i fremtidige wards

### Tween Lifecycle
1. **Start**: gem `startPos` (nuværende `base_pos`), `endPos` (`toX`/`toY`), `elapsed = 0`, vælg easing
2. **Tick**: `elapsed += dt`, beregn `t = clamp(elapsed / duration, 0, 1)`, anvend easing, interpoler `base_pos`
3. **Complete**: når `t >= 1`, sæt `base_pos = endPos`, skift tilbage til Default strategy
4. **Cancel**: sæt `base_pos` til nuværende interpolerede position, skift til Default strategy

### Physics Interaction under Tween
- Physics kører normalt — spring forces trækker partikler mod den animerede `base_pos`
- Resultatet er at partikler følger tween-banen med en organisk, fjedrende bevægelse
- Main loop blokeres IKKE — tween er en per-frame `base_pos` update, ikke en blocking animation

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_tween_interpolates_base_pos` | `base_pos` bevæger sig fra startposition til slutposition over den angivne duration |
| 2 | `test_easing_functions_work` | Linear og ease-out producerer forskellige mellempositioner ved samme `t`-værdi |
| 3 | `test_physics_respects_tween_base_pos` | Physics beregner forces relativt til den tweenede `base_pos` hver frame (spring force ændrer sig med tween) |

## Must NOT
- Ikke erstatte physics under tween — physics kører ovenpå den animerede `base_pos`
- Ikke blokere main loop under tween (ingen `await sleep()` eller blocking animation)
- Ikke efterlade stale tween-state når tween er complete eller cancelled
- Ikke mutere `endPos` under aktiv tween (immutable target)

## Must DO
- Eksponere `instance.tween()` på public API
- Understøtte mindst `linear` og `ease-out` easing
- Returnere til Default strategy når tween er fuldført
- Tillade cancellation af igangværende tween via `cancel()` på TweenHandle
- Håndtere overlappende tweens (nyt kald erstatter eksisterende, brug nuværende position som nyt startpunkt)
- Clamp `t` til `[0, 1]` for at undgå overshoot i easing

## Verification
- Alle 3 tests består
- Manuelt: kald `tween()` på et element og bekræft at det glider smooth til ny position
- Manuelt: bekræft at physics-respons (wobble/spring) er synlig under tween-bevægelse
- Manuelt: cancel en tween midtvejs og bekræft at elementet forbliver på sin nuværende position
