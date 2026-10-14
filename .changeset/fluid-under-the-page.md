---
"liquiddom": minor
---

The liquid goes under the page. The liquid canvas now sits at `z-index: -1`, so splashed or shaken liquid passes under the page's own text and boxes instead of over them, and observed elements no longer get `position: relative; z-index: 1` (their author dropdowns and overlays now show above them). If the page cannot take the canvas underneath — `<html>` and `<body>` both have a background, a wrapper or `<main>` around an observed element has an opaque background, or the `container` is not a stacking context (give it `isolation: isolate`) — liquiddom logs one `console.warn` naming the element (or, for a container, the fix) and keeps the previous behaviour (`z-index: 0`) for that instance. Under a shake, an element close to a window edge now sloshes inward instead of being cut off at the edge. The Canvas2D renderer draws a smoother edge while the liquid moves on pages with large elements (at some extra render cost there).
