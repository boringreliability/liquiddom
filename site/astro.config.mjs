import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Ward 058: GitHub Pages deployment under repo path.
// All internal links MUST use `import.meta.env.BASE_URL` — never hardcode "/liquiddom/".
export default defineConfig({
  output: "static",
  site: "https://boringreliability.github.io",
  base: "/liquiddom",
  trailingSlash: "always",
  vite: {
    plugins: [tailwindcss()],
  },
});
