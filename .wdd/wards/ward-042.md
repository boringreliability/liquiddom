---
ward: 42
revision: 5
name: "Border-Radius Aware Rest Shape"
epic: "element-physics-extensions"
status: "complete"
dependencies: []
layer: "both"
estimated_tests: 14
created: "2026-05-10"
completed: "2026-05-10"
---
# Ward 042: Border-Radius Aware Rest Shape

## Scope
Particle rest positions today form a rectangle regardless of the host element's CSS shape. Read the host's computed `border-radius`, resolve it to pixels, and parameterize rest positions so pill-shaped buttons rest as pills, circles rest as circles. Rule of Two preserved — TypeScript reads CSS, Rust receives only a pixel value.

This ward executes the deliberate FFI bump to `FLOATS_PER_ENTITY = 9`, adding `border_radius_px` as slot[8]. The previous slot layout (slots 0–7) is preserved unchanged — `interaction_state` at slot[4] continues to function exactly as today.

This ward also lays groundwork for W53 (border-radius clip in `preserveBackgrounds`) by exposing the resolved radius through the entity buffer.

## Revision history
- **r1** (initial): proposed slot[4] for radius. **REJECTED** by review: slot[4] is `interaction_state`, written every sync() by `phantom-observer.ts:203, 260, 262, 264` and read at line 308 for hover color.
- **r2**: grow `FLOATS_PER_ENTITY` from 8 → 9, add `border_radius_px` at slot[8]. Coordinated FFI revision.
- **r3**: r2 review surfaced four executability gaps:
  - `ffi-integration.test.ts` declares local `const FLOATS_PER_ENTITY = 8` (shadow constant, missed by `* 8 +` regex)
  - `src/buffer.rs` tests assert literal totals 800/400 derived from old stride
  - `index.ts` does not currently import `FLOATS_PER_ENTITY` — must extend existing import
  - Test #14 (ResizeObserver) requires a controllable mock; jsdom polyfill in repo is a no-op
  Plus concrete file:line edits for CLAUDE.md and ward-053.md, NaN-semantic note, pre-computed values for test #5.
- **r4**: r3 review surfaced two more must-fix items about audit completeness (doc comments in `src/buffer.rs` lines 6, 54, 61 + test comments lines 74, 82). Generalized: spec requires verifying NO shadow `FLOATS_PER_ENTITY` constants exist.
- **r5** (this revision): gold-phase implementation surfaced an internal spec inconsistency: r4's distribution rule produced x-asymmetric output for pill (100×50, r=25) — TR/BR=3, BL/TL=2 — making test #3's "both axes mirror-symmetric" assertion impossible. Switched §4 step 5 to symmetry-preserving order (4-arc group, then h-pair, then v-pair, then singleton to arc[0]). Test #5 expected values updated from `[1,1,1,1,5,2,4,1]` → `[1,1,1,1,5,1,5,1]`. Also fixed test #10: `'100%' on 200×80` arithmetic error — spec §2 says `% of min(w,h)` (= 80), not 40.

## Inputs
- `EntityBody::new_rect` in `src/physics.rs` (currently rectangle-only)
- `src/buffer.rs` — `FLOATS_PER_ENTITY` constant and layout comment
- `src/entity.rs` — typed slice accessors
- `src/api.rs` — `LiquidCore::tick`, lazy body init reads `slice[8]`
- `ts/src/phantom-observer.ts` — `FLOATS_PER_ENTITY` mirror constant, `observe()`, `sync()`, ResizeObserver registry
- `ts/src/wasm-bridge.ts` — view sizing (auto-scales via constant; verify no literal 8)
- `ts/src/index.ts` — `tween()` line 421 and `impulse()` line 475 use literal `id * 8`
- `ts/__tests__/ffi-integration.test.ts` line 6 — local shadow constant
- `ts/__tests__/liquiddom-api.test.ts` — extensive impulse/tween offset assertions to audit
- `getComputedStyle(el).borderRadius` browser API
- `ResizeObserver` browser API (real in browsers, mocked in jsdom)

