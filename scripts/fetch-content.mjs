// Fetch one site's published content from Talentum and download its media, ready for `astro build`.
//
//   PB_URL       Talentum's API base (default http://localhost:8090; in Docker http://pocketbase:8090)
//   SITE_KEY     the site's key (Website → Settings)
//   SITE_ENV     staging | live                       (default staging)
//   BUILDER_SECRET  or  SITE_TOKEN                     (one of them, to read the bundle)
//   FETCH_TIMEOUT_MS (30000)  FETCH_TRIES (4)  FETCH_CONCURRENCY (4)  BUNDLE_TIMEOUT_MS (120000)
//
// Writes src/data/bundle.json and src/media/<id>.<ext>. Media that hasn't changed (same file name) isn't re-downloaded.
// Every request has a timeout and is retried with backoff on timeouts, network errors, 429 and 5xx (a Cloudflare 522
// on one image must not fail a whole publish). A media file that still can't be had is left out of the bundle — the
// renderer treats it like a deleted image — and listed in the build log. Only a missing bundle fails the build (or so
// many missing images that something is clearly wrong: MEDIA_MAX_SKIPPED, default 25% of them and more than 5).
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, readFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PB = (process.env.PB_URL || "http://localhost:8090").replace(/\/+$/, "");
const KEY = process.env.SITE_KEY;
const ENV = process.env.SITE_ENV === "live" ? "live" : "staging";
const TIMEOUT = Number(process.env.FETCH_TIMEOUT_MS) || 30000;
const TRIES = Math.max(1, Number(process.env.FETCH_TRIES) || 4);
const CONCURRENCY = Math.max(1, Number(process.env.FETCH_CONCURRENCY) || 4);
const BACKOFF = Number(process.env.FETCH_BACKOFF_MS) || 1500;
if (!KEY && !process.env.BUNDLE_FILE) { console.error("SITE_KEY is not set."); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class HttpError extends Error { constructor(status, message, retryAfter) { super(message); this.status = status; this.retryAfter = retryAfter; } }
// Worth another try: timeouts, dropped connections, 408/425/429 and every 5xx (incl. Cloudflare's 520–524).
const retryable = (e) => !(e instanceof HttpError) || e.status === 408 || e.status === 425 || e.status === 429 || e.status >= 500;

/** GET with a timeout per attempt (it covers the body too) and up to TRIES attempts. Resolves { res, buf }. */
async function get(url, { headers, timeout = TIMEOUT, tries = TRIES, label = url, check } = {}) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 300);
        const ra = Number(res.headers.get("retry-after"));
        throw new HttpError(res.status, `${res.status} for ${label}${body && res.status < 500 ? ": " + body : ""}`, ra > 0 ? Math.min(ra, 30) * 1000 : 0);
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (check) check(res, buf);
      return { res, buf };
    } catch (e) {
      last = e && (e.name === "TimeoutError" || e.name === "AbortError") ? new Error(`timed out after ${Math.round(timeout / 1000)}s for ${label}`)
        : e instanceof TypeError ? new Error(`${e.cause?.code || e.cause?.message || e.message} for ${label}`) : e;   // fetch's "fetch failed"
      if (i === tries || !retryable(last)) break;
      const wait = last.retryAfter || BACKOFF * 2 ** (i - 1) + Math.round(Math.random() * 400);
      console.warn(`  retry ${i}/${tries - 1} in ${(wait / 1000).toFixed(1)}s — ${last.message}`);
      await sleep(wait);
    }
  }
  throw last;
}

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
  try {
    const { buf } = await get(`${PB}/api/site/${encodeURIComponent(KEY)}/bundle?env=${ENV}${preview}`, { headers, timeout: Number(process.env.BUNDLE_TIMEOUT_MS) || 120000, label: "the site's content bundle" });
    bundle = JSON.parse(buf.toString("utf8"));
  } catch (e) { console.error(`Bundle request failed: ${e.message}`); process.exit(1); }
  if (!bundle || !bundle.site) { console.error("Bundle request failed: the answer had no site in it."); process.exit(1); }
}
if (process.env.SITE_URL) bundle.site.url = process.env.SITE_URL;

const mediaDir = join(root, "src", "media");
mkdirSync(mediaDir, { recursive: true });
mkdirSync(join(root, "src", "data"), { recursive: true });

const IMG = /\.(jpe?g|png|webp|avif|gif|tiff?)$/i;
const keep = new Set([".gitkeep"]);
const manifestPath = join(mediaDir, ".manifest.json");
let had = {};
try { had = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {}; } catch { had = {}; }
const now = {};
// sharp is already a dependency (Astro's image service); used to make sure a raster file really is an image Astro can
// open, so one corrupt or oversized upload can't stop `astro build`.
let sharp = null;
try { sharp = (await import("sharp")).default; } catch {}
const MAX_PIXELS = 268402689;   // sharp's default limitInputPixels, which Astro keeps

