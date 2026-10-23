# liquiddom site (W86): design

Refines §9 of `2026-10-13-liquiddom-slice-6-world-design.md` (binding scope: landing, playground, short docs; the site back in workspaces, vitest and CI; `deploy-site.yml` stays `workflow_dispatch`). Agreed with Dennis in a brainstorm on 2026-10-22 (saga dec_94e73a65, dec_e35e6fc4, dec_9a7b3106, dec_59d99679, dec_40a58bb0); the W86 direction gate turns the choices below into `D86-x` decisions.

## 1. Intent

The site is the third consumer of the 0.3 API, after `examples/react` and `examples/vue`, and the first one built for people rather than tests. "Awesome" means: the first screen is an instant wow, and scrolling tells the story of what the liquid can do, one ability per chapter, ending in `npm install`. The landing is also the real long-page test of scroll and parking that spec §9 and W87's recording need.

It uses only the public API. No `@internal` hook, no `runtimeOf()`, no scene test hooks.

## 2. Visual direction: "Deep water"

- A night-blue radial gradient on `<html>`; `<body>` and every section are transparent, so the canvas at `z-index: -1` shows under the page (W82). No section, card wrapper or layout box between an observed element and `<html>` has a background.
- Liquid colours are saturated and luminous on the dark ground: cyan `oklch(0.82 0.15 205)`, magenta `oklch(0.72 0.2 340)`, lime `oklch(0.88 0.18 125)`, coral `oklch(0.68 0.22 25)` (exact values tuned at gold with vision). Text on observed elements has contrast against its liquid colour.
- A bold system grotesk (no web font); headlines may use gradient text (DOM text, never observed).
- No glow. The liquid draws no `box-shadow` in 0.3; the design must stand without one. Glow and shadow are a later ward after W87 (renderer-only: a density fade under the threshold for a narrow glow, a blurred coverage mask for a wide glow or a shadow).

## 3. The landing

One body-mode instance carries the story (`renderer: 'auto'`, a particle pool and `maxElements` sized by spike W86.0, `onError` set). Chapters 3 and 7 add small container instances (each container `position: relative; isolation: isolate`, its elements never observed by the body instance). Each chapter is about one viewport tall: a short headline, one sentence, the elements to touch. Copy is English.

| # | Chapter | Content | Scene step |
|-|-|-|-|
| 0 | "The DOM, but liquid." | Hero: two pills (Splash / Get started) and three large drops. Arrival: one `splash()` per hero element right after `create()`, the liquid flies apart and gathers within 3 s. Hint: one soft `shake()` after ~4 s without interaction, cancelled by the first pointer, key, touch or scroll. Neither under reduced motion. | wow |
| 1 | "It's still a button." | A small real form (button, link, card) at rest; the copy invites Tab + Enter (splash at the centre, focus ring visible). | 1, 4 |
| 2 | "Poke it." | Pills with the hover swell, splash on click, a strength slider; under WebGPU the label flows with the liquid. | 2, 3 |
| 3 | "Water, honey, jelly." | Three small cards side by side, each in its own container instance created with `presets.water`, `presets.honey`, `presets.jelly`; one "Shake all" button shakes the three. | 6 |
| 4 | "Grab it. Merge it." | Two pills and a card: drag one into the other, they merge and separate. One pill observed with `{ drag: false }`, labelled "I stay put". Touch copy: "hold, then drag". | 5 |
| 5 | "Tilt your phone." | Phone: "Use device tilt" (`requestOrientationPermission()` on iOS, then `setGravity({ source: 'orientation' })`). Desktop: a dial driving `setGravity({ source: 'fixed', vector })`. | tilt |
| 6 | "It follows you down." | A long diagonal run of cards over several viewport heights; the far ones park and appear at rest when reached. No counter (no public API reads parking). | 7 |
| 7 | "Calm when you need it." | Two identical cards, each in its own container instance, one created with `forceReducedMotion: true`; "Splash both" moves one, the other stays still and crisp. One line on print and forced colours. | 8 |
| 8 | "Pour it into your app." | Tabs Vanilla / React / Vue (code taken from the examples), `npm install liquiddom@alpha` with a copy button, links to Playground, Docs, GitHub. | CTA |

**Failure and fallbacks.** `onError` hides every control that drives the liquid and shows one quiet line ("The liquid stopped; the page works as usual."). Without WebGPU the page runs on Canvas2D; without JavaScript it is a readable dark page. Under reduced motion it is still and crisp and every demo control stays usable (it just does nothing visible).

