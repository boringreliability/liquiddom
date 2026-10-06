---
"liquiddom": minor
---

Fluid engine, slice 2: a soft pointer field (the liquid follows the pointer's motion with no holes), a 2 % hover swell (focus has no swell), `setMaterial()` / `getMaterial()`, and material `presets` (`water`, `honey`, `jelly`).

`presets` changed shape: it now holds material presets `{ viscosity, cohesion, recovery }` instead of the 0.2 physics presets (`goo`, `jelly`, `firm` with `tension`, `damping`, `repulsionRadius`, …). Under reduced motion, pointer, hover, splash and shake are ignored (`splash()`/`shake()` still validate their arguments).
