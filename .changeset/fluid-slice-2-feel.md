---
"liquiddom": patch
---

Slice-2 feel fixes: `shake()` now sets every element sloshing (a spatially coherent wave per element instead of per-particle noise, and elements go softer during a shake), the pointer field drags the liquid twice as strongly so the bulge along a sweep is readable, and the Canvas2D renderer no longer flashes a pale, translucent fill while an element fades back to rest.
