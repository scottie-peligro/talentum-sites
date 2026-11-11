// The editor's Live view: one `astro dev` shows every website being edited. scripts/live-sites.mjs (in the dev server) works
// out which website a request is for, lets pages through one at a time, and leaves the key in
// globalThis.__talentumLiveSite; this makes that website the one rendered (lib/live.ts).
// In a build (publish, staging, live) there's one website and this does nothing.
import { defineMiddleware } from "astro:middleware";
import { multi, useSite } from "./lib/live";

export const onRequest = defineMiddleware((_ctx, next) => {
  if (multi) {
    const key = (globalThis as any).__talentumLiveSite;
    if (typeof key === "string" && key) useSite(key);
  }
  return next();
});
