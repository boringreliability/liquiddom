---
ward: 86
revision: null
name: "The site"
epic: "fluid-engine"
status: "planned"
dependencies: [85]
layer: "typescript"
estimated_tests: 0
created: "2026-10-23"
completed: null
---
# Ward 086: The site

North star: none — the site is the third consumer of the 0.3 API (slice design §9); the 8 acceptance steps are unchanged. Its landing is the real long page of scroll and parking (step 7) and the page W87 records.

## Scope
Seventh ward of slice 6 (design `docs/superpowers/specs/2026-10-13-liquiddom-slice-6-world-design.md` §9, refined by `docs/superpowers/specs/2026-10-23-liquiddom-site-design.md`, brainstorm with Dennis 2026-10-22). The Astro site, frozen since W66, is rebuilt on the 0.3 API: a dark "Deep water" landing that tells the engine's story in nine scrolling chapters (arrival splash, rest, poke, materials, drag and merge, tilt, scroll and parking, reduced motion, install), a playground port of `demo/scenes/playground.html` (gravity, drag per element, "Copy as code"), five short docs pages, and the site back in the root workspaces, vitest and CI (`e2e:site` blocking on Canvas2D). Whether Astro 6 runs on the root's vite 8 and TypeScript 6, what particle pool a nine-chapter page carries, and what the arrival looks like come from the time-boxed spike W86.0 (plan `docs/superpowers/plans/2026-10-13-fluid-slice-6/W86.md`, part 1); part 2 is written after the gate.

