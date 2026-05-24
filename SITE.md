# Public site (`@liquiddom/site`)

Source for [liquiddom.dev](https://boringreliability.github.io/liquiddom/) — landing page + docs. Astro 6 + Tailwind 4.

## Local development

```bash
# From repo root
npm run build            # builds wasm + all workspace packages first (one-time after pull)
npm run dev -w @liquiddom/site
```

Astro dev server on `http://localhost:4321/liquiddom/` (note the `/liquiddom/` base — matches GitHub Pages deployment).

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

Before the first deploy succeeds, the repo owner must configure GitHub Pages source:

1. GitHub repo → **Settings** → **Pages**
2. **Source**: select **GitHub Actions** (not the default "Deploy from branch")
3. Save

After that, every push to `master` that touches a watched path triggers a build and deploy.

## Custom domain (deferred)

When ready to point `liquiddom.dev` (or another domain) at the site:

1. Add a CNAME record in the DNS provider pointing to `boringreliability.github.io`
2. In GitHub Pages settings → set custom domain
3. Update `site/astro.config.mjs`:
   - Set `site` to the new domain (e.g., `https://liquiddom.dev`)
   - Set `base: "/"` (or remove it)
4. Add a `site/public/CNAME` file with the domain on one line

Custom domain is out of scope for W58 — documented for future reference.

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
