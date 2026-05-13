---
ward: 51
revision: 2
name: "NPM Publish Pipeline & Workspace Split"
epic: "framework-adapters-dx"
status: "complete"
dependencies: [47, 48]
layer: "typescript"
estimated_tests: 13
created: "2026-05-10"
completed: "2026-05-13"
---
# Ward 051: NPM Publish Pipeline & Workspace Split

## Scope
Convert the repo to an npm workspace with three publishable packages (`liquiddom`, `@liquiddom/react`, `@liquiddom/vue`). Wire CI (build + test on PR/push) and a tag-driven publish pipeline. The W47 React adapter and W48 Vue adapter move out of `adapters/` into `packages/`. First public NPM release follows on tag `v0.2.0-rc.0` under the `next` dist-tag.

Out of scope (deferred): `examples/vue/` (candidate W56), `@liquiddom/playground` packaging, doc-site reorganization.

## Inputs
- Current single-package layout — `liquiddom` published from repo root, ships `dist/` (TS) + `dist/wasm/` (W35 pattern).
- `adapters/react/index.tsx` (W47, 5 tests) — currently consumed via relative import.
- `adapters/vue/index.ts` (W48, 9 tests) — same.
- `examples/react/` — already exists, currently builds against the workspace by relative path.
- `scripts/copy-wasm.mjs` — patches `dist/index.js` to load WASM from `dist/wasm/` after build. Must continue to work post-migration.
- **Load-bearing path literals** (count revised in r2): `ts/src/index.ts:167` (1 site) and `ts/__tests__/ffi-integration.test.ts:9,15,19` (3 sites). All four contain `../../pkg/liquiddom*` and MUST be re-pathed when the source moves to `packages/core/`.

## Outputs
1. **Workspace root** (`/`) — top-level `package.json` declares `workspaces: ["packages/*", "examples/*"]`, holds shared devDeps, exposes scripts that fan out across packages. `private: true`.
2. **`packages/core/`** — current `liquiddom` package. Owns TS source (`ts/src/**`), TS test suite (`ts/__tests__/**`), `dist/`. **Rust source and `Cargo.toml` stay at repo root** (see Decisions §1). `pkg/` stays at root.
3. **`packages/react/`** — `@liquiddom/react`. Source moves from `adapters/react/` to `packages/react/src/`. Tests move alongside. Declares `liquiddom` as a `peerDependency`.
4. **`packages/vue/`** — `@liquiddom/vue`. Same migration as react.
5. **`tsconfig.base.json`** at root — shared compiler options. Each package's `tsconfig.json` extends it.
6. **`vitest.workspace.ts`** at root — single Vitest invocation runs all package tests (avoids triple jsdom cold-start in CI).
7. **`.changeset/config.json` + initial changeset** bumping all three to `0.2.0-rc.0`.
8. **`.github/workflows/ci.yml`** — install, build WASM, build all packages, run `cargo test`, `cargo clippy -D warnings`, `vitest run`.
9. **`.github/workflows/release.yml`** — on tag `v*`, build, then `npx changeset publish` (handles dist-tag selection from version + only publishes non-private packages).

