import { defineConfig } from "vite";

// W85 (D85-5): render functions in .ts, so no @vitejs/plugin-vue. Vue's esm-bundler build reads
// three compile-time flags; defining them keeps its defaults and silences the dev warning.
export default defineConfig({
  define: {
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
  server: {
    port: 5175,
    open: true,
  },
  optimizeDeps: {
    // Don't pre-bundle the core liquiddom module — it loads WASM dynamically.
    exclude: ["liquiddom"],
  },
});
