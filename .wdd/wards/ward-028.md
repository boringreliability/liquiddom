---
ward: 28
revision: null
name: "Transparent Background Compatibility"
epic: "real-world-illusion"
status: "complete"
dependencies: [18, 23]
layer: "typescript"
estimated_tests: 2
created: "2026-04-22"
completed: "2026-04-23"
---
# Ward 028: Transparent Background Compatibility

## Scope
Undersøg og dokumentér hvordan CSS `box-shadow`, `gradient` og `backdrop-filter` interagerer med canvas-bag-DOM arkitekturen i LiquidDOM. Tilføj en optional `preserveBackgrounds: boolean` config der, hvis `true`, clipper canvas-rendering til ikke at overlappe med originale element-baggrunde. Acceptér trade-offs ærligt — hvis fuld kompatibilitet ikke er muligt, dokumentér begrænsningerne i stedet for at hacke en halv løsning.

## Inputs
- Configurable runtime options fra Ward 23 (`LiquidConfig` interface)
- Eksisterende canvas rendering pipeline (canvas placeret bag DOM-elementer)
- DOM-elementers computed styles (`getComputedStyle`)

## Outputs
- `preserveBackgrounds` config option tilføjet til `LiquidConfig`
- Dokumentation af CSS-interaktioner (i kode-kommentarer og/eller CONTEXT.md)
- Clipping-logik i canvas renderer (når `preserveBackgrounds: true`)
- Ærlig trade-off dokumentation for edge cases der ikke kan løses

## Specification

### CSS Interaktions-Research
Dokumentér findings for hver CSS feature:

- **`box-shadow`**: Shadow renders udenfor element-rect. Canvas-partikler bag elementet kan overlappe med shadow. Undersøg om shadow forbliver synlig med transparent canvas-baggrund.
- **`background: linear-gradient()`**: Element-baggrund renderes af browser oven på canvas. Undersøg z-index interaktion og om gradient forbliver intakt.
- **`backdrop-filter`**: Filteret appliceres på alt bag elementet inkl. canvas. Undersøg om partikel-rendering forvrænges af blur/saturate og om det er ønskeligt.

### preserveBackgrounds Config
```typescript
interface LiquidConfig {
  // ... eksisterende felter fra Ward 23
  preserveBackgrounds?: boolean; // default: false
}
```

- **`false` (default)**: Ingen ændring i rendering. Canvas tegner partikler under hele element-arealet. Eksisterende behavior bevares.
- **`true`**: Canvas renderer clipper partikel-tegning til områder udenfor elementets `getBoundingClientRect()`. Partikler der "siver ud" fra kanten er synlige, men partikler under selve elementet tegnes ikke.

### Clipping Implementation
- Når `preserveBackgrounds: true`:
  1. Før entity-rendering: opret clip path der excluder element-recten
  2. `ctx.save()` → definér clip region → tegn partikler → `ctx.restore()`
  3. Clip path er rektangulær (matche element rect) — border-radius ignoreres i v1
- Performance: clip path opdateres kun ved resize/scroll-snap, ikke per frame

### Trade-Off Dokumentation
- `backdrop-filter` + partikler: partiklerne VIL blive påvirket af filteret — dette er en browser-begrænsning og kan ikke undgås uden at flytte canvas over DOM (hvilket bryder den grundlæggende arkitektur)
- `box-shadow` + clip: shadow kan blive delvist klippet — dokumentér som known limitation
- Ærligt statement i docs: "preserveBackgrounds er best-effort og dækker rektangulære elementer. Komplekse CSS layouts kan give uventede resultater."

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_preserve_backgrounds_false_default` | Default config har `preserveBackgrounds === false` (eller undefined) og rendering-behavior er uændret |
| 2 | `test_preserve_backgrounds_true_respected` | Config option `preserveBackgrounds: true` accepteres, valideres og gemmes korrekt i runtime config |

## Must NOT
- Ikke bryde eksisterende transparent-element rendering (default behavior uændret)
- Ikke tvinge `preserveBackgrounds` til `true` som default
- Ikke hacke en ufuldstændig løsning uden at dokumentere begrænsninger
- Ikke ændre DOM-strukturen (canvas skal forblive bag DOM-elementer)

## Must DO
- Dokumentér CSS interaktions-findings (box-shadow, gradient, backdrop-filter)
- Tilføj `preserveBackgrounds` config option med `false` som default
- Implementér rektangulær clipping når option er `true`
- Acceptér og dokumentér trade-offs ærligt — ingen magic bullets
- Config-validering: `preserveBackgrounds` skal være boolean hvis angivet

## Verification
- Begge tests består
- CSS interaktions-findings er dokumenteret i kodebase
- Manuelt: element med `box-shadow` + `preserveBackgrounds: false` — partikler synlige bag shadow (eksisterende behavior)
- Manuelt: element med solid baggrund + `preserveBackgrounds: true` — partikler clippes under elementet, synlige kun ved kanterne
- Trade-off dokumentation er til stede og ærlig
