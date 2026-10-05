# Plan verification (2026-10-03)

The cross-check gave **49 issues**. Of those, **25 were blockers**, 15 major and 9 minor. Each ward was revised by its writer and then checked by an independent verifier. The verifier read the actual code and steps, corrected anything still open in place, and compared names and signatures against the W64 contract.

| Ward | Issues checked | Still open before verification | Fixed by verifier | Contract mismatches fixed | Remaining |
|---|---|---|---|---|---|
| W63 | 2 | 0 | 7 | 8 | 2 |
| W64 | 2 | 4 | 5 | 0 | 1 |
| W65 | 6 | 0 | 3 | 4 | 0 |
| W66 | 10 | 6 | 12 | 9 | 3 |
| W67 | 13 | 0 | 4 | 4 | 2 |
| W68 | 8 | 1 | 11 | 8 | 1 |
| W69 | 8 | 3 | 11 | 5 | 0 |

## Remaining items, none of them blocking

- **W63:** Item for the W64 owner only; W63 needs no change. Since ward-064's D64-1…D64-15 blocks now match the W64 list word for word, the W64.1 Step 1 note 'Expected: at least D64-10 to D64-15 differ' is stale. W64.1 still works: Step 4 rewrites the blocks to the same text and appends D64-16…18.
- **W63:** Item for the W64 owner only. W64.1 Step 4 sets headings to `### D64-k <name>` with no colon. W63's spec rule 2 and its template use `### D<NN>-<k>: <name>`. The doc-lint regex /^### (D\d{2}-\d+)\b/ accepts both, so no test breaks. It is a cosmetic inconsistency in W64.
- **W64:** Cross-file only, outside my file: W63.md still says D64-1 … D64-15 in ward-064's Must DO (line ~1383) and in its gold note (line ~2484). W64.1 now fixes the ward file at gate time, but the W63 plan text could also say D64-18 for consistency.
- **W66:** ward-066.md `## Outputs` (written by W63) still names the fixture path `packages/core/ts/__tests__/__fixtures__/api-migration-types/`. W66 (with resolution A3, W67 and W68) uses the root path `__fixtures__/api-migration-types/`. W66.0 only corrects this in D66-11 and does not touch other sections. Dennis may want the Outputs line changed in the red commit as well.
- **W66:** demo/scenes/scene-params.ts (W65) still throws '?renderer=… is not available before W66 (only "canvas2d")'. W66 passes `params.renderer` through but does not open up webgpu for the scene, so the message is stale but harmless.
- **W66:** The Files line in W66.1 for workspace-publish.test.ts gives slightly different line ranges (`:204-228`, `:296-312`) from Step 20 (`:205-221`, `:305`). Step 20 is authoritative and matches the current file.
- **W67:** Not a contract issue: whether the W64 scenarios given_particles_displaced_10px… and given_rect_moved_50px… still reach restAlpha == 1.0 within 180 frames once hysteresis and wobble are in (wobble fades as restAlpha rises) can only be shown by running the tests. W67.10 Step 5 already says to stop and take any failure to Dennis rather than tune the constants silently.
- **W67:** The README Global Constraints still say 'Re-form deadlines: splash 1.5 s … subject to D67-1'. That is outside W67's editable scope and is already marked as subject to D67-1.
- **W68:** Not blocking, a behaviour risk to check in W68.14 smoke: D68-7 relies on `document` receiving `pointerleave` when the pointer leaves the window. jsdom tests dispatch it directly and the e2e tests move the mouse to (1200, 60) instead of leaving, so no automated test checks real-browser delivery. If the manual smoke shows a stuck field after the pointer leaves the window, add a `pointerout` listener with `relatedTarget === null` (an AMENDED D68-7).

## Fixed by hand after verification

- **W66:** the site freeze (W66.8 Steps 1–3) moved forward to W66.5 Step 0, so that every commit in W66 builds.
- **README:** baselines are now generated locally (amends D1), the issue count is corrected (49), the deliberately unowned items are listed, and commit trailers are covered.

## Final critic (whole plan)

## Completeness review: fluid plan, slices 1–2 (W63–W69)

**Verdict: ready to start W63 and W64 once Dennis has approved D63-1…6.** No blocker is left for slices 1–2. Three things need to be fixed or decided before W65 and W67 (listed under section 5).

I checked the 49 entries in `_cross-check-issues.json` with grep against the ward files. About 30 of them were checked directly, including all the blocker types, and every one of those is fixed.

### 1. Is every slice-1/2 requirement owned by a ward?

Every requirement in the spec's slice 1–2 rows has an owner:
- **Slice 1:** single-flight init and loud failure, FFI 10/7/3/4, Canvas2D renderer with `roundRect` at rest → W64. Playwright, WebGPU smoke, multi-instance, perf and opt-level → W65. Stylesheet, stacking, print, axe, public API, retirement, site freeze, adapters, versioning → W66.
- **Slice 2:** MPM dynamics, splash, shake, `restAlpha`, scene steps 3, 4 and 6 → W67. Pointer field, hover, material, presets, reduced-motion gating, scene step 2 → W68. Playground, splash scene, whole-picture check → W69.
- **Resolutions:** every item from A1–A6, B1–B15, C1–C8 and D1–D6 has an owner.

