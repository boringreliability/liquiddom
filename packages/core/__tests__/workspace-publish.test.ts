/**
 * Ward 051: NPM Publish Pipeline & Workspace Split — workspace-publishability contract.
 *
 * 13 tests assert the publishable shape of `liquiddom`, `@liquiddom/react`, and
 * `@liquiddom/vue` (file lists, peer deps, dist-import patterns, WASM resolution,
 * type-graph integrity, CI/changesets config, declarationMap leakage).
 *
 * Determinism notes:
 *  - Tests are serial within this file (vitest default). `npm pack --dry-run`
 *    on a shared workspace is read-only and safe to repeat.
 *  - Tests #2–#4, #6, #8, #9, #13 require `npm run build` to have run first.
 *    CI's `npm run verify` builds before testing.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

const __dirname = dirname(fileURLToPath(import.meta.url));
// From packages/core/__tests__/, three levels up is the workspace root.
const ROOT = resolve(__dirname, "../../..");
const CORE = resolve(ROOT, "packages/core");
const REACT = resolve(ROOT, "packages/react");
const VUE = resolve(ROOT, "packages/vue");
const EXAMPLE_REACT = resolve(ROOT, "examples/react");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8"));
}

/** Run command with explicit arg array (no shell interpretation). */
function run(cmd: string, args: string[], cwd: string = ROOT): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
}

/** `npm pack --dry-run --json --workspace <name>` returns the file list bundled at publish. */
function packDryRunFiles(pkgName: string): string[] {
  const raw = run("npm", ["pack", "--dry-run", "--json", "--workspace", pkgName]);
  const parsed = JSON.parse(raw) as Array<{ files: Array<{ path: string }> }>;
  return parsed[0]?.files.map((f) => f.path) ?? [];
}

/** Recursively walk a directory, return relative file paths. */
function walkDir(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: false }) as string[];
}

