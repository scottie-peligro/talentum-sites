// Talentum Sites — one static build per website. Content comes from src/data/bundle.json, written by
// scripts/fetch-content.mjs from Talentum's public content API. See README.md.
import { defineConfig } from "astro/config";
import { readFileSync, existsSync } from "node:fs";

const bundlePath = new URL("./src/data/bundle.json", import.meta.url);
const bundle = existsSync(bundlePath) ? JSON.parse(readFileSync(bundlePath, "utf8")) : null;
const site = process.env.SITE_URL || bundle?.site?.url || "http://localhost:4321";

export default defineConfig({
  site,
  output: "static",
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "always", assets: "_astro" },
  compressHTML: true,
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  image: { responsiveStyles: false },
  devToolbar: { enabled: false },
});