## Outputs
- `FLOATS_PER_ENTITY` bumped from 8 → 9 in both Rust and TS, layout comments updated.
- New helper `rounded_rect_perimeter_points(w: f32, h: f32, r: f32, count: usize) -> Vec<Vec2>` in `src/physics.rs`.
- `EntityBody::new_rounded_rect(w, h, r, count)` as the canonical constructor.
- `EntityBody::new_rect(w, h, count)` becomes a wrapper calling `new_rounded_rect(w, h, 0.0, count)`.
- `EntityBody::new_rect_inner(w, h, count)` — private rename of the existing rectangle implementation.
- Slot[8] semantics: `border_radius_px` (TS-written on observe + on element resize, Rust-read once at body lazy-init).
- Single shared `ResizeObserver` on `PhantomObserver` for radius refresh.
- Pure helper `parseBorderRadius(value: string, w: number, h: number): number` exported for unit-testability.
- Updated `CLAUDE.md` entity buffer table (slot[8] added; `FLOATS_PER_ENTITY = 9`).
- Updated `CONTEXT.md` architecture decisions row + Known Limitations + Key Metrics (test count).
- Updated `ward-053.md` Specification to reference exact buffer offset.

## Specification

### 1. FFI revision: FLOATS_PER_ENTITY = 9

#### Constants and layout comments
- `src/buffer.rs` line 1 (constant) and the layout comment at line 2: bump `FLOATS_PER_ENTITY` from 8 → 9. Update layout comment to:
  `[x, y, width, height, interaction_state, liquid_type, custom_param_1, reserved, border_radius_px]`
- `ts/src/phantom-observer.ts` line 2 (`export const FLOATS_PER_ENTITY = 8`): bump to 9.

#### Audit table — every literal `8` that encodes the entity stride

| File | Line(s) | Current | Required change |
|------|---------|---------|-----------------|
| `src/buffer.rs` | 6 | `/// Each entity occupies exactly 8 floats (32 bytes).` | `/// Each entity occupies exactly FLOATS_PER_ENTITY (9) floats (36 bytes).` |
| `src/buffer.rs` | 54 | `/// Get an immutable slice of 8 floats for entity \`id\`.` | `/// Get an immutable slice of FLOATS_PER_ENTITY floats for entity \`id\`.` |
| `src/buffer.rs` | 61 | `/// Get a mutable slice of 8 floats for entity \`id\`.` | `/// Get a mutable slice of FLOATS_PER_ENTITY floats for entity \`id\`.` |
| `src/buffer.rs` | 74 (test comment) | `// 100 entities × 8 floats = 800 floats in the buffer` | `// 100 entities × FLOATS_PER_ENTITY (9) floats = 900 floats in the buffer` |
| `src/buffer.rs` | 75 | `assert_eq!(buf.len(), 800);` | `assert_eq!(buf.len(), 100 * FLOATS_PER_ENTITY);` |
| `src/buffer.rs` | 82 (test comment) | `// All 80 floats should be 0.0` | `// All 10 * FLOATS_PER_ENTITY floats should be 0.0` |
| `src/buffer.rs` | ~155 (50-capacity grow test) | `assert_eq!(buf.len(), 400); // 50 × 8` | `assert_eq!(buf.len(), 50 * FLOATS_PER_ENTITY); // 50 × FLOATS_PER_ENTITY` |
| `ts/src/index.ts` | 421 | `const off = id * 8;` (in `tween()`) | `const off = id * FLOATS_PER_ENTITY;` |
| `ts/src/index.ts` | 475 | `const off = id * 8;` (in `impulse()`) | `const off = id * FLOATS_PER_ENTITY;` |
| `ts/src/index.ts` | line 1 import block | `import { PhantomObserver } from "./phantom-observer";` | Extend to: `import { FLOATS_PER_ENTITY, PhantomObserver } from "./phantom-observer";` |
| `ts/__tests__/ffi-integration.test.ts` | 6 | `const FLOATS_PER_ENTITY = 8;` | DELETE the local declaration; replace with `import { FLOATS_PER_ENTITY } from "../src/phantom-observer";` near the existing imports |
| `ts/__tests__/liquiddom-api.test.ts` | various (search for `id \* 8`, `\+ 8\b`, local `const FLOATS_PER_ENTITY`) | Mixed | Audit pass: (a) verify NO local `const FLOATS_PER_ENTITY` declaration exists (verified clean at r4 write time, but re-check at execution); (b) replace any `id * 8 + N` pattern with `id * FLOATS_PER_ENTITY + N`, importing the constant from `../src/phantom-observer` if not already imported. Tests that read `buf[off + 5]` etc. through a previously-correct `off` are fine; the only risk is hardcoded strides. |

False-positive guard: literal `8` may legitimately appear for non-stride purposes (FPS counters, byte counts, capacity values like `64`/`128`). The audit MUST be expression-aware, not regex-only. Specifically: `id * 8`, `i * 8`, `* 8 +`, ` 8 *`, ` 8;` patterns where `8` represents the entity stride. When in doubt, check if the surrounding code accesses an entity buffer offset.

