#!/usr/bin/env node
// Copies pkg/ into packages/core/dist/wasm/ and rewrites every emitted pkg
// import specifier in dist/**/*.js to the colocated copy (W24/W35/W51; per
// file depth since W64/W66 D3). Only ts/src/wasm-loader.ts may import pkg
// (asserted by workspace-publish); a specifier with the wrong depth fails the build.
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = resolve(root, "pkg");
const distDir = resolve(root, "packages", "core", "dist");
const distWasmDir = resolve(distDir, "wasm");

if (!existsSync(pkgDir)) {
  console.error("[copy-wasm] pkg/ does not exist — run `npm run build:wasm` first.");
  process.exit(1);
}
if (!existsSync(distDir)) {
  console.error("[copy-wasm] packages/core/dist does not exist — run tsc first.");
  process.exit(1);
}

cpSync(pkgDir, distWasmDir, { recursive: true });
// wasm-pack writes `.gitignore: *`, which npm honours during pack and would drop the binary.
const distGitignore = resolve(distWasmDir, ".gitignore");
if (existsSync(distGitignore)) rmSync(distGitignore);

function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (p === distWasmDir) continue;
    if (statSync(p).isDirectory()) yield* jsFiles(p);
    else if (name.endsWith(".js")) yield p;
  }
}

const SPECIFIER = /(["'])((?:\.\.\/)+)pkg\//g;
let patched = 0;
for (const file of jsFiles(distDir)) {
  const depth = relative(distDir, dirname(file)).split(sep).filter(Boolean).length;
  const expectedUps = 4 + depth; // packages/core/ts/src/<depth dirs>/x.ts → repo root
  const target = depth === 0 ? "./wasm/" : `${"../".repeat(depth)}wasm/`;
  const original = readFileSync(file, "utf-8");
  const next = original.replace(SPECIFIER, (_match, quote, ups) => {
    const count = ups.length / 3;
    if (count !== expectedUps) {
      throw new Error(`[copy-wasm] ${relative(root, file)}: pkg specifier climbs ${count} levels, expected ${expectedUps}`);
    }
    return `${quote}${target}`;
  });
  if (next !== original) {
    writeFileSync(file, next);
    patched += 1;
  }
}
console.log(`[copy-wasm] WASM copied to packages/core/dist/wasm; pkg specifier rewritten in ${patched} file(s).`);