**Mobile.** One column; touch drag by long-press (W84); the tilt chapter offers the device tilt.

## 4. Playground (`/playground/`)

A port of `demo/scenes/playground.html`: Tweakpane in the Deep-water style over a scene of three drops, a card and two pills.

- Kept: material (viscosity, cohesion, recovery) live through `setMaterial`; presets; splash and shake with strength; pause/resume; init-only particles, seed, renderer and `forceReducedMotion` (reload with URL params).
- New: gravity (`none`, `fixed` with a dial, `orientation` on a phone); drag on/off per element (`unobserve` + `observe`, since `drag` is captured once); "Copy as code", which emits the exact `LiquidDOM.create({ … })` and `observe` calls for the current settings.
- The Tweakpane-free state module has one source, not a copy (where it lives is a plan decision). The persisted state gains gravity, so the key becomes `liquiddom-playground-v3` and v2 is discarded (precedent D69-1).
- `onError`: a "The liquid stopped" line with a Restart button (`destroy()` + `create()`).

## 5. Docs (`/docs/…`)

Five short Markdown pages in one docs layout (sidebar, Astro's built-in Shiki in a dark theme), no liquid on them:

1. Getting started: install, the five lines of vanilla, `data-liquid`.
2. API: every `create()` option, every instance method, `ElementOptions`, presets, gravity, the error types.
3. Adapters: React and Vue (`LiquidProvider`, `useLiquid`, `useLiquidError`, `<LiquidElement drag>`), the `onError` pattern.
4. Accessibility: the `aria-hidden` canvas, focus, reduced motion, print, forced colours.
5. Limitations: the known limitations from the core README.

A drift guard test fails when an option of `create()`'s whitelist or a method of `LiquidDOMInstance` is missing from the API page.

Shared chrome: a header (liquiddom, Playground, Docs, GitHub, a "0.3 alpha" pill) and a footer (MIT, GitHub).

## 6. Infrastructure

- Root workspaces become `["packages/*", "examples/*", "site"]`; `liquiddom: "*"` links the workspace package, and the site consumes core's **dist** like the examples. vite aligns with the root (^8) and typescript with ^6; the lockfile is regenerated. Whether Astro 6 builds on vite 8 is spike question Q1.
- Deleted: the 0.2 showcases (`squish`, `fusion`), the soft-body docs (`core-concepts`), the 0.2 components and libs, the eight 0.2 site tests, the stale `site/dist` and the `site/node_modules` leftovers.
- `ci.yml` builds the site after core. `deploy-site.yml` stays `workflow_dispatch` only (dispatching it is Dennis' call); its "fails until slice 6" header goes and its steps are corrected.
- `SITE.md` is rewritten to match (no push trigger, workspace commands that work, no vite override, the vitest project, the CNAME `liquiddom.vsplat.io`).

## 7. Tests

- Vitest project `./site` (fast): the landing's structure (nine chapters), the playground state (v3, URL params, "Copy as code"), the docs drift guard, `deploy-site.yml` on `workflow_dispatch` only. `astro build` does not run in vitest.
- **An approved test changes** (Dennis approves it at red): "W66: site freeze" in `packages/core/__tests__/workspace-publish.test.ts` is inverted to pin the site *in* (workspaces, lockfile, vitest project); the `workflow_dispatch`-only pin stays.
- Playwright `e2e:site`, blocking in CI on Canvas2D: `vite preview` of the built site on :4176; the landing creates its instances and has a canvas; scrolling to chapter 6 brings the parked cards in at rest; chapter 3's three instances run; the playground and every docs page load; no `console.error` (the W72 fixture). WebGPU runs locally on Metal.
- No pixel baselines for the site; vision at gold, recording in W87.
- Carried from W85: the Vue twin of React's row 20; `CONTEXT.md` is trimmed before W86 writes to it (8186 of 8192 B).

## 8. Spike W86.0

Time-boxed, code thrown away:

- Q1: does Astro 6 build and preview with the root's vite ^8 and typescript ^6, serving core's dist WASM?
- Q2: what particle pool and `maxElements` can a page of nine chapters carry (tick p95 with the hero and one chapter active, Canvas2D and WebGPU; looks checked with vision)?
- Q3: what does the arrival splash look like in both renderers, and at what strength?

## 9. Out of scope

Glow and shadow (a ward after W87); a parking counter; web fonts; dispatching `deploy-site.yml`; publishing `0.3.0-alpha.x`.
