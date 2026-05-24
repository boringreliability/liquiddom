---
ward: 60
revision: null
name: "Live Hero (Try-it-now cut to W61)"
epic: "public-site"
status: "complete"
dependencies: [41, 43, 44, 45, 46, 58, 59]
layer: "typescript"
estimated_tests: 4
created: "2026-05-24"
completed: "2026-05-24"
---
# Ward 060: Live Hero + Try-it-now widget

## Revision history
- r1 (2026-05-24): initial draft — LiveHero + TryItNow + framework tabs (7 tests, ~2 wards by reviewer assessment).
- r2 (2026-05-24, post-review): scope cut to LiveHero + TryItNow ONLY. Framework tabs moved to **W62**. LiveHero's `renderer-resolved` dispatch under reduced-motion fixed. FFI buffer-indexing coupling promoted to Must NOT. setInterval visibility guard + rect re-read promoted to Must DO. Test #3 scope clarified.
- **r3 (2026-05-24, post-gold-vision)**: TryItNow CUT from W60. Two simultaneous `LiquidDOM` instances on the landing (LiveHero + TryItNow's squish factory) triggered wasm-bindgen panic `"recursive use of an object detected which would lead to unsafe aliasing in rust"` from Rust core. Visual evidence: TryItNow box rendered EMPTY (transparent buttons + no liquid paint because the second instance crashed). Issue is in the core, not the showcase pages. **TryItNow + multi-instance bug investigation moved to new W61.** Test 2 (`landing_has_try_it_now`) removed from W60. W60 final test count: 4.
- **r3.1 (2026-05-24, post-gold-second-vision)**: SECOND known limitation discovered. WebGPU renderer paints FreeDrop entities as AABB rectangles instead of circles. Canvas2D path uses `renderEntityAt(ctx, id, viewport, isFreeDrop)` dispatcher (W56) that correctly renders the 16-particle circle. WebGPU pipeline (W38 SDF shader) does NOT have the equivalent FreeDrop branch — it treats FreeDrop entities as regular soft-body entities and produces broken output (filled AABB quad with no proper SDF mask). The bug is in core, pre-existing, and surfaces visibly on the LiveHero in WebGPU mode. **User decision: accept current state for W60 (Canvas2D hero looks correct), fix the core bug in W61 alongside multi-instance recursion. Republish as 0.2.0-rc.1 after core fixes land.**

## Known Limitations (shipped as-is in W60)
1. **TryItNow widget temporarily disabled.** Two simultaneous `LiquidDOM` instances on the landing trigger a wasm-bindgen recursion panic in Rust core. Investigation + re-enable in W61.
2. **WebGPU hero looks broken.** FreeDrop entities render as white AABB rectangles in WebGPU instead of soft circles. Canvas2D works correctly. Core renderer bug in W38 SDF shader — no FreeDrop branch in the pipeline. Fix in W61.

Both limitations are documented in `CONTEXT.md` Known Limitations and the next public RC (`0.2.0-rc.1`) will republish once W61 lands the core fixes.

## Scope
Make the landing page come alive with liquiddom. Replaces the static gradient hero with a **`<LiveHero>`** component that animates 4-6 FreeDrop droplet particles drifting in the background (respecting `prefers-reduced-motion`). Adds a chrome-less **`<TryItNow>`** widget between Features and Install — a mini squish-style interactive demo where visitors can hover/click without leaving the landing. Both follow the W59 lessons: `[data-liquid] { background: transparent }`, dispatch `liquiddom:renderer-resolved` for the capability indicator, transparent-DOM "single layer" illusion. **Framework tabs in getting-started moved to W61** (decoupled, lower risk).

## Inputs
- W41 — `LiquidDOM.create({ renderer })` + `auto`-fallback + `instance.activeRenderer`
- W43 + W44 + W45 — FreeDrop entity + `spawnDroplet()` + auto-cull at viewport-exit (the hero polls slot[2] for cull detection)
- W46 — `gravity` option for FreeDrop drift
- W58 — `renderer-store.ts` + `<RendererToggle>` (capability indicator from W59 reads our event)
- W59 — `<DemoEmbed showChrome={false}>`, `wireDemoEmbed`, `createSquishShowcase`, `liquiddom:renderer-resolved` event contract, `[data-liquid] { background: transparent }` invariant

## Outputs
- `site/src/components/LiveHero.astro` — full-bleed background canvas behind hero text, FreeDrop droplets drifting under gentle gravity, reduced-motion-aware
- `site/src/components/TryItNow.astro` — chrome-less DemoEmbed wrapping a squish-style interactive widget
- `site/src/showcases/hero-blobs.ts` — factory creating the hero LiquidDOM instance + spawns FreeDrop droplets (separate from squish/fusion: different lifecycle, no DOM observation, continuous animation)
- Updated `site/src/pages/index.astro` — replaces static `<section>` hero with `<LiveHero>` background; adds `<TryItNow>` section between Features and Install
- 5 new tests

## Specification

### 1 — `<LiveHero>` component
Renders absolutely-positioned container behind the hero text:

```astro
<section class="relative overflow-hidden">
  <LiveHero />
  <div class="container-page py-20 md:py-32 text-center relative z-10">
    <!-- existing hero text + CTAs from W58 -->
  </div>
</section>
```

`LiveHero.astro` markup:
```html
<div data-live-hero class="absolute inset-0 -z-10" aria-hidden="true">
  <!-- Static CSS gradient: the reduced-motion fallback. Always rendered.
       liquiddom's canvas (when created) paints OVER it. -->
  <div class="absolute inset-0" style="background: radial-gradient(...);"></div>
</div>
```

Inline `<script>`:
- Reads `matchMedia("(prefers-reduced-motion: reduce)")`. If `matches`: does NOT call `createHeroBlobs`. CSS gradient stays as visible background. **Does NOT dispatch `liquiddom:renderer-resolved`** — the capability indicator stays hidden until the user navigates to a showcase, which is correct because zero rendering is happening.
- Otherwise: statically imports `createHeroBlobs`, calls with `getPreference()`. Dispatches `liquiddom:renderer-resolved` AFTER successful mount + AFTER every renderer-change-driven re-mount. Subscribes to `liquiddom:renderer-change` for live swap.
- Cleanup: `beforeunload` → destroy.

### 2 — `createHeroBlobs` factory
`site/src/showcases/hero-blobs.ts`:

```ts
import { LiquidDOM, type LiquidDOMInstance } from "liquiddom";
import type { RendererPreference } from "../lib/renderer-store";

// Known FFI coupling: this factory reads `slot[2] === 0` to detect culled
// FreeDrop droplets (W45 invariant). The buffer layout (9 floats per entity,
// slot 2 = diameter/active-marker for FreeDrop) is documented in CLAUDE.md
// and stable since W42 — but if FLOATS_PER_ENTITY ever changes, update the
// indexing here AND in any other consumer. A future ward should add
// `liquid.getDropletState(id): { alive: boolean }` to the public API to
// insulate consumers from layout changes (W63 backlog).

export interface HeroBlobsHandle {
  instance: LiquidDOMInstance;
  activeRenderer: "canvas2d" | "webgpu";
  // Note: shape diverges from W59 `Showcase` — no DOM observation, no
  // renderer-toggle integration via wireDemoEmbed (LiveHero handles
  // renderer-change directly). Returning a wider shape avoids accidentally
  // routing this through wireDemoEmbed (which expects ShowcaseFactory).
  destroy(): void;
}

const FLOATS_PER_ENTITY = 9;       // mirrors core constant
const SLOT_DIAMETER = 2;           // FreeDrop active marker (W45)

export async function createHeroBlobs(
  root: HTMLElement,
  renderer: RendererPreference,
): Promise<HeroBlobsHandle> {
  const liquid = await LiquidDOM.create({
    capacity: 16,
    autoObserve: false,
    container: root,
    renderer,
    // Soft pastel — light enough that headline text on top stays readable.
    colorDefault: "rgba(120, 160, 220, 0.35)",
    gravity: { source: "fixed", vector: [0, 20] },
  });

  function spawn(opts: { x: number; y: number }): number {
    return liquid.spawnDroplet({
      x: opts.x,
      y: opts.y,
      vx: (Math.random() - 0.5) * 20,
      vy: 5,
      // Consistent-ish radius for visual coherence — small jitter only.
      radius: 28 + Math.random() * 8,
      lifetimeMs: 15_000,
    });
  }

  // Read rect FRESH each spawn (resize-aware). The first spawn batch uses
  // mount-time rect; respawn loop re-reads on each tick.
  const initialRect = root.getBoundingClientRect();
  const ids = new Set<number>();
  for (let i = 0; i < 6; i++) {
    ids.add(spawn({
      x: Math.random() * initialRect.width,
      y: Math.random() * initialRect.height * 0.5,
    }));
  }

  // Respawn culled droplets at the top edge with fresh velocity.
  // Visibility-gated: don't run when tab is hidden (saves CPU).
  // Rect re-read: handles window resize without coordinate drift.
  const respawnTimer = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    const buf = liquid.getBuffer();
    if (!buf) return;
    const currentRect = root.getBoundingClientRect();
    for (const id of ids) {
      if (buf[id * FLOATS_PER_ENTITY + SLOT_DIAMETER] === 0) {
        ids.delete(id);
        ids.add(spawn({
          x: Math.random() * currentRect.width,
          y: -50, // off-screen top
        }));
      }
    }
  }, 500);

  return {
    instance: liquid,
    activeRenderer: liquid.activeRenderer,
    destroy() {
      clearInterval(respawnTimer);
      liquid.destroy();
    },
  };
}
```

### 3 — `<TryItNow>` component
Chrome-less DemoEmbed using W59's `createSquishShowcase`:

```astro
---
import DemoEmbed from "./DemoEmbed.astro";
import squishSrc from "../showcases/squish.ts?raw";
import { extractSnippet } from "../lib/snippet";
const code = extractSnippet(squishSrc);
---
<section class="container-page py-16 md:py-24 text-center">
  <h2 class="text-3xl md:text-4xl font-bold">Try it now</h2>
  <p class="mt-3 text-[var(--color-ink-muted)] max-w-2xl mx-auto">
    Hover any button. Click for a shake. The page is using liquiddom right here.
  </p>
  <div class="mt-10 max-w-3xl mx-auto liquid-stage">
    <DemoEmbed title="" demoId="try-it-now" code={code} showChrome={false}>
      <div class="flex flex-wrap gap-4 items-center justify-center">
        <button data-liquid type="button">Click me</button>
        <button data-liquid type="button">Try me</button>
        <button data-liquid type="button">And me</button>
      </div>
    </DemoEmbed>
  </div>
</section>
<script>
  import { wireDemoEmbed } from "../lib/demo-embed-runtime";
  import { createSquishShowcase } from "../showcases/squish";
  function init() {
    const root = document.querySelector<HTMLElement>('[data-demo-embed="try-it-now"]');
    if (root) wireDemoEmbed(root, createSquishShowcase);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
</script>
<style>
  /* Same W59 transparent-bg pattern. Duplication with squish.astro
     acknowledged — extract to shared module in W63 polish. */
  .liquid-stage :global(button[data-liquid]) {
    background: transparent; border: none; outline: none;
    padding: 0.75rem 1.5rem; color: white; font-weight: 600;
    cursor: grab; user-select: none; position: relative; z-index: 1;
    border-radius: 9999px;
  }
</style>
```

**Hydration timing:** Astro bundled `<script>` runs after DOMContentLoaded. The widget mounts directly — no `IntersectionObserver` gate. Even though TryItNow is below the fold, the simpler hydration is correct: the W59 reviewer correctly flagged IO-gated hydration as premature optimization for this case.

**Renderer-resolved coordination:** Both LiveHero AND TryItNow's wireDemoEmbed dispatch `liquiddom:renderer-resolved`. On landing, both fire after mount. The W59 capability indicator handles each event as last-writer-wins — verified via test #5.

### 4 — Reduced motion
- **LiveHero:** `matchMedia` check at script-init. If reduced: no `LiquidDOM.create`, no droplet spawn, no `renderer-resolved` dispatch. CSS gradient (already present from W58) is the visible hero.
- **TryItNow:** physics-pause is W19's invariant (already handled by liquiddom — `physicsDt=0` under reduced-motion). No extra W60 handling.

### 5 — Performance constraints
- LiveHero hydration: Astro `<script>` is bundled + async by default. The DOMContentLoaded → mount path keeps first paint clear.
- Two simultaneous WASM instances on landing (LiveHero + TryItNow). Known trade-off: ~2× heap. Documented in W59 spec §10; reaffirmed here. Profile in W63 polish; if memory issues surface, may consolidate to shared WASM module instance with multiple `LiquidDOMInstance` references.
- Lighthouse target on `/` lowered from W58's ≥ 90 to **≥ 80** with the live hero. Acceptable trade-off for the "feature demo" landing. **Documented in Pass Criteria below** so the approver sees the intentional regression.

### 6 — What's DEFERRED to W61+
- **W61 (new):** Framework tabs (Vanilla / React / Vue) in `/docs/getting-started/`. Independent of W60; lower-risk; deferred for clean scope separation.
- **W62:** Migrate remaining 6 demos from `demo/scenes/*` + delete `demo/`
- **W63:** API ref autogen, Algolia DocSearch, dark mode, OG images, sitemap, 404 polish. Plus refactors: shared `liquid-stage` CSS module (currently duplicated between squish.astro + TryItNow.astro), `liquid.getDropletState(id)` public API (insulates hero-blobs from FFI buffer-layout coupling), extracted `tabs-runtime.ts` (from W58 install tabs + W61 framework tabs)
- **W63:** `<LiquidElement>` in `@liquiddom/react` + `@liquiddom/vue` auto-applies the `background: transparent` CSS reset

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | landing_has_live_hero | `dist/index.html` contains `data-live-hero` marker AND the section is positioned BEHIND hero text (class contains `-z-10`) |
| 2 | landing_has_try_it_now | `dist/index.html` contains `data-demo-embed="try-it-now"` marker with `data-show-chrome="false"` |
| 3 | hero_blobs_module_exports_factory | `createHeroBlobs` is exported, arity 2, returns Promise rejecting in jsdom (WASM unavailable). Same export-contract pattern as W59's squish/fusion factory tests — tests the MODULE directly, not the Astro `<script>`-tag-bundled invocation (the latter is unachievable in vitest without significant harness work) |
| 4 | hero_blobs_reduced_motion_short_circuit | In a vitest jsdom env: mock `liquiddom` to spy on `create`. Call a small test helper that simulates LiveHero's mount-time reduced-motion check (`matchMedia` mocked to match). Assert `create` was NOT called AND `liquiddom:renderer-resolved` was NOT dispatched on `window`. (Reduced-motion short-circuit must be honest — see r2 revision note) |
| 5 | renderer_resolved_dispatched_after_hero_mount | Same helper but reduced-motion FALSE. Assert `LiquidDOM.create` called once, AND `liquiddom:renderer-resolved` dispatched once with `detail.resolved` set to the mocked `instance.activeRenderer` value. Confirms LiveHero correctly notifies the capability indicator |

## Must NOT
- Initialize `LiquidDOM.create` under `prefers-reduced-motion: reduce` — CSS gradient is the accessibility-first fallback
- Dispatch `liquiddom:renderer-resolved` under reduced-motion — the indicator stays hidden, honestly reflecting that no rendering is happening
- Block first paint with hero hydration — Astro bundled `<script>` is async by default, sufficient for this case
- Use `IntersectionObserver` to gate TryItNow hydration — overengineered for below-fold widget on single-screen landing
- Couple LiveHero to squish/fusion showcases — `createHeroBlobs` is its own module with its own lifecycle
- **Change `FLOATS_PER_ENTITY` (currently 9) without updating `hero-blobs.ts`'s `SLOT_DIAMETER` index.** This is a known FFI coupling; documented in `CLAUDE.md` and at the call site
- Run the respawn `setInterval` when `document.visibilityState !== "visible"` — pure CPU waste on backgrounded tabs

## Must DO
- LiveHero respects `prefers-reduced-motion` by not creating LiquidDOM (CSS gradient remains as fallback)
- `createHeroBlobs` respawn loop:
  - Guards on `document.visibilityState === "visible"` (no CPU waste on hidden tab)
  - Re-reads `root.getBoundingClientRect()` inside the interval (resize-aware coordinate space)
- TryItNow uses W59's `<DemoEmbed showChrome={false}>` + `wireDemoEmbed` pattern — no new lifecycle code
- TryItNow buttons follow W59's `[data-liquid] { background: transparent }` pattern
- All new components have `:focus-visible` styles
- Take screenshots during gold: hero motion ON (animated frame), hero reduced-motion (static gradient), try-it-now interactive, mobile views
- Dispatch code-reviewer agent on implementation before presenting gold

## Manual Smoke Test

### Setup
```bash
cd /Users/Z6DEC/kmddev/liquiddom
npm install
npm run build
npm run build -w @liquiddom/site
cd site && npx astro preview --port 4321
```

### Steps
1. Run: `npm run build -w @liquiddom/site`
   Expected: zero errors. `site/dist/index.html` contains `data-live-hero` AND `data-demo-embed="try-it-now"`.

2. Open `http://localhost:4321/` in Chrome (WebGPU-capable).
   Verify:
   - Hero shows 4-6 soft floating droplets drifting downward in the background
   - Headline text remains crisp + readable
   - Capability indicator on header toggle reads `Active: webgpu` (or `canvas2d`)
   - Below Features: "Try it now" section with 3 buttons. Hover squishes, click impulses.
   - All buttons in transparent-DOM style — single liquid layer, no double-layer

3. DevTools → Rendering → Emulate `prefers-reduced-motion: reduce` → reload.
   Verify:
   - Hero shows STATIC gradient — no motion, no canvas spawned
   - Capability indicator is HIDDEN (no resolved event dispatched, correct behavior)
   - Try-it-now: buttons render, physics paused (per W19), no squish on hover
   - Zero JS errors in console

4. Toggle to Canvas2D in the header. Verify:
   - Hero re-creates without flash
   - Try-it-now re-creates similarly
   - Both indicators update to canvas2d

5. **Agent screenshots + vision verification:**
   - `/` desktop with live hero (one frame) — droplets visible, headline readable
   - `/` desktop reduced-motion — static gradient, no droplets
   - `/` desktop showing try-it-now widget below Features
   - `/` mobile (375px) — hero scales gracefully, try-it-now stacks

6. Lighthouse desktop on `/`:
   - Performance ≥ 80 (intentionally lower than W58's ≥ 90 with live JS animation)
   - Accessibility ≥ 95
   - LCP ≤ 2.5s

### Pass criteria
- [ ] `npm run build -w @liquiddom/site` succeeds with zero errors
- [ ] Live hero animates with droplets on Chrome WebGPU + Canvas2D
- [ ] **Reduced-motion shows static gradient AND capability indicator hidden** (correct accessibility behavior — no rendering, no lie)
- [ ] Try-it-now widget functional + chrome-less
- [ ] Renderer toggle change live-swaps both hero + try-it-now
- [ ] Capability indicator updates with last-writer-wins from either source
- [ ] Mobile layouts work
- [ ] Background tab: hero animation pauses (setInterval visibility guard works)
- [ ] Window resize: respawned droplets use new rect (no coordinate drift)
- [ ] Agent screenshots taken + visually verified
- [ ] All 4 W60 tests pass — r3 cut removed `landing_has_try_it_now` (264 prior baseline-passing + 4 W60 = 268 passing; pre-existing 11 canvas-context failures unchanged; 275 total)
- [ ] **Lighthouse Desktop on `/`: Performance ≥ 80 (intentionally lower than W58 baseline ≥ 90)**, Accessibility ≥ 95, LCP ≤ 2.5s

## Verification
1. `npm run verify` (root) — tests + clippy still pass
2. `npm run build -w @liquiddom/site` succeeds
3. Manual smoke test passes EVERY checkbox
4. Agent takes + visually verifies all screenshots
5. Code-reviewer agent dispatched on implementation before presenting gold
6. **The user runs the manual smoke test from their machine** before approving gold

After gold-approval and `wdd complete 60`: auto-deploys to `https://liquiddom.vsplat.io/` via the W58 workflow. The landing now has live demo on first paint + an interactive widget — the "wow factor" the site was missing.