## Decisions (locked in this spec)
1. **Rust source stays at repo root.** Cargo.toml, `src/`, and `pkg/` stay where they are. Migration touches 4 TS source literals and the `copy-wasm.mjs` regex (see Specification §"path-literal updates"). Moving Rust into `packages/core/` would additionally require updating `Cargo.toml`, wasm-pack invocations, demo `vite.config.ts`, and the dev script — much larger surface for no functional gain.
2. **Independent versioning** (Changesets `linked: []`). Justification: adapters often need bug-fix bumps that don't touch core. **Trade-off accepted:** independent versions can produce peer-range/installed-version mismatches when core minor-bumps. Mitigation: Test #10 (semver.satisfies check on every CI run). If this mitigation proves insufficient in practice, lockstep (`fixed: [["liquiddom","@liquiddom/react","@liquiddom/vue"]]`) is a single-config-line revert.
3. **Peer-dep model for adapters.** `@liquiddom/react` and `@liquiddom/vue` declare `liquiddom: peerDependencies."^0.2.0-rc.0"`. Guarantees one WASM instance across the app (multiple loads would corrupt the shared buffer). `react`/`react-dom` and `vue` are also peers. **Note on prerelease range:** `^0.2.0` excludes prereleases by default (npm + semver convention); we use `^0.2.0-rc.0` so workspace install accepts the in-development `0.2.0-rc.0` version. After stable `0.2.0` ships the range still works via caret semantics (accepts `0.2.x`, `0.3.x`).
4. **Initial public version: `0.2.0-rc.0`** on `next` dist-tag. Promotes to `latest` after manual stability window. Bumping past `0.1.0` avoids confusing any existing local consumers.
5. **No `examples/vue/` in this ward.** Tracked as candidate W56.
6. **Per-package README + LICENSE** (physical copies, not symlinks). Symlinks break `npm pack` on Windows-hosted CI. A pre-publish check asserts each package's `README.md` is non-empty (>200 bytes).
7. **Vitest workspace mode** (single process via `vitest.workspace.ts`). Per-package `vitest run` would triple-cold-start jsdom in CI.

## Specification

### Workspace topology

```
liquiddom/
  Cargo.toml                          # unchanged
  src/                                # unchanged (Rust)
  pkg/                                # unchanged (wasm-pack output)
  scripts/copy-wasm.mjs               # path regex updated for new depth
  tsconfig.base.json                  # NEW: shared compilerOptions
  vitest.workspace.ts                 # NEW: single Vitest runner
  package.json                        # NEW: workspace root (private)
  .changeset/                         # NEW
  .github/workflows/{ci,release}.yml  # NEW
  packages/
    core/
      package.json                    # name: "liquiddom", v0.2.0-rc.0, public
      README.md                       # NEW (trimmed from root README)
      LICENSE                         # COPY of root LICENSE
      tsconfig.build.json             # extends ../../tsconfig.base.json
      vitest.config.ts                # MOVED, rootDir adjusted
      ts/src/                         # MOVED from /ts/src
      ts/__tests__/                   # MOVED from /ts/__tests__
      __tests__/workspace-publish.test.ts  # NEW (this ward's tests)
      dist/                           # build output (gitignored)
    react/
      package.json                    # name: "@liquiddom/react", v0.2.0-rc.0
      README.md                       # NEW
      LICENSE                         # COPY
      tsconfig.build.json             # extends base, composite, refs core
      src/index.tsx                   # MOVED from /adapters/react/index.tsx
      __tests__/                      # MOVED
      dist/
    vue/
      package.json                    # name: "@liquiddom/vue", v0.2.0-rc.0
      README.md
      LICENSE
      tsconfig.build.json
      src/index.ts                    # MOVED from /adapters/vue/index.ts
      __tests__/
      dist/
  examples/
    react/                            # location unchanged; deps updated
  demo/                               # unchanged
  adapters/                           # DELETED after migration
```

### Path-literal updates (load-bearing — failure mode covered by Tests #2 & #8)

Source files containing `../../pkg/liquiddom*` (depth 2 from current `ts/src/` and `ts/__tests__/`) must update to depth 4 because the new path is `packages/core/ts/{src,__tests__}/`:

| File | Sites | From | To |
|---|---|---|---|
| `packages/core/ts/src/index.ts` | 1 (line 167) | `import("../../pkg/liquiddom.js")` | `import("../../../../pkg/liquiddom.js")` |
| `packages/core/ts/__tests__/ffi-integration.test.ts` | 3 (lines 9, 15, 19) | `../../pkg/liquiddom{.js,_bg.wasm}` | `../../../../pkg/liquiddom{.js,_bg.wasm}` |

