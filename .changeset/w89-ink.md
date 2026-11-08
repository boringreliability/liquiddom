---
"liquiddom": minor
---

Text dissolves like ink where two liquids meet. When one element's liquid mixes with another's (a drag into a neighbour, a merge), the text in the mixing zone softens into ink that drifts with the liquid, in both renderers, and is crisp again at rest. Under Canvas2D a mixing element's DOM text is hidden with `liquid-text` while the canvas draws it (it stays in the accessibility tree); the text atlas is built once two elements move. A splash, a shake or a drag without contact looks as before; reduced motion, print and forced colours show the DOM text as before.
