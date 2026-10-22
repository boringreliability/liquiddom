---
ward: 85
revision: null
name: "Adapters"
epic: "fluid-engine"
status: "planned"
dependencies: [84]
layer: "both"
estimated_tests: 0
created: "2026-10-22"
completed: null
---
# Ward 085: Adapters

North star: none — the adapters carry the engine to React and Vue (slice design §8); the 8 acceptance steps are unchanged. An app built with `@liquiddom/react` or `@liquiddom/vue` learns when its instance stopped, can opt an element out of drag, gets the same liquid resolution as `autoObserve` and is smoke-tested from the published `dist` in both frameworks.

## Scope
Sixth ward of slice 6 (design `docs/superpowers/specs/2026-10-13-liquiddom-slice-6-world-design.md` §8). Four parts: (1) a stopped instance is reported: a new core option `onError(err)` is called once when the instance stops (a throwing frame, a failed `resize_world`, a failed rebuild after a lost device), and the React and Vue providers turn it into an error state; (2) `drag` reaches the adapters (`<LiquidElement drag={false}>`, `useLiquidRef({ drag: false })`; W84 added it to core's `ElementOptions`); (3) the area hint without `autoObserve`: today an app that observes its elements after `create()` (every adapter app) builds the core with hint 0, so the grid cell stays at 8 px for good, while `autoObserve` gives `clamp(√(4A/N), 4, 8)`; (4) `examples/vue` and a blocking Vue dist e2e, mirroring `examples/react`. How visible the 8 px cell is, and whether a core call that rebuilds the grid before any element is placed equals a core built with the hint, come from the time-boxed spike W85.0 (plan `docs/superpowers/plans/2026-10-13-fluid-slice-6/W85.md`, part 1); part 2 is written after the gate.

Out of scope: the site (W86), publishing (W87, Dennis), an automatic re-create after a stop (recovery stays `destroy()` + `create()`; an adapter remount), a cell change once liquid is placed.

## Inputs
- The slice design §8, §11 (vitest: `onError` once, adapter `drag` prop and error state), §12 (D85-1).
- `runtime.ts` `stopInstance(msg, err)` (failed frame, `growWorld`) and `rebuildFailed` (its own copy of the stop logic); `options.ts` `OPTION_KEYS`/`resolveOptions` (function options: `testBackend`, `loader`, `clock`); `index.ts` (`initial = autoObserve ? candidatesIn(root) : []`, `measureHint` → `areaHintPx2`, `maxElementHPx`); `src/fluid/grid.rs` `choose_cell_px` (B5), `margin_px` (B15), `Grid::new`, `resize_world`; the runtime's redistribute batcher and the over-budget warning (`max_area_px2`).
- `packages/react/src/index.tsx` and `packages/vue/src/index.ts` (`pickElementOptions` copies only `viscosity` and `recovery`; create rejections only `console.error`); `examples/react`, `e2e/dist.spec.ts`, `e2e/projects.ts` (`DIST_*`), `e2e:dist:build`, `ci.yml`'s dist steps, and the tests that pin them (`e2e-harness.test.ts`, `ci-workflow.test.ts`, `workspace-publish.test.ts`).
- Baseline at `9986911` (W84 complete): see Specification.

## Outputs
- Core: `LiquidOptions.onError`; one stop path (`rebuildFailed` on `stopInstance`); the area-hint rule of D85-4.
- React and Vue: the error state of D85-2, the `drag` prop of D85-3.
- `examples/vue`, the Vue dist e2e (D85-5).

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3). -->
### D85-1: A stopped instance is reported (`onError`)
Proposal: a new `create()` option `onError?: (err: unknown) => void`, validated as a function (TypeError otherwise) and called exactly once per instance when it stops: a throwing frame, a throwing `resize_world`, a failed rebuild after a lost device (`rebuildFailed` is folded into `stopInstance`, so every stop runs one path). It runs synchronously after the stop's cleanup and after its `console.error` (the message stays: an author without a handler still sees it). A throwing handler is caught and reported with one `console.error`. Never called for a `create()` rejection (the promise rejects), an `'auto'` fallback, a lost device that rebuilds as Canvas2D, or after `destroy()`.
Consequence: one new public option and the whitelist grows; the runtime's three stop paths become one. No `instance.stopped` getter (the handler is the signal; YAGNI).
Decision: PENDING

