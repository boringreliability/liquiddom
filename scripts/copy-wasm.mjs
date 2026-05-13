#!/usr/bin/env node
import { cpSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pkgDir = resolve(root, "pkg");
const distWasmDir = resolve(root, "packages", "core", "dist", "wasm");
const distIndex = resolve(root, "packages", "core", "dist", "index.js");

if (!existsSync(pkgDir)) {
  console.error("[copy-wasm] pkg/ does not exist — run `npm run build:wasm` first.");
  process.exit(1);
}

cpSync(pkgDir, distWasmDir, { recursive: true });

// wasm-pack writes a `.gitignore: *` into pkg/ which npm honors during pack,
// excluding our WASM binary from the published tarball. Drop it.
const distGitignore = resolve(distWasmDir, ".gitignore");
if (existsSync(distGitignore)) {
  rmSync(distGitignore);
}

// The TS source at packages/core/ts/src/index.ts is 4 levels deep from the
// repo root, so `tsc` emits the dynamic import as `../../../../pkg/liquiddom.js`
// into packages/core/dist/index.js. Rewrite it to point at the colocated
// dist/wasm/ copy so the published tarball is self-contained.
if (existsSync(distIndex)) {
  const original = readFileSync(distIndex, "utf-8");
  const patched = original.replace(/\.\.\/\.\.\/\.\.\/\.\.\/pkg\//g, "./wasm/");
  if (patched !== original) {
    writeFileSync(distIndex, patched);
  }
}

console.log("[copy-wasm] WASM copied to packages/core/dist/wasm and dist/index.js path patched.");
