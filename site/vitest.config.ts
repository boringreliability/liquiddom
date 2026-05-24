import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "site",
    environment: "jsdom",
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 60_000,  // build tests run astro build — give it room
    // W59: site-build.test.ts (W58) AND showcase-build.test.ts (W59) both
    // invoke `astro build` in beforeAll. Vitest's default file-parallelism
    // would run them concurrently and they'd collide writing to `site/dist/`,
    // producing intermittent ERR_MODULE_NOT_FOUND races. Disabling file
    // parallelism within this project serializes them. Other projects
    // (packages/*) keep their default parallelism.
    fileParallelism: false,
  },
});
