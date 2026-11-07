// After `astro build`: Cloudflare Pages _headers and _redirects, the logo at /logo.<ext> (for Organization schema),
// and a manifest (path → content hash) the builder sends back to Talentum so the Builds tab can show what changed.
import { readFileSync, writeFileSync, readdirSync, statSync, copyFileSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const bundle = JSON.parse(readFileSync(join(root, "src", "data", "bundle.json"), "utf8"));
const staging = bundle.site.environment !== "live";
const s = bundle.site.settings || {};

// --- Headers -------------------------------------------------------------------------------------------------
const a = s.analytics || {};
const scriptSrc = ["'self'", "'unsafe-inline'"];
const connectSrc = ["'self'"];
const imgSrc = ["'self'", "data:", "https://i.ytimg.com"];
const frameSrc = ["https://www.youtube-nocookie.com", "https://player.vimeo.com"];
if (a.ga4 || a.gtm) { scriptSrc.push("https://www.googletagmanager.com"); connectSrc.push("https://*.google-analytics.com", "https://*.analytics.google.com", "https://*.googletagmanager.com"); imgSrc.push("https://*.google-analytics.com", "https://*.googletagmanager.com"); }
if (a.gtm) { frameSrc.push("https://www.googletagmanager.com"); }
if (a.clarity) { scriptSrc.push("https://www.clarity.ms", "https://*.clarity.ms"); connectSrc.push("https://*.clarity.ms"); imgSrc.push("https://*.clarity.ms", "https://c.bing.com"); }
if (s.forms?.endpoint) connectSrc.push(new URL(s.forms.endpoint).origin);
for (const d of (s.csp_extra || "").split(/\s+/).filter(Boolean)) { scriptSrc.push(d); connectSrc.push(d); imgSrc.push(d); frameSrc.push(d); }
// GTM can load anything the marketing team configures, so with GTM on the CSP only reports.
const csp = [`default-src 'self'`, `script-src ${scriptSrc.join(" ")}`, `style-src 'self' 'unsafe-inline'`, `img-src ${imgSrc.join(" ")}`, `font-src 'self' data:`,
  `connect-src ${connectSrc.join(" ")}`, `frame-src ${frameSrc.join(" ")}`, `media-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self' ${s.forms?.endpoint ? new URL(s.forms.endpoint).origin : ""}`.trim(), `frame-ancestors 'self'`].join("; ");

const headers = [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "  X-Frame-Options: SAMEORIGIN",
  staging ? "  X-Robots-Tag: noindex, nofollow" : "  Strict-Transport-Security: max-age=31536000; includeSubDomains",
  `  ${a.gtm ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy"}: ${csp}`,
  "",
  "/_astro/*",
  "  Cache-Control: public, max-age=31536000, immutable",
  "",
  "/*.html",
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

// --- Manifest ----------------------------------------------------------------------------------------------------
const manifest = {};
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f === "index.html") {
  const html = readFileSync(p, "utf8").replace(/\/_astro\/[^"' )]+/g, "");   // asset hashes change every build; content is what matters
  manifest["/" + relative(dist, d).replace(/\\/g, "/") + (relative(dist, d) ? "/" : "")] = createHash("sha1").update(html).digest("hex").slice(0, 16);
} } };
walk(dist);
writeFileSync(join(root, ".build-manifest.json"), JSON.stringify(manifest));
console.log(`postbuild: ${Object.keys(manifest).length} pages, ${lines.length} redirect lines, headers written (${staging ? "staging" : "live"}).`);
