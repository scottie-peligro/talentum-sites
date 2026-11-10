// Header & footer options test: node scripts/test-header.mjs — builds a tiny site with every header option set.
import { writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync, symlinkSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const check = (c, m) => { console.log((c ? "ok    " : "FAIL  ") + m); if (!c) failed++; };
const e = (id, title, path) => ({ id, type: "page", title, slug: path.split("/").filter(Boolean).pop() || "", path, blocks: [{ id: "r", type: "rich_text", data: { html: "<p>Hi</p>" } }], excerpt: "", featured_image: "",
  authors: [], categories: [], tags: [], service_line: "", account: "", fields: {}, seo: {}, parent: "", sort_order: 0, published_at: "", updated: "2026-11-10" });
const settings = {
  org: { name: "Test Co" }, brand: { logo: "m1", logo_inverse: "m2" },
  header_cta: { label: "Contact Us", url: "/contact/", style: "primary", more: [{ label: "Candidates", url: "/candidates/", style: "secondary" }, { label: "Call", url: "tel:123", style: "link", new_tab: true }] },
  styles: { colors: { header_bg: "#ffffff", footer_bg: "#f3f4f6", header_hover: "#cc0000" }, header: { logo_h: 90, footer_logo_h: 70, layout: "center-menu", sticky: "off", look: "shadow", menu_size: 17, menu_weight: 700, menu_case: "upper", menu_gap: 32,
    topbar: { on: true, text: "Hiring now", phone: "+1 555 0100", email: "hi@test.co", link_label: "Jobs", link_url: "/jobs/" } } },
};
const media = { m1: { id: "m1", url: "", file: "logo.svg", raster: false, name: "logo", alt: "", caption: "", credit: "", focal: null, width: 400, height: 200, mime: "image/svg+xml" },
  m2: { id: "m2", url: "", file: "logo2.svg", raster: false, name: "logo2", alt: "", caption: "", credit: "", focal: null, width: 400, height: 200, mime: "image/svg+xml" } };
const bundle = { site: { id: "s", key: "ht", name: "Header Test", theme: "nlmc", environment: "staging", url: "http://localhost:4321", live_url: "", settings }, generated_at: "x",
  entries: [e("h", "Home", "/"), e("c", "Contact", "/contact/")], sections: {}, menus: { header: [{ label: "About", entry: "c", url: "", description: "", new_tab: false, style: "", children: [] }] },
  categories: [], proof: [], testimonials: [], faqs: [], team: [], users: {}, service_lines: [], accounts: {}, media, redirects: [], booking_links: [], forms: {}, data: {} };
const ws = join(root, ".work", "test-header");
rmSync(ws, { recursive: true, force: true }); mkdirSync(ws, { recursive: true });
for (const f of ["astro.config.mjs", "package.json", "tsconfig.json"]) cpSync(join(root, f), join(ws, f));
for (const d of readdirSync(join(root, "src"))) if (d !== "media" && d !== "data") cpSync(join(root, "src", d), join(ws, "src", d), { recursive: true });
mkdirSync(join(ws, "src/data"), { recursive: true }); mkdirSync(join(ws, "src/media"), { recursive: true });
cpSync(join(root, "src/data/block-schema.json"), join(ws, "src/data/block-schema.json"));
for (const [f, fill] of [["logo.svg", "c00"], ["logo2.svg", "00c"]]) writeFileSync(join(ws, "src/media", f), `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#${fill}"/></svg>`);
symlinkSync(join(root, "node_modules"), join(ws, "node_modules"), "dir");
writeFileSync(join(ws, "src/data/bundle.json"), JSON.stringify(bundle));
const r = spawnSync("npx", ["astro", "build"], { cwd: ws, encoding: "utf8", env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" }, maxBuffer: 64 << 20 });
if (r.status !== 0) { console.log((r.stdout + r.stderr).split("\n").slice(-30).join("\n")); process.exit(1); }
const html = readFileSync(join(ws, "dist/index.html"), "utf8");
const css = html + readdirSync(join(ws, "dist/_astro")).filter((f) => f.endsWith(".css")).map((f) => readFileSync(join(ws, "dist/_astro", f), "utf8")).join("");
check(/--header-text:#111827/.test(html), "white header → dark menu text automatically");
check(/--logo-h:90px/.test(html) && /--footer-logo-h:70px/.test(html), "header and footer logo heights");
check(/--menu-size:1\.0625rem/.test(html) && /--menu-weight:700/.test(html) && /--menu-case:uppercase/.test(html) && /--menu-gap:32px/.test(html) && /--header-hover:#cc0000/.test(html), "menu text options");
check(/class="site-header hd-center-menu hd-static hd-shadow"/.test(html), "layout, not sticky, shadow");
check(html.includes("Hiring now") && html.includes('href="tel:+15550100"') && html.includes("mailto:hi@test.co") && html.includes(">Jobs<"), "top bar");
check(/btn btn-primary cta[^>]*>Contact Us/.test(html) && /btn btn-secondary cta[^>]*>Candidates/.test(html) && /hd-link cta"[^>]*target="_blank"[^>]*>Call/.test(html), "three header buttons with styles");
const hdr = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
check(hdr.includes("%23c00") && !hdr.includes("%2300c"), "light header shows the normal logo, not the inverse one");
check(/--on-dark:#111827/.test(html), "light footer → dark footer text");
console.log(failed ? `${failed} failed` : "all passed"); process.exit(failed ? 1 : 0);
