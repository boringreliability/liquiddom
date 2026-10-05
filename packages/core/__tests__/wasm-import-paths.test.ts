/**
 * W64 (decision D64-15, plan resolution D3): only files directly in ts/src
 * import the repo-root wasm-pack output, copy-wasm.mjs rewrites the specifier
 * in every emitted dist/**\/*.js, and no declaration file leaks a pkg/ path.
 * The dist cases need `npm run build` first, like workspace-publish #8.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SRC = resolve(ROOT, "packages/core/ts/src");
const DIST = resolve(ROOT, "packages/core/dist");
const PKG_SPECIFIER = /["'](?:\.\.\/)+pkg\//;

const walk = (dir: string): string[] =>
  (readdirSync(dir, { recursive: true }) as string[]).filter((f) => f !== "wasm" && !f.startsWith(`wasm${sep}`));

describe("W64 WASM import paths (D3)", () => {
  it("given_ts_src_when_scanned_then_only_files_directly_in_ts_src_import_pkg", () => {
    const importers = walk(SRC).filter(
      (f) => f.endsWith(".ts") && readFileSync(resolve(SRC, f), "utf-8").includes("pkg/liquiddom"),
    );
    expect(importers).toContain("wasm-loader.ts");
    for (const f of importers) expect(dirname(f), `${f} imports pkg/ from a subdirectory`).toBe(".");
    expect(readFileSync(resolve(SRC, "wasm-loader.ts"), "utf-8")).toContain('import("../../../../pkg/liquiddom.js")');
  });

  it("given_built_dist_when_scanned_then_no_js_file_still_contains_a_pkg_specifier", () => {
    expect(existsSync(DIST), "run `npm run build` first").toBe(true);
    const offenders = walk(DIST).filter((f) => f.endsWith(".js") && PKG_SPECIFIER.test(readFileSync(resolve(DIST, f), "utf-8")));
    expect(offenders).toEqual([]);
  });

  it("given_built_dist_when_scanned_then_no_d_ts_references_pkg", () => {
    const offenders = walk(DIST).filter(
      (f) => f.endsWith(".d.ts") && /pkg\/|liquiddom_bg/.test(readFileSync(resolve(DIST, f), "utf-8")),
    );
    expect(offenders).toEqual([]);
  });

  it("given_dist_wasm_loader_when_read_then_dynamic_import_points_at_the_packaged_glue", () => {
    const file = resolve(DIST, "wasm-loader.js");
    expect(existsSync(file), "run `npm run build` first").toBe(true);
    const m = readFileSync(file, "utf-8").match(/import\(\s*["']([^"']*liquiddom\.js)["']\s*\)/);
    expect(m?.[1]).toBe("./wasm/liquiddom.js");
    expect(existsSync(resolve(DIST, "wasm/liquiddom.js"))).toBe(true);
  });
});
