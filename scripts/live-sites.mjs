// The editor's Live view serving many websites from one `astro dev` (builder/server.mjs starts it with LIVE_MULTI=1;
// astro.config.mjs adds this integration only then — never in a build).
//
// Which website: each preview address carries ?site=<key>. Astro hides the query and the headers from pre-built
// pages, so this picks the website here, in the dev server, before Astro sees the request:
//   - ?site=<key>                → that website;
//   - no ?site, a page request   → back to the same address with the website of the page the link was clicked on
//                                  (its Referer), so a preview tab stays on its own website (no cookies: two tabs on
//                                  two websites never mix);
//   - shared files (images, scripts, fonts, the dev server's own files) need no website.
// One page at a time: a request waits for the one before it to finish, so a page renders start to finish for its own
// website. The choice reaches the renderer through globalThis.__talentumLiveSite (src/middleware.ts → lib/live.ts).
import { existsSync } from "node:fs";
import { join } from "node:path";

const SHARED = /^\/(_image|_astro|_fonts|_server-islands|@|node_modules\/|src\/|\.astro\/|favicon)|\.(js|mjs|ts|css|map|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|mp4|webm|vtt|pdf)(\?|$)/i;

export default function liveSites({ root }) {
  return {
    name: "talentum-live-sites",
    hooks: {
      "astro:server:setup": ({ server }) => {
        let queue = Promise.resolve();
        const has = (key) => /^[a-z0-9-]{1,60}$/.test(key) && existsSync(join(root, "src", "data", "live", key + ".json"));
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url || "/", "http://x");
          if (SHARED.test(url.pathname) || url.searchParams.has("import") || req.headers.upgrade) return next();
          let key = url.searchParams.get("site") || "";
          if (!key) {
            try { key = new URL(String(req.headers.referer || "")).searchParams.get("site") || ""; } catch { key = ""; }
            if (key && has(key) && req.method === "GET" && /text\/html/.test(String(req.headers.accept || ""))) {
              url.searchParams.set("site", key);
              res.writeHead(302, { Location: url.pathname + url.search, "Cache-Control": "no-store" });
              return res.end();
            }
          }
          if (!key || !has(key)) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
            return res.end("This preview doesn't say which website to show. Open the page again from Talentum's page editor (Live view).");
          }
          const turn = queue;
          let release;
          queue = new Promise((r) => (release = r));
          let done = false;
          const finish = () => { if (!done) { done = true; release(); } };
          res.once("finish", finish);
          res.once("close", finish);
          turn.then(() => {
            globalThis.__talentumLiveSite = key;
            res.setHeader("Cache-Control", "no-store");
            next();
          });
        });
      },
    },
  };
}
