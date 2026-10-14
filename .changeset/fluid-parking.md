---
"liquiddom": minor
---

Parking and resize. Elements far outside the viewport (beyond the liquid's world plus a margin) are parked: their liquid is not simulated, which makes long pages cheaper, and when they scroll back into view they are at rest at once. When the window (or the container) grows beyond the area the liquid was set up for, the liquid's grid grows, with one `console.info` per growth; it never shrinks. In container mode the liquid's world is the container's visible box. The Canvas2D renderer no longer draws the liquid of an element that is hidden (`display: none`) while it moves.
