// After `astro build`: Cloudflare Pages _headers and _redirects, the logo at /logo.<ext> (for Organization schema),
// and a manifest (path → content hash) the builder sends back to Talentum so the Builds tab can show what changed.
import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { htmlToMarkdown, decode as decodeHtml } from "./lib/markdown.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const bundle = JSON.parse(readFileSync(join(root, "src", "data", "bundle.json"), "utf8"));
const staging = bundle.site.environment !== "live";
const s = bundle.site.settings || {};

// --- Headers -------------------------------------------------------------------------------------------------
const a = s.analytics || {};
const scriptSrc = ["'self'", "'unsafe-inline'"];
const connectSrc = ["'self'"];
const imgSrc = ["'self'", "data:", "https://i.ytimg.com", "https://*.cloudflarestream.com", "https://videodelivery.net"];
// Overview videos (New layout) and the Video block: YouTube, Vimeo, Cloudflare Stream, Loom, Wistia, HeyGen.
const frameSrc = ["https://www.youtube-nocookie.com", "https://player.vimeo.com", "https://*.cloudflarestream.com", "https://iframe.videodelivery.net", "https://www.loom.com", "https://fast.wistia.net", "https://app.heygen.com"];
if (a.ga4 || a.gtm) { scriptSrc.push("https://www.googletagmanager.com"); connectSrc.push("https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com"); imgSrc.push("https://*.google-analytics.com", "https://*.googletagmanager.com"); }
if (a.gtm) { frameSrc.push("https://www.googletagmanager.com"); }
if (a.clarity) { scriptSrc.push("https://www.clarity.ms", "https://*.clarity.ms"); connectSrc.push("https://*.clarity.ms"); imgSrc.push("https://*.clarity.ms", "https://c.bing.com"); }
const t = s.tracking || {};
const add = (list, ...d) => list.push(...d);
if (!staging) {
  if (t.google_ads) { add(scriptSrc, "https://www.googleadservices.com", "https://googleads.g.doubleclick.net", "https://www.google.com"); add(connectSrc, "https://www.google.com", "https://googleads.g.doubleclick.net", "https://*.doubleclick.net"); add(imgSrc, "https://www.google.com", "https://googleads.g.doubleclick.net", "https://*.doubleclick.net", "https://www.googleadservices.com"); add(frameSrc, "https://*.doubleclick.net"); if (!a.ga4 && !a.gtm) add(scriptSrc, "https://www.googletagmanager.com"); }
  if (t.meta_pixel) { add(scriptSrc, "https://connect.facebook.net"); add(connectSrc, "https://www.facebook.com", "https://connect.facebook.net"); add(imgSrc, "https://www.facebook.com"); }
  if (t.linkedin) { add(scriptSrc, "https://snap.licdn.com"); add(connectSrc, "https://px.ads.linkedin.com", "https://*.linkedin.com"); add(imgSrc, "https://px.ads.linkedin.com", "https://*.linkedin.com"); }
  if (t.bing_uet) { add(scriptSrc, "https://bat.bing.com"); add(connectSrc, "https://bat.bing.com", "https://*.clarity.ms"); add(imgSrc, "https://bat.bing.com"); }
  if (t.tiktok) { add(scriptSrc, "https://analytics.tiktok.com"); add(connectSrc, "https://analytics.tiktok.com"); add(imgSrc, "https://analytics.tiktok.com"); }
  if (t.hubspot) { add(scriptSrc, "https://*.hs-scripts.com", "https://*.hs-analytics.net", "https://*.hs-banner.com", "https://*.usemessages.com", "https://*.hscollectedforms.net", "https://*.hubspot.com", "https://*.hsforms.net"); add(connectSrc, "https://*.hubspot.com", "https://*.hubapi.com", "https://*.hs-banner.com", "https://*.hscollectedforms.net", "https://*.hsforms.com"); add(imgSrc, "https://*.hubspot.com", "https://*.hsforms.com", "https://*.hs-analytics.net"); add(frameSrc, "https://*.hubspot.com", "https://*.hsforms.net"); }
  if (t.hotjar) { add(scriptSrc, "https://*.hotjar.com"); add(connectSrc, "https://*.hotjar.com", "https://*.hotjar.io", "wss://*.hotjar.com"); add(imgSrc, "https://*.hotjar.com"); add(frameSrc, "https://*.hotjar.com"); }
}
// Book-a-time blocks embed the team's Talentum booking pages.
for (const l of bundle.booking_links || []) { try { const o = new URL(l.url).origin; if (o.startsWith("https://") || o.startsWith("http://localhost")) frameSrc.push(o); } catch {} }
for (const en of bundle.entries || []) for (const bl of en.blocks || []) if (bl.type === "booking") for (const tp of bl.data?.topics || []) {
  try { const o = new URL(tp.booking_url).origin; if (o.startsWith("https://") || o.startsWith("http://localhost")) frameSrc.push(o); } catch {}
}
if (t.cf_beacon) { add(scriptSrc, "https://static.cloudflareinsights.com"); add(connectSrc, "https://cloudflareinsights.com"); }
if (s.forms?.turnstile_site_key) { add(scriptSrc, "https://challenges.cloudflare.com"); add(frameSrc, "https://challenges.cloudflare.com"); }
// Custom code lists the domains it needs; code with scripts that doesn't makes the CSP report-only (rather than break it).
let looseSnippet = false;
for (const sn of bundle.snippets || []) {
  const doms = String(sn.csp || "").split(/[\s,]+/).filter((d) => /^(https:\/\/|wss:\/\/)?[*a-z0-9.-]+\.[a-z]{2,}$/i.test(d)).map((d) => (/^[a-z]+:\/\//.test(d) ? d : "https://" + d));
  if (doms.length) { add(scriptSrc, ...doms); add(connectSrc, ...doms); add(imgSrc, ...doms); add(frameSrc, ...doms); }
  else if (/<script[^>]*src=|<iframe/i.test(sn.code || "")) looseSnippet = true;
}
if (s.forms?.endpoint) connectSrc.push(new URL(s.forms.endpoint).origin);
for (const d of (s.csp_extra || "").split(/\s+/).filter(Boolean)) { scriptSrc.push(d); connectSrc.push(d); imgSrc.push(d); frameSrc.push(d); }
// GTM can load anything the marketing team configures, so with GTM on the CSP only reports.
const uniq = (l) => [...new Set(l)].join(" ");
const csp = [`default-src 'self'`, `script-src ${uniq(scriptSrc)}`, `style-src 'self' 'unsafe-inline'`, `img-src ${uniq(imgSrc)}`, `font-src 'self' data:`,
  `connect-src ${uniq(connectSrc)}`, `frame-src ${uniq(frameSrc)}`, `media-src 'self' https:`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self' ${s.forms?.endpoint ? new URL(s.forms.endpoint).origin : ""}`.trim(), `frame-ancestors 'self'`].join("; ");

const headers = [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "  X-Frame-Options: SAMEORIGIN",
  staging ? "  X-Robots-Tag: noindex, nofollow" : "  Strict-Transport-Security: max-age=31536000; includeSubDomains",
  `  ${a.gtm || looseSnippet ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy"}: ${csp}`,
  "",
  "/_astro/*",
  "  Cache-Control: public, max-age=31536000, immutable",
  "",
  "/_assistant/*",
  "  X-Robots-Tag: noindex",
  "  Cache-Control: public, max-age=300",
  "",
  "/*.html",
  "  Cache-Control: public, max-age=0, must-revalidate",
  "",
  // Markdown copies of the pages for AI assistants (below). The HTML page stays the one search engines list.
  "/*.md",
  "  Content-Type: text/markdown; charset=utf-8",
  "  X-Robots-Tag: noindex",
  "  Cache-Control: public, max-age=0, must-revalidate",
  "",
  "/llms-full.txt",
  "  Content-Type: text/plain; charset=utf-8",
  "  Cache-Control: public, max-age=0, must-revalidate",
  "",
].join("\n");
writeFileSync(join(dist, "_headers"), headers);

// --- Redirects (Cloudflare Pages supports 301/302; 410s are listed in the Builds log as not supported yet) ---------
const lines = [];
const skipped = [];
for (const r of bundle.redirects || []) {
  if (!r.from || r.code === 410) { skipped.push(r.from); continue; }
  const from = r.from.replace(/\s/g, "");
  lines.push(`${from} ${r.to} ${r.code === 302 ? 302 : 301}`);
  if (from.endsWith("/") && from.length > 1 && !from.includes("*")) lines.push(`${from.slice(0, -1)} ${r.to} ${r.code === 302 ? 302 : 301}`);
}
writeFileSync(join(dist, "_redirects"), lines.slice(0, 2000).join("\n") + "\n");
if (skipped.length) console.log(`410 redirects not supported on Pages yet (skipped): ${skipped.join(", ")}`);

// --- Logo at a stable URL ------------------------------------------------------------------------------------------
const logo = bundle.media?.[s.brand?.logo];
if (logo?.file && existsSync(join(root, "src", "media", logo.file))) copyFileSync(join(root, "src", "media", logo.file), join(dist, "logo." + logo.file.split(".").pop()));

// --- IndexNow key file (live only): lets Bing and other IndexNow engines verify our "these pages changed" pings ------
if (!staging && /^[a-f0-9]{32}$/.test(s.seo?.indexnow_key || "")) writeFileSync(join(dist, s.seo.indexnow_key + ".txt"), s.seo.indexnow_key);

// --- Site Assistant content: every page's main text in small chunks, plus the FAQs (functions/api/assistant.js) ---
if (s.assistant?.enabled) {
  const decode = (x) => x.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  const chunks = [];
  const pages = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) pages(p); else if (f === "index.html") {
    const url = "/" + relative(dist, d).replace(/\\/g, "/") + (relative(dist, d) ? "/" : "");
    if (url.startsWith("/404")) continue;
    const html = readFileSync(p, "utf8");
    if (/<meta name="robots" content="noindex/.test(html) && !staging) continue;
    const title = decode((html.match(/<title>([^<]*)<\/title>/) || [, ""])[1]).replace(/\s*[|–—-]\s*[^|–—-]+$/, "").trim();
    let main = (html.match(/<main[^>]*>([\s\S]*?)<\/main>/) || [, ""])[1];
    main = main.replace(/<(script|style|nav|form|svg|template)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|h[1-6]|li|dt|dd|tr|blockquote|figcaption|div)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
    const text = decode(main).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 2);
    let cur = "";
    for (const line of text) { if ((cur + " " + line).length > 900 && cur) { chunks.push({ title, url, text: cur.trim() }); cur = ""; } cur += (cur ? "\n" : "") + line; }
    if (cur.trim().length > 40) chunks.push({ title, url, text: cur.trim() });
  } } };
  pages(dist);
  const plain = (h) => decode(String(h || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  for (const f of bundle.faqs || []) chunks.push({ title: "FAQ: " + f.question, url: "/", kind: "faq", text: f.question + "\n" + plain(f.answer) });
  const o = s.org || {};
  chunks.push({ title: "Contact details", url: (bundle.entries.find((e) => !e.translation_of && /contact/.test(e.path)) || {}).path || "/", text: [o.name, o.phone && "Phone: " + o.phone, o.email && "Email: " + o.email, [o.street || o.address, o.city, o.region, o.postal].filter(Boolean).join(", "), o.hours && "Hours: " + o.hours].filter(Boolean).join("\n") });
  mkdirSync(join(dist, "_assistant"), { recursive: true });
  writeFileSync(join(dist, "_assistant", "index.json"), JSON.stringify({ site: bundle.site.name, org: o.name || bundle.site.name, name: s.assistant.name || "", booking: s.assistant.booking_url || "", chunks: chunks.slice(0, 3000) }));
  console.log(`postbuild: Site Assistant index — ${chunks.length} chunks.`);
}

// --- Markdown copies + llms-full.txt (AI assistants) ---------------------------------------------------------------
// Every page whose <head> links a Markdown alternate (layouts/Base.astro: not noindex, not the 404 page) gets
// /<path>/index.md: title, description, source URL, then the page's main content (scripts/lib/markdown.mjs).
// llms-full.txt: the Markdown of the key pages in one file (main language; capped at about 1.5 MB).
{
  const t0 = Date.now();
  const byPath = new Map((bundle.entries || []).map((e) => [e.path, e]));
  const docs = [];
  const visit = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "_astro" && f !== "_assistant") visit(p); } else if (f === "index.html") {
    const html = readFileSync(p, "utf8");
    const alt = html.match(/<link rel="alternate" type="text\/markdown" href="([^"]+)"/);
    if (!alt) continue;
    const url = "/" + relative(dist, d).replace(/\\/g, "/") + (relative(dist, d) ? "/" : "");
    const e = byPath.get(url);
    const meta = (re) => decodeHtml((html.match(re) || [, ""])[1]);
    const canonical = meta(/<link rel="canonical" href="([^"]*)"/) || alt[1].replace(/index\.md$/, "");
    const title = e?.title || meta(/<meta property="og:title" content="([^"]*)"/) || meta(/<title>([^<]*)<\/title>/);
    const description = meta(/<meta name="description" content="([^"]*)"/);
    const md = htmlToMarkdown(html, { base: canonical, title, description, url: canonical });
    writeFileSync(join(d, "index.md"), md);
    docs.push({ url, e, md });
  } } };
  visit(dist);
  // llms-full.txt: home, pages, services, case studies, then the newest insights; translations left out.
  const rank = (x) => (x.url === "/" ? 0 : !x.e ? 6 : x.e.translation_of ? 9 : ({ page: 1, landing: 1, service: 2, case_study: 3, post: 4, job: 5, legal: 8 })[x.e.type] ?? 6);
  const ordered = docs.filter((x) => rank(x) < 9 && !/\/page\/\d+\/$/.test(x.url))
    .sort((a, b) => rank(a) - rank(b) || (rank(a) === 4 ? String(b.e?.published_at || "").localeCompare(String(a.e?.published_at || "")) : a.url.localeCompare(b.url)));
  const o = s.org || {};
  let full = `# ${o.name || bundle.site.name}\n\n${o.description || s.seo?.default_description ? "> " + String(o.description || s.seo.default_description).replace(/\s+/g, " ").trim() + "\n\n" : ""}The full text of the main pages of ${bundle.site.url || "this website"}. Each page is also available on its own at <page address>index.md.\n`;
  const CAP = 1.5 * 1048576;
  let included = 0, size = Buffer.byteLength(full);
  for (const x of ordered) {
    const part = "\n---\n\n" + x.md;
    const n = Buffer.byteLength(part);
    if (size + n > CAP) continue;
    full += part; size += n; included++;
  }
  if (docs.length) writeFileSync(join(dist, "llms-full.txt"), full);
  console.log(`postbuild: ${docs.length} Markdown pages, llms-full.txt ${included} pages (${Math.round(Buffer.byteLength(full) / 1024)} KB) in ${Date.now() - t0} ms.`);
}

// --- Manifest ----------------------------------------------------------------------------------------------------
const manifest = {};
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === "index.html") {
  const html = readFileSync(p, "utf8").replace(/\/_astro\/[^"' )]+/g, "");   // asset hashes change every build; content is what matters
  manifest["/" + relative(dist, d).replace(/\\/g, "/") + (relative(dist, d) ? "/" : "")] = createHash("sha1").update(html).digest("hex").slice(0, 16);
} } };
walk(dist);
writeFileSync(join(root, ".build-manifest.json"), JSON.stringify(manifest));
console.log(`postbuild: ${Object.keys(manifest).length} pages, ${lines.length} redirect lines, headers written (${staging ? "staging" : "live"}).`);
