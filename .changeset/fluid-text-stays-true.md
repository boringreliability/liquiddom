---
"liquiddom": minor
---

Liquid text stays true to the page. A change to an observed element's text, its own `class` or `style`, a web font that finishes loading, or a zoom/DPR change re-renders the element's liquid text on the next frame, and colour changes through the element's `class`/`style` or a `color`/`background-color` transition are picked up without calling `refresh(el)`. With forced colours or print the real DOM text shows at once, also mid-splash. In the Canvas2D renderer a moving element's DOM text gets a soft halo in the element's own background colour so it stays readable while its liquid is away.
