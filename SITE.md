# Public site (`@liquiddom/site`)

Source for [liquiddom.vsplat.io](https://liquiddom.vsplat.io/): the landing page, the material playground and the docs. Astro 7 (static output) + Tailwind 4, Tweakpane 4 on the playground only. The site is an npm workspace (private, ignored by changesets) and consumes core's built `dist` like the examples; it imports only `liquiddom`'s public exports.

- **Landing** (`src/pages/index.astro`, boot script `src/landing/main.ts`): nine chapters (`section[data-chapter="0".."8"]`), one body instance (`particles: 18000`, `maxElements: 48`, `renderer: "auto"`) and five container instances in `.pool` boxes (`particles: 1000`, `maxElements: 2`), paused while off-screen. A stop hides `[data-liquid-control]` and shows `[data-liquid-stopped]`.
- **Playground** (`src/pages/playground/`, `src/playground/`): material, gravity and drag per element in Tweakpane, saved under `localStorage` key `liquiddom-playground-v3`, "Copy as code", Restart. `window.liquiddom` exposes the public instance for devtools.
- **Docs** (`src/pages/docs/*.md` on `DocsLayout.astro`): getting started, API, adapters, accessibility, limitations.

Behaviour lives in small framework-free TypeScript modules under `site/src/`, unit-tested in the vitest project `./site` (jsdom); the pages are thin templates.

## Local development

```bash
# From the repo root
npm run dev -w @liquiddom/site   # predev builds the wasm and core's dist, then astro dev
```

Astro dev server on `http://localhost:4321/` (custom-domain mode, no base path).

## Build

```bash
npm run e2e:site:build           # core's dist, then astro check && astro build
# Output: site/dist/
npm run preview -w @liquiddom/site
```

`npm run build` at the root builds the site too (every workspace), so `npm run verify` covers it. Astro 7 needs Node >= 22.

## Tests

- `npm test` runs the `./site` vitest project with the others.
- `npm run e2e:site` builds the site and runs the blocking Playwright project `site` (`e2e/site.spec.ts`), which serves `site/dist` with Vite's `preview()` on :4176 in Canvas2D. CI runs it in the `e2e` job after the dist smoke. WebGPU is checked locally with vision; there is no WebGPU site project.

## Deployment

`.github/workflows/deploy-site.yml` runs **only on manual dispatch** (dispatching is Dennis' call), and the `github-pages` environment allows deploys only from `master`. The site is live at https://liquiddom.vsplat.io. It installs Rust and wasm-pack, runs `npm ci`, `npm run build:wasm` and `npm run e2e:site:build`, uploads `site/dist/` as a GitHub Pages artifact and deploys it with `actions/deploy-pages@v4`.

## One-time GitHub Pages setup

Done once per repo:

1. GitHub repo → **Settings** → **Pages**
2. **Source**: **GitHub Actions** (not "Deploy from branch")
3. **Custom domain**: `liquiddom.vsplat.io`
4. **Enforce HTTPS**: enabled (available a few minutes after the certificate is provisioned)

`site/public/CNAME` (contents: `liquiddom.vsplat.io`) keeps the custom-domain setting across deploys; without it every deploy would reset the domain.

## DNS configuration

At the registrar that hosts the `vsplat.io` zone, a CNAME record points `liquiddom` to GitHub Pages:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| CNAME | `liquiddom` | `boringreliability.github.io` | 300 (or default) |

Verify with `dig liquiddom.vsplat.io CNAME +short`. Each project on `vsplat.io` has its own CNAME and deploys independently.

## Layout rule: nothing opaque between an observed element and `<html>`

The liquid canvas sits at `z-index: -1` under the page (W82). The page background lives on `<html>` (the night gradient in `global.css`); `<body>`, every section and every wrapper of an observed element stay transparent. A background (any alpha > 0 or a `background-image`) on an ancestor of an observed element puts the instance into the `z-index: 0` fallback with a `console.warn`, and the liquid then covers text. `e2e/site.spec.ts` checks the canvas z-index and that no `[liquiddom]` warning is logged.

A `.pool` (container instance) is `position: relative; isolation: isolate; padding: 96px (48px at 480px and below)`: positioned for the absolutely placed canvas, a stacking context so the liquid goes under its content, padded so a splash stays inside.

## Colour tokens

Defined on `:root` in `src/styles/global.css`:

| Token | Value |
|---|---|
| `--liquid-cyan` | `oklch(0.82 0.15 205)` |
| `--liquid-magenta` | `oklch(0.72 0.2 340)` |
| `--liquid-lime` | `oklch(0.88 0.18 125)` |
| `--liquid-coral` | `oklch(0.68 0.22 25)` |
| `--on-liquid` | `oklch(0.18 0.05 252)` (text on a liquid) |
| `--ink`, `--ink-muted`, `--ink-faint` | page text |

The `.tone-cyan`, `.tone-magenta`, `.tone-lime` and `.tone-coral` classes give an element its liquid colour and the deep `--on-liquid` text. Core reads oklch through its colour probe (D86-9), so the liquid takes the element's colour.
