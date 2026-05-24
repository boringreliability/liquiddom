import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// Custom domain on `liquiddom.vsplat.io` (W58 follow-up). The CNAME at
// site/public/CNAME tells GitHub Pages this is the authoritative host on
// every deploy — without it, Pages would forget the custom-domain setting.
//
// All internal links MUST use `import.meta.env.BASE_URL` (which is "/" now,
// previously was "/liquiddom/"). Components are framework-agnostic regardless.
export default defineConfig({
  output: "static",
  site: "https://liquiddom.vsplat.io",
  base: "/",
  trailingSlash: "always",
  vite: {
    plugins: [tailwindcss()],
  },
});