`scripts/copy-wasm.mjs` regex updates from `/\.\.\/\.\.\/pkg\//g` to `/\.\.\/\.\.\/\.\.\/\.\.\/pkg\//g`, matching the new depth that `tsc` emits into `packages/core/dist/index.js`. The post-patch literal in `dist/index.js` remains `./wasm/liquiddom.js` (unchanged).

### tsconfig layout

`tsconfig.base.json` at root:
```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": false,
    "sourceMap": false
  }
}
```
`declarationMap: false` for published builds — avoids `.d.ts.map` paths leaking workspace structure to consumers (R7).

`packages/core/tsconfig.build.json`:
```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./ts/src"
  },
  "include": ["ts/src/**/*"],
  "exclude": ["ts/__tests__/**/*"]
}
```

`packages/{react,vue}/tsconfig.build.json`:
```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "paths": { "liquiddom": ["../core/ts/src/index.ts"] }
  },
  "references": [{ "path": "../core" }],
  "include": ["src/**/*"]
}
```
The `paths` + `references` combo lets `tsc` resolve `from "liquiddom"` to source during the workspace build without requiring the consumer to use the same configuration.

### Root `package.json` (workspace root, private, not published)

```jsonc
{
  "name": "liquiddom-workspace",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "examples/*"],
  "scripts": {
    "build:wasm": "wasm-pack build --target web --out-dir pkg",
    "build:ts": "npm run build --workspaces --if-present",
    "build": "npm run build:wasm && npm run build:ts",
    "test": "vitest run",
    "test:rust": "cargo test",
    "clippy": "cargo clippy --all-targets --all-features -- -D warnings",
    "verify": "npm run build && npm run test:rust && npm run test && npm run clippy",
    "changeset": "changeset",
    "version": "changeset version",
    "release": "npm run build && npx changeset publish"
  },
  "devDependencies": { /* shared: vitest, jsdom, vite, typescript, @types/*, @vue/*, react, react-dom, vue, @changesets/cli, semver */ }
}
```

### `vitest.workspace.ts`

```ts
import { defineWorkspace } from "vitest/config";
export default defineWorkspace([
  "packages/core/vitest.config.ts",
  "packages/react/vitest.config.ts",
  "packages/vue/vitest.config.ts",
]);
```

### `packages/core/package.json`

```jsonc
{
  "name": "liquiddom",
  "version": "0.2.0-rc.0",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./wasm/liquiddom.js": "./dist/wasm/liquiddom.js"
  },
  "files": ["dist/", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json && node ../../scripts/copy-wasm.mjs",
    "test": "vitest run"
  },
  "publishConfig": { "access": "public" }
}
```
`exports` is narrowed to one explicit subpath (`./wasm/liquiddom.js`) per N6 — consumers don't get unintentional access to internal wasm-pack artifacts.

### `packages/react/package.json` & `packages/vue/package.json`

```jsonc
{
  "name": "@liquiddom/react",
  "version": "0.2.0-rc.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "files": ["dist/", "README.md", "LICENSE"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run"
  },
  "peerDependencies": {
    "liquiddom": "^0.2.0",
    "react": "^18.0.0 || ^19.0.0"
  },
  "publishConfig": { "access": "public" }
}
```
Vue equivalent swaps `react: "^18.0.0 || ^19.0.0"` → `vue: "^3.4.0"`.

### Adapter imports
- Today: `import { LiquidDOM, … } from "../../ts/src/index"` (relative).
- Post-migration: `import { LiquidDOM, … } from "liquiddom"`. Resolves via workspace symlink in-repo; resolves to the published package for external consumers.

### `examples/react/package.json` updates