/** File extension from a URL's last path segment, without query string or fragment; `fallback` when there's none. */
function extOf(url, fallback) {
  const last = String(url || "").split(/[?#]/)[0].split("/").pop() || "";
  const i = last.lastIndexOf(".");
  const e = i > 0 ? last.slice(i + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,5}$/.test(e) ? e : fallback;
}

async function download(url, file, { timeout = TIMEOUT, label = file } = {}) {
  const raster = IMG.test(file), svg = /\.svg$/i.test(file);
  const check = (res, buf) => {
    // An HTML error page with a 200 (proxy/captcha pages) instead of the file: try again, then give up on it.
    if (!buf.length) throw new Error(`empty file for ${label}`);
    if ((raster || svg) && /text\/html/i.test(res.headers.get("content-type") || "")) throw new Error(`got an HTML page instead of ${label}`);
  };
  const { buf } = await get(url.startsWith("http") ? url : PB + url, { timeout, label, check });
  if (raster && sharp) {
    let meta;
    try { meta = await sharp(buf, { limitInputPixels: false }).metadata(); } catch (e) { throw new Error(`not a readable image (${e.message})`); }
    if ((meta.width || 0) * (meta.height || 0) > MAX_PIXELS) throw new Error(`too large to optimise (${meta.width}×${meta.height})`);
  }
  if (svg && !/<svg[\s>]/i.test(buf.subarray(0, 4000).toString("utf8"))) throw new Error("not an SVG file");
  const tmp = join(mediaDir, file + ".part");
  writeFileSync(tmp, buf);
  renameSync(tmp, join(mediaDir, file));
}

let fetched = 0;
const jobs = [];
const skipped = [];   // { name, why } — left out of this build
const stale = [];     // { name, why } — an older copy of the same file used
for (const m of Object.values(bundle.media || {})) {
  if (!m || !m.id || !m.url) continue;
  const file = `${m.id}.${extOf(m.url, "bin")}`;
  m.file = file;
  m.raster = IMG.test(file);
  keep.add(file);
  now[file] = m.url;
  if (had[file] === m.url && existsSync(join(mediaDir, file))) continue;
  // ~250 KB/s floor on top of the base timeout, so big videos and PDFs aren't cut off.
  const timeout = TIMEOUT + Math.round((Number(m.size) || 0) / 250);
  const label = `${m.name || file} (${m.url})`;
  jobs.push(() => download(m.url, file, { timeout, label }).then(() => fetched++).catch((e) => {
    if (had[file] && existsSync(join(mediaDir, file))) {
      // The file was replaced but the new one couldn't be fetched: keep serving the previous copy; next build retries.
      now[file] = had[file];
      stale.push({ name: m.name || file, why: e.message });
    } else {
      // Left out like a deleted image: every block already skips media it can't find.
      delete bundle.media[m.id];
      keep.delete(file); delete now[file];
      skipped.push({ name: m.name || file, why: e.message });
    }
  }));
}
// Team photos (users' headshots) — downloaded so they're optimised like everything else.
for (const u of Object.values(bundle.users || {})) {
  if (!u || !u.photo) continue;
  const ext = extOf(u.photo, "jpg");
  const file = `user-${u.id}.${/^(jpe?g|png|webp|avif|gif)$/.test(ext) ? ext : "jpg"}`;
  keep.add(file);
  now[file] = u.photo;
  u.photo_file = file;
  if (had[file] === u.photo && existsSync(join(mediaDir, file))) continue;
  jobs.push(() => download(u.photo, file, { label: `team photo of ${u.name}` }).then(() => fetched++).catch((e) => { console.warn("Team photo skipped:", u.name, e.message); delete u.photo_file; }));
}
const total = jobs.length;
const queue = jobs.slice();
await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await queue.shift()(); }));
for (const f of readdirSync(mediaDir)) if (!keep.has(f) && f !== ".manifest.json") rmSync(join(mediaDir, f), { force: true });
writeFileSync(manifestPath, JSON.stringify(now));
for (const u of Object.values(bundle.users || {})) if (u && u.photo_file && !existsSync(join(mediaDir, u.photo_file))) delete u.photo_file;
for (const x of stale) console.warn(`Media kept from the last build (new file unavailable): ${x.name} — ${x.why}`);
if (skipped.length) {
  console.warn(`⚠ ${skipped.length} media file${skipped.length === 1 ? "" : "s"} left out of this build (couldn't be downloaded):`);
  for (const x of skipped) console.warn(`   - ${x.name}: ${x.why}`);
  const limit = process.env.MEDIA_MAX_SKIPPED !== undefined ? Number(process.env.MEDIA_MAX_SKIPPED) : Math.max(5, Math.floor(total * 0.25));
  if (skipped.length > limit) { console.error(`Too many media files failed (${skipped.length} of ${total}) — Talentum's file storage is probably unreachable. Not building a site without its images.`); process.exit(1); }
}
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
for (const en of bundle.entries || []) scan(en?.blocks);
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
        const r = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam).replace(/%20/g, "+")}${axis}&display=swap`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
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
          const { buf } = await get(m[1], { timeout: 20000, tries: 3, label: file });
          writeFileSync(join(fontDir, file), buf);
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

// Written to a temporary file and renamed, so the Live view (astro dev, watching this file) never reads half of it.
const bundleOut = join(root, "src", "data", "bundle.json");
writeFileSync(bundleOut + ".tmp", JSON.stringify(bundle));
renameSync(bundleOut + ".tmp", bundleOut);
console.log(`Fetched ${bundle.site.name} (${ENV}): ${(bundle.entries || []).length} entries, ${Object.keys(bundle.media || {}).length} media (${fetched} downloaded${skipped.length ? `, ${skipped.length} skipped` : ""}${stale.length ? `, ${stale.length} from the last build` : ""}).`);
