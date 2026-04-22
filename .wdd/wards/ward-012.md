---
ward: 12
revision: null
name: "Final Demo & API Wrapper"
epic: "theming-visuals"
status: "complete"
dependencies: [11]
layer: "typescript"
estimated_tests: 2
created: "2026-03-31"
completed: "2026-04-22"
---
# Ward 012: Final Demo & API Wrapper

## Scope
Public facade `LiquidDOM` med zero-config `init()`. Demo kogt ned til 2-3 linjer. Bibliotek klar til NPM.

## Inputs
- Integration Spec 3
- PhantomObserver + WASM LiquidCore

## Outputs
- `ts/src/index.ts` med `LiquidDOM` klasse
- Refaktoreret `demo/main.ts` (2-3 linjer)

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_liquiddom_init_creates_canvas` | init() injicerer canvas i document.body |
| 2 | `test_liquiddom_auto_observes_attributes` | [data-liquid] elementer overvåges automatisk |

## Must NOT
- Ingen Rust/WASM ændringer

## Must DO
- Canvas auto-injection
- Mouse listeners i init()
- Eksportér LiquidDOM for NPM bundling

## Verification
- Alle tests grønne
- Demo kører med ultra-kort setup
