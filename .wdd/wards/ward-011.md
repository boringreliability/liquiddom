---
ward: 11
revision: null
name: "The Illusion & Interaction State"
epic: "theming-visuals"
status: "complete"
dependencies: [10]
layer: "typescript"
estimated_tests: 2
created: "2026-03-31"
completed: "2026-03-31"
---
# Ward 011: The Illusion & Interaction State

## Scope
Canvas bag DOM-elementer som ægte baggrund. Hover-events binder til interaction_state (index 4) i buffer. Visuel feedback på hover via farveskift.

## Inputs
- PhantomObserver + render()
- [data-liquid] HTML elementer

## Outputs
- Canvas z-index: -1, DOM-elementer transparente
- Hover tracking via WeakMap + mouseenter/mouseleave
- sync() skriver interaction_state, render() reagerer visuelt

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_hover_updates_interaction_state` | mouseenter → index 4 = 1.0 efter sync() |
| 2 | `test_mouseleave_resets_interaction_state` | mouseleave → index 4 = 0.0 efter sync() |

## Must NOT
- Ingen Rust-ændringer (bruger eksisterende interaction_state felt fra Ward 1)

## Must DO
- Event listener cleanup i unobserve()
- WeakMap til hover-state

## Verification
- 2 automatiserede tests grønne
- Visuel: canvas bag DOM, hover giver farveskift