### D85-2: The providers' error state
Proposal: React and Vue providers chain their own handler in front of `config.onError` (which is still called). On a stop the provider destroys the stopped instance, `useLiquid()` returns `null` and a new `useLiquidError()` returns the error (React: `unknown | null`; Vue: `Ref<unknown | null>`); a `create()` rejection sets the same error (its `console.error` stays). No automatic retry (a deterministic failure would loop); a remount (React `key`, Vue `v-if`/`key`) creates a new instance and clears the error. The Vue plugin (`LiquidPlugin.install`) behaves like the provider.
Consequence: `useLiquid()` keeps its type (non-breaking); one new hook per adapter. Elements stay as the stop left them until the provider destroys the instance (then exactly restored).
Decision: PENDING

### D85-3: `drag` in the adapters
Proposal: `<LiquidElement drag={false}>` (React prop; Vue prop `{ type: Boolean, default: undefined }`, since Vue casts an absent Boolean prop to `false`) and `useLiquidRef({ drag })`, captured once at the first render/setup like `viscosity` (D66-4). `pickElementOptions` copies every `ElementOptions` key that is not `undefined` (`viscosity`, `recovery`, `drag`); `drag` is never spread onto the DOM.
Consequence: an absent `drag` passes no key (W84: no `data-liquid-drag`); changing the prop after mount has no effect, as for `viscosity`.
Decision: PENDING

### D85-4: The area hint without `autoObserve`
Proposal: (a), from W85.0. Candidates: (a) a new scalar call `FluidCore::set_area_hint(area_px2, max_element_h_px)` that rebuilds the grid (cell by B5, margin by B15; world, viewport and lattice phase kept) and returns `true` only while no element has ever been placed (generation 0), otherwise does nothing and returns `false`; the runtime calls it once, at the first redistribute batch with observed area > 0, only when `create()` had hint 0; (b) build the core lazily at the first observe batch; (c) no change, document that `autoObserve` or observing before the first frame gives the finer liquid.
Consequence: (a) one allocation outside `tick` (13 µs at 1280×800, 178 µs at 8192²) and one new FFI call (the 7-arg constructor stays); a core built with a hint is untouched; bit-identical to a hinted constructor (W85.0 Q2); adapter apps get the finer, more ragged liquid in motion that the engine was tuned at, and a smaller over-budget limit (`particles · cell² / 2`), so an app observing more area than its particles cover now gets the warning `autoObserve` would give. (b) restructures `create()` (renderer, bridge and loop wait for elements) for no gain. (c) adapter apps keep the 8 px cell: smoother, rounder liquid in motion, identical at rest.
Decision: PENDING

