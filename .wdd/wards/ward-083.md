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
Proposal: Rust keeps a low-pass `g_lp` per core and adds `scale·g_hp·dt` (`g_hp = g − g_lp`) to the grid velocities of cells with mass, after momentum → velocity and before the walls and the CFL cap; `|scale·g_hp|` is clamped to 2000 px/s² and `|g_hp| < 0.5 px/s²` snaps to 0 (so the engine returns to bit-identity ≈ 8τ after a change). The home spring is unchanged: a tilt gives a subtle lean of a few px that settles at home, not a run to the side (Dennis chose this over a softer spring during a tilt, 2026-10-14). Reduced motion: g = 0. Parked particles skip the grid and are unaffected (brainstorm 2026-10-13, saga dec_645b54e4, made concrete by W83.0).
Consequence: tilt is a subtle, live detail (W83.0 Q1: a 90° tilt leans 6.4 px at its peak, ragged edges for a few frames, rest within 142 frames, ≤ 0.05 px left after 3 s; the settled frame is byte-identical to the frame before the tilt); the clamp keeps it below the spring's saturation, where the liquid would run out of its element (20–700 px). A tilt during a shake stays bounded (153 px vs 98 px for the shake alone, re-forms within 150 frames). With `source: 'none'` every acceptance step is bit-identical.
Decision: PENDING

### D83-2: Gravity scale and high-pass time constant
Proposal: τ = 0.5 s, scale = 1.5, clamp `|scale·g_hp|` ≤ 2000 px/s².
Consequence: W83.0 Q1 grid (τ 0.25/0.5/1.0 × scale 0.25/0.5/1.0): the slosh peaks at ≤ 5 px and a 20° or slow 2 s tilt at scale ≤ 0.5 never drops restAlpha (nothing visible); 1.5 with the clamp is the largest visible lean that stays inside rect + one kernel radius (6.4 of 7.09 px) even at 2× strength.
Decision: PENDING

### D83-3: Changing gravity at run time
Proposal: a `setGravity(partial)` setter, snapshotted, validated and applied atomically like `setMaterial`; for `fixed` the gravity is `normalize(vector)·strength` (both are typed px/s² today, which is ambiguous); a zero vector means no gravity; the Rust clamp guards large strengths.
Consequence: a new public method; `fixed` gravity acts only when it changes (D83-1); the `vector` + `strength` meaning is documented.
Decision: PENDING

### D83-4: A fixed vector at create()
Proposal: the low-pass is seeded with the initial gravity at `create()` (and on a source switch), so a fixed vector starts at rest; only later changes act.
Consequence: W83.0 Q2: crisp from frame 0 and bit-identical to `none`; the alternative (high-pass from 0) leaned ≈ 2 px at load and held restAlpha below 1 for 74 frames.
Decision: PENDING

### D83-5: Orientation mapping
Proposal: `deviceorientation` → `px = cos β · sin γ`, `py = sin β`, rotated by θ = `screen.orientation.angle`: `gx = s·(px·cos θ + py·sin θ)`, `gy = s·(−px·sin θ + py·cos θ)`; a 2° dead band on the gravity direction; the listener is added only for `source: 'orientation'` and removed on `destroy`; `requestOrientationPermission()` (iOS) unchanged.
Consequence: W83.0 Q3: all 8 sign cases (portrait, landscape left/right, upside down × tilt directions) check out and a flat phone gives (0, 0); with ±0.5° sensor noise rest held with every band, and only the 2° band makes `g_hp` exactly 0 at rest (the engine stays bit-quiet); a real 30° tilt passes unchanged. Not tested: the iOS permission prompt on a device.
Decision: PENDING

## Spike W83.0 result (2026-10-14, a throwaway copy of `7a67ce7`, deleted; report `.superpowers/sdd/W83/spike-Q.md`, stills in `.superpowers/sdd/W83/stills/`, inspected with vision)

| Q | Candidates | Numbers | Vision | Verdict |
|---|---|---|---|---|
| Q1 | τ 0.25/0.5/1.0 s × scale 0.25/0.5/1.0, then 1.5–3 | peak slosh ≤ 5 px at scale ≤ 1; 20° and slow tilts at ≤ 0.5 never drop restAlpha; cliff at `scale·|Δg|` ≈ 2800–3200 px/s² (spring `a_max`): 20–700 px out of the element; τ 0.5 + scale 1.5 + clamp 2000: 90° tilt 6.4 px (≤ rect + 7.09 px kernel, also at 2×), rest 142 frames (budget 180), ≤ 0.05 px after 3 s | a 3–4 px lean with ragged edges in both renderers; WebGPU text rides the liquid; settled frame byte-identical to before | τ 0.5, scale 1.5, clamp 2000 (D83-2); subtle lean accepted by Dennis over a softer spring (D83-1) |
| Q2 | (i) high-pass from 0, (ii) low-pass seeded at create | (i) ≈ 2 px lean at load, restAlpha < 1 for 74 frames; (ii) bit-identical to `none` | (i) a visible lean in WebGPU; (ii) crisp from frame 0 | (ii) (D83-4) |
| Q3 | dead band 0°, 1°, 2° | ±0.5° noise: rest held with all; only 2° makes `g_hp` exactly 0; 30° tilt passes; 8 sign cases correct, flat phone (0, 0) | — | mapping + 2° band (D83-5) |
| Q4 | `none`, seeded `fixed` | all 8 acceptance-step state hashes equal HEAD; reduced motion g = 0; parked, drag, scroll unaffected; a snap `|g_hp| < 0.5 → 0` is needed for bit-identity to return after a change | — | snap in D83-1 |

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
