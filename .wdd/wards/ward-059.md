---
ward: 59
revision: null
name: "DemoEmbed + 2 Showcases (squish, fusion) + Snippet Canary + Toggle Indicator"
epic: "public-site"
status: "complete"
dependencies: [41, 58]
layer: "typescript"
estimated_tests: 11
created: "2026-05-24"
completed: "2026-05-24"
---
# Ward 059: DemoEmbed + 2 Showcases (squish, fusion) + Snippet Canary + Toggle Indicator

## Revision history
- r1 (2026-05-24): initial draft — DemoEmbed + showcases + LiveHero + TryItNow + getting-started tabs (14 tests, ~2 wards by reviewer assessment)
- r2 (2026-05-24, post-review): scope cut to demo-system only. LiveHero + TryItNow + framework tabs moved to **W60** (new). Dynamic-import path replaced with factory prop (Vite production build correctness). Canvas lifetime made explicit (W37 §17 fresh-canvas invariant). Test #14 (reduced-motion) deferred to W60 with LiveHero. Test #12 fragility note added. `visibilitychange` instead of `pagehide` for BFCache compat. Multiple WASM instances trade-off acknowledged.

## Scope
Ship the **`<DemoEmbed>`** shared component (canvas slot + Shiki-highlighted code snippet + explanation panel + reset button + powered-by badge, with renderer-toggle live-swap), two showcase modules and pages (`/showcases/squish/`, `/showcases/fusion/`), and the snippet-canary pattern (via Vite's `?raw` import) that W60+ reuse. Also extends the existing `<RendererToggle>` with a capability indicator ("Active: webgpu/canvas2d") that listens to a new `liquiddom:renderer-resolved` event dispatched by mounted demo islands. **Does NOT include** the live-hero animation, the Try-it-now widget, or framework-tab examples in docs — those are W60.

## Inputs
- W41 — `LiquidDOM.create({ renderer, container })` + `instance.activeRenderer` + `WebGPUUnavailableError`. Critically: when `container` is passed, LiquidDOM creates and owns its own `<canvas>` inside that container; `destroy()` removes the canvas. This is the mechanism that handles the W37 §17 fresh-canvas invariant — every renderer-change destroy+create produces a new canvas automatically.
- W58 — `renderer-store.ts` + `<RendererToggle>` + `BaseLayout` + Astro/Tailwind/CNAME deploy pipeline
- `liquiddom@0.2.0-rc.0` on npm

## Outputs
- `site/src/components/DemoEmbed.astro` — shared demo wrapper
- `site/src/showcases/types.ts` — shared `Showcase` interface + `ShowcaseFactory` type
- `site/src/showcases/squish.ts` — Squish showcase module (DOM-observing soft-body)
- `site/src/showcases/fusion.ts` — Fusion showcase module (metaball cluster, WebGPU-different)
- `site/src/pages/showcases/squish.astro` — page wrapping squish in DemoEmbed
- `site/src/pages/showcases/fusion.astro` — page wrapping fusion in DemoEmbed
- `site/src/lib/snippet.ts` — `extractSnippet(src: string): string` utility
- Updated `site/src/components/RendererToggle.astro` — adds capability indicator listening to `liquiddom:renderer-resolved` event
- Updated `site/src/components/Header.astro` — adds "Showcases" nav link (currently 404s; now lands at `/showcases/squish/` as a sensible default)

## Specification

### 1 — `Showcase` interface
```ts
// site/src/showcases/types.ts
import type { LiquidDOMInstance } from "liquiddom";
import type { RendererPreference } from "../lib/renderer-store";

export interface Showcase {
  instance: LiquidDOMInstance;
  activeRenderer: "canvas2d" | "webgpu";
  destroy(): void;
}

export type ShowcaseFactory = (
  root: HTMLElement,
  renderer: RendererPreference,
) => Promise<Showcase>;
```

Both showcase modules export this factory shape.

### 2 — `<DemoEmbed>` component
Astro component. Desktop layout: demo canvas on the left, code panel + explanation panel on the right. Reset button below the code. Mobile: stacked vertically (demo on top).

**Props:**
```ts
interface DemoEmbedProps {
  title: string;
  /** Pre-loaded factory function. The PAGE imports the showcase module and
   *  passes its factory here. Avoids dynamic-import path resolution issues
   *  in Vite production builds (which can't statically analyze template-literal
   *  imports). */
  factory: ShowcaseFactory;
  /** Code snippet to syntax-highlight + display. Page extracts via
   *  `extractSnippet(moduleSrc)` after `?raw` import. */
  code: string;
  /** Code language for Shiki. Defaults to "ts". */
  language?: "ts" | "tsx" | "html";
  /** Hide code+explanation panel + powered-by badge (chrome-less variant
   *  reserved for W60's TryItNow). Defaults to true (show full chrome). */
  showChrome?: boolean;
}
```

The page is responsible for both imports:
```astro
---
import { createSquishShowcase } from "../../showcases/squish";
import squishSrc from "../../showcases/squish.ts?raw";
import { extractSnippet } from "../../lib/snippet";

const code = extractSnippet(squishSrc);
---
<DemoEmbed title="Squish" factory={createSquishShowcase} code={code}>
  ...
</DemoEmbed>
```

**Why factory prop, not showcaseId string:** Vite's production build needs static analysis of all `import()` paths. A template-literal dynamic import like `` import(`/src/showcases/${id}.ts`) `` does NOT get bundled — the file won't exist in `dist/`. Passing the imported factory directly lets Vite trace + bundle the dependency normally. The page writes one extra line; the component stays simple.

**Inline `<script>` in the component:**
1. On mount: read `data-factory` attribute? — NO, can't pass functions through attributes. Solution: the component renders the markup AND its own script which references a globally-registered factory by `data-demo-id`. Each page also includes a small `<script>` that calls `window.__demos = window.__demos ?? {}; window.__demos["squish"] = createSquishShowcase;` BEFORE the DemoEmbed inline script runs. This is awkward.
   
   **Better solution:** DemoEmbed has NO inline script. Each page writes its own initialization script that:
   - Imports the factory statically (`import { createSquishShowcase } from "../../showcases/squish"`)
   - On `DOMContentLoaded`, finds the `<div data-demo-embed>` element, calls `wireDemoEmbed(root, createSquishShowcase)` from a shared helper module
   
   `site/src/lib/demo-embed-runtime.ts` exports `wireDemoEmbed(root, factory)` which handles: getPreference, factory call, dispatching `liquiddom:renderer-resolved`, subscribing to renderer-change, reset button wiring, visibilitychange cleanup, powered-by badge population.
   
   Pages stay thin; component is pure markup; the runtime helper holds all the lifecycle logic in one tested module.

2. **Renderer-change handler** (in `wireDemoEmbed`):
   ```ts
   subscribePreference(async (newPref) => {
     handle.destroy();   // liquiddom.destroy() removes its canvas (W41 mechanism)
     handle = await factory(root, newPref);
     window.dispatchEvent(new CustomEvent("liquiddom:renderer-resolved", {
       detail: { resolved: handle.activeRenderer },
     }));
     poweredByEl.textContent = handle.activeRenderer;
   });
   ```
   The destroy + factory-call sequence works because LiquidDOM (W41) owns and removes its canvas on destroy, then creates a fresh one when re-invoked with the same container. **No manual canvas management required at the DemoEmbed layer** — the W37 §17 fresh-canvas invariant is satisfied by liquiddom's internal lifecycle.

3. **Cleanup on page navigation:** Use `visibilitychange` + `document.visibilityState === "hidden"`, NOT `pagehide`. The latter fires when iOS BFCaches the page; destroying on BFCache-entry prevents the page from being restored. `visibilitychange` lets the user navigate away cleanly without nuking BFCache restoration.

   ```ts
   document.addEventListener("visibilitychange", () => {
     if (document.visibilityState === "hidden") {
       // Soft cleanup: leave the instance alive (BFCache restore-friendly),
       // just freeze if needed. Hard destroy happens on actual unload.
     }
   });
   window.addEventListener("beforeunload", () => handle.destroy());
   ```
   In practice for v1, `beforeunload` is sufficient and BFCache restore is a non-issue (each restore just sees a paused-but-intact instance). Decision: only register `beforeunload` cleanup in W59. Revisit if BFCache issues arise.

### 3 — `<RendererToggle>` capability indicator (extension)
Adds `<span data-renderer-active>` element below the existing buttons, initially empty. Inline script:
- Listens to `liquiddom:renderer-resolved` on `window`
- Reads `detail.resolved`
- Updates the indicator text based on whether `resolved === getPreference()`:
  - Match: `Active: webgpu` (or canvas2d) — neutral muted color
  - Mismatch (e.g., user picked Auto, demo resolved to canvas2d): `Active: canvas2d (WebGPU unavailable)` — slightly more visible color

The indicator is informational — the toggle's selection (`aria-checked`) remains the user's choice.

**Multi-emitter race note:** When W60 lands LiveHero + TryItNow, the landing will have ≥2 demos firing `renderer-resolved`. They should all resolve to the same value on a healthy browser; momentary differences during user-toggle transitions are acceptable (last-writer-wins). If profiling later reveals user-visible flicker, change to debounce or single-emitter-aggregation in W62 polish.

### 4 — Squish showcase
`site/src/showcases/squish.ts`:
```ts
import { LiquidDOM } from "liquiddom";
import type { RendererPreference } from "../lib/renderer-store";
import type { Showcase } from "./types";

export async function createSquishShowcase(
  root: HTMLElement,
  renderer: RendererPreference,
): Promise<Showcase> {
  /* @snippet:start */
  const liquid = await LiquidDOM.create({
    capacity: 8,
    autoObserve: true,
    container: root,
    renderer,
    colorDefault: "oklch(0.51 0.16 250 / 0.75)",
    colorHover: "oklch(0.68 0.22 25 / 0.85)",
  });

  for (const btn of root.querySelectorAll<HTMLButtonElement>("button[data-liquid]")) {
    btn.addEventListener("click", () => liquid.impulse(btn, { magnitude: 12 }));
  }
  /* @snippet:end */

  return {
    instance: liquid,
    activeRenderer: liquid.activeRenderer,
    destroy: () => liquid.destroy(),
  };
}
```

Page renders 3 visible buttons with `data-liquid`. Effect: hover → squish. Click → shake.

### 5 — Fusion showcase
```ts
export async function createFusionShowcase(
  root: HTMLElement,
  renderer: RendererPreference,
): Promise<Showcase> {
  /* @snippet:start */
  const liquid = await LiquidDOM.create({
    capacity: 8,
    autoObserve: true,
    container: root,
    renderer,
    colorDefault: "oklch(0.62 0.21 280 / 0.85)",
    theme: { fusionRadius: 60 },  // WebGPU only — Canvas2D ignores
  });
  /* @snippet:end */

  return {
    instance: liquid,
    activeRenderer: liquid.activeRenderer,
    destroy: () => liquid.destroy(),
  };
}
```

Page renders 5 colored divs in a tight cluster. WebGPU → merged metaball. Canvas2D → 5 separate blobs. **Killer toggle demo.**

### 6 — Snippet canary pattern
`site/src/lib/snippet.ts`:
```ts
export function extractSnippet(src: string): string {
  const m = src.match(/\/\*\s*@snippet:start\s*\*\/([\s\S]*?)\/\*\s*@snippet:end\s*\*\//);
  if (!m) throw new Error("snippet markers missing");
  return m[1]!.trim();
}
```

Page wires it up:
```astro
---
import DemoEmbed from "../../components/DemoEmbed.astro";
import { createSquishShowcase } from "../../showcases/squish";
import squishSrc from "../../showcases/squish.ts?raw";
import { extractSnippet } from "../../lib/snippet";

const code = extractSnippet(squishSrc);
---
<DemoEmbed title="Squish" factory={createSquishShowcase} code={code}>
  <button data-liquid>One</button>
  <button data-liquid>Two</button>
  <button data-liquid>Three</button>
  <Fragment slot="explain">
    <p>Each button is a real DOM element. Hover causes the soft-body
    to squish toward the cursor; click fires <code>impulse()</code> for a shake.</p>
  </Fragment>
</DemoEmbed>
```

**Single source of truth:** the `.ts` file is what's both executed AND displayed.

### 7 — Reduced motion + cleanup invariants
- Showcases use liquiddom's W19 invariant: physics paused under `prefers-reduced-motion`, but observer/render still run. No extra handling at the DemoEmbed layer.
- `beforeunload` triggers `handle.destroy()`. Reset button does `handle.destroy() + factory(root, currentPref)`.
- Multiple DemoEmbeds on the same page: each independent (separate WASM instance). **Known trade-off:** two WASM instances = ~2× heap. The site has at most 1 DemoEmbed per route in W59. W60's TryItNow makes the landing 2-instance (LiveHero + TryItNow); if profiling reveals memory issues, W62 may consolidate.

### 8 — Performance constraints
- Showcase pages: each has ONE DemoEmbed. Acceptable LCP impact ≥ 150ms.
- DemoEmbed initialization should be deferred to `DOMContentLoaded` event — the inline script tag runs after page parse, before image loads.

### 9 — What's DEFERRED to W60+
- **W60:** Live hero animation on landing + TryItNow widget + getting-started framework tabs (vanilla/React/Vue)
- **W61:** Migrate remaining 6 demos from `demo/scenes/*` + delete old `demo/` directory
- **W62:** API reference autogen, Algolia DocSearch, dark mode, OG images, 404 page styling

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | site_builds_with_showcase_routes | Build succeeds. `dist/showcases/squish/index.html` and `dist/showcases/fusion/index.html` exist |
| 2 | showcase_pages_have_demo_embed | Both showcase HTML files contain `data-demo-embed` markers |
| 3 | demo_embed_renders_shiki_highlighted_code | Showcase pages contain Shiki render marker — searches raw HTML string for `astro-code` or `shiki` class on a `<pre>` element. Stable against tokenization changes since Shiki always wraps in one of these |
| 4 | demo_embed_renders_powered_by_badge | Showcase pages contain `data-powered-by` element (chrome=true variant) |
| 5 | demo_embed_renders_reset_button | Showcase pages contain `data-demo-reset` button |
| 6 | extract_snippet_parses_marked_block | `extractSnippet("// foo\n/* @snippet:start */\nconst x = 1;\n/* @snippet:end */\n// bar")` returns `"const x = 1;"` (trimmed) |
| 7 | extract_snippet_throws_on_missing_markers | `extractSnippet("no markers here")` throws Error with message containing "markers missing" |
| 8 | squish_module_exports_factory | `import { createSquishShowcase } from ...`: function with `.length === 2` (arity). Calling it with mock root + "auto" rejects (jsdom doesn't load WASM) — verifies the EXPORT contract, not the runtime path |
| 9 | fusion_module_exports_factory | Same export-shape assertion for `createFusionShowcase` |
| 10 | snippet_in_dist_html_contains_expected_identifiers | For each showcase, the raw HTML string in dist contains expected literal substrings (`LiquidDOM.create` for both; `impulse` for squish; `fusionRadius` for fusion). Shiki preserves these as continuous text-content tokens. Catches markers being stripped or pointing at the wrong block |
| 11 | renderer_toggle_indicator_listens_to_resolved | In jsdom: render Header.astro fixture, dispatch `liquiddom:renderer-resolved` `{ detail: { resolved: "webgpu" } }` on `window`, assert `data-renderer-active` textContent contains `"webgpu"` |

## Must NOT
- Use template-literal dynamic imports in DemoEmbed — they break Vite production builds. Use static imports + factory props.
- Render Shiki at runtime — code highlighting is a build-time concern
- Manually manage canvas elements in DemoEmbed — liquiddom owns its canvas via the `container` param (W41 mechanism)
- Use `pagehide` for cleanup — use `beforeunload` (BFCache-compat)
- Couple DemoEmbed to a specific showcase — accepts `factory` prop, agnostic to which one
- Add `is:inline` to scripts — bundled module scripts (Astro default) for tree-shaking
- Add `liquiddom` as an Astro frontmatter import on showcase pages — it's only imported by the inline runtime + the factory module (so WASM loads client-side)

## Must DO
- `extractSnippet` exported from `site/src/lib/snippet.ts` — tested in isolation, reused by both showcase pages
- All showcase modules accept `(root: HTMLElement, renderer: RendererPreference)` — uniform factory signature
- DemoEmbed/runtime listens to `liquiddom:renderer-change` and re-creates its showcase via destroy + factory()
- DemoEmbed/runtime dispatches `liquiddom:renderer-resolved` after first init AND after every re-init
- All new components have `:focus-visible` styles (Reset button especially)
- Take screenshots during gold-phase verification — see Manual Smoke Test below
- Dispatch code-reviewer agent after gold implementation before presenting to user

## Manual Smoke Test

### Setup
```bash
cd /Users/Z6DEC/kmddev/liquiddom
npm install
npm run build
npm run build -w @liquiddom/site
npm run dev -w @liquiddom/site
```

### Steps
1. Run: `npm run build -w @liquiddom/site`
   Expected: build completes. `site/dist/showcases/squish/index.html` and `.../fusion/index.html` exist.

2. Open `http://localhost:4321/` in Chrome. Header now has "Showcases" link.

3. Click "Showcases" → lands at `/showcases/squish/`. Verify:
   - DemoEmbed visible: left half = 3 buttons, right half = code + explanation
   - Code is syntax-highlighted (Shiki — different colors for `import`, strings, identifiers)
   - "Powered by: webgpu" (or canvas2d) badge top-right of demo area
   - "Reset" button below the code panel
   - Buttons squish on hover, shake on click
   - Capability indicator below header toggle reads `Active: webgpu`

4. Click "Reset". Verify:
   - Demo re-initializes (buttons may briefly flicker as old instance destroys)
   - No console errors
   - Powered-by badge re-populates with same renderer

5. Click "Canvas2D" in the header toggle. Verify:
   - Demo re-creates without page reload
   - Powered-by badge updates to `canvas2d`
   - Capability indicator updates to `Active: canvas2d`
   - Buttons still squish/shake — both renderers handle Squish equivalently

6. Navigate to `/showcases/fusion/`. Verify:
   - 5 colored blobs in a cluster
   - With toggle = WebGPU: blobs visibly merge (metaball fusion)
   - With toggle = Canvas2D: blobs are 5 distinct shapes
   - **Killer demo:** toggle physically changes rendered output

7. Mobile (375px) on both showcase pages. Verify:
   - DemoEmbed stacks: demo on top, code+explanation below
   - Reset button still reachable
   - Capability indicator visible in collapsed header

8. **Agent screenshots + vision verification:**
   - `/showcases/squish/` desktop — DemoEmbed full chrome
   - `/showcases/fusion/` WebGPU — show metaball fusion
   - `/showcases/fusion/` Canvas2D — show distinct blobs (the toggle's value)
   - `/showcases/squish/` mobile — DemoEmbed stacks
   - Reset button before + after interaction
   - Capability indicator in match state (e.g., picked WebGPU, resolved WebGPU) and mismatch state (picked WebGPU, resolved canvas2d on non-WebGPU browser — emulated if needed)

9. Lighthouse desktop on `/showcases/squish/`:
   - Performance ≥ 85
   - Accessibility ≥ 95

### Pass criteria
- [ ] `npm run build -w @liquiddom/site` succeeds with zero errors
- [ ] Both `/showcases/squish/` and `/showcases/fusion/` return HTTP 200 in `astro preview`
- [ ] All 6 W58 routes still work
- [ ] DemoEmbed renders syntax-highlighted code, working buttons, working Reset
- [ ] Fusion demo visibly differs between Canvas2D and WebGPU
- [ ] Capability indicator on toggle shows `Active: webgpu`/`canvas2d` after demo loads
- [ ] Renderer toggle change live-swaps showcase demos (no reload)
- [ ] Reset button re-initializes only its own demo
- [ ] Mobile layouts work
- [ ] Agent screenshots taken + visually verified before presenting gold
- [ ] All 11 W59 tests pass (258 prior + 11 W59 = 269; pre-existing 11 canvas-context failures unchanged)
- [ ] Lighthouse Desktop: Performance ≥ 85, Accessibility ≥ 95 on showcase pages

## Verification
1. `npm run verify` (root) — tests + clippy still pass
2. `npm run build -w @liquiddom/site` succeeds
3. Manual smoke test above passes EVERY checkbox
4. Agent takes + visually verifies all screenshots in step 8
5. Code-reviewer agent dispatched on the implementation before presenting gold
6. **The user runs the manual smoke test from their machine** before approving gold

After gold-approval and `wdd complete 59`: deployed automatically at `https://liquiddom.vsplat.io/showcases/squish/` and `.../fusion/` via the W58 workflow.
