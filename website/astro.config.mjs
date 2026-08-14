import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

/**
 * GitHub project pages default: https://neural-axis.github.io/VibeDoctor/
 *
 * Custom domain later:
 *   PUBLIC_SITE_URL=https://example.com PUBLIC_BASE_PATH=/ npm run build
 * and add a CNAME file in public/ (see README).
 */
const site = process.env.PUBLIC_SITE_URL ?? "https://neural-axis.github.io";
const base = process.env.PUBLIC_BASE_PATH ?? "/VibeDoctor/";

export default defineConfig({
  site,
  base,
  trailingSlash: "always",
  integrations: [sitemap()],
  compressHTML: true,
  build: {
    inlineStylesheets: "auto"
  }
});
