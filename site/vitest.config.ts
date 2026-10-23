import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "site", environment: "jsdom", include: ["__tests__/**/*.test.ts"] },
});
