import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// W66: `liquiddom` resolves to the core SOURCE so scenes never run a stale dist.
// The source loader imports ../../../../pkg/liquiddom.js (repo-root pkg/), built
// by `npm run dev` / `npm run build:wasm`.
const coreEntry = fileURLToPath(new URL("../packages/core/ts/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^liquiddom$/, replacement: coreEntry }],
  },
  server: {
    port: 3000,
    open: true,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: ["liquiddom"],
  },
});
