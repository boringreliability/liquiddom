---
ward: 83
revision: null
name: "Gravity and tilt"
epic: "fluid-engine"
status: "planned"
dependencies: [82]
layer: "both"
estimated_tests: 0
created: "2026-10-14"
completed: null
---
# Ward 083: Gravity and tilt

North star: none of the 8 acceptance steps (they run with gravity `none` and stay bit-identical); the slice matrix's tilt experience — tilting the phone sloshes the liquid to one side and it settles at home again (slice design §6, D83-1), shown live in a new `demo/scenes/tilt.html`.

## Scope
Fourth ward of slice 6 (design `docs/superpowers/specs/2026-10-13-liquiddom-slice-6-world-design.md` §6). `gravity: { source: 'none' | 'fixed' | 'orientation', vector, strength }` reaches `tick(…, gx, gy)`. Only changes in gravity act (a high-pass): Rust adds the high-passed `g·dt` to grid velocities of cells with mass, scaled so the liquid never leaves its element, so a tilt sloshes the liquid and it rests at home, the exact contour and the DOM text work as today. A `setGravity(partial)` setter changes it at run time; `orientation` follows `deviceorientation` (listener removed on `destroy`, `requestOrientationPermission()` on iOS); reduced motion means g = 0. The scale, the high-pass time constant, a fixed vector's behaviour at `create()` and the orientation mapping come from the measurement spike W83.0 (plan `docs/superpowers/plans/2026-10-13-fluid-slice-6/W83.md`, part 1); part 2 of the plan is written after the gate. W82's page-text ink probes gain a 200-ink-pixel floor in this ward's red (approved by Dennis 2026-10-14, saga dec_6f6924ff).

Out of scope: touch drag and the drag opt-out (W84), the adapters (W85), the site (W86), a persistent gravity lean (rejected, slice design §1).

## Inputs
- The slice design §6, §11, §12 (D83-1 … D83-3) and the spec §2 interaction table (gravity row) and §5 API, as amended in `17ede66`.
- `options.ts` `resolveGravity`, `index.ts` (gravity dropped, `requestOrientationPermission`), `api.rs` `tick` (`_gx`, `_gy`), `gravity.test.ts` (four `it.skip`), the ignored slice-6 Rust scenario.
- Baseline at `4a38e4a` (W82 complete): see Specification.

## Outputs
- Set after the gate (part 2 of the plan).

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3): one item per technique, architecture or scope choice. Present each in chat to Dennis as a named decision with its consequence, record it with saga_record_decision, then replace PENDING with: APPROVED YYYY-MM-DD — <choice> (saga dec_xxxxxxxx), or AMENDED when he changed it, and add the row to NORTH-STAR.md "Plan decisions". The ward cannot move to red while any line says PENDING. -->
### D83-1: High-pass gravity — only changes act
Proposal: Rust adds the high-passed gravity `g_hp·dt` (`g_hp = g − lowpass_τ(g)`) to the grid velocities of cells with mass, so a tilt sloshes the liquid and it rests at home afterwards; a constant gravity has no lasting effect (brainstorm 2026-10-13, saga dec_645b54e4).
Consequence: rest, the exact contour and the DOM text work as today; a persistent lean is ruled out. With `source: 'none'` the engine is bit-identical to W82.
Decision: PENDING

### D83-2: Gravity scale and high-pass time constant
Proposal: from W83.0 Q1 — one (τ, scale) pair so the liquid sloshes visibly, never leaves its element and rests within the NORTH-STAR budgets.
Consequence: from W83.0 Q1.
Decision: PENDING

### D83-3: Changing gravity at run time
Proposal: a `setGravity(partial)` setter on the instance, snapshotted, validated and applied atomically like `setMaterial` (slice design §12).
Consequence: a new public method; `fixed` gravity can act after `create()` (only its changes act, D83-1).
Decision: PENDING

### D83-4: A fixed vector at create()
Proposal: from W83.0 Q2 — either the liquid sloshes once at load (the high-pass starts from 0) or it starts at rest (the low-pass is seeded with the initial g).
Consequence: from W83.0 Q2.
Decision: PENDING

### D83-5: Orientation mapping
Proposal: from W83.0 Q3 — `deviceorientation` beta/gamma mapped to `(gx, gy)`, rotated by `screen.orientation.angle`, with a dead band against sensor noise at rest.
Consequence: from W83.0 Q3.
Decision: PENDING

## Specification
Set after the gate (part 2 of the plan).

**Baseline (2026-10-14, `4a38e4a`).**

| Suite | Count |
|---|---|
| cargo | 228 passed; 0 failed; 2 ignored |
| vitest | 752 passed, 4 skipped (756), 75 files |
| Playwright `--list` | canvas2d 94, webgpu 51, webgpu-hw 97, perf 6 |

## Tests

Set at red (part 2 of the plan).

| # | Test Name | Verifies |
|---|-----------|----------|

## Must NOT
- Change the FFI layout or the 7-arg constructor (gravity travels through `tick`'s `gx, gy`).
- Move any acceptance step or Linux baseline with gravity `none`.
- Let a constant gravity lean the liquid (D83-1).
- Copy spike code into the repo (D2); keep spike copies after their numbers are recorded.

## Must DO
- Reduced motion: g = 0.
- Remove the `deviceorientation` listener on `destroy`.
- Every scene live on the RAF clock by default.

## Manual Smoke Test
### Setup
`npm run dev`, then `http://localhost:3000/scenes/tilt.html` (after part 2).

### Steps
1. Move the vector slider (desktop) or tilt a phone.
   Verify: the liquid sloshes to the side and settles at home; nothing stays leaning.

### Pass criteria
- [ ] Slosh on a change, rest at home afterwards, in both renderers.

## Verification
Set after the gate (part 2 of the plan).