**Shadow constant principle**: the r2/r3 cycle was caused by `ffi-integration.test.ts:6` declaring its own `const FLOATS_PER_ENTITY = 8`. Before completing the audit, run `git grep -nE 'const FLOATS_PER_ENTITY' src/ ts/` and verify only the canonical declarations in `src/buffer.rs:3` and `ts/src/phantom-observer.ts:2` remain. Any other match is a shadow constant and must be replaced with an import.

**Doc comment principle**: comments like `/// Each entity occupies exactly 8 floats` and inline test comments like `// 100 × 8 = 800` encode the stride in prose. After bumping `FLOATS_PER_ENTITY` to 9, every doc comment and test-section comment that mentions a literal `8` related to the entity stride must be updated. Run `git grep -nE '\b8\s+floats?\b|\b8\s+f32\b|\b32\s+bytes\b' src/` and verify all hits are addressed by the audit table.

#### Verification grep
After the audit, the following greps must return zero hits in `src/` and `ts/`:
- `git grep -nE 'id \* 8\b'` (id-times-eight stride)
- `git grep -nE 'i \* 8 \+'` (loop stride literal)

The TypeScript-side test `ffi-integration.test.ts` view-size assertions (lines around 34, 71, 145, 165, 289, 305, 315, 399 — search for `* FLOATS_PER_ENTITY` or `expectedLength`) must continue to use the imported constant, not the deleted local literal.

#### entity_slice safety
`buffer.rs::entity_slice` returns `&self.data[start..start + FLOATS_PER_ENTITY]`. After the bump, the slice has length 9, and `slice[8]` is in bounds. No bounds-check additions needed in `api.rs`. (NaN > 0.0 evaluates to false in IEEE 754 — see §3.)

### 2. CSS parsing (TS side, pure function)
- New file: `ts/src/border-radius.ts` exporting `parseBorderRadius(value: string, w: number, h: number): number`. Pure, no DOM access — testable in isolation.
- Read `getComputedStyle(el).borderRadius` on observe and on each `ResizeObserver` callback. NOT per frame.
- Parse the FIRST space-separated token only.
  - `'10px'` → 10; `'0px'` / `'0'` / `'0%'` → 0
  - `'50%'` → resolved against `min(w, h)`
  - `'10px 20px'` → 10 (per-corner mixed: only first token used; v1 limitation)
  - `'10px / 5px'` → 10 (per-axis elliptical: only horizontal first token used; v1 limitation)
  - `''`, `'normal'`, `'auto'`, unparseable → 0
  - `calc(...)` / `min(...)` / `max(...)` — `getComputedStyle` typically resolves to a px value; if the function literal survives, fall back to 0 (v1 limitation, documented)
  - Negative parsed values → clamped to 0
- `inherit`, `revert`, CSS variables: `getComputedStyle` resolves to absolute values; no special handling.

### 3. Rust geometry — exact contract for r=0 byte-identity
The Must NOT requires `r=0` to produce results byte-identical to current `new_rect`. The contract is **delegation, not re-implementation**:

```rust
pub fn new_rounded_rect(w: f32, h: f32, r: f32, count: usize) -> EntityBody {
    if !(r > 0.0) {  // covers 0.0, NaN (NaN > 0.0 is false), negatives
        return Self::new_rect_inner(w, h, count);
    }
    // ... rounded path (§4)
}

pub fn new_rect(w: f32, h: f32, count: usize) -> EntityBody {
    Self::new_rounded_rect(w, h, 0.0, count)
}
```

The original `new_rect` body is renamed to `new_rect_inner` (private). `new_rounded_rect` calls it directly when `r <= 0` or NaN. This guarantees byte-identity by construction. Test #2 then asserts equality with zero tolerance (`assert_eq!`).

**NaN semantic note**: the guard MUST be `if !(r > 0.0)`, not `if r <= 0.0`. The latter does not catch NaN (`NaN <= 0.0` is false), and a NaN radius would fall through to the rounded path and produce garbage. Test #6 asserts NaN delegation.