### D85-5: `examples/vue` and the Vue dist e2e
Proposal: `examples/vue` (private `liquiddom-vue-example`, render functions in `.ts`, no SFC, so no `@vitejs/plugin-vue` dependency; `vite.config.ts` defines Vue's three feature flags), the same two pills as `examples/react`; both examples give one pill `drag={false}` so the dist e2e also checks `data-liquid-drag="off"` from the built adapter. `e2e:dist:build` also builds `@liquiddom/vue` and the Vue example; `dist.spec.ts` gets a second test that serves `examples/vue/dist` with Vite's `preview()` on :4175 (`DIST_VUE_PORT`, `DIST_VUE_EXAMPLE_ROOT`); CI's dist step runs both; `.changeset/config.json` ignores the Vue example.
Consequence: approved tests change at red (Dennis approves them with the red tests): `e2e-harness.test.ts` (the `e2e:dist:build` string, the dist constants), `ci-workflow.test.ts` (the dist step strings), `workspace-publish.test.ts` (the example set); the dist job gets slower by one adapter and one example build.
Decision: PENDING

## Spike W85.0 result (2026-10-22, a throwaway copy of `c61bc5e`, deleted; stills inspected with vision)

| Q | Measured | Recommendation |
|---|---|---|
| Q1 cell | Acceptance scene: hinted cell 6.17 px (A = 76 057 px², N = 8000) against 8 px when observed after `create()`; `examples/react`'s pills: 4 px (√(4·24 855/8000) = 3.5, clamped) against 8. Particle spacing and kernel radius follow area per particle, not the cell, so they are equal; the cell sets the solver's resolution (B-spline support 18.5 px against 24 px; 12 against 24 for the pills). At rest the stills are byte-identical (exact roundRect) in both renderers. In motion (splash frame 20), vision: the hinted liquid has finer, more ragged edges (thin tendrils, a jagged hole), the 8 px liquid the same shape with a smoother, rounder outline; the pills (4 against 8) differ more. Nothing looks broken. No over-budget warning in any case (a hinted budget is exactly 2·A; 8 px has the largest budget, so it can only hide the warning). | the engine was tuned (W73–W77) at the hinted cell; an element's liquid should not depend on when it was observed → D85-4 (a) |
| Q2 rebuild | Prototype `set_area_hint(area, tallest) -> bool` (only at generation 0; `Grid::new` with the current world, B5 cell, B15 margin; viewport kept): **bit-identical** to a hinted constructor in the dynamic, state and static views after 120 frames with a splash, for k = 0, 1 and 5 empty frames before it. Against a page that observed at create the empty frames shift only `time_s` (the wobble phase): ≤ 0.195 px, the same as any two pages observing at different frames. After a redistribute it returns `false` and changes nothing. Cost: 13 µs at 1280×800, 178 µs at 8192² (release). No TS view points into grid memory; a memory growth rebinds the bridge's views (W81's path). A `scroll_shift` before the first batch drifts the origin by < ½ old cell; the prototype carried it over in px. | (a) is safe; re-split the drift with `scroll_origin` (design resolution of part 2) |
| Q3 first batch | Frames ticked before the first observe batch: React built 0, React dev (StrictMode) 1, Vue dev 0, Vue built 0; the batch is `observe, observe`, generation 0 → 1 in all four; nothing drawn before it (no active particles). StrictMode never batches observe/unobserve/observe: its effect replay creates and destroys a whole first instance (the WASM loads once). | the generation-0 condition holds for adapter apps; (b) gains nothing over (a) |
| Q4 Vue example | `examples/vue` as render functions in `.ts` builds with Vite 8.3.2 without `@vitejs/plugin-vue`; preview: ready flag, 2 `.liquid-element`, one canvas, no console error. JS 168.9 kB (57.7 kB gzip) against React's 248.8 kB (79.6 kB); build time equal. Dev mode warns about the three undefined Vue feature flags; a `define` in `vite.config.ts` removes it. | D85-5 as proposed, plus the three `define`s |

## Specification
Baseline at `9986911`: cargo `240 passed; 0 failed; 1 ignored`; vitest `798 passed (798)`, 80 files; Playwright `--list` canvas2d 102 / webgpu 51 / webgpu-hw 99 / perf 6 / dist 1. The rest is written with part 2 of the plan, after the gate.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| — | (written at red) | — |

## Must NOT
- Change the FFI layout, the strides or the 7-arg constructor.
- Change the liquid of a core built with an area hint (`autoObserve` with candidates): bit-identical to W84.
- Re-create a stopped instance automatically, or call `onError` more than once per instance.
- Spread adapter-only props (`as`, `viscosity`, `recovery`, `drag`) onto the DOM.
- Add a dependency for the Vue example.

## Must DO
- Report every stop path once; keep each stop's `console.error`.
- Keep `useLiquid()`'s type in both adapters.
- Smoke both examples from the built `dist`.

## Manual Smoke Test
### Setup
`npm run e2e:dist:build`, then `npm run preview -w liquiddom-react-example` and `npm run preview -w liquiddom-vue-example`.

### Steps
1. Open the React example: two pills with liquid; drag the first with the mouse, the second (`drag={false}`) does not move.
2. Open the Vue example: the same.
3. (written at part 2: forcing a stop and seeing the error state)

### Pass criteria
- [ ] Both examples show the liquid at the hinted resolution and no console error.
- [ ] `drag={false}` holds in both.

## Verification
`npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:dist`, `npm run e2e:webgpu-hw`; vision on both examples.
