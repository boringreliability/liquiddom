---
"liquiddom": minor
---

Gravity works. The `gravity` option (`source: 'none' | 'fixed' | 'orientation'`) now reaches the liquid, and only its changes act: tilting the phone (or changing a fixed vector with the new `setGravity(partial)`) sloshes the liquid inside its element, and it rests at home again, so the crisp contour and the real DOM text come back. A constant gravity never leans the liquid, and the gravity given at `create()` or a switch of `source` starts at rest. `fixed` now means `normalize(vector) · strength`; `orientation` follows `deviceorientation` rotated with the screen, ignores changes under 2° and removes its listener on `destroy()`. `setGravity(partial)` is validated and applied atomically like `setMaterial`. Under reduced motion gravity is ignored.
