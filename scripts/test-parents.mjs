// Parent pages test: node scripts/test-parents.mjs — builds a small site with two parent pages and checks the output.
import { writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync, symlinkSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const ok = (m) => console.log("ok    " + m), fail = (m) => { console.log("FAIL  " + m); failed++; };
const e = (id, type, title, path, extra = {}) => ({ id, type, title, slug: path.split("/").filter(Boolean).pop() || "", path, blocks: [], excerpt: "About " + title, featured_image: "",
  authors: [], categories: [], tags: [], service_line: "", account: "", fields: {}, seo: {}, parent: "", sort_order: 0, published_at: "2026-11-01T10:00:00Z", updated: "2026-11-09", ...extra });
const settings = { content_types: [
  { key: "portfolio", kind: "custom", page: "pp", label: "Project", plural: "Portfolio", route: "portfolio", archive: true, show_fields: true, auto_list: true,
    fields: [{ key: "client", label: "Client", type: "text", options: [] }], card: { layout: "grid", columns: "3", style: "overlay", image_ratio: "4/3", show_image: true, show_excerpt: true,
      show_date: false, show_category: true, fields: ["client"], read_more: "View", per_page: 12, sort: "", empty: "" }, filter: { categories: true, bar: true, all_label: "Everything" } },
  { key: "post", kind: "post", page: "ins", label: "Article", plural: "Insights", route: "insights", archive: false, show_fields: true, auto_list: true, fields: [],
    card: { layout: "list", columns: "3", style: "plain", image_ratio: "16/10", show_image: true, show_excerpt: true, show_date: true, show_category: false, fields: [], read_more: "", per_page: 1, sort: "", empty: "" },
    filter: { categories: true, bar: false } },
  { key: "service", kind: "service", page: "svc", label: "Service", plural: "Services", route: "service", archive: false, show_fields: true, auto_list: true, fields: [], card: {}, filter: {} },
], routes: { post: "insights", service: "service" } };
const entries = [
  e("home", "page", "Home", "/"),
  e("pp", "page", "Portfolio", "/portfolio/", { blocks: [{ id: "h", type: "hero", data: { heading: "Our work" } }] }),
  e("p1", "x_portfolio", "Alpha project", "/portfolio/alpha/", { categories: ["c1"], fields: { client: "Acme" } }),
  e("p2", "x_portfolio", "Beta project", "/portfolio/beta/", { categories: ["c2"], fields: { client: "Bolt" } }),
  e("p3", "x_portfolio", "Gamma project", "/portfolio/gamma/", { categories: ["c1", "c2"] }),
  e("ins", "page", "Insights", "/insights/"),
  e("a1", "post", "First article", "/insights/first/"),
  e("a2", "post", "Second article", "/insights/second/", { published_at: "2026-11-05T10:00:00Z" }),
  e("svc", "page", "Services", "/services/", { blocks: [{ id: "sc", type: "service_cards", data: {} }] }),
  e("s1", "service", "SEO", "/service/seo/"),
];
const bundle = { site: { id: "s", key: "pt", name: "Parent Test", theme: "nlmc", environment: "staging", url: "http://localhost:4321", live_url: "", settings },
  generated_at: "2026-11-09", entries, sections: {}, menus: {}, categories: [{ id: "c1", name: "Branding", slug: "branding", description: "", seo: {} }, { id: "c2", name: "Web", slug: "web", description: "", seo: {} }],
  proof: [], testimonials: [], faqs: [], team: [], users: {}, service_lines: [], accounts: {}, media: {}, redirects: [], booking_links: [], forms: {}, data: {} };
const ws = join(root, ".work", "test-parents");
rmSync(ws, { recursive: true, force: true }); mkdirSync(ws, { recursive: true });
for (const f of ["astro.config.mjs", "package.json", "tsconfig.json"]) cpSync(join(root, f), join(ws, f));
for (const d of readdirSync(join(root, "src"))) if (d !== "media" && d !== "data") cpSync(join(root, "src", d), join(ws, "src", d), { recursive: true });
mkdirSync(join(ws, "src/data"), { recursive: true }); mkdirSync(join(ws, "src/media"), { recursive: true });
cpSync(join(root, "src/data/block-schema.json"), join(ws, "src/data/block-schema.json"));
symlinkSync(join(root, "node_modules"), join(ws, "node_modules"), "dir");
writeFileSync(join(ws, "src/data/bundle.json"), JSON.stringify(bundle));
const r = spawnSync("npx", ["astro", "build"], { cwd: ws, encoding: "utf8", env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" }, maxBuffer: 64 << 20 });
if (r.status !== 0) { console.log((r.stdout + r.stderr).split("\n").slice(-40).join("\n")); fail("astro build"); process.exit(1); }
ok("astro build");
const read = (p) => { const f = join(ws, "dist", p, "index.html"); return existsSync(f) ? readFileSync(f, "utf8") : ""; };
const pf = read("/portfolio/");
const check = (c, m) => (c ? ok(m) : fail(m));
check(pf.includes("Our work") && pf.includes("Alpha project") && pf.includes("Gamma project"), "portfolio page shows its blocks and its items");
check(pf.includes("data-cc-bar") && pf.includes("Everything") && pf.includes(">Branding<") && pf.includes(">Web<"), "portfolio filter bar with its categories");
check(pf.includes("cc-overlay") && pf.includes("Client") && pf.includes("Acme") && pf.includes("View"), "portfolio card design (overlay, field, read more)");
check(/data-cats="c1 c2"/.test(pf), "cards carry their categories");
check(!existsSync(join(ws, "dist/portfolio/page/2/index.html")), "no paging with a filter bar");
const ins = read("/insights/");
check(ins.includes("<h1") && ins.includes("Second article") && !ins.includes("First article"), "insights: heading from the title, newest first, 1 per page");
check(existsSync(join(ws, "dist/insights/page/2/index.html")) && read("/insights/page/2/").includes("First article"), "insights page 2");
check(ins.includes("cc-plain") && ins.includes("cc-list"), "insights card design (plain list)");
const svc = read("/services/");
check(!svc.includes('id="pp-list"') && (svc.match(/class="cc /g) || []).length === 0, "services page lists itself (service cards), no extra list");
const a = read("/portfolio/alpha/");
check(a.includes('href="/portfolio/"') && a.includes("Acme"), "item: breadcrumb to its parent page, its fields");
const s1 = read("/service/seo/");
check(s1.includes('href="/services/"'), "service: breadcrumb to its parent page (different address)");
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
