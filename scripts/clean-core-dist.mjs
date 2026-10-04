#!/usr/bin/env node
// W66 (D66-9): tsc never deletes the outputs of removed sources, and its
// composite buildinfo (packages/tsconfig.build.tsbuildinfo, which is core's,
// because rootDir is ts/src) can skip re-emitting into a deleted dist/. Start clean.
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const rel of ["packages/core/dist", "packages/tsconfig.build.tsbuildinfo", "packages/core/tsconfig.build.tsbuildinfo"]) {
  rmSync(resolve(root, rel), { recursive: true, force: true });
}
console.log("[clean-core-dist] packages/core/dist and core tsbuildinfo removed.");