```jsonc
{
  "private": true,
  "scripts": {
    "predev": "cd ../.. && npm run build:wasm",
    "prebuild": "cd ../.. && npm run build:wasm",
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "liquiddom": "*",
    "@liquiddom/react": "*",
    "react": "^18 || ^19",
    "react-dom": "^18 || ^19"
  }
}
```
`"*"` is the conventional npm-workspace pattern — always resolves to the workspace version. The added `prebuild` hook (parity with the existing `predev`) ensures Test #7 builds against fresh WASM rather than potentially stale `pkg/` from a prior run — found in red-phase test review.

### `.changeset/config.json`

```jsonc
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "master",
  "updateInternalDependencies": "patch",
  "ignore": ["liquiddom-workspace", "liquiddom-react-example"]
}
```
`baseBranch: "master"` matches the current branch. `ignore` lists every private package explicitly so Changesets prompts don't list them.

### CI workflow shape

`ci.yml` triggers on PR + push to `master`:
- Matrix: Node 20, 22 × ubuntu-latest.
- Steps: checkout → `dtolnay/rust-toolchain@stable` → `jetli/wasm-pack-action@v0.4.0` → `actions/setup-node@v4` (cache: npm) → `npm ci` → `npm run build` → `npm run test:rust` → `npm run test` → `npm run clippy`.

`release.yml` triggers on `v*` tag push:
- Same setup. Then `npx changeset publish`. Reads `NPM_TOKEN` secret. Changesets infers dist-tag from version: `-rc.` → `next`, otherwise `latest`.

### Migration steps (corrected from r1 per I1)

1. Add `tsconfig.base.json` at root.
2. Add root `package.json` with workspaces + shared devDeps.
3. Create `packages/core/` skeleton (package.json, tsconfig.build.json, vitest.config.ts, README.md, LICENSE copy).
4. `git mv ts/src packages/core/ts/src` and `git mv ts/__tests__ packages/core/ts/__tests__`.
5. Update path literals in `packages/core/ts/src/index.ts` (1 site) and `packages/core/ts/__tests__/ffi-integration.test.ts` (3 sites) from depth-2 to depth-4 (see §"Path-literal updates").
6. Update `scripts/copy-wasm.mjs` regex + target dir.
7. `npm install` at root → verify symlinks populate.
8. `npm run build -w liquiddom` → assert build succeeds and `packages/core/dist/index.js` contains `./wasm/liquiddom.js`.
9. `vitest run -w liquiddom` → assert existing 124 tests still pass.
10. Create `packages/react/` skeleton (package.json with peerDeps, tsconfig.build.json with composite + refs + paths, README, LICENSE).
11. `git mv adapters/react/index.tsx packages/react/src/index.tsx`. `git mv adapters/react/__tests__ packages/react/__tests__`.
12. Replace `import { … } from "../../ts/src/index"` → `from "liquiddom"` in source + tests.
13. `vitest run -w @liquiddom/react` → assert 5 tests pass.
14. Repeat 10–13 for `packages/vue/` (9 tests).
15. Update `examples/react/package.json` dependencies.
16. `npm install` → `npm run build` inside `examples/react` → assert exit 0.
17. Delete `adapters/`.
18. Add `vitest.workspace.ts` and verify `vitest run` from root runs all packages in one process.
19. Add `.changeset/config.json` + initial changeset.
20. Add `.github/workflows/{ci,release}.yml`.
21. Write Tests #1–#10 in `packages/core/__tests__/workspace-publish.test.ts`. Run `npm run verify` from root.