describe("Ward 051: Workspace topology + publishable shape", () => {
  // ── Test #1 — workspace install resolves liquiddom to workspace link ──
  it("workspace_install_resolves_liquiddom_to_workspace_link", () => {
    expect(existsSync(CORE), `expected ${CORE} to exist`).toBe(true);
    expect(existsSync(REACT), `expected ${REACT} to exist`).toBe(true);
    expect(existsSync(VUE), `expected ${VUE} to exist`).toBe(true);

    // Resolution from each adapter must land inside packages/core/ after
    // realpath dereferencing. A hoisted real-copy at root `node_modules/`
    // would resolve to a path NOT under packages/core, so this check
    // distinguishes workspace-linked from registry-copy installs.
    //
    // (Node's `createRequire().resolve()` already realpath's internally,
    // so comparing raw vs realpath is not a reliable extra signal.)
    for (const adapter of [REACT, VUE]) {
      const requireFromAdapter = createRequire(resolve(adapter, "package.json"));
      const resolved = realpathSync(requireFromAdapter.resolve("liquiddom"));
      expect(
        resolved.startsWith(realpathSync(CORE)),
        `expected liquiddom resolved from ${adapter} to be under ${CORE}, got ${resolved}`,
      ).toBe(true);
    }
  });

  // ── Test #2 — npm pack dry-run for core contains expected files ──
  it("npm_pack_dry_run_for_core_contains_only_expected_files", () => {
    expect(existsSync(resolve(CORE, "package.json"))).toBe(true);

    const files = packDryRunFiles("liquiddom");
    const expected = [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/wasm/liquiddom.js",
      "dist/wasm/liquiddom_bg.wasm",
      "README.md",
      "LICENSE",
      "package.json",
    ];
    for (const f of expected) {
      expect(files.some((entry) => entry.endsWith(f)), `expected ${f} in tarball`).toBe(true);
    }
    // Forbidden inclusions
    const forbidden = [/(^|\/)ts\//, /(^|\/)src\//, /__tests__/, /(^|\/)pkg\//, /Cargo\./, /\.changeset/];
    for (const f of files) {
      for (const re of forbidden) {
        expect(re.test(f), `forbidden path ${f} matched ${re}`).toBe(false);
      }
    }
  });

  // ── Test #3 — npm pack dry-run for @liquiddom/react contains only dist ──
  it("npm_pack_dry_run_for_react_contains_only_dist", () => {
    expect(existsSync(resolve(REACT, "package.json"))).toBe(true);

    const files = packDryRunFiles("@liquiddom/react");
    expect(files.some((f) => f.endsWith("dist/index.js"))).toBe(true);
    expect(files.some((f) => f.endsWith("dist/index.d.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("README.md"))).toBe(true);
    expect(files.some((f) => f.endsWith("LICENSE"))).toBe(true);
    // Peer-dep contract: no liquiddom source/dist bundled inside the adapter tarball.
    for (const f of files) {
      expect(/liquiddom_bg\.wasm/.test(f), `react tarball must not contain WASM (${f})`).toBe(false);
      expect(/liquiddom\/dist\//.test(f), `react tarball must not contain core dist (${f})`).toBe(false);
    }
  });

  // ── Test #4 — npm pack dry-run for @liquiddom/vue contains only dist ──
  it("npm_pack_dry_run_for_vue_contains_only_dist", () => {
    expect(existsSync(resolve(VUE, "package.json"))).toBe(true);

    const files = packDryRunFiles("@liquiddom/vue");
    expect(files.some((f) => f.endsWith("dist/index.js"))).toBe(true);
    expect(files.some((f) => f.endsWith("dist/index.d.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("README.md"))).toBe(true);
    expect(files.some((f) => f.endsWith("LICENSE"))).toBe(true);
    for (const f of files) {
      expect(/liquiddom_bg\.wasm/.test(f), `vue tarball must not contain WASM (${f})`).toBe(false);
      expect(/liquiddom\/dist\//.test(f), `vue tarball must not contain core dist (${f})`).toBe(false);
    }
  });

  // ── Test #5 — adapter packages declare peer deps with expected ranges ──
  it("adapter_packages_declare_peer_deps", () => {
    expect(existsSync(resolve(REACT, "package.json"))).toBe(true);
    expect(existsSync(resolve(VUE, "package.json"))).toBe(true);

    const reactPkg = readJson(resolve(REACT, "package.json"));
    const vuePkg = readJson(resolve(VUE, "package.json"));
    const reactPeers = (reactPkg.peerDependencies ?? {}) as Record<string, string>;
    const vuePeers = (vuePkg.peerDependencies ?? {}) as Record<string, string>;

    // Peer range uses `^0.2.0-rc.0` (not `^0.2.0`) so npm workspace install
    // accepts the in-development prerelease version. After the rc period
    // ends and core publishes `0.2.0` stable, the range still works
    // (^0.2.0-rc.0 accepts 0.2.x, 0.3.x via caret semantics).
    expect(reactPeers.liquiddom).toBe("^0.2.0-rc.0");
    expect(reactPeers.react).toBe("^18.0.0 || ^19.0.0");
    expect(vuePeers.liquiddom).toBe("^0.2.0-rc.0");
    expect(vuePeers.vue).toBe("^3.4.0");
  });

  // ── Test #6 — adapter dist imports liquiddom by package name ──
  it("adapter_dist_imports_liquiddom_by_name", () => {
    for (const adapter of [REACT, VUE]) {
      const distEntry = resolve(adapter, "dist/index.js");
      expect(existsSync(distEntry), `expected ${distEntry} to exist`).toBe(true);

      const content = readFileSync(distEntry, "utf-8");
      const byName = /from\s+["']liquiddom["']/.test(content);
      const bySubpath = /from\s+["']liquiddom\/[^"']+["']/.test(content);
      const byRelative = /from\s+["'](\.\.\/)+ts\//.test(content);
      expect(byName, `expected '${distEntry}' to import liquiddom by bare name`).toBe(true);
      expect(bySubpath, `'${distEntry}' must not import a liquiddom subpath (peer-dep contract)`).toBe(false);
      expect(byRelative, `expected '${distEntry}' to NOT use a relative ts/ import`).toBe(false);
    }
  });

  // ── Test #7 — example/react builds against workspace-linked liquiddom ──
  it("example_react_builds_against_workspace_liquiddom", () => {
    expect(existsSync(EXAMPLE_REACT), `expected ${EXAMPLE_REACT} to exist`).toBe(true);

    // Verify the workspace link resolves into packages/core BEFORE running the build —
    // a registry-installed copy would lurk under examples/react/node_modules and the
    // build might succeed without actually using the workspace.
    const requireFromExample = createRequire(resolve(EXAMPLE_REACT, "package.json"));
    const resolvedCore = realpathSync(requireFromExample.resolve("liquiddom"));
    expect(
      resolvedCore.startsWith(realpathSync(CORE)),
      `example/react must resolve liquiddom to packages/core (got ${resolvedCore})`,
    ).toBe(true);

    // Build (spec requires `prebuild` hook on examples/react/package.json so
    // WASM is rebuilt automatically — that hook is the gold-phase fix for the
    // stale-WASM failure mode caught in red-phase test review).
    run("npm", ["run", "build"], EXAMPLE_REACT);

    const distDir = resolve(EXAMPLE_REACT, "dist");
    expect(existsSync(distDir)).toBe(true);
    expect(statSync(distDir).isDirectory()).toBe(true);

    // Bundle must include an identifier from @liquiddom/react — proves the
    // adapter was actually pulled in, not just type-imported and tree-shaken.
    const bundleFiles = walkDir(distDir).filter((f) => f.endsWith(".js"));
    expect(bundleFiles.length, "expected at least one .js bundle in dist/").toBeGreaterThan(0);
    const allBundleContent = bundleFiles
      .map((f) => readFileSync(resolve(distDir, f), "utf-8"))
      .join("\n");
    expect(
      /LiquidProvider/.test(allBundleContent),
      "expected bundle to contain LiquidProvider identifier from @liquiddom/react",
    ).toBe(true);
  });

  // ── Test #8 — core dist WASM dynamic-import resolves to packaged file ──
  it("core_dist_wasm_dynamic_import_resolves_to_packaged_file", () => {
    const distEntry = resolve(CORE, "dist/index.js");
    expect(existsSync(distEntry), `expected ${distEntry} to exist`).toBe(true);

    const content = readFileSync(distEntry, "utf-8");

    // Pre-assertion (catches B1 silent-no-op regex drift directly):
    // post-patch dist must NOT still reference the source-relative pkg/ path.
    expect(
      /["'](?:\.\.\/)+pkg\//.test(content),
      "copy-wasm.mjs regex must have rewritten the ../../../../pkg/ literal",
    ).toBe(false);

    const match = content.match(/import\(\s*["']([^"']*?liquiddom\.js)["']\s*\)/);
    expect(match, "expected a dynamic import of liquiddom.js in core/dist/index.js").not.toBeNull();
    const literal = match![1];
    expect(literal).toBe("./wasm/liquiddom.js");

    const resolvedWasmJs = resolve(dirname(distEntry), literal);
    expect(existsSync(resolvedWasmJs), `expected WASM loader at ${resolvedWasmJs}`).toBe(true);

    const wasmBinary = resolve(dirname(resolvedWasmJs), "liquiddom_bg.wasm");
    expect(existsSync(wasmBinary), `expected WASM binary at ${wasmBinary}`).toBe(true);
  });

  // ── Test #9 — adapter d.ts type-resolves through workspace link ──
  //
  // Fixture contract for __fixtures__/types-smoke/:
  //   index.ts must import:
  //     import { LiquidDOM } from "liquiddom";
  //     import { LiquidProvider } from "@liquiddom/react";
  //     import { LiquidElement as VueLiquidElement } from "@liquiddom/vue";
  //   …and reference each symbol at least once so tsc cannot tree-shake.
  //   tsconfig.json must extend ../../tsconfig.base.json with "noEmit": true.
  it("adapter_d_ts_resolves_through_workspace_link", () => {
    for (const pkg of [CORE, REACT, VUE]) {
      const dts = resolve(pkg, "dist/index.d.ts");
      expect(existsSync(dts), `expected ${dts} to exist`).toBe(true);
    }

    const fixtureDir = resolve(ROOT, "__fixtures__/types-smoke");
    const fixturePath = resolve(fixtureDir, "index.ts");
    expect(existsSync(fixturePath), `expected ${fixturePath} fixture to exist`).toBe(true);

    run("npx", ["tsc", "--noEmit", "-p", resolve(fixtureDir, "tsconfig.json")]);
  });

  // ── Test #10 — adapter peer-dep ranges satisfy installed core version ──
  it("adapter_peer_dep_range_satisfies_core_version", () => {
    for (const p of [CORE, REACT, VUE]) {
      expect(existsSync(resolve(p, "package.json")), `expected ${p}/package.json to exist`).toBe(true);
    }

    const corePkg = readJson(resolve(CORE, "package.json"));
    const reactPkg = readJson(resolve(REACT, "package.json"));
    const vuePkg = readJson(resolve(VUE, "package.json"));

    const coreVersion = corePkg.version as string;
    const reactPeer = (reactPkg.peerDependencies as Record<string, string>).liquiddom;
    const vuePeer = (vuePkg.peerDependencies as Record<string, string>).liquiddom;

    // `includePrerelease: true` is required because Decision §4 ships
    // `0.2.0-rc.0` as the initial public version, and the peer range `^0.2.0`
    // excludes pre-release tags by default. Both adapters must accept the rc.
    expect(
      semver.satisfies(coreVersion, reactPeer, { includePrerelease: true }),
      `@liquiddom/react peer ${reactPeer} does not satisfy core ${coreVersion} (with prerelease)`,
    ).toBe(true);
    expect(
      semver.satisfies(coreVersion, vuePeer, { includePrerelease: true }),
      `@liquiddom/vue peer ${vuePeer} does not satisfy core ${coreVersion} (with prerelease)`,
    ).toBe(true);
  });

  // ── Test #11 — release.yml uses changeset publish, not npm publish --workspaces ──
  it("release_workflow_uses_changeset_publish_only", () => {
    const releaseYml = resolve(ROOT, ".github/workflows/release.yml");
    expect(existsSync(releaseYml), `expected ${releaseYml} to exist`).toBe(true);

    const yml = readFileSync(releaseYml, "utf-8");
    // Must use changesets path (either the CLI or the official GitHub Action).
    const usesChangeset = /changeset\s+publish/.test(yml) || /changesets\/action/.test(yml);
    expect(usesChangeset, "release.yml must invoke `changeset publish` or use changesets/action").toBe(true);

    // Must NOT use `npm publish --workspaces` (Must-NOT clause + R9).
    expect(
      /npm\s+publish\s+--workspaces/.test(yml),
      "release.yml must NOT call `npm publish --workspaces` (use changeset publish only)",
    ).toBe(false);
  });

  // ── Test #12 — .changeset/config.json matches spec ──
  it("changeset_config_matches_spec", () => {
    const cfgPath = resolve(ROOT, ".changeset/config.json");
    expect(existsSync(cfgPath), `expected ${cfgPath} to exist`).toBe(true);

    const cfg = readJson(cfgPath);
    expect(cfg.baseBranch).toBe("master");
    expect(cfg.access).toBe("public");
    expect(cfg.linked).toEqual([]);
    expect(cfg.fixed).toEqual([]);
    const ignore = cfg.ignore as string[];
    // v0.2.0-rc.0 release fix: `liquiddom-workspace` removed from ignore —
    // changesets rejects names that aren't actual workspace packages, and the
    // private root package.json isn't enumerated as one.
    expect(ignore).toContain("liquiddom-react-example");
    expect(ignore).not.toContain("liquiddom-workspace");
  });

  // ── Test #13 — published dist must not emit declaration maps (R7) ──
  it("published_dist_emits_no_declaration_maps", () => {
    for (const pkg of [CORE, REACT, VUE]) {
      const distDir = resolve(pkg, "dist");
      expect(existsSync(distDir), `expected ${distDir} to exist`).toBe(true);

      const allFiles = walkDir(distDir);
      const dtsMapFiles = allFiles.filter((p) => p.endsWith(".d.ts.map"));
      expect(
        dtsMapFiles,
        `R7: ${pkg}/dist must not contain .d.ts.map files (workspace path leakage)`,
      ).toEqual([]);
    }
  });
});
