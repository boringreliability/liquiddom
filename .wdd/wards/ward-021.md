---
ward: 21
revision: null
name: "Dynamic Observation Strategy"
epic: "library-maturity"
status: "planned"
dependencies: [13]
layer: "typescript"
estimated_tests: 3
created: "2026-03-31"
completed: null
---
# Ward 021: Dynamic Observation Strategy

## Scope
Optional MutationObserver-baseret auto-discovery af `[data-liquid]` elementer, så nye elementer automatisk observeres uden eksplicit API-kald. Explicit API forbliver primær — observer er opt-in convenience. Fjernede DOM-noder ryddes sikkert op for at undgå memory leaks og stale references.

## Inputs
- Instance-based runtime API fra Ward 13 (`LiquidInstance` med `observe()`/`unobserve()` metoder)

## Outputs
- `autoDiscover(root?: Element)` metode på `LiquidInstance` der starter MutationObserver
- `stopAutoDiscover()` metode der disconnecter observer
- Cleanup-logik for fjernede noder (fjern fra entity buffer, stop animation)
- Bruges af Ward 023 (runtime config kan slå auto-discover til/fra)

## Specification

### MutationObserver Setup
- `autoDiscover(root)` opretter en `MutationObserver` på `root` (default `document.body`)
- Observer konfigureres med `{ childList: true, subtree: true }`
- Ved `addedNodes`: find alle elementer med `[data-liquid]` attribut, kald `observe()` på dem
- Ved `removedNodes`: find alle elementer med `[data-liquid]` attribut, kald `unobserve()` og ryd op

### Cleanup ved Removal
- Fjern element fra intern entity map
- Frigiv entity slot i buffer (marker som ledig for genbrug)
- Stop eventuelle animations/timers bundet til elementet

### Explicit API Independence
- `observe()` og `unobserve()` skal fungere uafhængigt af om MutationObserver kører
- Hvis et element allerede er observed manuelt, skal observer ikke duplikere det
- Intern `Set<Element>` tracker alle observerede elementer uanset kilde

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_dynamically_added_element_gets_observed` | Et element indsat i DOM med `[data-liquid]` bliver automatisk observeret af autoDiscover |
| 2 | `test_removed_element_cleaned_up` | Et fjernet `[data-liquid]` element frigiver sin entity slot og fjernes fra intern tracking |
| 3 | `test_explicit_api_works_independently` | `observe()` og `unobserve()` fungerer korrekt uden at autoDiscover er aktiveret |

## Must NOT
- Ikke gøre MutationObserver obligatorisk — explicit API er primær
- Ikke observere elementer uden `[data-liquid]` attribut
- Ikke lade fjernede elementer efterlade stale references i entity buffer
- Ikke duplikere observation af allerede-observerede elementer

## Must DO
- Brug `MutationObserver` med `childList: true, subtree: true`
- Track observerede elementer i en `Set<Element>` for dedup
- Ryd op ved element-fjernelse: buffer slot, animation, event listeners
- `stopAutoDiscover()` skal disconnecte observer og returnere cleanly

## Verification
- Alle 3 tests består
- Manuelt: indsæt `[data-liquid]` element dynamisk og bekræft at det animerer
- Manuelt: fjern element og bekræft at der ingen memory leaks er (entity count falder)
