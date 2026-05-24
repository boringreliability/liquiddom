---
ward: 58
revision: null
name: "Site Foundation: Astro + Landing Skeleton + Renderer Toggle + Deploy Workflow"
epic: "public-site"
status: "complete"
dependencies: [41, 51]
layer: "typescript"
estimated_tests: 11
created: "2026-05-23"
completed: "2026-05-24"
---
# Ward 058: Site Foundation: Astro + Landing Skeleton + Renderer Toggle + Deploy Workflow

## Revision history
- r1 (2026-05-23): initial draft — scope was 1.5 wards (incl. DemoEmbed + showcases + live hero)
- r2 (2026-05-23): scope reduced. DemoEmbed, showcases (squish/fusion), and live-hero animation moved to **W59**. W58 ships the foundation: Astro bootstrap, layout, renderer-store + toggle, landing skeleton (static hero), docs page skeletons, and deploy workflow. Tailwind 4 dependency block cleaned (`@tailwindcss/vite` only, removed `@astrojs/tailwind`). Snippet-canary test approach deferred to W59 with `?raw` import. SubscribePreference SSR guard explicitly added.
- r2.1 (2026-05-23, post-test-review): test count 10→11 — added `renderer_store_get_handles_localstorage_failure` to cover the defense-in-depth try/catch around `getItem`. Documented `import.meta.env.BASE_URL` compliance check as a known coverage gap (deferred to W59 build-time path scan).

## Known coverage gaps (deferred)
- **Base-path compliance scan.** Spec §1 Must NOT says "hard-coded `/liquiddom/...` paths are forbidden — components must use `import.meta.env.BASE_URL`." No test currently asserts this against built HTML. Defer to W59 where a `dist/**/*.html` regex scan can also enforce the showcase pages' link patterns.

## Scope
Bootstrap a new Astro-based public site under `site/` and ship the **foundation** of Epic 14: Astro + Tailwind 4 project structure, a `BaseLayout` with header + footer, a global `<RendererToggle>` segmented control wired to a single-source-of-truth `renderer-store.ts` module (localStorage + cross-island event bus), a landing page with hero (static gradient + headline + CTAs — no live demo yet), features grid, install snippet section, and footer, plus three doc page skeletons (`/docs/`, `/docs/getting-started/`, `/docs/core-concepts/`) and a GitHub Pages deployment workflow. Parallel-coexists with the existing `demo/` directory. **The live-physics hero, the DemoEmbed component, and the squish/fusion showcases are W59's job.**

