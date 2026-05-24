# Public site (`@liquiddom/site`)

Source for [liquiddom.vsplat.io](https://liquiddom.vsplat.io/) — landing page + docs. Astro 6 + Tailwind 4. Deployed via GitHub Pages to a custom subdomain on the `vsplat.io` multi-WASM-project hub.

## Local development

```bash
# From repo root
npm run build            # builds wasm + all workspace packages first (one-time after pull)
npm run dev -w @liquiddom/site
```

Astro dev server on `http://localhost:4321/` (custom-domain mode — no base path).

## Production build

```bash
npm run build -w @liquiddom/site
# Output: site/dist/
```

Preview locally:

```bash
npm run preview -w @liquiddom/site
```

## Deployment

`.github/workflows/deploy-site.yml` triggers on push to `master` when any of these change:

- `site/**`
- `packages/**`
- `src/**` (Rust)
- `Cargo.toml` / `Cargo.lock`
- `package.json` / `package-lock.json`

The workflow builds wasm + all packages + the site, then uploads `site/dist/` as a GitHub Pages artifact and deploys via `actions/deploy-pages@v4`.

## ⚠️ One-time GitHub Pages setup

These are done once per repo:

1. GitHub repo → **Settings** → **Pages**
2. **Source**: **GitHub Actions** (not "Deploy from branch")
3. **Custom domain**: `liquiddom.vsplat.io`
4. **Enforce HTTPS**: enabled (becomes available a few minutes after the cert is provisioned)

The `site/public/CNAME` file (contents: `liquiddom.vsplat.io`) is what tells GitHub Pages to keep the custom-domain setting across deploys — without it, every deploy would reset the domain setting.

## DNS configuration

At the registrar that hosts the `vsplat.io` zone, a CNAME record points `liquiddom` to GitHub Pages:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| CNAME | `liquiddom` | `boringreliability.github.io` | 300 (or default) |

Verify propagation with `dig liquiddom.vsplat.io CNAME +short`.

When more projects land on `vsplat.io`, each gets its own CNAME (e.g., `gsplat → boringreliability.github.io` from the gausian splat engine repo). Each subdomain deploys independently.

## Architecture overview

See `.wdd/wards/ward-058.md` for the full spec. Highlights:

- **`renderer-store.ts`** is the single source of truth for the global Canvas2D↔WebGPU toggle. It owns `localStorage` and dispatches `liquiddom:renderer-change` on `window`. No other module touches that storage key or dispatches that event.
- **`<RendererToggle>`** subscribes to the store so external callers (future demo islands) keep the UI in sync.
- All internal links use `import.meta.env.BASE_URL` — never hardcoded `/liquiddom/...` paths.
- Layout: `BaseLayout.astro` → `Header.astro` (with toggle) + `<slot />` + `Footer.astro`.

## Notes for maintainers

- **Vite version split.** Astro 6 requires `vite@^7`; the root `package.json` keeps `vite@^8` for the legacy `demo/` Vite config. The split is enforced via an `overrides` entry in root `package.json` (`@liquiddom/site > vite: ^7.3.3`) so subsequent `npm install` runs cannot accidentally hoist vite 8 into the site's resolution.
- **Vitest workspace migration.** This epic introduced the Vitest 4 `test.projects` pattern in root `vitest.config.ts`, replacing the legacy `vitest.workspace.ts` file (deprecated since Vitest 3). If CI scripts ever reference the old file name, they will silently no-op — there is no such reference today.

## Upcoming wards in the public-site epic

- **W59** — DemoEmbed component + squish & fusion showcase pages + live LiquidDOM hero animation
- **W60** — Migrate remaining 6 demos from `demo/scenes/*.html` into Astro islands; delete `demo/`
- **W61** — API reference autogen, search (Algolia DocSearch), dark mode, sitemap, Open Graph images
