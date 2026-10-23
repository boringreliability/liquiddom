---
"liquiddom": minor
---

Touch can drag. Hold an observed element for 350 ms and move: its liquid follows the finger and the page does not scroll; a quicker swipe still scrolls and a tap is still a click. While a finger holds a draggable element its long-press menu is suppressed and draggable elements get `-webkit-touch-callout: none`. The new element option `observe(el, { drag: false })` opts an element out of every drag (mouse, pen and touch) and keeps the browser's own long-press behaviour; like `viscosity` it is validated and read once. The pointer's idle velocity now fades per unit of time (0.8 per 1/60 s), so a 120 Hz display has the same tail as a 60 Hz one.
