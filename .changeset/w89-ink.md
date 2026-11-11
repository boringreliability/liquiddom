---
"liquiddom": minor
---

Text dissolves like ink where two liquids meet. When one element's liquid mixes with another's (a drag into a neighbour, a merge), the text in the mixing zone softens into ink that drifts with the liquid, in both renderers, and is crisp again at rest. Under Canvas2D a mixing element's DOM text is hidden with `liquid-text` while the canvas draws it (it stays in the accessibility tree); the text atlas is built once two elements move. A splash, a shake or a drag without contact looks as before (a shake that brings close neighbours into contact does ink where they mix); where the GPU supports `float32-blendable`, WebGPU requests it for the ink's mixing sums; reduced motion, print and forced colours show the DOM text as before.
