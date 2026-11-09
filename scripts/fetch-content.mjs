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
  const preview = process.env.PREVIEW_TOKEN ? `&preview=${encodeURIComponent(process.env.PREVIEW_TOKEN)}` : "";
  const res = await fetch(`${PB}/api/site/${encodeURIComponent(KEY)}/bundle?env=${ENV}${preview}`, { headers });
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

// Styles page fonts: any Google Font, downloaded now and served from the site itself (fast, private, no CLS from
// a third-party stylesheet). Latin + Latin Extended only. Writes src/data/fonts.json { css, preload }.
const fontOut = { css: "", preload: [] };
const fontDir = join(root, "public", "_fonts");
// Fonts named on the Styles page, plus any a block's own Style tab uses (src/lib/blockStyle.ts: heading_font, body_font).
const blockFonts = [];
const scan = (blocks) => { for (const bl of blocks || []) { const st = bl?.data?.style; if (st) blockFonts.push(st.heading_font, st.body_font); if (bl?.type === "container") for (const col of bl.data?.cols || []) scan(col?.blocks); } };
for (const en of bundle.entries || []) scan(en.blocks);
for (const sec of Object.values(bundle.sections || {})) scan(sec);
const want = [bundle.site.settings?.styles?.fonts?.heading, bundle.site.settings?.styles?.fonts?.body, ...blockFonts].map((x) => String(x || "").replace(/[^A-Za-z0-9 ]+/g, "").trim()).filter(Boolean);
// Same fonts as last time and the files are still there: keep them (live view updates, repeat builds).
const fontsJson = join(root, "src", "data", "fonts.json");
const famKey = JSON.stringify([...new Set(want)].slice(0, 6));
let reuse = false;
try { const old = JSON.parse(readFileSync(fontsJson, "utf8")); reuse = old.families === famKey && (old.preload || []).every((u) => existsSync(join(root, "public", u))); if (reuse) Object.assign(fontOut, old); } catch {}
if (!reuse) rmSync(fontDir, { recursive: true, force: true });
fontOut.families = famKey;
if (want.length && !reuse) {
  mkdirSync(fontDir, { recursive: true });
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
  for (const fam of [...new Set(want)].slice(0, 6)) {
    let css = "";
    for (const axis of [":wght@100..900", ":wght@400;500;600;700;800", ":wght@400;700", ""]) {
      try {
        const r = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}${axis}&display=swap`, { headers: { "User-Agent": UA } });
        if (r.ok) { css = await r.text(); break; }
      } catch (e) { console.warn("Google Fonts unreachable:", e.message); break; }
    }
    if (!css) { console.warn(`Font "${fam}" not found on Google Fonts; using the theme font.`); continue; }
    const blocks = css.split(/(?=\/\*\s*[a-z-]+\s*\*\/)/).filter((x) => /\/\*\s*latin(-ext)?\s*\*\//.test(x));
    let i = 0;
    for (const blk of blocks) {
      const isLatin = /\/\*\s*latin\s*\*\//.test(blk);
      let out = blk;
      for (const m of [...blk.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)\s]+)\)/g)]) {
        const file = `${fam.toLowerCase().replace(/\s+/g, "-")}-${i++}.woff2`;
        try {
          const r = await fetch(m[1]); if (!r.ok) throw new Error(String(r.status));
          writeFileSync(join(fontDir, file), Buffer.from(await r.arrayBuffer()));
          out = out.replace(m[1], `/_fonts/${file}`);
          if (isLatin && !fontOut.preload.includes(`/_fonts/${file}`) && fontOut.preload.length < 3) fontOut.preload.push(`/_fonts/${file}`);
        } catch (e) { console.warn("Font file skipped:", file, e.message); }
      }
      fontOut.css += out.replace(/\/\*[^*]*\*\//g, "").replace(/\s*\n\s*/g, "");
    }
    console.log(`Font: ${fam} (${i} file${i === 1 ? "" : "s"})`);
  }
}
writeFileSync(fontsJson, JSON.stringify(fontOut));

writeFileSync(join(root, "src", "data", "bundle.json"), JSON.stringify(bundle));
console.log(`Fetched ${bundle.site.name} (${ENV}): ${bundle.entries.length} entries, ${Object.keys(bundle.media || {}).length} media (${fetched} downloaded).`);
