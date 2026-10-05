import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // jsdom defaults to http://localhost:3000, which is the demo dev server's port: a running
    // `npm run dev` would then serve pkg/*.wasm to the "no WASM under jsdom" tests. `.test` is a
    // reserved TLD (RFC 2606), so fetches from this origin always fail.
    environmentOptions: { jsdom: { url: "http://liquiddom.test/" } },
    include: ["ts/__tests__/**/*.test.ts", "__tests__/**/*.test.ts"],
  },
});
