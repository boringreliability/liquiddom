---
ward: 35
revision: null
name: "Demo Hardening, Runtime Truth, and Showcase Polish"
epic: "demo-scenes"
status: "complete"
dependencies: [24, 26, 30, 31, 32, 33, 34]
layer: "both"
estimated_tests: 12
created: "2026-04-25"
completed: "2026-05-10"
---
# Ward 035: Demo Hardening, Runtime Truth, and Showcase Polish

## Scope
Bring LiquidDOM from impressive prototype to credible showcase/library preview. Make existing public claims true: scroll-aware physics must actually pause physics, runtime primitives must work in the real animation loop, package exports must resolve after build, public config must either be wired end-to-end or honestly scoped, and the demo must feel intentional, polished, and resilient.

## Specification

### 1. Fix package/WASM import correctness
Move/copy wasm loader into dist/wasm so published package is self-contained.

### 2. Make scroll-aware physics true
Physics receives dt=0 while scrolling. sync() continues for rendering. On idle: snap + resume.

### 3. Make public config truthful
Wire repulsionRadius, repulsionStrength, neighborSpringK end-to-end to Rust. Defer particleCount.

### 4. Fix or quarantine tween
Either make tween survive observer.sync() or mark experimental.

### 5. Align Dragged strategy docs with DOM-driven implementation
Document that drag moves DOM element, Rust follows via skip_rigid_translation.

### 6. Improve impulse robustness
Clear previous timers on repeat calls. Validate inputs. Destroy clears timers.

### 7. Create showcase scene
4 scenes in one page: hero blob, impulse buttons, drag cards, scroll resilience.

### 8. Demo content cleanup
Remove overclaiming. Honest positioning as experimental UI physics engine.

### 9. WDD reconciliation
Align PROGRESS.md, CONTEXT.md, ward statuses with actual code.

### 10. Runtime-truth tests
12 tests that catch "looks green but is not true in runtime" failures.

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | scrolling_passes_zero_dt | During scroll, physics tick receives dt=0 |
| 2 | reduced_motion_and_scroll_both_zero_dt | Both freeze physics |
| 3 | package_dist_import_resolves | dist/index.js imports without broken WASM path |
| 4 | config_repulsion_radius_reaches_rust | Public config wired to Rust or not exposed |
| 5 | config_neighbor_spring_reaches_rust | Same for neighborSpringK |
| 6 | tween_survives_sync_or_is_experimental | Tween not overwritten by sync |
| 7 | impulse_repeated_last_write_wins | Repeated impulse clears stale timers |
| 8 | destroy_clears_impulse_timers | Destroy cleans pending timers |
| 9 | showcase_scene_loads | Showcase page initializes without errors |
| 10 | scroll_hero_status_matches_wdd | Ward 034 docs match reality |
| 11 | package_files_include_wasm | npm pack includes WASM loader/binary |
| 12 | public_api_exports_only_ready | No internal/unfinished details leaked |

## Must NOT
- Add features while existing claims are false
- Keep public config fields not wired or documented as experimental
- Let tests pass by only checking method existence
- Claim WDD numbers that don't match repo
- Break existing demos
- Move canvas above DOM
- Add framework dependencies
- Make Rust aware of DOM/CSS
- Use JSON over FFI

## Must DO
- Make package import/build path correct
- Make scroll physics actually pause (dt=0)
- Align public API with actual runtime behavior
- Fix or quarantine tween
- Make impulse robust under repeated calls and destroy
- Create polished showcase scene
- Reconcile WDD docs with real code
- Add runtime-truth tests
- Preserve core architecture

## Verification
npm run build && npm test && cargo test && cargo clippy && npm pack --dry-run
Manual: demo scenes work, no console errors, no particle explosions, showcase understandable in 10 seconds.
