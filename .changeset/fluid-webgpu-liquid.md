---
"liquiddom": patch
---

`renderer: 'webgpu'` now draws the liquid: instanced particle splats thresholded into a smooth silhouette, blended colour where elements meet, and a crisp rounded-rect contour at rest. Translucent element backgrounds keep their alpha. `'auto'` still uses Canvas2D for now, and the infrastructure-only warning for `'webgpu'` is gone.
