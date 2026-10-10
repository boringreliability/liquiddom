---
"liquiddom": patch
---

Liquid text under WebGPU: while an element splashes, shakes or bulges, its text now stretches and tears with its own liquid, and at rest the real DOM text returns. The DOM text is hidden only while the liquid text stands in for it (never under Canvas2D, reduced motion, after a lost device or when the text atlas cannot be built). A splash or shake no longer leaves a pale outline of the element inside the hole.
