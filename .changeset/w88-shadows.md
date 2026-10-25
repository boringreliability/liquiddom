---
"liquiddom": minor
---

Shadows follow the liquid. An observed element keeps its own CSS `box-shadow`: the browser draws it at rest, and while the element's liquid is away (a splash, a shake, a drag) liquiddom hides it with the new class `liquid-shadow-away` and draws up to four outer layers from the liquid's shape in both renderers, under all liquid, so a drop shadow sags with a splash and a glow wraps a merge. Inset shadows show at rest only. The shadow is re-read with the colours (the element's own class or style, `refresh(el)`) and when a `box-shadow` transition on it ends; an author `transition: box-shadow` does not fade the shadow when the liquid leaves or returns to rest. Previously liquiddom hid every observed element's box-shadow.
