---
"liquiddom": minor
---

Fluid engine slice 2 (W67): full MLS-MPM dynamics with T-1000 re-form. New `splash(el, { strength?, at? })` and `shake(strength?)`. Clicking an observed element splashes at the pointer; keyboard activation splashes at the rect centre. `SplashOptions` changed shape in 0.3: the 0.2 fields `threshold`, `count`, `jitter`, `speedScale`, `lifetimeMs` and `radius` throw a `TypeError`.
