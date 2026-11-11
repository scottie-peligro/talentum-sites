// Talentum Sites — one static build per website. Content comes from src/data/bundle.json, written by
// scripts/fetch-content.mjs from Talentum's public content API. See README.md.
import { defineConfig } from "astro/config";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";

// The builder image sets NODE_ENV=production, which makes `astro dev` (the page editor's Live view) think it isn't in
// dev mode — and Astro's dev image endpoint then refuses every optimised photo. Dev is dev.
if (process.argv.includes("dev")) process.env.NODE_ENV = "development";

const bundlePath = new URL("./src/data/bundle.json", import.meta.url);
const bundle = existsSync(bundlePath) ? JSON.parse(readFileSync(bundlePath, "utf8")) : null;
const site = process.env.SITE_URL || bundle?.site?.url || "http://localhost:4321";

export default defineConfig({
  site,
  output: "static",
  // The builder keeps the image cache on its data volume so restarts don't re-optimise every image.
  ...(process.env.ASTRO_CACHE_DIR || existsSync("/data/sites") ? { cacheDir: process.env.ASTRO_CACHE_DIR || "/data/astro-cache" } : {}),
  trailingSlash: "always",
  build: { format: "directory", inlineStylesheets: "always", assets: "_astro" },
  compressHTML: true,
  prefetch: { prefetchAll: false, defaultStrategy: "hover" },
  image: { responsiveStyles: false },
  devToolbar: { enabled: false },
  // The editor's Live view: one dev server for every website being edited (scripts/live-sites.mjs). Only when the builder
  // starts it that way — never in a build.
  ...(process.env.LIVE_MULTI ? { integrations: [(await import("./scripts/live-sites.mjs")).default({ root: fileURLToPath(new URL(".", import.meta.url)) })] } : {}),
});
