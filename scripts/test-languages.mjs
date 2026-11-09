// Build check for a two-language site: the site-wide files (rss.xml, llms.txt, search-index.json, sitemap.xml) must list
// the main-language pages, whatever language the last page built in. Run: node scripts/test-languages.mjs
// It builds a small fixture bundle into dist/ (any existing src/data/bundle.json is put back afterwards).
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = join(root, "src/data/bundle.json");
const backup = bundlePath + ".test-backup";
const rt = (t) => [{ id: "r", type: "rich_text", data: { html: `<p>${t}</p>` } }];
const entry = (id, type, title, path, extra = {}) => ({ id, type, title, slug: path.split("/").filter(Boolean).pop() || "", path, blocks: rt(title), excerpt: title + " excerpt",
  featured_image: "", authors: [], categories: [], tags: [], service_line: "", account: "", fields: {}, seo: {}, parent: "", sort_order: 0, published_at: "2026-10-01", updated: "2026-11-01", ...extra });
const main = [entry("home", "page", "Home", "/"), entry("about", "page", "About", "/about/"), entry("p1", "post", "Post One", "/insights/post-one/", { published_at: "2026-10-02" }),
  entry("p2", "post", "Post Two", "/insights/post-two/", { published_at: "2026-10-03" })];
const es = main.map((e) => ({ ...e, id: e.id + "-es", title: e.title + " ES", path: "/es" + e.path, lang: "es", translation_of: e.id }));
// Translations last, so the last page Astro renders is most likely Spanish.
const bundle = { site: { id: "s", key: "test", name: "Test Co", theme: "nlmc", environment: "staging", url: "http://localhost:4321", live_url: "",
  settings: { org: { name: "Test Co" }, languages: { default: "en", default_label: "English", extra: [{ code: "es", label: "Español", prefix: "es" }] } } },
  generated_at: "2026-11-09", entries: [...main, ...es], sections: {}, menus: {}, categories: [], proof: [], testimonials: [], faqs: [], team: [], users: {},
  service_lines: [], accounts: {}, media: {}, redirects: [], booking_links: [], forms: {} };

let failed = 0;
const check = (ok, msg) => { console.log((ok ? "ok   " : "FAIL ") + msg); if (!ok) failed++; };
if (existsSync(bundlePath)) renameSync(bundlePath, backup);
try {
  mkdirSync(dirname(bundlePath), { recursive: true });
  writeFileSync(bundlePath, JSON.stringify(bundle));
  rmSync(join(root, "dist"), { recursive: true, force: true });
  execSync("npx astro build", { cwd: root, stdio: "pipe" });
  const read = (f) => readFileSync(join(root, "dist", f), "utf8");
  const rss = read("rss.xml"), llms = read("llms.txt"), search = read("search-index.json"), sitemap = read("sitemap.xml");
  check(rss.includes("/insights/post-one/</link>") && rss.includes("<title>Post Two</title>"), "rss.xml lists the main-language posts");
  check(!rss.includes("/es/"), "rss.xml has no Spanish posts");
  check(llms.includes("[Post One](") && llms.includes("[About](") && !llms.includes(" ES]"), "llms.txt lists main-language pages and posts only");
  check(!search.includes("/es/") && search.includes('"/about/"'), "search-index.json is main-language");
  check(sitemap.includes("/es/about/") && sitemap.includes('hreflang="es"'), "sitemap.xml still lists every language with alternates");
  check(read("es/about/index.html").includes('lang="es"'), "the Spanish page still renders in Spanish");
} finally {
  rmSync(bundlePath, { force: true });
  if (existsSync(backup)) renameSync(backup, bundlePath);
}
console.log(failed ? `${failed} check(s) failed` : "all language checks passed");
process.exit(failed ? 1 : 0);
