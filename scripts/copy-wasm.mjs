#!/usr/bin/env node
import { cpSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const pkgDir = resolve(root, "pkg");
const distDir = resolve(root, "packages", "core", "dist");
const distWasmDir = resolve(distDir, "wasm");

if (!existsSync(pkgDir)) {
  console.error("[copy-wasm] pkg/ does not exist — run `npm run build:wasm` first.");
  process.exit(1);
}
if (!existsSync(distDir)) {
  console.error("[copy-wasm] packages/core/dist/ does not exist — run tsc first.");
  process.exit(1);
}

cpSync(pkgDir, distWasmDir, { recursive: true });

// wasm-pack writes a `.gitignore: *` into pkg/ which npm honors during pack,
// excluding our WASM binary from the published tarball. Drop it.
const distGitignore = resolve(distWasmDir, ".gitignore");
if (existsSync(distGitignore)) {
  rmSync(distGitignore);
}

// W64 (decision D64-15, plan resolution D3): tsc emits the repo-root specifier
// `../../../../pkg/liquiddom.js` verbatim into every dist file whose source
// imports the glue (index.js and wasm-loader.js today). Rewrite each one to
// the colocated dist/wasm/ copy, with the prefix computed from the file's
// depth below dist/, so the published tarball is self-contained.
const PKG_SPECIFIER = /(["'])(?:\.\.\/)+pkg\//g;
let patched = 0;
for (const entry of readdirSync(distDir, { recursive: true })) {
  const rel = String(entry);
  if (!rel.endsWith(".js") || rel === "wasm" || rel.startsWith(`wasm${sep}`)) continue;
  const file = resolve(distDir, rel);
  const depth = rel.split(sep).length - 1;
  const prefix = depth === 0 ? "./" : "../".repeat(depth);
  const original = readFileSync(file, "utf-8");
  const next = original.replace(PKG_SPECIFIER, (_match, quote) => `${quote}${prefix}wasm/`);
  if (next !== original) {
    writeFileSync(file, next);
    patched += 1;
  }
}

console.log(`[copy-wasm] WASM copied to packages/core/dist/wasm; pkg/ specifier patched in ${patched} file(s).`);
