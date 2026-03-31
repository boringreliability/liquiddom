---
ward: 10
revision: null
name: "Canvas Spline Renderer"
epic: "theming-visuals"
status: "complete"
dependencies: [8, 9]
layer: "typescript"
estimated_tests: 1
created: "2026-03-31"
completed: "2026-03-31"
---
# Ward 010: Canvas Spline Renderer

## Scope
Erstat kantet polygon-wireframe med blød spline-rendering. Lukket sti med fyldfarve → organisk "væske-blob".

## Inputs
- particleBuffer fra PhantomObserver (16 × (x,y))
- CanvasRenderingContext2D

## Outputs
- `render()` metode (omdøbt fra `debugRender`)
- Visuelt bløde blobs i stedet for wireframes

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `test_render_executes_without_errors` | render() med mocked canvas crasher ikke |
| - | Visuel Inspektion | Blød form uden skarpe hjørner, fyldt med farve |

## Must NOT
- Ingen eksterne libs (d3-shape, paper.js)

## Must DO
- Midpoint Quadratic Curve: `quadraticCurveTo` mellem midtpunkter
- `(i + 1) % numParticles` for at lukke stien

## Verification
- 1 automatiseret test grøn
- Visuel demo viser bløde blobs
