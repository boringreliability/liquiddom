---
"liquiddom": minor
---

Drag the liquid. A mouse or pen press on an observed element that moves more than 4 px now drags the element's liquid, never the DOM element: the liquid softens and follows the pointer, and on release it crawls back home and re-forms. The click that ends a drag no longer splashes or activates the element; a press that does not move stays a normal click. Escape, losing window focus, a cancelled pointer, `unobserve()`, `destroy()` and reduced motion cancel the drag. Under WebGPU the label rides on the liquid; under Canvas2D the element's DOM text is hidden (`-webkit-text-fill-color` via the new class `liquid-away`) until the liquid is back at rest. Touch and keyboard never drag. Mouse text selection that starts inside an observed element is no longer possible.
