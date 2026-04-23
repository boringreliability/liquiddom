---
ward: 33
revision: null
name: "Dragable Cards Scene"
epic: "demo-scenes"
status: "complete"
dependencies: [30]
layer: "typescript"
estimated_tests: 1
created: "2026-04-22"
completed: "2026-04-23"
---
# Ward 033: Dragable Cards Scene

## Scope
Første demo-scene for LiquidDOM. Et grid af 6-9 kort der kan trækkes frit rundt med mus eller touch. Viser drag-inerti, bounce-back til original position, og soft body deformation under bevægelse. Hvert kort inkluderer en kort subtitle "drag me." for at guide brugeren. Placeres i `demo/scenes/dragable-cards.html` med tilhørende TypeScript-fil.

## Inputs
- Dragable Interaction Primitive fra Ward 30 (drag-enabled physics med inerti og bounce-back)
- LiquidDOM public API (`LiquidDOM.create()`, `observe()`, drag-konfiguration)
- Eksisterende build pipeline (TypeScript compilation, bundling)

## Outputs
- `demo/scenes/dragable-cards.html` — standalone HTML-side med canvas og DOM-kort
- `demo/scenes/dragable-cards.ts` — TypeScript der initialiserer LiquidDOM med drag-konfigurerede elementer
- Visuel reference-implementation af drag-interaktion til dokumentation og QA
- Template for fremtidige demo-scenes (fil-struktur og setup-pattern)

## Specification

### HTML Struktur (`dragable-cards.html`)
- Standalone HTML-side med `<canvas>` overlay og et grid af kort-elementer
- 6-9 `<div>` elementer med `data-liquid` attribut, stylet som kort (afrundede hjørner, skygge, baggrund)
- Hvert kort har en titel og subtekst "drag me."
- CSS Grid eller Flexbox layout til initial placering
- Responsiv: fungerer på desktop og tablet viewports

### TypeScript Setup (`dragable-cards.ts`)
- Importér LiquidDOM og opret instance med `LiquidDOM.create({ canvas, container })`
- Observe alle kort-elementer med drag-konfiguration fra Ward 30
- Konfigurer physics-parametre for visuelt tilfredsstillende drag-respons:
  - Inerti efter release (kort glider videre baseret på hastighed)
  - Bounce-back: kort returnerer til original grid-position via spring force
  - Soft body deformation: partikler deformerer under hurtig bevægelse

### Visuelle Krav
- Kort skal have tydelig visuel feedback under drag (f.eks. forhøjet skygge, subtle scale)
- Smooth inerti-animation efter release
- Bounce-back animation med synlig spring-oscillation (overshoot + settle)
- Deformation synlig ved hurtige drag-bevægelser
- Kort-grid gendannes visuelt efter bounce-back

### Instruktiv Tekst
- Kort heading/label per kort (f.eks. "Card 1", "Card 2", ...)
- Subtitle "drag me." på hvert kort i nedtonet farve
- Eventuelt en overordnet side-titel: "LiquidDOM — Dragable Cards"

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_scene_loads_without_errors` | Scene HTML loader og LiquidDOM initialiserer uden at kaste exceptions |

## Must NOT
- Ikke introducere nye physics features — brug udelukkende eksisterende drag primitive fra Ward 30
- Ikke kræve build-step ud over eksisterende pipeline (ingen nye dependencies)
- Ikke hardcoded canvas-størrelse (skal tilpasse sig container)
- Ikke bryde eksisterende demo-scenes eller library kode

## Must DO
- Opret `demo/scenes/dragable-cards.html` og `demo/scenes/dragable-cards.ts`
- Brug `LiquidDOM.create()` med drag-enabled elementer
- Visuel demonstration af drag, inerti og bounce-back
- Inkludér kort tekst der forklarer hvad der sker ("drag me.")
- Fungere uden server — åbnes direkte i browser efter build

## Verification
- 1 test består (scene loader uden fejl)
- Manuelt: åbn `dragable-cards.html` i browser, træk kort rundt
- Manuelt: bekræft inerti (kort glider efter release)
- Manuelt: bekræft bounce-back (kort returnerer til grid-position)
- Manuelt: bekræft soft body deformation ved hurtige bevægelser