## Tests
All tests live in `packages/core/__tests__/workspace-publish.test.ts` (vitest + child_process for shell-invoking tests, similar to W35's `runtime-truth.test.ts`).

| # | Test Name | Verifies |
|---|-----------|----------|
| 1 | `workspace_install_resolves_liquiddom_to_workspace_link` | After `npm install` from root, `require.resolve("liquiddom", { paths: [resolve("packages/react")] })` returns a path inside `packages/core/` after `fs.realpath` dereferencing. Same for `packages/vue`. Cross-platform via realpath (covers symlink + junction). |
| 2 | `npm_pack_dry_run_for_core_contains_only_expected_files` | `npm pack --dry-run --json --workspace liquiddom` returns a file list including `dist/index.js`, `dist/index.d.ts`, `dist/wasm/liquiddom.js`, `dist/wasm/liquiddom_bg.wasm`, `README.md`, `LICENSE`, `package.json`. Excludes `src/`, `ts/`, `__tests__/`, `pkg/`, `Cargo.*`, `.changeset/`. |
| 3 | `npm_pack_dry_run_for_react_contains_only_dist` | Same as #2 for `@liquiddom/react`. Asserts NO `liquiddom` source/dist bundled (peer-dep contract). |
| 4 | `npm_pack_dry_run_for_vue_contains_only_dist` | Same as #3 for `@liquiddom/vue`. |
| 5 | `adapter_packages_declare_peer_deps` | Read each adapter's `package.json`, assert `peerDependencies.liquiddom` matches `^0.2.0` and the framework peer (`react` or `vue`) is declared with expected range. |
| 6 | `adapter_dist_imports_liquiddom_by_name` | After build, read `packages/{react,vue}/dist/index.js`, assert content contains `from "liquiddom"` (or equivalent string form) and NOT a relative path matching `(\.\./)+ts/`. Catches accidental relative-import regressions. |
| 7 | `example_react_builds_against_workspace_liquiddom` | Run `npm run build` inside `examples/react`, assert exit 0 + that produced bundle contains identifiers from `@liquiddom/react` (e.g., `LiquidProvider`). Asserts workspace-link resolution by file-path: bundle's import-map should resolve `liquiddom` to a path under `packages/core/`, not under `examples/react/node_modules/liquiddom` registry copy (use `fs.realpath`). |
| 8 | `core_dist_wasm_dynamic_import_resolves_to_packaged_file` | Reads `packages/core/dist/index.js`, extracts the dynamic-import literal for `liquiddom.js`. Asserts the literal is exactly `./wasm/liquiddom.js`. Resolves that path relative to `dist/index.js`, asserts the file exists on disk. This is the test that catches the depth-math failure mode (B1). |
| 9 | `adapter_d_ts_resolves_through_workspace_link` | Asserts `packages/{core,react,vue}/dist/index.d.ts` exist after build. Then runs `tsc --noEmit` against a fixture at `__fixtures__/types-smoke/index.ts` which does `import { LiquidDOM } from "liquiddom"; import { LiquidProvider } from "@liquiddom/react"; import { LiquidElement as VueLiquidElement } from "@liquiddom/vue";`. Verifies the published-shape type graph is internally consistent. |
| 10 | `adapter_peer_dep_range_satisfies_core_version` | Reads `packages/core/package.json.version` and both adapters' `peerDependencies.liquiddom`. Uses `semver.satisfies(coreVersion, peerRange, { includePrerelease: true })`. Asserts true for both adapters. **Pre-release handling:** Decision §4 ships `0.2.0-rc.0` as the first public version — default `satisfies("0.2.0-rc.0", "^0.2.0")` returns false, so `includePrerelease: true` is required. Catches independent-versioning drift (Decision §2 mitigation). |
| 11 | `release_workflow_uses_changeset_publish_only` | Reads `.github/workflows/release.yml`, asserts content includes `changeset publish` (or `changesets/action`) and does NOT include `npm publish --workspaces`. Catches Must-NOT regression. |
| 12 | `changeset_config_matches_spec` | Reads `.changeset/config.json`, asserts `baseBranch === "master"`, `access === "public"`, `linked === []`, `fixed === []`, `ignore` contains `"liquiddom-workspace"` and `"liquiddom-react-example"`. R6 mitigation. |
| 13 | `published_dist_emits_no_declaration_maps` | Walks each package's `dist/`, asserts zero files end in `.d.ts.map`. R7 mitigation against workspace-path leakage. |

All 176 existing tests (43 Rust + 133 TS) MUST continue to pass after migration; this is implicit but stated for clarity. The 13 new tests are W51-specific.

## Must NOT
- Break the import path `from "liquiddom"` for any internal or external consumer.
- Bundle `liquiddom` source/types into either adapter's `dist/` — peer-dep contract is broken if so.
- Publish before all three packages have a green CI run on the publishing branch.
- Couple core to React/Vue. Core has zero framework-aware code; this ward must not introduce any.
- Move `Cargo.toml` or `pkg/` (see Decisions §1).
- Skip the `next` dist-tag for the first publish — `latest` is reserved for the post-soak promotion.
- Use `npm publish --workspaces` in `release.yml` — Changesets handles topology and private-package filtering. One tool, one source of truth.
- Symlink README/LICENSE into packages — breaks Windows-hosted CI on `npm pack`.
- Enable `declarationMap: true` for published builds — leaks workspace paths to consumers.

## Must DO
- `npm pack --dry-run --workspace <name>` for each of the three packages emits the expected file list (Tests #2–#4).
- Workspace install builds all three packages in topological order (core builds before adapters because of peer-dep + tsc reference graph).
- `examples/react` builds against the workspace-linked `@liquiddom/react` + `liquiddom` (Test #7).
- Existing test suite (`cargo test`, `vitest run`) continues to pass from the new locations.
- `clippy` continues to emit zero warnings.
- Dynamic-import literal in `packages/core/dist/index.js` resolves to a file present in `dist/wasm/` (Test #8).

## Risks & Mitigations
- **R1: Path-literal depth change breaks WASM load at runtime.** Mitigation: explicit step 5 in migration order updates all 4 sites; Test #8 verifies the dist artifact's import literal resolves to a real file. The regex in `copy-wasm.mjs` is updated in step 6 to match the new depth.
- **R2: Adapter test files break because they import from `../../ts/src/index`.** Mitigation: step 12 replaces with `from "liquiddom"`; resolves via workspace symlink. Test #6 verifies this in built artifacts.
- **R3: `examples/react/vite.config.ts` has `predev: cd ../.. && npm run build:wasm`.** Path stays valid because Rust source didn't move; verify in step 16.
- **R4: Adapter devDeps (`@vue/test-utils`, `@vue/server-renderer`) need to remain reachable post-split.** Mitigation: keep them as root-level devDeps; npm workspaces hoist them by default. Document this in `packages/vue/README.md` for future contributors.
- **R5: Fresh GHA runners lack Rust + wasm-pack.** Mitigation: `dtolnay/rust-toolchain@stable` + `jetli/wasm-pack-action@v0.4.0` in workflow.
- **R6: Changesets prompts for private packages.** Mitigation: explicit `ignore: ["liquiddom-workspace", "liquiddom-react-example"]` in `.changeset/config.json`.
- **R7: `declarationMap: true` would emit `.d.ts.map` with workspace paths.** Mitigation: `declarationMap: false` in `tsconfig.base.json`. Documented in Decision §6 reasoning chain.
- **R8: Peer-dep range drift between independent versions** (Decision §2 trade-off). Mitigation: Test #10 (`semver.satisfies`) runs in CI.
- **R9: `npm publish --workspaces` and `changeset publish` are redundant.** Resolution: spec chooses `changeset publish` only (Must NOT clause).

## Verification (manual, post-merge)
1. Fresh clone: `npm install && npm run verify`. Expect: builds green, all tests pass, clippy clean.
2. From root: `npm pack --dry-run --workspaces`. Inspect tarball summaries against Tests #2–#4.
3. Tag `v0.2.0-rc.0` on `master`, push. Watch CI → `release.yml` → npm publish under `next` dist-tag.
4. From a scratch project: `npm install liquiddom@next @liquiddom/react@next react react-dom`. Verify all four resolve. Import `<LiquidProvider>` in a Vite app, confirm canvas appears. Repeat for Vue.
