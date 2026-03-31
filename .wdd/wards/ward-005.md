---
ward: 5
revision: null
name: "Visual FFI Proof"
epic: "state-ffi"
status: "gold"
dependencies: [4]
layer: "both"
estimated_tests: 0
created: "2026-03-31"
completed: null
---
# Ward 005: Visual FFI Proof

## Scope
Minimal Vanilla TS/HTML demo der visuelt beviser at FFI-broen (Ward 4) og PhantomObserver (Ward 3) fungerer i realtid ved 60+ FPS. Ingen ny kerne-logik.

## Inputs
- WASM modul (wasm-pack build)
- PhantomObserver med debugRender()

## Outputs
- Vite dev-server opsætning
- `demo/index.html` med test-elementer + fullscreen canvas
- `demo/main.ts` med RAF loop

## Specification
- 3-4 HTML-elementer (buttons, cards), mindst ét animeret
- Fullscreen `<canvas>` med `pointer-events: none`, `z-index: 9999`
- RAF loop: clearRect → sync() → debugRender(ctx)

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| - | Visuel Inspektion | Røde debug-kasser følger DOM-elementer 1:1 |

Note: 0 automatiserede tests. Verifikation er 100% visuel (Human Gate).

## Must NOT
- Ingen fysikberegninger
- Ingen UI frameworks
- Ingen tests til demo-mappen

## Must DO
- wasm-pack build --target web før dev-server
- Vite konfigureret til .wasm serving

## Verification (Human Gate)
- `npm run dev` → browser → røde debug-bokse ligger præcis ovenpå HTML-elementer og følger animation