### 4. Rounded-rect point distribution algorithm
For `r > 0` (after the guard in §3):
1. Clamp `r = min(r, min(w, h) / 2)`.
2. Compute total perimeter: `P = 2*(w + h) - 8*r + 2*π*r`.
3. Per-segment nominal counts (8 segments — 4 corner arcs of length `π*r/2`, 4 straight edges of lengths `w-2r, h-2r, w-2r, h-2r`):
   - `n_arc_f = (count as f32) * (π*r/2) / P` per arc
   - `n_edge_h_f = (count as f32) * (w - 2r) / P` per horizontal edge
   - `n_edge_v_f = (count as f32) * (h - 2r) / P` per vertical edge
4. Floor each to integer; track total assigned.
5. Distribute remainder `count - total_assigned` in **symmetry-preserving order** (r5):
   - **5a**: while remainder ≥ 4, add 1 to each of the 4 arcs simultaneously (TR, BR, BL, TL).
   - **5b**: if remainder ≥ 2, add 1 to edge_top AND 1 to edge_bottom.
   - **5c**: if remainder ≥ 2, add 1 to edge_right AND 1 to edge_left.
   - **5d**: if remainder == 1, add to arc[0] (deterministic singleton).
   This preserves bilateral and 4-fold symmetry whenever the remainder allows.
6. Generate points **centered** within each segment (offset `(j + 0.5) * L / n`) clockwise: top edge → TR arc → right edge → BR arc → bottom edge → BL arc → left edge → TL arc. Centered placement avoids junction ambiguity at segment endpoints.
7. Return exactly `count` points.

**Pre-computed expected counts for test #5** (100×50, r=10, count=16):
- P = 2*(100+50) - 8*10 + 2π*10 = 300 - 80 + 62.832 ≈ 282.832
- n_arc_f ≈ 0.889 → floor 0 (per arc); n_edge_h_f ≈ 4.526 → floor 4 (top, bottom); n_edge_v_f ≈ 1.697 → floor 1 (left, right)
- Floored total: 0+0+0+0 + 4 + 1 + 4 + 1 = 10. Remainder: 6.
- Step 5a (6 ≥ 4): arcs all +1 → counts [1,1,1,1, 4,1, 4,1]. Remainder 2.
- Step 5b (2 ≥ 2): top +1, bottom +1 → counts [1,1,1,1, 5,1, 5,1]. Remainder 0.
- **Final: `[arc0=1, arc1=1, arc2=1, arc3=1, edge_top=5, edge_right=1, edge_bottom=5, edge_left=1]`** — bilateral symmetric.

**Pill verification** (100×50, r=25, count=16):
- arc_len ≈ 39.27, edge_h_len = 50, edge_v_len = 0
- Floor: arcs 2 each, h-edges 3 each, v-edges 0 → 14. Remainder 2.
- Step 5a skip (2 < 4). Step 5b: top +1, bottom +1.
- **Final: `[arc=2,2,2,2, top=4, right=0, bottom=4, left=0]`** — fully 4-fold and bilateral symmetric.

### 5. Body construction (Rust)
- `LiquidCore::tick` lazy-init becomes: `EntityBody::new_rounded_rect(w, h, slice[8], PARTICLES_PER_BODY)`.
- After body is created, slot[8] changes have NO effect on the existing rest shape. Bodies are not rebuilt mid-life. Documented v1 limitation: changing border-radius after observe requires `unobserve` + `observe`.
- Slot[8] = NaN, negative, or > min(w,h)/2 are clamped at body construction (Spec §4 step 1; §3 NaN guard).

### 6. Refresh policy (TS side)
- **On `observe(el)`**: parse border-radius, write to `buffer[id * FLOATS_PER_ENTITY + 8]`.
- **Single shared `ResizeObserver`** owned by `PhantomObserver`. Lazily constructed in the constructor. On `observe(el)`: `this.resizeObserver.observe(el)`. On `unobserve(el)`: `this.resizeObserver.unobserve(el)`. On `unobserveAll()` / destroy: `this.resizeObserver.disconnect()`.
- ResizeObserver callback receives `entries: ResizeObserverEntry[]`. For each entry: look up the entity ID via `this.elementToId.get(entry.target as HTMLElement)`, re-parse border-radius using `entry.contentRect.width` and `entry.contentRect.height`, write to slot[8].
- NO body rebuild — only slot value updates (consistent with §5).
- NOT re-read on `MutationObserver` style/class changes (deferred).
- NOT re-read per frame.

### 7. Mock ResizeObserver for jsdom tests
The repo's existing polyfill (`liquiddom-api.test.ts:7-14`) is a no-op and cannot fire callbacks. Test #14 requires a controllable mock. Add this polyfill to `ts/__tests__/border-radius.test.ts`:

```ts
type Entry = { target: Element; contentRect: { width: number; height: number } };
let lastObserver: { trigger: (entries: Entry[]) => void } | null = null;

class ControllableResizeObserver {
  private cb: (entries: Entry[]) => void;
  constructor(cb: (entries: Entry[]) => void) {
    this.cb = cb;
    lastObserver = { trigger: (e) => this.cb(e) };
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  globalThis.ResizeObserver = ControllableResizeObserver as unknown as typeof ResizeObserver;
});
```

Test #14 then triggers a synthetic resize via `lastObserver!.trigger([{ target: el, contentRect: { width: 200, height: 100 } }])` and asserts `buffer[id * FLOATS_PER_ENTITY + 8] === 50`.

### 8. grow() behavior
- `LiquidCore::grow` uses `Vec::resize`; existing slot[8] values survive grow.
- `WasmBridge::rebind` creates fresh views; standard pattern.
- TS does NOT need to re-write slot[8] after grow — observed entities retain their resolved radii.

### 9. Render-side
- W42 itself does NOT change rendering. `PhantomObserver.render()` keeps using particle positions.
- Resolved radius available at `buffer[id * FLOATS_PER_ENTITY + 8]` for W53.

### 10. Documentation updates required as part of W42

#### `CLAUDE.md` — concrete edits
- Line ~47 (the entity buffer narrative): change `8 floats per entity (FLOATS_PER_ENTITY = 8)` → `9 floats per entity (FLOATS_PER_ENTITY = 9)`.
- Entity buffer table (around lines 49–57): add row:
  `| 8     | border_radius_px  | TS writes (on observe + resize) |`
- Update any prose elsewhere that references "8 floats" or "32 bytes per entity" to reflect 9 floats / 36 bytes.

#### `CONTEXT.md` — concrete edits
- Architecture Decisions table: add row `| FLOATS_PER_ENTITY 8 → 9, slot[8] = border_radius_px | First coordinated FFI bump; slot[4] is interaction_state (verified), no free slot in 0–7 | W42 |`.
- Key Metrics table: add row `| Floats per entity | 9 (36 bytes) | W42 |` (do NOT delete the W1 row — keep history).
- Key Metrics table: update test count row: `| Total tests | 138 (43 Rust + 95 TS) | W42 |` (124 + 14 new = 138; Rust 35 + 8 new from tests 1–8 = 43; TS 89 + 6 new from tests 9–14 = 95).
- Known Limitations: replace "rectangle-only rest shape" line (if present) with: "Per-corner mixed (`10px 20px`) and per-axis elliptical (`10px / 5px`) `border-radius` values fall back to first token; runtime border-radius changes require `unobserve` + re-`observe`; `calc()`/`min()`/`max()` may fall back to 0 if `getComputedStyle` does not resolve them."

#### `ward-053.md` — concrete edits
- In Specification, find the sentence referencing "W42 resolved border-radius value per entity" and replace with: "Resolved border-radius read from `buffer[id * FLOATS_PER_ENTITY + 8]` (written by W42 on observe and on resize)."
- In Inputs, add: "Entity buffer slot[8] (`border_radius_px`, established by W42)."

## Tests

### Rust (in `src/physics.rs::tests` and `src/buffer.rs::tests`)
| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `rounded_rect_returns_exact_count` | `rounded_rect_perimeter_points(100, 50, 10, 16)` returns exactly 16 points |
| 2 | `rounded_rect_zero_radius_byte_identical_to_new_rect` | `new_rounded_rect(100, 50, 0, 16)` particles compare equal (`assert_eq!`) to `new_rect(100, 50, 16)` particles, no tolerance |
| 3 | `rounded_rect_pill_is_symmetric` | r=h/2 on 100×50: points mirror-symmetric about both x=50 and y=25 within 1e-4 |
| 4 | `rounded_rect_clamps_oversized_radius` | r=999 on 100×50 produces points equal (`assert_eq!`) to r=25 |
| 5 | `rounded_rect_remainder_distribution_matches_spec` | For 100×50, r=10, count=16: per-segment counts equal `[1, 1, 1, 1, 5, 1, 5, 1]` (arc0..arc3, edge_top, edge_right, edge_bottom, edge_left) — bilateral symmetric per §4 step 5 (r5) |
| 6 | `rounded_rect_negative_and_nan_radius_treated_as_zero` | `new_rounded_rect(_, _, -5, _)` and `new_rounded_rect(_, _, f32::NAN, _)` produce particles `assert_eq!` to `new_rect(_, _, _)` |
| 7 | `pill_body_reaches_stable_equilibrium` | EntityBody from `new_rounded_rect(100, 50, 25, 16)`, ticked 1000× at default physics (tension=100, damping=5, substeps=1, repulsion_radius=100, repulsion_strength=5000, neighbor_spring_k=30, no pointer): max distance from initial rest position < 1.0 px |
| 8 | `entity_buffer_layout_is_9_floats` | `FLOATS_PER_ENTITY == 9`; `EntityBuffer::new(N).len() == N * 9`; `entity_slice` returns slice of length 9 |

