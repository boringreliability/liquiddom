---
"liquiddom": minor
---

Scroll follows. The liquid now moves with the page when it scrolls: every frame the scroll delta shifts the liquid rigidly with its elements, so scrolling no longer sets it sloshing or tears it, and a light, capped share of the scroll speed lets it lag a little and settle back. In container mode the liquid follows the container's own scroll and the canvas stays on the container's visible area (a `transform` on liquiddom's canvas only; the container is never restyled). Elements that do not move with the page (`position: fixed`, or `sticky` while stuck) keep their liquid in place. A drag survives a scroll: the dragged liquid stays under the pointer. Under reduced motion the liquid follows the scroll with no inertia.