Gaps that are still open:
- **`_verification.md` does not exist.** `README.md:181` points to it, but it is in neither the plan directory nor the job tmp directory. The re-check of the blockers therefore can't be audited. README also says "59 issues", but the JSON has 49 (25 of them blockers, which matches).
- **Baselines: README contradicts the wards.** README's "Global Constraints" still say baselines come from the CI `workflow_dispatch` job (resolution D1). W65 (D65-7), W66, W67 and W68 actually generate them locally with Docker, because the dispatch can't run before `ci.yml` is on master. That is a reasonable choice, but it amends D1 without saying so.
- **No owner (all acceptable, but should be listed):**
  - What happens to `0.2.0-rc.0` (spec §7).
  - Switching the `webgpu` project from soft to blocking after 10 green runs: it is only logged.
  - Applying the opt-level result: W65 measures it, Dennis decides at gold, and no ward then changes `Cargo.toml`.
- **The plan is not committed.** `docs/superpowers/plans/` is untracked.

### 2. Does the build stay green after each ward?

Yes, at every ward boundary:
- The print test is `fixme` in W65 and turned back on in W66.
- W69 recreates the playground and edits W66's `retired_demo_scenes` test (W69.1 Step 12).
- `__stress` and `__liquidTest` survive W66.6.
- W67 requires W66 to be `complete` (set by a human).

Things to watch:
- **W66 inside the ward:** W66.5 (facade swap) and W66.6 (`git rm` of the soft-body code) break `site/`, which is still in `workspaces` and in `vitest.config.ts`. `examples/react` also stays broken until W66.7 and W66.8. In between, the plan only builds per package, so those commits can't be bisected.
  - Fix: move W66.8 Step 1 (site freeze) to before W66.5, or accept it.
- **`scripts/copy-wasm.mjs` is fully replaced twice,** in W64.8 and W66.8. The expected log text also differs: W64 expects "patched in 2 file(s)" and W66 expects "rewritten in 1 file(s)". This is harmless, but ownership is doubled.

### 3. Are there contract inconsistencies left between wards?

The main contracts are consistent:
- **Strides:** `ELEMENT_STRIDE=10`, `DYNAMIC_FIELDS=7`, `STATIC_FIELDS=3` and `STATE_STRIDE=4` match across W63–W66 and Rust `layout.rs`. Resolution B3's "·6·4" is replaced by B14, and the plan uses 7 everywhere.
- **Constructor:** every `FluidCore::new` / `new glue.FluidCore` call has 7 arguments.
- **Earlier cross-check items, now fixed:**
  - `set_region` / `clear_region`
  - one `[profile.test]` table
  - `FakeCanvasHandle.restore()`
  - `mergeMaterial` and `MATERIAL_KEYS` are not declared twice
  - the reduced-motion guard returns `true`
  - `HOVER_SWELL` is imported from `layout`
  - the export whitelist (4 → 5 in W68)
  - `restAlphaOf`
  - `SPLASH_BUDGET_MS` is read from NORTH-STAR

Minor issues left:
- **W67's surface table (`W67.md:91`) is out of date.** It lists `startRuntime(opts, core, bridge, canvas, renderer)` with 5 parameters, but W66.4 gives it 6 (adding `activeRenderer`). W67 finds its anchors with grep, so this is descriptive only.
- **W65.0 has to rename the D65 headings.** W63's ward-065 D65-6…10 cover other topics than the plan's D65-6…11, so W65.0 renumbers them through a mapping table. That works, but the headings must be rewritten, or test 22 fails.
- **Commit trailers are incomplete.** None of the plan's commit messages have the `Claude-Session:` trailer that the harness requires.

### 4. What must a human decide, per ward?

In every ward Dennis also approves the tests ("godkendt") before implementation, approves gold, and runs `wdd complete`.

| Ward | Gate decisions |
|---|---|
| **Before W63** | D63-1…6 |
| **W64** | D64-1…18. D64-16 (Cargo profiles), D64-17 (`RenderFrame`) and D64-18 (registry) are new; D64-3, 11, 12 and 13 change topic compared with W63's blocks. Gold with screenshots |
| **W65** | D65-1…11, renumbered. D65-7 implicitly amends D1. Approve each Linux baseline after a vision check. Decide opt-level 3 vs "s" at gold. Consent before any push or CI dispatch |
| **W66** | Prerequisites: W62 complete or closed (it is `gold` now), W50 closed (it is `planned`). D66-1…15; D66-15 (`@layer` + `!important`, two axe passes) is new. Baseline approval. `0.2.0-rc.0` is still open |
| **W67** | **D67-1 blocks red.** A strength-1 splash reaches rest after ≈ 2.82 s, but the spec allows 1.5 s. Option 1 is recommended: `REST_S_MIN` 0.95 and a 3 s splash budget, which amends the spec and NORTH-STAR. D67-2…12 follow. Any change to a constant is a new decision (STOP) |
| **W68** | D68-1…9: preset values for water, honey and jelly (to be tuned), pointer smoothing, end events, swell shape, `setMaterial` semantics. Baseline approval |
| **W69** | D69-1…4: playground schema 2, recording pipeline, splash scene layout, whole-picture gate semantics. Go/no-go for planning slice 3 |

### 5. Is the plan ready to execute?

Yes, it can be executed: everything has an owner, the contracts are consistent, every ward ends green, and the gates can be checked by tests.

The real risk is size: about 27,000 lines of finished code. That code will drift from what actually gets built after W64. W67 and W68 guard against this with "check the surface table or STOP" steps, but expect many such STOPs.

Before going further:
- **Before W65:** recreate `_verification.md` or remove the reference to it, update the D1 line in README, and commit the plan.
- **Before W66:** decide whether to move the site freeze to before W66.5.
- **Before W67 red:** D67-1 must be decided.
