// Block drift test:  npm run test:blocks      (about 20–40 s)
// Uses src/data/block-schema.json — a copy of Talentum's frontend/src/lib/block-schema.json, where every block's fields,
// defaults and sample data are defined (talentum-pb: node scripts/block-schema/sync.mjs writes the copy).
//  1. The copy is up to date (when ../talentum-pb is checked out beside this repo).
//  2. Every block type in the schema has a component registered (components/Blocks.astro C, or blocks/interactive/index.ts).
//  3. Data keys: the keys each component reads (d.<key>) vs the fields the schema defines. Printed as warnings.
//  4. Builds a test site in .work/test-blocks — one page per block type with its sample data, the same inside a
//     2-column container, and a "hostile" copy with <script>/onerror/javascript: strings in every text field — then
//     fails on a build error, a missing page, a block that renders nothing, or hostile markup that got through unescaped.
//  Options: --keep (leave .work/test-blocks), --only <type,type>, --no-build (steps 1–3 only), --strict-keys (warnings fail).
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, readdirSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k) => args.includes(k);
const only = opt("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const schema = JSON.parse(readFileSync(join(root, "src/data/block-schema.json"), "utf8"));
const blocks = schema.blocks.filter((b) => !only || only.includes(b.type));
const byType = Object.fromEntries(schema.blocks.map((b) => [b.type, b]));
let failed = 0, warned = 0;
const ok = (msg) => console.log("ok    " + msg);
const fail = (msg) => { console.log("FAIL  " + msg); failed++; };
const warn = (msg) => { console.log("warn  " + msg); warned++; };
const t0 = Date.now();

// 1. The copy is current -------------------------------------------------------------------------------------------
const source = join(root, "..", "talentum-pb", "frontend/src/lib/block-schema.json");
if (existsSync(source)) {
  if (Buffer.compare(readFileSync(source), readFileSync(join(root, "src/data/block-schema.json"))) === 0) ok("src/data/block-schema.json matches ../talentum-pb");
  else fail("src/data/block-schema.json differs from ../talentum-pb/frontend/src/lib/block-schema.json: run `node scripts/block-schema/sync.mjs` in talentum-pb");
} else console.log("skip  schema copy check (no ../talentum-pb here)");

// 2. Registry --------------------------------------------------------------------------------------------------------
const blocksAstro = readFileSync(join(root, "src/components/Blocks.astro"), "utf8");
const interactiveTs = readFileSync(join(root, "src/blocks/interactive/index.ts"), "utf8");
const imports = (src, base) => Object.fromEntries([...src.matchAll(/import\s+(\w+)\s+from\s+"([^"]+\.astro)"/g)].map((m) => [m[1], join(base, m[2])]));
const registry = (src, name) => Object.fromEntries([...(src.match(new RegExp(`const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`)) || ["", ""])[1].replace(/\/\/.*$/gm, "").matchAll(/\b([a-z_]+)\s*:\s*([A-Z]\w*)/g)].map((m) => [m[1], m[2]]));
const compFile = {};
for (const [t, c] of Object.entries(registry(blocksAstro, "C"))) compFile[t] = imports(blocksAstro, join(root, "src/components"))[c];
for (const [t, c] of Object.entries(registry(interactiveTs, "INTERACTIVE"))) compFile[t] = imports(interactiveTs, join(root, "src/blocks/interactive"))[c];
const inline = new Set([...blocksAstro.matchAll(/b\.type === "([a-z_]+)"/g)].map((m) => m[1])); // handled in Blocks.astro itself (section_ref)
for (const b of blocks) {
  if (compFile[b.type] && existsSync(compFile[b.type])) ok(`${b.type} → ${compFile[b.type].replace(root + "/", "")}`);
  else if (inline.has(b.type)) ok(`${b.type} → handled in Blocks.astro`);
  else fail(`${b.type}: no component registered in src/components/Blocks.astro (C) or src/blocks/interactive/index.ts (INTERACTIVE)`);
}
for (const t of Object.keys(compFile)) if (!byType[t]) warn(`${t}: registered in the renderer but not in the block schema (the editor can't add it)`);

// 3. Data keys read vs defined (warnings) ---------------------------------------------------------------------------
const libSrc = readdirSync(join(root, "src/lib")).filter((f) => f.endsWith(".ts")).map((f) => readFileSync(join(root, "src/lib", f), "utf8")).join("\n");
const COMMON_READ = ["style", "in_depth", "in_depth_label"]; // read for every block by Blocks.astro / lib/blockStyle.ts
function keysRead(file) {
  let src = readFileSync(file, "utf8").replace(/<style[\s\S]*?<\/style>/g, "").replace(/const\s+(?:JS|NOJS|CSS|css)\s*=\s*`[\s\S]*?`;/g, "");
  const vars = new Set(["d"]);
  for (const m of src.matchAll(/const\s+(\w+)(?:\s*:[^=]+)?\s*=\s*(?:block\.data|\(block\.data)/g)) vars.add(m[1]);
  const keys = new Set();
  for (const v of vars) {
    for (const m of src.matchAll(new RegExp(`\\b${v}\\??\\.(\\w+)`, "g"))) keys.add(m[1]);
    for (const m of src.matchAll(new RegExp(`\\b${v}\\[["'](\\w+)["']\\]`, "g"))) keys.add(m[1]);
    // Helpers called with the block's data: count the keys they read from their first parameter.
    for (const m of src.matchAll(new RegExp(`\\b(\\w+)\\(${v}[,)]`, "g"))) {
      const fn = libSrc.match(new RegExp(`export function ${m[1]}\\((\\w+)[^)]*\\)[^{]*\\{([\\s\\S]*?)\\n\\}`));
      if (fn) for (const k of fn[2].matchAll(new RegExp(`\\b${fn[1]}\\??\\.(\\w+)`, "g"))) keys.add(k[1]);
    }
  }
  for (const m of src.matchAll(/block\.data\??\.(\w+)/g)) keys.add(m[1]);
  const dynamic = [...vars].some((v) => new RegExp(`\\b${v}\\[(?!["'])`).test(src)); // d[k]: count quoted keys in the file too
  return { keys, dynamic, src };
}
const fieldKeys = (b) => b.fields.map((f) => (typeof f === "string" ? schema.shared_fields[f.slice(1)].key : f.key));
const commonKeys = (b) => [...(b.no_background ? [] : ["background", "anchor"]), ...(b.no_in_depth ? [] : ["in_depth", "in_depth_label"])];
const byFile = {};
for (const b of blocks) if (compFile[b.type]) (byFile[compFile[b.type]] = byFile[compFile[b.type]] || []).push(b);
const readNotDefined = [], definedNotRead = [];
for (const [file, list] of Object.entries(byFile)) {
  const { keys, dynamic, src } = keysRead(file);
  const defined = new Set(list.flatMap((b) => [...fieldKeys(b), ...commonKeys(b)]));
  if (list.some((b) => b.type === "container")) for (const f of schema.container_grid_fields) defined.add(f.key), defined.add("cols");
  const extra = new Set(list.flatMap((b) => Object.keys(b.extra_keys || {})));
  for (const k of keys) if (!defined.has(k) && !extra.has(k) && !COMMON_READ.includes(k)) readNotDefined.push(`${list.map((b) => b.type).join("/")}: reads "${k}" (no field for it; add one, or list it in the block's extra_keys)`);
  for (const b of list) for (const k of Object.keys(b.extra_keys || {})) if (!keys.has(k)) definedNotRead.push(`${b.type}: extra_keys "${k}" is never read by ${basename(file)}`);
  for (const b of list) for (const k of [...fieldKeys(b), ...commonKeys(b)]) {
    if (keys.has(k) || COMMON_READ.includes(k) || (dynamic && new RegExp(`["']${k}["']`).test(src))) continue;
    definedNotRead.push(`${b.type}: field "${k}" is never read by ${basename(file)}`);
  }
}
for (const w of readNotDefined) warn(w);
for (const w of definedNotRead) warn(w);
if (!readNotDefined.length && !definedNotRead.length) ok("data keys: every field is read and every key read has a field");
if (opt("--strict-keys") && (readNotDefined.length || definedNotRead.length)) fail("data key mismatches (--strict-keys)");

if (opt("--no-build")) finish();

// 4. Build the test site -----------------------------------------------------------------------------------------------
const H = `"><script>PWN()</script><img src=x onerror=PWN()>`; // hostile text
const HL = "javascript:PWN()"; // hostile link
const TEXT = ["text", "textarea", "rich"], LINK = ["link"];
const resolveField = (f) => (typeof f === "string" ? schema.shared_fields[f.slice(1)] : f);
function hostile(type, data) {
  const b = byType[type]; if (!b || type === "html") return data; // custom code is raw HTML by design (Owner/Admins only)
  const out = structuredClone(data);
  const walk = (fields, obj) => {
    for (const f of fields.map(resolveField)) {
      const v = obj[f.key];
      if (f.type === "text" && /(^|_)(url|href)$/.test(f.key) && v !== undefined) obj[f.key] = HL; // a pasted link
      else if (TEXT.includes(f.type) && v !== undefined) obj[f.key] = H;
      else if (LINK.includes(f.type) && v !== undefined) obj[f.key] = HL;
      else if ((f.type === "lines" || f.type === "csv") && Array.isArray(v)) obj[f.key] = v.map(() => H);
      else if (f.type === "buttons" && Array.isArray(v)) obj[f.key] = v.map((x) => ({ ...x, label: H, href: HL }));
      else if (f.type === "list" && Array.isArray(v)) v.forEach((x) => x && typeof x === "object" && walk(f.fields, x));
    }
  };
  walk(b.fields, out);
  if (type === "container") for (const c of out.cols || []) c.blocks = (c.blocks || []).map((x) => ({ ...x, data: hostile(x.type, x.data) }));
  return out;
}
const MARK_A = "BLOCKTEST-START", MARK_B = "BLOCKTEST-END";
const mark = (id, m) => ({ id, type: "rich_text", data: { html: `<p>${m}</p>` } });
const page = (path, title, inner) => ({ path, title, blocks: [mark("ma", MARK_A), ...inner, mark("mb", MARK_B)] });
const wrap = (b) => ({ id: "ct", type: "container", data: { cols: [{ blocks: b ? [b] : [] }, { blocks: [{ id: "beside", type: "rich_text", data: { html: "<p>Beside it</p>" } }] }] } });
const one = (b, data) => ({ id: "blk-" + b.type, type: b.type, data });

const ctx = schema.sample_context || {};
const pages = [{ path: "/", title: "Home", blocks: [mark("h", "Home")] }, page("/b/__empty/", "Empty", []), page("/c/__empty/", "Empty", [wrap(null)])];
for (const b of blocks) {
  pages.push(page(`/b/${b.type}/`, b.label, [one(b, b.sample)]));
  pages.push(page(`/c/${b.type}/`, b.label, [wrap(one(b, b.sample))]));
  pages.push(page(`/h/${b.type}/`, b.label, [one(b, hostile(b.type, b.sample))]));
}
const entry = (e, i) => ({ id: e.id || "e" + i, type: e.type || "page", title: e.title, slug: e.slug ?? (e.path.split("/").filter(Boolean).pop() || ""), path: e.path, blocks: e.blocks || [],
  excerpt: e.excerpt || "", featured_image: "", authors: [], categories: e.categories || [], tags: [], service_line: e.service_line || "", account: "", fields: {}, seo: {}, parent: "",
  sort_order: i, published_at: e.published_at || "", updated: "2026-11-09" });
const bundle = {
  site: { id: "s", key: "blocktest", name: "Block Test", theme: "nlmc", environment: "staging", url: "http://localhost:4321", live_url: "", settings: ctx.settings || {} },
  generated_at: "2026-11-09", entries: [...pages.map(entry), ...(ctx.entries || []).map((e, i) => entry(e, 1000 + i))], sections: ctx.sections || {}, menus: {},
  categories: ctx.categories || [], proof: ctx.proof || [], testimonials: ctx.testimonials || [], faqs: ctx.faqs || [], team: ctx.team || [], users: ctx.users || {},
  service_lines: ctx.service_lines || [], accounts: {}, media: ctx.media || {}, redirects: [], booking_links: ctx.booking_links || [], forms: ctx.forms || {}, data: ctx.data || {},
};

const ws = join(root, ".work", "test-blocks");
rmSync(join(ws, "src"), { recursive: true, force: true });
rmSync(join(ws, "dist"), { recursive: true, force: true });
mkdirSync(ws, { recursive: true });
for (const f of ["astro.config.mjs", "package.json", "tsconfig.json"]) cpSync(join(root, f), join(ws, f));
for (const d of readdirSync(join(root, "src"))) if (d !== "media" && d !== "data") cpSync(join(root, "src", d), join(ws, "src", d), { recursive: true });
mkdirSync(join(ws, "src/data"), { recursive: true });
mkdirSync(join(ws, "src/media"), { recursive: true });
if (!existsSync(join(ws, "node_modules"))) symlinkSync(join(root, "node_modules"), join(ws, "node_modules"), "dir");
writeFileSync(join(ws, "src/data/bundle.json"), JSON.stringify(bundle));
for (const m of Object.values(bundle.media)) {
  if (!/\.svg$/.test(m.file)) continue;
  writeFileSync(join(ws, "src/media", m.file), `<svg xmlns="http://www.w3.org/2000/svg" width="${m.width}" height="${m.height}" viewBox="0 0 ${m.width} ${m.height}"><rect width="100%" height="100%" fill="#7aa"/><text x="20" y="60" font-size="48">${m.name}</text></svg>`);
}

const tb = Date.now();
const r = spawnSync("npx", ["astro", "build"], { cwd: ws, encoding: "utf8", env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" }, maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) {
  console.log((r.stdout || "").split("\n").slice(-40).join("\n") + "\n" + (r.stderr || "").split("\n").slice(-40).join("\n"));
  fail(`astro build failed (exit ${r.status})`);
  finish();
}
ok(`astro build: ${pages.length} pages in ${((Date.now() - tb) / 1000).toFixed(1)} s`);

const read = (p) => { const f = join(ws, "dist", p, "index.html"); return existsSync(f) ? readFileSync(f, "utf8") : null; };
const between = (html) => { const a = html.indexOf(MARK_A), b = html.indexOf(MARK_B); return a === -1 || b === -1 ? null : html.slice(a + MARK_A.length, b).replace(/\s+/g, " ").trim(); };
const emptyTop = between(read("/b/__empty/") || ""), emptyCt = between(read("/c/__empty/") || "");
const text = (s) => s.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").replace(/\s+/g, " ").trim();
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Markup that got out: a <script> or an onerror= outside any quoted attribute value (quoted values are safe as long as
// their quotes are escaped, which the stripping below relies on), or a javascript: link.
const BAD_MARKUP = [/<script>PWN/i, /<img[^>]*\sonerror=PWN/i], BAD_URL = [/\s(?:href|src|action|formaction)=["']?\s*javascript:/i];
const unquoted = (html) => html.replace(/="[^"]*"/g, '=""').replace(/='[^']*'/g, "=''");
for (const b of blocks) {
  const problems = [];
  for (const [v, base] of [["b", emptyTop], ["c", emptyCt]]) {
    const html = read(`/${v}/${b.type}/`);
    if (!html) { problems.push(`/${v}/${b.type}/ was not built`); continue; }
    const mid = between(html);
    if (mid === null) problems.push(`/${v}/ markers missing`);
    else if (mid === base) problems.push(v === "b" ? "renders nothing with its sample data" : "renders nothing inside a container");
    else if (typeof b.sample.heading === "string" && fieldKeys(b).includes("heading") && !mid.includes(esc(b.sample.heading)) && !text(mid).includes(b.sample.heading))
      problems.push(`${v === "b" ? "" : "in a container: "}the sample heading "${b.sample.heading}" isn't shown`);
  }
  const h = read(`/h/${b.type}/`);
  if (!h) problems.push(`/h/${b.type}/ was not built`);
  else for (const [re, src] of [...BAD_MARKUP.map((re) => [re, unquoted(h)]), ...BAD_URL.map((re) => [re, h])]) if (re.test(src)) {
    const i = src.search(re); problems.push(`hostile sample: ${re.source} got through … ${src.slice(Math.max(0, i - 80), i + 60).replace(/\s+/g, " ")}`);
  }
  if (problems.length) for (const p of problems) fail(`${b.type}: ${p}`);
  else ok(`${b.type}: renders (top level + in a container), hostile strings escaped`);
}
if (!opt("--keep")) rmSync(ws, { recursive: true, force: true });
finish();

function finish() {
  console.log(`\n${failed ? failed + " failure(s)" : "all block checks passed"}${warned ? `, ${warned} warning(s)` : ""} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(failed ? 1 : 0);
}
