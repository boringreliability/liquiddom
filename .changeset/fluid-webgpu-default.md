---
"liquiddom": patch
---

`renderer: 'auto'` (the default) now uses WebGPU when the browser has a hardware GPU adapter and falls back to Canvas2D otherwise (no WebGPU, a software adapter such as SwiftShader, or a canvas whose WebGPU presentation surface does not work), logging one `console.info` unless `silentFallback: true`. An explicit `renderer: 'webgpu'` also accepts a software adapter and still rejects `create()` with `WebGPUUnavailableError` when WebGPU is missing. If the GPU device is lost while the page runs, the instance continues with the Canvas2D renderer on a fresh canvas (one `console.warn`), and `activeRenderer` reports `'canvas2d'`. With `'auto'`, `create()` now performs one extra `requestAdapter` round-trip (plus `requestDevice` on a hardware adapter) before it resolves. `activeRenderer` can change from `'webgpu'` to `'canvas2d'` after a device loss without any event, so read it again whenever you need it rather than caching it.
