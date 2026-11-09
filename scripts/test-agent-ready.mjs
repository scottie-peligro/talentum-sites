// Agent-ready pages test:  npm run test:agent      (after a build: checks dist/; `--dist <dir>` for another build)
//  1. The HTML → Markdown converter (scripts/lib/markdown.mjs) on a fixed page: main content only, FAQ Q&A, cards.
//  2. Structured data on every built page (a small schema.org checker): each JSON-LD node has its type's required
//     properties, @ids are unique on the page, every { "@id": … } reference resolves inside the page, people link to
//     the organisation, articles' authors are Person nodes, and an @id means the same entity on every page.
//  3. Markdown copies: every page that links one has it (and no noindex page does), llms.txt links only files that
//     exist, llms-full.txt stays under 2 MB, _headers serves .md as text/markdown and keeps staging noindex.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { htmlToMarkdown } from "./lib/markdown.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dist = args.includes("--dist") ? args[args.indexOf("--dist") + 1] : join(root, "dist");

test("markdown: main content only, headings, lists, links, FAQ answers, cards", () => {
  const html = `<html><head><title>T</title><script>x()</script></head><body><header><nav><a href="/">Menu</a></nav></header>
<main id="main"><nav class="crumbs"><a href="/">Home</a></nav><h1>About &amp; us</h1><p>We <em>help</em> <a href="/contact/">get in touch</a>.</p>
<ul class="grid"><li class="card"><picture><img src="/a.webp" alt="x"></picture><h3><a href="/s/seo/">SEO</a></h3><p>Get found.</p></li></ul>
<details><summary><h3>How long?</h3></summary><div><p>Weeks.</p></div></details><dl><div><dt><h3>Cost?</h3></dt><dd><p>It depends.</p></dd></div></dl>
<form><label>Name</label><input><button>Send</button></form><svg aria-hidden="true"><path d=""/></svg><div aria-hidden="true">copy</div>
<a class="card" href="/cs/acme/"><div><h3>Acme</h3></div><p>Doubled leads</p></a><h2>Empty</h2></main><footer>Footer</footer></body></html>`;
  const md = htmlToMarkdown(html, { base: "https://ex.com/about/", title: "About & us", description: "Who we are", url: "https://ex.com/about/" });
  assert.equal(md, [
    "# About & us", "> Who we are", "Source: https://ex.com/about/", "We *help* [get in touch](https://ex.com/contact/).",
    "- **[SEO](https://ex.com/s/seo/)** — Get found.", "### How long?", "Weeks.", "### Cost?", "It depends.", "[Acme](https://ex.com/cs/acme/) — Doubled leads",
  ].join("\n\n") + "\n");
  for (const bad of ["Menu", "Footer", "Send", "copy", "x()", "Empty", "crumbs"]) assert.ok(!md.includes(bad), bad);
  // Text typed into a field that looks like markup stays inert (it was escaped on the page, too).
  const hostile = htmlToMarkdown(`<main><h2>&lt;script&gt;PWN()&lt;/script&gt;</h2><p>a &lt; b and &lt;img src=x onerror=PWN()&gt;</p><a href="javascript:PWN()">x</a></main>`);
  assert.ok(!/<script|<img/i.test(hostile) && !/javascript:/i.test(hostile), hostile);
  assert.match(hostile, /a < b/);
});

// ---------------------------------------------------------------------------------------------------------------
const REQUIRED = {
  Organization: ["name", "url"], ProfessionalService: ["name", "url"], LocalBusiness: ["name", "url"], Corporation: ["name", "url"],
  WebSite: ["url", "name"], WebPage: ["url", "name", "isPartOf"], BreadcrumbList: ["itemListElement"], Person: ["name"],
  BlogPosting: ["headline", "author", "datePublished", "publisher", "mainEntityOfPage"], Article: ["headline", "author", "datePublished", "publisher", "mainEntityOfPage"],
  Service: ["name", "provider"], JobPosting: ["title", "description", "datePosted", "hiringOrganization"], FAQPage: ["mainEntity"],
  Question: ["name", "acceptedAnswer"], Answer: ["text"], VideoObject: ["name", "thumbnailUrl", "uploadDate"], ListItem: ["position"], ItemList: ["itemListElement"],
};
const ORG_TYPES = new Set(["Organization", "ProfessionalService", "LocalBusiness", "Corporation", "EmploymentAgency", "MarketingAgency", "AdvertisingAgency"]);
const isRef = (v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v["@id"] === "string";
const typesOf = (n) => [].concat(n["@type"] || []);

/** All JSON-LD nodes on a page (graph members and nested typed objects) + every reference. */
function nodesOf(html) {
  const nodes = [], refs = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    const doc = JSON.parse(m[1]);
    assert.equal(doc["@context"], "https://schema.org");
    const visit = (v, top) => {
      if (Array.isArray(v)) return v.forEach((x) => visit(x, false));
      if (!v || typeof v !== "object") return;
      if (isRef(v)) { refs.push(v["@id"]); return; }
      if (v["@type"]) nodes.push(Object.assign(v, { __top: top }));
      for (const [k, x] of Object.entries(v)) if (k !== "@context" && k !== "__top") visit(x, false);
    };
    if (doc["@graph"]) doc["@graph"].forEach((n) => visit(n, true)); else visit(doc, true);
  }
  return { nodes, refs };
}

const pages = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "_astro") walk(p); } else if (f === "index.html") pages.push({ url: "/" + relative(dist, d).replace(/\\/g, "/") + (relative(dist, d) ? "/" : ""), dir: d, html: readFileSync(p, "utf8") }); } };
const built = existsSync(join(dist, "index.html"));
if (built) walk(dist);

