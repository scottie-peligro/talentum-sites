// Fetch one site's published content from Talentum and download its media, ready for `astro build`.
//
//   PB_URL       Talentum's API base (default http://localhost:8090; in Docker http://pocketbase:8090)
//   SITE_KEY     the site's key (Website → Settings)
//   SITE_ENV     staging | live                       (default staging)
//   BUILDER_SECRET  or  SITE_TOKEN                     (one of them, to read the bundle)
//
// Writes src/data/bundle.json and src/media/<id>.<ext>. Media that hasn't changed (same file name) isn't re-downloaded.
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PB = (process.env.PB_URL || "http://localhost:8090").replace(/\/+$/, "");
const KEY = process.env.SITE_KEY;
const ENV = process.env.SITE_ENV === "live" ? "live" : "staging";
if (!KEY && !process.env.BUNDLE_FILE) { console.error("SITE_KEY is not set."); process.exit(1); }

let bundle;
if (process.env.BUNDLE_FILE) {
  // Promote to Live: rebuild from the exact content snapshot the staging build used.
  bundle = JSON.parse(readFileSync(process.env.BUNDLE_FILE, "utf8"));
  bundle.site.environment = ENV;
} else {
  const headers = {};
  if (process.env.BUILDER_SECRET) headers["X-Builder-Secret"] = process.env.BUILDER_SECRET;
  else if (process.env.SITE_TOKEN) headers.Authorization = "Bearer " + process.env.SITE_TOKEN;
  else { console.error("Set BUILDER_SECRET or SITE_TOKEN."); process.exit(1); }
  const res = await fetch(`${PB}/api/site/${encodeURIComponent(KEY)}/bundle?env=${ENV}`, { headers });
  if (!res.ok) { console.error(`Bundle request failed: ${res.status} ${await res.text()}`); process.exit(1); }
  bundle = await res.json();
}
if (process.env.SITE_URL) bundle.site.url = process.env.SITE_URL;

const mediaDir = join(root, "src", "media");
mkdirSync(mediaDir, { recursive: true });
mkdirSync(join(root, "src", "data"), { recursive: true });

const IMG = /\.(jpe?g|png|webp|avif|gif|tiff?)$/i;
const keep = new Set([".gitkeep"]);
const manifestPath = join(mediaDir, ".manifest.json");
const had = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
const now = {};

async function download(url, file) {
  const r = await fetch(url.startsWith("http") ? url : PB + url);
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  writeFileSync(join(mediaDir, file), Buffer.from(await r.arrayBuffer()));
}

let fetched = 0;
const jobs = [];
for (const m of Object.values(bundle.media || {})) {
  const ext = (m.url.split(".").pop() || "bin").toLowerCase();
  const file = `${m.id}.${ext}`;
  m.file = file;
  m.raster = IMG.test(file);
  keep.add(file);
  now[file] = m.url;
  if (had[file] === m.url && existsSync(join(mediaDir, file))) continue;
  jobs.push(() => download(m.url, file).then(() => fetched++));
}
// Team photos (users' headshots) — downloaded so they're optimised like everything else.
for (const u of Object.values(bundle.users || {})) {
  if (!u || !u.photo) continue;
  const clean = u.photo.split("?")[0];
  const ext = (clean.split(".").pop() || "jpg").toLowerCase().slice(0, 5);
  const file = `user-${u.id}.${/^(jpe?g|png|webp|avif|gif)$/.test(ext) ? ext : "jpg"}`;
  keep.add(file);
  now[file] = u.photo;
  u.photo_file = file;
  if (had[file] === u.photo && existsSync(join(mediaDir, file))) continue;
  jobs.push(() => download(u.photo, file).then(() => fetched++).catch((e) => { console.warn("Team photo skipped:", u.name, e.message); delete u.photo_file; }));
}
// Six at a time.
const queue = jobs.slice();
await Promise.all(Array.from({ length: 6 }, async () => { while (queue.length) await queue.shift()(); }));
for (const f of readdirSync(mediaDir)) if (!keep.has(f) && f !== ".manifest.json") rmSync(join(mediaDir, f));
writeFileSync(manifestPath, JSON.stringify(now));
for (const u of Object.values(bundle.users || {})) if (u && u.photo_file && !existsSync(join(mediaDir, u.photo_file))) delete u.photo_file;
// SVGs: real width/height from the file, so the page reserves their space (no layout shift).
for (const m of Object.values(bundle.media || {})) {
  if (!/\.svg$/i.test(m.file) || (m.width && m.height) || !existsSync(join(mediaDir, m.file))) continue;
  const head = readFileSync(join(mediaDir, m.file), "utf8").slice(0, 3000);
  const tag = (head.match(/<svg\b[^>]*>/i) || [""])[0];
  const num = (a) => { const x = tag.match(new RegExp("\\s" + a + "=[\"']([\\d.]+)(px)?[\"']", "i")); return x ? Math.round(Number(x[1])) : 0; };
  const vb = (tag.match(/viewBox=["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i) || []);
  m.width = num("width") || Math.round(Number(vb[1]) || 0);
  m.height = num("height") || Math.round(Number(vb[2]) || 0);
}

writeFileSync(join(root, "src", "data", "bundle.json"), JSON.stringify(bundle));
console.log(`Fetched ${bundle.site.name} (${ENV}): ${bundle.entries.length} entries, ${Object.keys(bundle.media || {}).length} media (${fetched} downloaded).`);