## Inputs
- W41 — `LiquidDOM.create({ renderer: 'auto' | 'canvas2d' | 'webgpu' })` + `instance.activeRenderer` (the renderer-store contract aligns with these three values)
- W51 — workspace + published `0.2.0-rc.0` on npm (the landing's install snippet references real npm names)

Note: W47 + W48 are NOT direct inputs to W58 — they become relevant in W59 when docs add framework-specific code-tab examples.

## Outputs
- `site/` — new npm workspace package containing the Astro site (`"private": true`)
- `site/src/lib/renderer-store.ts` — localStorage-backed renderer preference + `CustomEvent` bus
- `site/src/components/RendererToggle.astro` — header segmented control (Auto / WebGPU / Canvas2D), keyboard + ARIA
- `site/src/components/Header.astro` — site header containing the toggle + nav + brand
- `site/src/components/Footer.astro` — links to docs, GitHub, npm, MIT
- `site/src/layouts/BaseLayout.astro` — page chrome (header + footer + html boilerplate)
- `site/src/pages/index.astro` — landing page (static hero, features, install snippet, footer via layout)
- `site/src/pages/docs/{index,getting-started,core-concepts}.astro` — doc skeletons with content but no live demos
- `site/src/styles/global.css` — Tailwind 4 imports + theme tokens
- `site/__tests__/*.test.ts` — Vitest tests for renderer-store + build output + workflow validation
- `.github/workflows/deploy-site.yml` — GitHub Pages deploy on push to master
- Updated root `package.json` workspaces to include `site/`
- Updated `vitest.workspace.ts` to include `site/__tests__/`

## Specification

### 1 — Astro project under `site/`
Astro 5.x (latest stable). Package.json:
```jsonc
{
  "name": "@liquiddom/site",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "test": "vitest run"
  },
  "dependencies": {
    "liquiddom": "*",
    "astro": "^5.x"
  },
  "devDependencies": {
    "@astrojs/check": "latest",
    "@tailwindcss/vite": "^4.x",
    "tailwindcss": "^4.x",
    "typescript": "^5.4.0",
    "vitest": "^4.x",
    "jsdom": "^25.x"
  }
}
```

**Important:** use only `@tailwindcss/vite` — NOT `@astrojs/tailwind` (the legacy integration ships Tailwind 3 internally and would conflict with Tailwind 4).

Astro config (`site/astro.config.mjs`):
```js
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "static",
  site: "https://boringreliability.github.io",
  base: "/liquiddom",
  vite: { plugins: [tailwindcss()] },
});
```

**Base path concern:** all internal links MUST use `import.meta.env.BASE_URL` (Astro provides this) or Astro's `<a href={import.meta.env.BASE_URL + "/docs/"}>` pattern. Hard-coded `/liquiddom/...` strings are forbidden — single source of truth lives in `astro.config.mjs`.

Add `"site"` to root `package.json` workspaces. Site is `"private": true` so changesets won't try to publish or validate its deps.

### 2 — `renderer-store.ts` — global toggle state
A single source-of-truth module:

```ts
export type RendererPreference = "auto" | "webgpu" | "canvas2d";

const STORAGE_KEY = "liquiddom-renderer-preference";
const EVENT_NAME = "liquiddom:renderer-change";

export function getPreference(): RendererPreference {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "auto" || raw === "webgpu" || raw === "canvas2d") return raw;
  } catch {
    // Private mode / disabled storage — fall through to default.
  }
  return "auto";
}

export function setPreference(value: RendererPreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // localStorage failure must not block the event — the toggle UI should
    // still update for the session even if persistence fails.
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { preference: value } }));
}

export function subscribePreference(
  cb: (value: RendererPreference) => void,
): () => void {
  if (typeof window === "undefined") return () => {};  // SSR no-op
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<{ preference: RendererPreference }>).detail;
    cb(detail.preference);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
```

**SSR-safety:** every entry point guards `typeof window`. `subscribePreference` returns a no-op cleanup on SSR. `getPreference` returns `"auto"` on SSR (matches W41's runtime default).

**Single-source-of-truth invariant:** this module is the ONLY place in `site/` that touches `localStorage` for the renderer preference, and the ONLY place that dispatches `liquiddom:renderer-change`. Linted via the Must NOT list below.

### 3 — `<RendererToggle>` header component
Astro component with a tiny inline `<script>` for client-side hydration.

```html
<div role="radiogroup" aria-label="Renderer" data-renderer-toggle>
  <button role="radio" data-pref="auto" aria-checked="true">Auto</button>
  <button role="radio" data-pref="webgpu" aria-checked="false">WebGPU</button>
  <button role="radio" data-pref="canvas2d" aria-checked="false">Canvas2D</button>
</div>
```

On mount (inline script):
- Reads `getPreference()`, sets the matching button's `aria-checked="true"`
- On click: calls `setPreference(button.dataset.pref)`. The store dispatches the event. The toggle subscribes (`subscribePreference`) to update its own UI when ANY caller changes the preference — keeps the toggle in sync if a future ward adds a "switch renderer" link inside a demo.
- Keyboard: arrow keys cycle buttons; Enter/Space activate
- Styled via Tailwind utilities + a small custom rule for the segmented-look (rounded full + active state).

W58 does NOT show a "Active: webgpu / canvas2d" capability indicator (that requires a live demo reporting back its `instance.activeRenderer`). The indicator is a W59 addition once DemoEmbed exists.

### 4 — `<Header>`, `<Footer>`, `<BaseLayout>`
**`Header.astro`**: brand on the left (text "liquiddom" + small SVG mark), nav links in the middle (Docs, Showcases — link target is `/showcases/` even though no showcases exist yet in W58; will 404 until W59. This is acceptable for foundation-phase — the menu structure ships now, the target lands in W59). RendererToggle on the right.

**`Footer.astro`**: three columns — links to docs, repo (`https://github.com/boringreliability/liquiddom`), npm packages. License line: "MIT © Dennis Schmock".

**`BaseLayout.astro`**: HTML boilerplate, `<head>` (title, description, charset, viewport), `lang="en"`, `<body>` with Header + slot + Footer. All pages use this layout.

### 5 — Landing page (`/`)
W58 ships the LANDING SKELETON. No live demos. Sections:

1. **Hero** — static. Background: subtle CSS gradient (oklch-based, mathematical look). Foreground: big headline "Physical DOM, without sacrificing accessibility", subtitle paragraph, two CTAs ("Get started" → `/docs/getting-started/`, "View on GitHub" → repo). The live `LiquidDOM` background animation is W59.
2. **Features grid** — 3 cards: "Real DOM, real a11y" / "WebGPU when available" / "Framework adapters (React + Vue)". Cards are static text + icon (use Lucide-style SVG inline; no icon library dependency).
3. **Install snippet** — tabs for `npm` / `pnpm` / `yarn`. JS interactivity is minimal: click tab → swap visible code block. Use Tailwind classes + a tiny inline script. Each tab shows the matching install command for all three packages (`npm install liquiddom @liquiddom/react @liquiddom/vue`).
4. **Footer** (from layout)

Landing must be visually compelling EVEN WITHOUT live physics — a great gradient hero + crisp typography carries it. W59's live hero is a delight upgrade, not the load-bearing visual.

### 6 — Docs pages
- `/docs/` — index with two cards: "Getting Started" / "Core Concepts". Brief description of each.
- `/docs/getting-started/` — install command + minimal create-instance example (vanilla TS only in W58; React + Vue tabs added in W59). Static markdown-style prose.
- `/docs/core-concepts/` — Rule of Two diagram (ASCII art in a `<pre>` block — the same one from root README), FFI buffer layout table, RAF loop ordering, liquid_type dispatch table. All static content.

Each page uses `BaseLayout`. **No live demos in W58 docs** — they ship in W59+.

### 7 — Tailwind 4 + design tokens
Use Tailwind 4 CSS-first via `@tailwindcss/vite`. Global stylesheet `site/src/styles/global.css`:
```css
@import "tailwindcss";

@theme {
  /* Liquid brand */
  --color-liquid-primary: oklch(0.51 0.13 250);   /* deep cool blue */
  --color-liquid-accent: oklch(0.65 0.21 25);     /* coral */
  --color-surface: oklch(0.98 0.005 250);          /* near-white */
  --color-surface-strong: oklch(0.92 0.01 250);   /* card backgrounds */
  --color-ink: oklch(0.2 0.015 250);              /* near-black */
  --font-display: ui-sans-serif, system-ui, sans-serif;
  --font-body: ui-sans-serif, system-ui, sans-serif;
}

html { font-family: var(--font-body); color: var(--color-ink); background: var(--color-surface); }
```

Globally imported in `BaseLayout.astro`.

`prefers-reduced-motion: reduce` honored — CSS rule that disables CSS-only animations (no JS toggle needed in W58; W59's live hero will read `liquid.isReducedMotion`).

### 8 — GitHub Pages deploy workflow
`.github/workflows/deploy-site.yml`:

```yaml
name: Deploy site

on:
  push:
    branches: [master]
    paths:
      - "site/**"
      - "packages/**"
      - "src/**"          # Rust source — site rebuilds when wasm changes
      - "Cargo.toml"
      - "Cargo.lock"
      - ".github/workflows/deploy-site.yml"

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
      - name: Install wasm-pack
        uses: jetli/wasm-pack-action@v0.4.0
      - name: Setup Node 22
        uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - name: Install npm deps
        run: npm ci
      - name: Build (wasm + all packages)
        run: npm run build
      - name: Build site
        run: npm run build -w @liquiddom/site
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with: { path: site/dist }
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
```

**Path filter:** `pkg/` is gitignored, so we use `src/` (Rust source) instead. `Cargo.toml` + `Cargo.lock` cover the case where dependencies change.

**Workflow runs on `push: master` only** — NOT on PRs (avoids burning Actions minutes). Preview deploys are deferred to Vercel if/when adopted later.

**One-time manual step:** GitHub repo settings → Pages → set source to "GitHub Actions". Documented in Manual Smoke Test.

### 9 — TypeScript + strictness
`site/tsconfig.json`:
```jsonc
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"]
}
```
Astro's `strict` preset is appropriate.

### 10 — What's DEFERRED to W59 (explicitly out of scope here)
- DemoEmbed component
- Squish + Fusion showcase modules and pages
- The live `LiquidDOM` hero animation on the landing page
- "Try it now" widget on landing
- "Active: webgpu/canvas2d" capability indicator on the RendererToggle
- React/Vue code-tab examples in `/docs/getting-started/`
- Snippet-canary test pattern (using `?raw` import — moves with showcases to W59)

## Tests

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | astro_site_builds | `npm run build -w @liquiddom/site` exits 0; `site/dist/` exists with `index.html`, `docs/index.html`, `docs/getting-started/index.html`, `docs/core-concepts/index.html` |
| 2 | landing_has_hero_and_install | `site/dist/index.html` contains the hero headline text AND a visible `npm install` snippet referencing all three packages |
| 3 | every_page_has_renderer_toggle_markup | Every built HTML file under `site/dist/` (except a future 404) contains `data-renderer-toggle` marker — the toggle is in the shared layout |
| 4 | docs_pages_contain_zero_demo_markers | Each `docs/*/index.html` contains zero `<demo-embed>` or `data-demo-embed` markers — W58 docs are demo-free by design |
| 5 | renderer_store_default_is_auto | `getPreference()` in jsdom (no localStorage entry) returns `"auto"` |
| 6 | renderer_store_persists_on_set | `setPreference("webgpu")` → `localStorage` contains `liquiddom-renderer-preference=webgpu`; next `getPreference()` returns `"webgpu"` |
| 7 | renderer_store_emits_change_event | `setPreference("canvas2d")` dispatches `liquiddom:renderer-change` on `window` with `detail.preference === "canvas2d"` |
| 8 | renderer_store_handles_localstorage_failure | `setPreference()` in a jsdom env where `localStorage.setItem` throws does NOT throw; event still fires |
| 9 | renderer_store_get_handles_localstorage_failure | `getPreference()` in a jsdom env where `localStorage.getItem` throws does NOT throw; falls back to `"auto"` (defense-in-depth: private-mode read failures must not crash) |
| 10 | renderer_store_subscribe_returns_unsubscribe | `subscribePreference(cb)` returns a function; calling it removes the listener; subsequent dispatch does NOT invoke `cb` |
| 11 | deploy_workflow_exists_and_is_valid | `.github/workflows/deploy-site.yml` exists; parses as valid YAML; has `on: push: branches: [master]`, `pages: write` permission, `actions/deploy-pages@v4` step, AND path filter includes `site/**` |

## Must NOT
- Delete or modify any file under `demo/` — parallel-coexist until W60 (renumbered from old W59)
- Publish the site as an npm package (it's `"private": true`)
- Read `localStorage` outside of `renderer-store.ts` (single-source-of-truth invariant)
- Dispatch the `liquiddom:renderer-change` event outside of `renderer-store.ts`
- Hard-code `boringreliability.github.io` or `/liquiddom` paths in components — `astro.config.mjs` is the single source of truth; use `import.meta.env.BASE_URL` for links
- Include React or Vue in the site's runtime bundle for W58 — vanilla TS only
- Use Tailwind 3 or `@astrojs/tailwind` — Tailwind 4 + `@tailwindcss/vite` only
- Run the deploy workflow on PRs — `push: master` only

## Must DO
- All paths under `site/src/` use TypeScript strict mode (`tsconfig.json` extends `astro/tsconfigs/strict`)
- `renderer-store.ts` and `RendererToggle` BOTH handle SSR — every `localStorage` and `window.dispatchEvent` access guarded by `typeof window !== "undefined"`
- Add `site/` to root `package.json` workspaces
- Update `vitest.workspace.ts` to include `site/__tests__/`
- Document the one-time GitHub Pages "set source to GitHub Actions" step in `SITE.md` at repo root (or in the W58 ward Manual Smoke Test, copied into the repo for ongoing reference)
- Take screenshots during gold-phase verification — see Manual Smoke Test below
- Verify keyboard navigation: Tab cycles through interactive elements, RendererToggle responds to arrow keys + Enter/Space
- All interactive elements (buttons, links, toggle) have `:focus-visible` styles

## Manual Smoke Test

### Setup
```bash
# From repo root, with W58 implementation in place
cd /Users/Z6DEC/kmddev/liquiddom
npm install                          # picks up new site/ workspace
npm run build                        # wasm + all packages
npm run build -w @liquiddom/site     # astro build → site/dist
npm run dev -w @liquiddom/site       # astro dev → http://localhost:4321
```

### Steps
1. Run: `npm run build -w @liquiddom/site`
   Expected: `astro build` completes with zero errors and zero warnings. Output:
   ```
   site/dist/index.html
   site/dist/docs/index.html
   site/dist/docs/getting-started/index.html
   site/dist/docs/core-concepts/index.html
   ```

2. Run: `npm run dev -w @liquiddom/site`
   Open `http://localhost:4321/liquiddom/` in Chrome.
   Verify:
   - Hero loads with the headline "Physical DOM, without sacrificing accessibility"
   - Two CTAs visible ("Get started", "View on GitHub")
   - Features grid (3 cards) below the hero
   - Install snippet section with `npm` / `pnpm` / `yarn` tabs — clicking a tab swaps the visible command
   - Footer with links
   - Header at the top: brand on left, "Docs" + "Showcases" nav (showcases-link goes to 404 — expected in W58), RendererToggle on right

3. Click "WebGPU" in the toggle.
   Verify:
   - WebGPU button gains active visual state (background fill, `aria-checked="true"` in DevTools)
   - Auto button loses active state
   - Reload the page. Verify the toggle remembers "WebGPU" (localStorage persistence)
   - Click "Auto" — return to default state, reload, verify persistence

4. Navigate to `http://localhost:4321/liquiddom/docs/`
   Verify:
   - Two cards: "Getting Started" / "Core Concepts" with brief descriptions
   - Same header (with toggle still showing previous selection)
   - Click "Getting Started" — page loads, shows install + minimal vanilla TS example
   - Click back, click "Core Concepts" — page loads, shows Rule-of-Two ASCII art + FFI table + RAF loop ordering

5. Keyboard accessibility test:
   - Tab from page load. Verify tab order is: skip-link (if added) → brand link → nav links → toggle → CTAs → footer links
   - Tab to RendererToggle. Press Right arrow — focus moves to next button. Press Space — that button activates.
   - All focused elements have a visible `:focus-visible` outline

6. **Agent screenshots + vision verification:**
   - Screenshot of `/` at 1440px width — verify hero centered, features grid 3-up, install tabs visible
   - Screenshot of `/` at 375px width (mobile) — verify hero stacks, features grid stacks to 1-column, header collapses (hamburger optional — flag if missing)
   - Screenshot of `/docs/` desktop — verify two-card docs index
   - Screenshot of `/docs/getting-started/` desktop — verify install + code example readable
   - Screenshot of `/docs/core-concepts/` desktop — verify ASCII Rule-of-Two diagram renders in mono font
   - Screenshot of RendererToggle in each of the three states (Auto / WebGPU / Canvas2D)
   - **Describe each screenshot in 1-2 sentences in the gold-phase report before claiming ready**

7. Open Chrome DevTools → Lighthouse → run Performance audit on `/` (Desktop preset).
   Expected: Performance ≥ 90, Accessibility ≥ 95 (W58 has NO live JS animation, so this is achievable).

8. Verify the deploy workflow:
   - Open `.github/workflows/deploy-site.yml` — YAML lints clean
   - Path filter includes `site/**`
   - One-time setup note exists in `SITE.md` or equivalent

### Pass criteria
- [ ] `npm run build -w @liquiddom/site` succeeds with zero errors and zero warnings
- [ ] All four routes (`/`, `/docs/`, `/docs/getting-started/`, `/docs/core-concepts/`) return HTTP 200 in `astro preview`
- [ ] Renderer toggle is visible in the header on every route, with `aria-checked` on the active button
- [ ] localStorage persistence works across page reload
- [ ] Tab order is sensible; all focused elements have a visible focus outline
- [ ] Install snippet tabs switch on click
- [ ] Agent has taken + visually verified ALL screenshots listed in step 6
- [ ] All 11 Vitest tests pass (302 prior + 11 W58 = 313 total)
- [ ] Lighthouse Desktop Performance ≥ 90, Accessibility ≥ 95 on `/`
- [ ] `cargo clippy` still 0 warnings (no Rust changes)
- [ ] One-time GitHub Pages setup step is documented in `SITE.md` (or equivalent)

## Verification
1. `npm run verify` (root) — all tests + clippy still pass (302 prior + 11 W58 = 313 tests)
2. `npm run build -w @liquiddom/site` succeeds
3. Manual smoke test above passes EVERY checkbox
4. Agent takes screenshots + describes them with vision before claiming gold-ready
5. Code-review agent dispatched on the implementation before presenting gold to user
6. **The user runs the manual smoke test from their machine** before approving gold — agent's verification is necessary but not sufficient

After gold-approval and `wdd complete 58`, deployment to `boringreliability.github.io/liquiddom` should happen automatically via the new workflow on the next push to master.
