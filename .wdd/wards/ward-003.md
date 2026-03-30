---
ward: 3
revision: null
name: "Phantom DOM Observer"
epic: "state-ffi"
status: "complete"
dependencies: []
layer: "typescript"
estimated_tests: 5
created: "2026-03-30"
completed: "2026-03-30"
---
# Ward 003: Phantom DOM Observer

## Scope
PhantomObserver i TypeScript — overvåger HTML-elementer, udtrækker BoundingClientRect og synkroniserer til et fladt Float32Array. Bindeleddet mellem DOM og fremtidig WASM-hukommelse.

## Inputs
HTML-elementer, DOM API'er (ResizeObserver, getBoundingClientRect).

## Outputs
- `PhantomObserver` klasse med internt Float32Array
- Intern mapping mellem elementer og buffer-indices (WeakMap)
- Bruges af Ward 4 (FFI Integration)

## Specification

### Data Layout (matcher Ward 1)
8 floats per element: [x, y, w, h, interaction_state, liquid_type, custom, reserved]

### API
- `constructor(capacity: number)` — allokerer Float32Array
- `getBuffer(): Float32Array` — returnerer underliggende buffer
- `observe(el: HTMLElement, liquidType?: number): number` — tilføj element, returner ID
- `unobserve(el: HTMLElement): void` — fjern element, frigiv ID
- `sync(): void` — genberegn alle positioner

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_initializes_with_correct_capacity` | Float32Array på 80 for capacity 10 |
| 2 | `test_observe_assigns_ids_and_writes_rect` | ID 0,1,2... og korrekt x,y,w,h i buffer |
| 3 | `test_sync_updates_moved_elements` | Ændret rect + sync() opdaterer buffer |
| 4 | `test_unobserve_frees_id_for_reuse` | Frigivet ID genbruges ved næste observe |
| 5 | `test_capacity_limit_throws` | Overskredet kapacitet kaster fejl |

## Must NOT
- Ingen WASM imports
- Ingen rendering/canvas
- Intet framework (kun Vanilla TS)

## Must DO
- Vitest test-miljø med mock HTMLElement
- `FLOATS_PER_ENTITY = 8` som konstant
- TypeScript strict mode

## Verification
- Alle 5 TS tests grønne
- Typer korrekte i strict mode