### TypeScript (in `ts/__tests__/border-radius.test.ts`, new file)
| # | Test Name | Verifies |
|---|-----------|----------|
| 9 | `parseBorderRadius_handles_pixel_values` | `parseBorderRadius('10px', 100, 50)` === 10; `'0px'` === 0; `'0'` === 0 |
| 10 | `parseBorderRadius_resolves_percent_against_min_dim` | `parseBorderRadius('50%', 100, 50)` === 25; `'100%'` on 200×80 === 80; `'50%'` on 200×80 === 40 (no clamping at TS level; Rust clamps to min(w,h)/2 at body construction per §3) |
| 11 | `parseBorderRadius_falls_back_for_unparseable` | `''`, `'normal'`, `'auto'`, `'banana'`, `'calc(10px + 5%)'` all return 0 |
| 12 | `parseBorderRadius_uses_first_token_for_mixed_values` | `'10px 20px'` === 10; `'10px / 5px'` === 10; `'10px 20px 30px 40px'` === 10 |
| 13 | `observe_writes_resolved_border_radius_to_slot_8` | After `observe(el)` on a 100×50 element with computed `border-radius: 12px`, `buffer[id * FLOATS_PER_ENTITY + 8] === 12` |
| 14 | `resize_re_reads_border_radius_via_resize_observer` | With ControllableResizeObserver mock (§7): observe element with 50%, initial 100×50 → slot[8]=25; trigger synthetic resize entry to 200×100 → slot[8]=50 |

## Must NOT
- Break the 16-particle invariant (`PARTICLES_PER_BODY = 16` stays).
- Introduce DOM-awareness or CSS parsing in Rust.
- Regress rectangle case: `new_rounded_rect(_, _, 0.0, _)` byte-identical (zero tolerance) to legacy `new_rect`.
- Change `tick()` FFI signature.
- Re-read `getComputedStyle` per frame.
- Rebuild `EntityBody` after initial creation when slot[8] changes.
- Skip the audit table in §1: every listed file:line MUST be touched.
- Use `if r <= 0.0` instead of `if !(r > 0.0)` (NaN-safety, §3).
- Use a per-element ResizeObserver (resource cost; one shared instance only).

## Must DO
- `r = 0` byte-identical to current `new_rect` via direct delegation (test #2).
- Pill case (`r = h/2`, `w > h`) reaches stable equilibrium (test #7) at the documented physics parameters.
- Resolved radius readable via `buffer[id * FLOATS_PER_ENTITY + 8]`.
- Audit table in §1 fully executed; both `git grep -nE 'id \* 8\b'` and `git grep -nE 'i \* 8 \+'` return zero hits in `src/` and `ts/`.
- Update `CLAUDE.md`, `CONTEXT.md`, and `ward-053.md` per §10.
- Single shared `ResizeObserver`.
- Pure function `parseBorderRadius` (separable from DOM, tests 9–12).
- ControllableResizeObserver polyfill (§7) for test #14.

## Verification
- `cargo test physics::tests::*rounded_rect*`, `*pill*`, `*entity_buffer_layout*` (tests 1–8) green.
- `npm test ts/__tests__/border-radius.test.ts` (tests 9–14) green.
- `npm run build && npm test` full suite green — no regressions in 124 prior tests after the FLOATS_PER_ENTITY bump.
- `cargo clippy` clean.
- `git grep -nE 'id \* 8\b' src/ ts/` returns zero hits.
- `git grep -nE 'i \* 8 \+' src/ ts/` returns zero hits.
- Manual demo: `border-radius: 50%` on a 200×60 button in `demo/scenes/scroll-hero.html` → pill silhouette at rest, drag/impulse without artifacts. Resize viewport → slot[8] visibly updates in DevTools (`instance.getBuffer()[id * 9 + 8]`).
- `CLAUDE.md`, `CONTEXT.md`, `ward-053.md` reflect the new layout per §10.
