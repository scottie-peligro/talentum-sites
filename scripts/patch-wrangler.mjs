// Make `wrangler pages deploy` upload in small pieces so it fits the builder's 1 GB.
// wrangler 4.x uploads a Pages site in 40 MB buckets, three at a time, and holds each bucket several times over
// (file Buffers, base64 strings, the JSON body) — 500 MB+ for a site with a few hundred photos, which got the
// whole builder OOM-killed. Neither number is configurable, so the builder patches its own copy: 8 MB buckets
// (PAGES_UPLOAD_BUCKET_MB), one at a time. Idempotent; warns (and changes nothing) if wrangler's code moved.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let cli;
try { cli = join(dirname(createRequire(join(root, "package.json")).resolve("wrangler/package.json")), "wrangler-dist", "cli.js"); }
catch { console.warn("patch-wrangler: wrangler isn't installed"); process.exit(0); }
const mb = Math.max(1, Math.min(40, Number(process.env.PAGES_UPLOAD_BUCKET_MB) || 8));
let src = readFileSync(cli, "utf8");
const edits = [
  [/(\n\s*MAX_BUCKET_SIZE = )[\d.]+( \* 1024 \* 1024;)/, `$1${mb}$2`],
  [/(\n\s*BULK_UPLOAD_CONCURRENCY2 = )\d+;/, "$11;"],
];
let changed = 0;
for (const [re, to] of edits) {
  if (!re.test(src)) { console.warn(`patch-wrangler: pattern not found (${re}); wrangler upload left as is`); continue; }
  const next = src.replace(re, to);
  if (next !== src) { src = next; changed++; }
}
if (changed) writeFileSync(cli, src);
console.log(`patch-wrangler: Pages uploads in ${mb} MB pieces, one at a time${changed ? "" : " (already set)"}.`);