test("structured data: required properties, unique @ids, references resolve, people and authors link up", { skip: !built && "no build in " + dist }, () => {
  const seen = new Map();   // @id → "Type|name" across pages
  let people = 0, authored = 0;
  for (const pg of pages) {
    const { nodes, refs } = nodesOf(pg.html);
    const ids = new Map();
    for (const n of nodes) {
      for (const t of typesOf(n)) for (const k of REQUIRED[t] || []) assert.ok(n[k] !== undefined && n[k] !== "" && n[k] !== null, `${pg.url}: ${t} without ${k}`);
      if (n["@id"]) {
        assert.ok(!ids.has(n["@id"]), `${pg.url}: @id ${n["@id"]} defined twice`);
        ids.set(n["@id"], n);
        const sig = typesOf(n).join(",") + "|" + (n.name || n.headline || "");
        if (seen.has(n["@id"])) assert.equal(seen.get(n["@id"]), sig, `${n["@id"]} means different things on different pages`);
        else seen.set(n["@id"], sig);
      }
      if (typesOf(n).includes("Person") && n.__top) {
        people++;
        assert.ok(n["@id"], `${pg.url}: a Person without an @id`);
        assert.ok(isRef(n.worksFor) && ORG_TYPES.has(typesOf(ids.get(n.worksFor["@id"]) || nodes.find((x) => x["@id"] === n.worksFor["@id"]) || {})[0]), `${pg.url}: ${n.name} worksFor isn't the organisation`);
        for (const u of [].concat(n.sameAs || [])) assert.match(u, /^https?:\/\//, `${pg.url}: ${n.name} sameAs ${u}`);
        if (n.image) assert.match(n.image, /^https?:\/\//);
      }
      if (typesOf(n).some((t) => t === "BlogPosting" || t === "Article")) {
        for (const a of [].concat(n.author)) {
          const target = isRef(a) ? nodes.find((x) => x["@id"] === a["@id"]) : a;
          assert.ok(target && (typesOf(target).includes("Person") || ORG_TYPES.has(typesOf(target)[0])), `${pg.url}: author ${JSON.stringify(a)} isn't a Person or the organisation`);
          if (typesOf(target).includes("Person")) authored++;
        }
      }
      if (typesOf(n).includes("Service")) assert.ok(isRef(n.provider) && ORG_TYPES.has(typesOf(ids.get(n.provider["@id"]) || nodes.find((x) => x["@id"] === n.provider["@id"]) || {})[0]), `${pg.url}: Service provider isn't the organisation`);
      if (ORG_TYPES.has(typesOf(n)[0]) && n.__top) for (const u of [].concat(n.sameAs || [])) assert.match(u, /^https?:\/\//, `${pg.url}: organisation sameAs ${u}`);
    }
    for (const r of refs) assert.ok(nodes.some((x) => x["@id"] === r), `${pg.url}: reference ${r} doesn't resolve on the page`);
  }
  console.log(`# structured data: ${pages.length} pages, ${seen.size} entities, ${people} Person nodes, ${authored} authored articles`);
});

test("markdown copies, llms.txt, llms-full.txt and _headers", { skip: !built && "no build in " + dist }, () => {
  const headers = readFileSync(join(dist, "_headers"), "utf8");
  assert.match(headers, /\/\*\.md\n {2}Content-Type: text\/markdown; charset=utf-8/);
  const staging = /X-Robots-Tag: noindex, nofollow/.test(headers.split("\n\n")[0]);
  let noindexPaths = null;
  try { noindexPaths = new Set(JSON.parse(readFileSync(join(root, "src/data/bundle.json"), "utf8")).entries.filter((e) => e.seo?.noindex).map((e) => e.path)); } catch {}
  let mdCount = 0;
  for (const pg of pages) {
    const link = pg.html.match(/<link rel="alternate" type="text\/markdown" href="([^"]+)"/);
    // Live pages say "noindex, follow"; on staging every page says "noindex, nofollow", so the bundle tells.
    const noindex = /<meta name="robots" content="noindex, follow"/.test(pg.html) || !!noindexPaths?.has(pg.url);
    if (noindex || pg.url.startsWith("/404")) { assert.ok(!link, `${pg.url}: noindex page links a Markdown copy`); assert.ok(!existsSync(join(pg.dir, "index.md")), `${pg.url}: noindex page has index.md`); continue; }
    assert.ok(link, `${pg.url}: no Markdown link`);
    assert.ok(link[1].endsWith(pg.url + "index.md"), `${pg.url}: Markdown link ${link[1]}`);
    const md = readFileSync(join(pg.dir, "index.md"), "utf8");
    assert.match(md, /^# \S/, `${pg.url}: Markdown starts with a title`);
    assert.ok(!/<(script|nav|footer|form|button|svg)\b/i.test(md), `${pg.url}: Markdown carries markup`);
    mdCount++;
  }
  const llms = readFileSync(join(dist, "llms.txt"), "utf8");
  const mdLinks = [...llms.matchAll(/\]\(([^)]+index\.md)\)/g)].map((m) => new URL(m[1]).pathname);
  assert.ok(mdLinks.length > 0, "llms.txt links Markdown copies");
  for (const p of mdLinks) assert.ok(existsSync(join(dist, p)), `llms.txt links ${p}, which wasn't built`);
  const full = readFileSync(join(dist, "llms-full.txt"));
  assert.ok(full.length < 2 * 1048576, "llms-full.txt under 2 MB");
  if (staging) assert.match(readFileSync(join(dist, "robots.txt"), "utf8"), /Disallow: \//);
  console.log(`# markdown: ${mdCount} copies, llms.txt links ${mdLinks.length}, llms-full.txt ${Math.round(full.length / 1024)} KB, ${staging ? "staging (noindex)" : "live"}`);
});
