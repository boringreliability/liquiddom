---
ward: 34
revision: null
name: "Scroll-Responsive Hero Scene"
epic: "demo-scenes"
status: "planned"
dependencies: [26]
layer: "typescript"
estimated_tests: 1
created: "2026-04-22"
completed: null
---
# Ward 034: Scroll-Responsive Hero Scene

## Scope
Hero-sektion demo-scene med 3-5 store elementer der "ånder" (subtil oscillation/pulsering) når scroll stopper. Demonstrerer Ward 26 scroll-aware physics: under scroll pauses physics, og når scroll settles, snapper elementerne til nye positioner og genoptager organisk bevægelse. Placeres i `demo/scenes/scroll-hero.html` med tilhørende TypeScript-fil.

## Inputs
- Scroll-Aware Base Position fra Ward 26 (`ScrollGuard`, scroll-pause, idle snap)
- LiquidDOM public API (`LiquidDOM.create()`, `observe()`)
- Eksisterende build pipeline

## Outputs
- `demo/scenes/scroll-hero.html` — scrollbar side med hero-sektion og liquid-elementer
- `demo/scenes/scroll-hero.ts` — TypeScript der initialiserer LiquidDOM med scroll-aware config
- Visuel reference-implementation af scroll-responsive physics til dokumentation og QA

## Specification

### HTML Struktur (`scroll-hero.html`)
- Lang side med nok indhold til at scrolle (mindst 200vh)
- Hero-sektion med 3-5 store `<div>` elementer med `data-liquid` attribut
- Elementer stylet som store, visuelt fremtrædende blokke (hero cards, feature panels, eller abstract shapes)
- Indhold over og under hero-sektionen for at muliggøre scroll forbi
- Neutral baggrund der lader liquid-effekten stå frem

### TypeScript Setup (`scroll-hero.ts`)
- Importér LiquidDOM og opret instance med scroll-aware konfiguration
- Observe hero-elementer med `data-liquid` attribut
- Ward 26 ScrollGuard aktiveres automatisk — physics pauser under scroll
- Physics-parametre tunet til "breathing" effekt:
  - Lav tension for langsom, organisk oscillation
  - Lav damping for vedvarende, subtil bevægelse
  - Resultatet: elementer pulserer/ånder roligt når scroll er stoppet

### Scroll Behavior
- Under aktiv scroll: elementer renderes statisk (ingen physics jank)
- Når scroll stopper (100ms idle): `base_pos` snappes til nye viewport-positioner
- Physics genoptages og elementer "vågner" med en smooth breathing-animation
- Gentages ved hver scroll-stop — elementer ånder når de er synlige og stationære

### Visuelle Krav
- 3-5 store elementer (mindst 200x200px) med tydelig visual identity
- "Breathing" effekt synlig som subtil størrelse-oscillation eller position-drift
- Ingen visuel glitch under scroll (physics er pauset, rendering viser cached state)
- Smooth transition fra statisk til animeret ved scroll-stop
- Elementer skal rendere korrekt selv uden scroll (initial load viser breathing)

### Instruktiv Tekst
- Side-titel: f.eks. "LiquidDOM — Scroll-Responsive Hero"
- Kort instruktion: "Scroll to see elements respond" eller tilsvarende
- Eventuelt label per hero-element for visuel identitet

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_scene_loads_without_errors` | Scene HTML loader og LiquidDOM initialiserer uden at kaste exceptions |

## Must NOT
- Ikke introducere nye physics features — brug udelukkende Ward 26 scroll-aware base position
- Ikke kræve at siden scrolles for at elementer renderes (elementer skal vises og ånde ved initial load)
- Ikke bryde eksisterende demo-scenes eller library kode
- Ikke hardcode viewport-størrelser (responsive layout)

## Must DO
- Opret `demo/scenes/scroll-hero.html` og `demo/scenes/scroll-hero.ts`
- Brug Ward 26 scroll-aware base position (ScrollGuard)
- 3-5 store hero-elementer med `data-liquid` attribut
- Visuel "breathing" effekt når scroll settles
- Fungere ved initial page load uden scroll (elementer render og animerer)
- Fungere uden server — åbnes direkte i browser efter build

## Verification
- 1 test består (scene loader uden fejl)
- Manuelt: åbn `scroll-hero.html` i browser — elementer ånder ved load
- Manuelt: scroll ned og stop — elementer snapper og begynder at ånde igen
- Manuelt: hurtig scroll — ingen partikel-eksplosion eller visuel glitch
- Manuelt: elementer synlige og animerede uden at scrolle (initial render)