Out of scope: glow and shadow (a renderer ward after W87), a parking counter (no public API), web fonts, dispatching `deploy-site.yml` and publishing `0.3.0-alpha.x` (Dennis' calls), any change to the engine or the public API.

## Inputs
- The slice design §9, §11, §12 (D86-1); the site design (all sections).
- The public API of `liquiddom`, `@liquiddom/react`, `@liquiddom/vue` at W85 (`create()` options incl. `onError`, `forceReducedMotion`, `gravity`; `observe(el, { drag })`; `splash`, `shake`, `setMaterial`, `setGravity`, `requestOrientationPermission`, `presets`).
- `site/` (Astro ^6.3.7, vite ^7.3.3, TypeScript ^5.4, Tailwind ^4.2.4, `liquiddom: "*"`, `astro.config.mjs` site `https://liquiddom.vsplat.io`, `trailingSlash: "always"`); the 0.2 showcases and docs; `SITE.md`; `.github/workflows/deploy-site.yml` and `ci.yml`.
- `demo/scenes/playground.html`, `playground.ts`, `playground-state.ts` (W69, key `liquiddom-playground-v2`), their tests `packages/core/ts/__tests__/playground.test.ts` and `e2e/scenes.spec.ts` (the playground test).
- `packages/core/__tests__/workspace-publish.test.ts` "W66: site freeze" (`:336-358`).
- Baseline at `0698e3d`: see Specification.

## Outputs
- `site/`: the landing, `/playground/`, `/docs/…` (five pages), shared chrome; a workspace consuming core's `dist`.
- The vitest project `./site`, the Playwright project `site` (`e2e:site`, :4176), the CI build and run.
- `SITE.md`, `deploy-site.yml` (still `workflow_dispatch` only) corrected.

## Decisions
<!-- Direction gate (NORTH-STAR.md rule 3). -->
### D86-1: Site content
Proposal: the site is a landing, a playground and short docs on the 0.3 API; the 0.2 showcases (`squish`, `fusion`, `hero-blobs`), the soft-body docs, their components and the eight 0.2 site tests are deleted (chosen in the slice-6 brainstorm, Dennis 2026-10-13; this gate makes it formal).
Consequence: nothing of the 0.2 site survives except the Astro/Tailwind setup and the CNAME; the site only uses public API (no `@internal` hook, no `runtimeOf()`, no scene hook).
Decision: APPROVED 2026-10-23 — landing + playground + short docs on the 0.3 API; every 0.2 page, component and site test deleted; public API only (saga dec_1a032be5)

### D86-2: "Deep water" and the nine-chapter story
Proposal: a night-blue radial gradient on `<html>` (body and sections transparent, W82), luminous liquid colours (cyan `oklch(0.82 0.15 205)`, magenta `oklch(0.72 0.2 340)`, lime `oklch(0.88 0.18 125)`, coral `oklch(0.68 0.22 25)`, tuned at gold), a bold system grotesk, no glow; nine chapters of about one viewport each (0 hero "The DOM, but liquid.", 1 "It's still a button.", 2 "Poke it.", 3 "Water, honey, jelly.", 4 "Grab it. Merge it.", 5 "Tilt your phone.", 6 "It follows you down.", 7 "Calm when you need it.", 8 "Pour it into your app."), English copy, one column on mobile (brainstorm saga dec_94e73a65, dec_e35e6fc4, dec_9a7b3106).
Consequence: the page must stand without glow; every observed element's ancestors stay transparent or the instance falls back to `z-index: 0` with a warning (the W72 fixture fails on none, but the e2e checks the canvas z-index).
Decision: APPROVED 2026-10-23 — Deep water (gradient on <html>, transparent body and sections, luminous cyan/magenta/lime/coral, system grotesk, no glow) and the nine chapters of the site design (saga dec_acb4c4c2)

### D86-3: Instances, pool and the failure line
Proposal: one body-mode instance carries the story (`renderer: 'auto'`, particles and `maxElements` from spike Q2, `onError` set); chapter 3 adds three container instances (`presets.water`, `presets.honey`, `presets.jelly`, one "Shake all"), chapter 7 two (one `forceReducedMotion: true`, one "Splash both"); each container `position: relative; isolation: isolate`, never observed by the body instance. `onError` of any instance hides the controls that drive the liquid and shows "The liquid stopped; the page works as usual." (brainstorm saga dec_59d99679).
Consequence: six instances on one page (six WASM cores, six canvases, one shared module); the pool numbers are measured, not guessed; no parking counter.
Decision: APPROVED 2026-10-23 — body instance particles 18000, maxElements 48 (re-measured at W86.2); five container instances particles 1000, maxElements 2, paused off-screen (IntersectionObserver + pause()/resume()), padded 60–80 px; onError hides the liquid controls and shows one line (saga dec_4016d938)

### D86-4: The arrival and the hint
Proposal: right after the body instance's `create()` resolves, one `splash()` per hero element at a strength chosen in spike Q3, so the liquid flies apart and gathers within 3 s; after about 4 s without a pointer, key, touch or scroll, one soft `shake()` as a hint, cancelled by the first interaction; neither under reduced motion (brainstorm saga dec_40a58bb0).
Consequence: the first frame the visitor sees is moving liquid, not rest; the hero text stays DOM text (Canvas2D halo, WebGPU atlas).
Decision: APPROVED 2026-10-23 — arrival splash 0.8 per hero element, hint shake 0.5 after ~4 s without interaction; neither under reduced motion (saga dec_7265d4e7)

### D86-5: The playground port
Proposal: `/playground/` ports `demo/scenes/playground.html` (Tweakpane in the Deep-water style; three drops, a card, two pills): material live via `setMaterial`, presets, splash/shake with strength, pause/resume, init-only particles/seed/renderer/`forceReducedMotion` via URL params; new: gravity (`none`, `fixed` with a dial, `orientation` on a phone), drag on/off per element (`unobserve` + `observe`), "Copy as code", `onError` with a Restart button. The state module lives once, in the site (`site/src/playground/state.ts`); `demo/scenes/playground.*` is deleted, `playground.test.ts` moves to the site project and the playground test in `e2e/scenes.spec.ts` moves to `e2e:site`. The persisted key becomes `liquiddom-playground-v3`; v1 and v2 are discarded (precedent D69-1).
Consequence: two approved tests (W69) move and change key; the dev server loses its playground scene (the site's `astro dev` is the playground); Tweakpane moves from the root devDependencies to the site's dependencies.
Decision: APPROVED 2026-10-23 — the playground port with gravity, drag per element, Copy as code and Restart; the state lives only in site/src/playground/state.ts, the demo playground is deleted, the W69 tests move, key liquiddom-playground-v3 (saga dec_e625d9ee)

### D86-6: Docs
Proposal: five short Markdown pages in one docs layout (Getting started, API, Adapters, Accessibility, Limitations), Astro's built-in Shiki in a dark theme, no liquid on them; shared header (liquiddom, Playground, Docs, GitHub, a "0.3 alpha" pill) and footer (MIT, GitHub); a drift-guard test fails when an option of `create()`'s whitelist or a method of `LiquidDOMInstance` is missing from the API page.
Consequence: the API page must be kept in step with core; the guard makes a new option a failing test until it is documented.
Decision: APPROVED 2026-10-23 — five Markdown docs pages, dark Shiki, shared chrome, the drift guard (saga dec_1e5620c8)

### D86-7: The site back in the workspace and CI
Proposal: root workspaces `["packages/*", "examples/*", "site"]`; the site consumes core's `dist` like the examples; vite aligns with the root (^8), TypeScript with ^6 (or what spike Q1 shows Astro 6 needs); the lockfile is regenerated; `site/dist` and the `site/node_modules` leftovers are deleted; `ci.yml` builds the site after core; `deploy-site.yml` stays `workflow_dispatch` only, its "fails until slice 6" header goes and its steps are corrected; `SITE.md` is rewritten.
Consequence: the lockfile moves (Astro's tree joins it); CI time grows by the site build and `e2e:site`; dispatching the deploy stays Dennis' call.
Decision: AMENDED 2026-10-23 — Astro 7 (astro ^7.4.2) instead of Astro 6 (every astro@6 needs vite 7); root and site vite ^8.3.5, typescript ^6.0.2; e2e:site serves site/dist with vite preview; a favicon link; rest as proposed (saga dec_2dd947a2)

### D86-8: Tests
Proposal: a vitest project `./site` (the landing's structure, the playground state and "Copy as code", the docs drift guard, `deploy-site.yml` on `workflow_dispatch` only; no `astro build` in vitest); the approved test "W66: site freeze" (`workspace-publish.test.ts:336-358`) is inverted to pin the site in (workspaces, lockfile, vitest project), its `workflow_dispatch`-only pin stays; a Playwright project `site` (`npm run e2e:site`, `vite preview` of the built site on :4176, Canvas2D, blocking in CI): the landing's instances and canvases, scrolling to chapter 6 brings parked cards in at rest, chapter 3's instances run, the playground and every docs page load, no `console.error`; WebGPU locally on Metal; no pixel baselines (vision at gold, the recording in W87). Carried from W85: the Vue twin of React's row 20; `CONTEXT.md` is trimmed before W86 writes to it (8186 of 8192 B).
Consequence: three approved tests change (the W66 freeze, the two W69 playground tests of D86-5) and are approved at red; no Linux baseline moves.
Decision: APPROVED 2026-10-23 — vitest ./site, the inverted W66 freeze test, the moved W69 tests, e2e:site on :4176 blocking on Canvas2D, no pixel baselines, the Vue twin of row 20, CONTEXT.md trimmed first (saga dec_636f1077)

### D86-9: CSS colours the liquid cannot read (oklch)
Proposal: found by spike W86.0: `parseCssColor` (`packages/core/ts/src/color.ts:63`) reads only `rgb()/rgba()` and hex, and Chromium's computed `background-color` of an `oklch()` (or `lab()`, `color()`) value stays in that syntax, so such an element's liquid falls back to the default purple in both renderers. Tailwind 4's default palette is oklch, so every Tailwind 4 app hits it. (a) Fix it in core in W86: a colour the parser does not read is normalised through a 1 × 1 canvas (`fillStyle` = the computed value, one `fillRect`, `getImageData`, cached per string), so every CSS colour the browser paints reaches the liquid as sRGB; a `patch` changeset. (b) Leave core; the site uses hex/rgb for observed backgrounds and the docs list it as a known limitation; fix it in a later ward.
Consequence: (a) touches core's colour snapshot (no API change, one new branch in the snapshot path, jsdom tests through the fake canvas) and closes a bug every Tailwind 4 user hits; (b) keeps W86 site-only but ships the site's own stack (Tailwind 4) with a trap in it.
Decision: APPROVED 2026-10-23 — (a) core normalises a computed colour parseCssColor does not read through a 1 × 1 canvas, cached per string; patch changeset, no API change (saga dec_a223c2a5)

## Spike W86.0 result
Throwaway copy of `ef7e197` (deleted), rough Astro site with the design's nine chapters (35 body elements, 534 511 px², five container instances), Playwright 1.63 at 1280 × 800, DPR 1; Canvas2D in the headless shell, WebGPU in new headless Chromium on Metal; 600 RAF frames per cell after a 2.5 s settle; stills on the manual clock, inspected with vision.

| Q | Finding | Recommendation |
|---|---|---|
| Q1 Astro on vite 8 / TS 6 | Every `astro@6.x` hard-depends on `vite ^7.3`: npm nests vite 7 under Astro, and with Tailwind 4 on the hoisted vite 8 `astro build` fails (`Missing field 'tsconfigPaths' on BindingViteResolvePluginConfig.resolveOptions`); without Tailwind it builds but `astro dev` warns "Astro requires Vite 7". `astro@7.4.2` depends on `vite ^8.3.4`: with root and site `vite ^8.3.5`, `typescript ^6.0.2`, `@astrojs/check ^0.9.12`, Tailwind 4.3.3, install has no peer warning and no override, one vite in the tree; check 0/0/0, build, dev, `astro preview` and `vite preview` serve `application/wasm`; Canvas2D, WebGPU and `auto` create an instance with no console error. Lockfile +5 889 / −1 497 lines. Astro 7's `dev`/`preview` daemonise without a TTY (useless as a Playwright `webServer`); `vite preview` of `site/dist` works. New headless Chromium requests `/favicon.ico` (a 404 `console.error` without a `<link rel="icon">`). Root vitest on vite 8.3.5: green except the three expected failures (no `.git` in the copy, the W66 freeze, the spike's scratch export). | D86-7 amended: **Astro 7** (`astro ^7.4.2`), root and site `vite ^8.3.5`, `typescript ^6.0.2`; `e2e:site` serves `site/dist` with `vite preview`; the layout carries a favicon link |
| Q2 pool | Body cell 8 px, budget = particles · 32 px²: the over-budget warning is silent from 16 704 particles. Body tick ≈ 0.14 ms per 1000 particles per fixed step (at rest p95 1.4 / 1.9 / 2.4 ms at 8k / 12k / 16k, hero view). Hero splashing every second: WebGPU never missed a frame up to 20 000; Canvas2D (headless software raster) misses from 16–17k. Over budget the re-forming liquid is visibly hollow (pills as rings, holes, WebGPU labels missing until rest); at 17 000 solid fills, legible text. Containers: 5 × 2000 cost 4 ms per frame and tick off-screen; 5 × 1000 look like 2000, 500 is noisy and over budget; paused off-screen (an `IntersectionObserver` calling the public `pause()`/`resume()`) they cost 0. Container liquid is clipped hard at the container's box. Parking on the long page works (ch6 cards at rest 2 frames after entering); no z-index fallback warning anywhere. | D86-3: body `particles: 18000`, `maxElements: 48` (re-measured on the real layout at W86.2); containers `particles: 1000`, `maxElements: 2`, paused off-screen, each padded 60–80 px around its card |
| Q3 arrival | Time to rest 2.25–2.5 s at every strength (0.5 / 0.8 / 1.0), both renderers and pools. 0.5 dents, pills keep their shape; 0.8 and 1.0 burst every element into a ring that closes by f30–f60 (1.0 throws more droplets). Within budget (17 000) Canvas2D labels are readable throughout (halo), WebGPU labels are fragments at f10, mostly readable at f30, clean at f90; over budget (8 000) WebGPU labels are gone until rest. Hint from rest: `shake(0.3)` barely visible, `shake(0.5)` a clear, gentle slosh with readable labels; rest 2.33 s. | D86-4: arrival 0.8 (needs the pool within budget), hint 0.5 |
| Found | The site's oklch palette never reached the liquid (default purple) until converted to hex: `#00dff2`, `#f269cb`, `#bdeb58`, `#ff4c4d`. | New D86-9 |

## Specification
**Baseline at `0698e3d`** (W85 complete `c9c1a1a` plus the site design): cargo `245 passed; 0 failed; 1 ignored`; vitest `833 passed (833)`, 84 files; Playwright `--list` canvas2d 102 / webgpu 51 / webgpu-hw 99 / perf 6 / dist 2.

Written after the W86.0 gate (part 2 of the plan).

## Tests
Written after the W86.0 gate (part 2 of the plan).

## Must NOT
- Use `@internal` API, `runtimeOf()` or a scene test hook in the site.
- Change the engine or the public API of any package.
- Move a Linux baseline; dispatch `deploy-site.yml`; publish.
- Change a test Dennis approved without his approval.
- Copy spike code (D2).

## Must DO
- Keep every ancestor of an observed element transparent (W82).
- Run under reduced motion with every control usable and nothing moving.

## Manual Smoke Test
Written after the W86.0 gate (part 2 of the plan).

## Verification
`npm run verify`, `npm run e2e:canvas2d`, `npm run e2e:site`, `npm run e2e:dist`; WebGPU locally; vision of the landing, the playground and the docs in both renderers, desktop and phone width.
