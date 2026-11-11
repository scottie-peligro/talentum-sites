// Talentum website builder — a small HTTP service Talentum calls when someone publishes.
//
//   POST /build   { build_id, site_key, environment: staging|live|preview, cf_project, mode: build|promote|preview, from_build,
//                   site_url, branch, preview_token, edge: { d1_id, vars, secrets } }
//                 header X-Builder-Secret. Answers 202 at once; progress and the result go back to
//                 Talentum: POST {PB_URL}/api/site-builds/{build_id}/report.
//   GET  /health
//   GET  /queue   header X-Builder-Secret → { current, current_started, waiting: [build ids in order], at }. Talentum
//                 compares it with the builds it thinks are queued/building (lib/sitequeue.js): this queue lives in
//                 memory, so a restart loses it, and Talentum then sends recent builds again or marks them failed.
//   anything else → the Live view (`astro dev`), so one public port is enough on a server (LIVE_PUBLIC_URL).
//   POST /live    { site_key, bundle, path }   header X-Builder-Secret. The Live view in Talentum's page editor:
//                 writes this content (the unsaved draft already merged in) into a long-running `astro dev` and
//                 answers { url } — the page at LIVE_PUBLIC_URL, which reloads itself whenever the content changes.
//                 Same renderer code as a real build, so what you see is what publishes. One site at a time.
//
// Each site builds in its own working copy (WORK_DIR/sites/<key>) so its downloaded media and Astro's image cache
// survive between builds — a normal publish only re-renders pages and re-optimises new images.
// "Promote to Live" rebuilds from the exact content snapshot the staging build used (saved with that build), for
// the live domain: same content, but indexable, real analytics, live canonical URLs.
//
// Env: BUILDER_SECRET, PB_URL (http://pocketbase:8090 locally; on Sevalla the API's internal-connection address, not
//      its public URL), CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
//      WORK_DIR (/data), PORT (8787), KEEP_BUILDS (5 per site and environment)
import http from "node:http";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, readdirSync, statSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.BUILDER_SECRET || process.env.SITE_BUILDER_SECRET || "";
const PB = (process.env.PB_URL || "http://pocketbase:8090").replace(/\/+$/, "");
const WORK = process.env.WORK_DIR || join(REPO, ".work");
const KEEP = Number(process.env.KEEP_BUILDS || 5);
const LIVE_PORT = Number(process.env.LIVE_PORT || 4321);
const LIVE_PUBLIC = (process.env.LIVE_PUBLIC_URL || `http://localhost:${LIVE_PORT}`).replace(/\/+$/, "");
if (!SECRET) { console.error("BUILDER_SECRET is not set."); process.exit(1); }

const queue = [];
let busy = false;
let current = null;          // the job being built now (GET /queue)
let currentStarted = 0;

// Progress reports are fire-and-forget; the final one (success/failed/superseded) is retried, or Talentum would show the
// build as "building" until its 25-minute cut-off.
async function report(id, body) {
  const tries = body.status === "building" ? 1 : 5;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(`${PB}/api/site-builds/${id}/report`, { method: "POST", headers: { "Content-Type": "application/json", "X-Builder-Secret": SECRET }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      if (r.ok) return;
      console.warn(`report ${id} → ${r.status}`);
      if (r.status < 500 && r.status !== 429) return;
    } catch (e) { console.warn(`report ${id} failed: ${e.message}`); }
    if (i < tries) await new Promise((res) => setTimeout(res, 2000 * 2 ** (i - 1)));
  }
}

function run(cmd, args, opts, log) {
  return new Promise((resolve, reject) => {
    log.push(`$ ${cmd} ${args.join(" ")}`);
    const p = spawn(cmd, args, { ...opts, shell: false });
    const take = (d) => { for (const line of String(d).split(/\r?\n/)) { if (!line.trim()) continue; const m = line.match(/\((\d+)\/(\d+)\)\s*$/); if (/▶ \/_astro\//.test(line)) { if (m && (+m[1] % 50 === 0 || m[1] === m[2])) log.push(`Optimising images… ${m[1]}/${m[2]}`); } else log.push(line); } };
    p.stdout.on("data", take); p.stderr.on("data", take);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0] || ""} exited with ${code}`))));
  });
}

/** A per-site working copy: the renderer's source, with node_modules shared from the repo. */
function workspaceFor(key) {
  const dir = join(WORK, "sites", key);
  mkdirSync(dir, { recursive: true });
  for (const f of ["astro.config.mjs", "package.json", "tsconfig.json"]) if (existsSync(join(REPO, f))) cpSync(join(REPO, f), join(dir, f));
  for (const d of ["scripts", "public"]) if (existsSync(join(REPO, d))) cpSync(join(REPO, d), join(dir, d), { recursive: true });
  // src: everything except the site's own data/media (kept between builds)
  mkdirSync(join(dir, "src", "media"), { recursive: true });
  mkdirSync(join(dir, "src", "data"), { recursive: true });
  for (const d of readdirSync(join(REPO, "src"))) {
    if (d === "media" || d === "data") continue;
    rmSync(join(dir, "src", d), { recursive: true, force: true });
    cpSync(join(REPO, "src", d), join(dir, "src", d), { recursive: true });
  }
  if (!existsSync(join(dir, "node_modules"))) symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"), "dir");
  return dir;
}

function prune(key, env) {
  const base = join(WORK, "builds");
  if (!existsSync(base)) return;
  const mine = readdirSync(base).filter((d) => d.startsWith(`${key}--${env}--`)).map((d) => ({ d, t: statSync(join(base, d)).mtimeMs })).sort((a, b) => b.t - a.t);
  for (const x of mine.slice(KEEP)) rmSync(join(base, x.d), { recursive: true, force: true });
}

// wrangler run directly (not through npx: one less Node process) with a capped heap — `pages deploy` hashes and
// uploads every file of the site, and with the builder's 1 GB a big site's deploy was OOM-killing the whole builder.
// Also patched when the builder starts (local Docker mounts the repo over the image's copy).
try { execFileSync(process.execPath, [join(REPO, "scripts", "patch-wrangler.mjs")], { stdio: "inherit" }); } catch (e) { console.warn("patch-wrangler failed:", e.message); }
function wrangler(args, opts, log) {
  const env = { ...(opts.env || process.env), MALLOC_ARENA_MAX: "2",
    NODE_OPTIONS: `${(opts.env || process.env).NODE_OPTIONS || ""} --max-old-space-size=${Number(process.env.DEPLOY_HEAP_MB) || 512}`.trim() };
  return run("node", [join(REPO, "node_modules", "wrangler", "bin", "wrangler.js"), ...args], { ...opts, env }, log);
}

async function ensureProject(project, log, env) {
  try { await wrangler(["pages", "project", "create", project, "--production-branch", "main"], { cwd: REPO, env }, log); }
  catch { log.push(`(project ${project} already exists)`); }
}

/** Wire the project's Functions: the D1 binding, the site's variables and secrets (forms, Site Assistant, Turnstile).
 *  Skipped when nothing changed since the last build of this project. */
async function configureProject(job, log) {
  const e = job.edge;
  if (!e || !process.env.CLOUDFLARE_API_TOKEN) return;
  const envName = job.environment === "live" ? "live" : "staging";
  const cfg = (siteEnv) => {
    const env_vars = { SITE_ENV: { type: "plain_text", value: siteEnv } };
    for (const [k, v] of Object.entries(e.vars || {})) env_vars[k] = { type: "plain_text", value: String(v ?? "") };
    for (const [k, v] of Object.entries(e.secrets || {})) env_vars[k] = { type: "secret_text", value: String(v ?? "") };
    const c = { compatibility_date: "2025-01-01", env_vars };
    if (e.d1_id) c.d1_databases = { DB: { id: e.d1_id } };
    if (e.r2_bucket) c.r2_buckets = { UPLOADS: { name: e.r2_bucket } };   // form uploads
    return c;
  };
  const body = { deployment_configs: { production: cfg(envName), preview: cfg("preview") } };
  const hash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const mark = join(WORK, `edge-${job.cf_project}.hash`);
  if (existsSync(mark) && readFileSync(mark, "utf8") === hash) return;
  const url = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${job.cf_project}`;
  const r = await fetch(url, { method: "PATCH", headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.success === false) { log.push(`Couldn't set up forms/assistant on ${job.cf_project}: ${(j.errors || []).map((x) => x.message).join("; ") || r.status}`); return; }
  writeFileSync(mark, hash);
  log.push(`Forms${e.vars?.ASSISTANT_BASE ? ", Site Assistant" : ""}${e.d1_id ? "" : " (no database yet)"} wired on ${job.cf_project}.`);
}

async function handle(job) {
  const started = Date.now();
  const log = [];
  const tag = `${job.site_key}--${job.environment}--${job.build_id}`;
  const out = join(WORK, "builds", tag);
  await report(job.build_id, { status: "building" });
  // Send the log so far every 10 s, so the Builds tab shows progress on long builds.
  const ticker = setInterval(() => { report(job.build_id, { status: "building", log: log.slice(-200).join("\n") }); }, 10000);
  try {
    const dry = process.env.DRY_RUN === "1";   // build only, no deploy (testing)
    if (!dry && (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID)) throw new Error("CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID aren't set on the builder.");
    const dir = workspaceFor(job.site_key);
    const preview = job.mode === "preview";
    const env = { ...process.env, ASTRO_CACHE_DIR: join(WORK, "astro-cache"), PB_URL: PB, SITE_KEY: job.site_key, SITE_ENV: preview ? "staging" : job.environment, BUILDER_SECRET: SECRET, SITE_URL: job.site_url || "", ASTRO_TELEMETRY_DISABLED: "1" };
    if (preview) { env.PREVIEW_TOKEN = job.preview_token || ""; log.push("Preview build of one draft."); }
    if (job.mode === "promote") {
      const snap = readdirSync(join(WORK, "builds")).find((d) => d.endsWith(`--${job.from_build}`));
      if (!snap || !existsSync(join(WORK, "builds", snap, "bundle.json"))) throw new Error("The staging build to promote is no longer on the builder — publish to staging again, then promote.");
      env.BUNDLE_FILE = join(WORK, "builds", snap, "bundle.json");
      log.push(`Promoting the content of staging build ${job.from_build}.`);
    }
    log.push(`Content from ${new URL(PB).origin}`);   // the public, Cloudflare-fronted API URL here means every image goes out and back through Cloudflare
    await run("node", ["scripts/fetch-content.mjs"], { cwd: dir, env }, log);
    // Memory (the Sevalla builder has 1 GB, shared with this server and the Live view): run Astro directly rather than
    // through npx (one less ~80 MB process); report 1 CPU so it optimises one image at a time and turn sharp's cache
    // off (scripts/limit-cpus.mjs); stop glibc growing an arena per thread; and cap Node's heap so a site that is
    // simply too big fails with a message instead of the whole builder being OOM-killed. Images already optimised
    // are kept in ASTRO_CACHE_DIR, so the next build only does new ones. Autopeople (282 pages, 3,456 image
    // variants): ~1.3 GB before → ~0.75 GB.
    const heap = Number(process.env.BUILD_HEAP_MB) || 640;
    const astroEnv = { ...env, MALLOC_ARENA_MAX: env.MALLOC_ARENA_MAX || "2", BUILD_CPUS: env.BUILD_CPUS || "1",
      NODE_OPTIONS: `${env.NODE_OPTIONS || ""} --max-old-space-size=${heap} --import ${join(REPO, "scripts", "limit-cpus.mjs")}`.trim() };
    try {
      await run("node", [join(dir, "node_modules", "astro", "astro.js"), "build"], { cwd: dir, env: astroEnv }, log);
    } catch (e) {
      if (log.slice(-40).some((l) => /heap out of memory|Allocation failed/i.test(l))) throw new Error(`This site needs more memory to build than the builder allows (${heap} MB). Images already optimised are kept, so Rebuild usually gets further.`);
      throw e;
    }
    await run("node", ["scripts/postbuild.mjs"], { cwd: dir, env }, log);
    mkdirSync(out, { recursive: true });
    cpSync(join(dir, "dist"), join(out, "dist"), { recursive: true });
    cpSync(join(dir, "src", "data", "bundle.json"), join(out, "bundle.json"));
    const manifest = JSON.parse(readFileSync(join(dir, ".build-manifest.json"), "utf8"));
    const bundle = JSON.parse(readFileSync(join(out, "bundle.json"), "utf8"));

    const dlog = [];
    if (dry) dlog.push("DRY_RUN: not deployed. Output in " + join(out, "dist"));
    else { await ensureProject(job.cf_project, log, env); await configureProject(job, log); }
    const branch = /^[a-z0-9-]{1,40}$/.test(job.branch || "") ? job.branch : "main";
    // Deployed from the repo root so wrangler also bundles functions/ (forms, assistant, 404 log).
    if (!dry) await wrangler(["pages", "deploy", join(out, "dist"), "--project-name", job.cf_project, "--branch", branch, "--commit-dirty=true", "--commit-message", `Talentum ${job.environment} build ${job.build_id}`], { cwd: REPO, env }, dlog);
    log.push(...dlog);
    const urls = dlog.join("\n").match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev/gi) || [];
    // A branch deploy prints the one-off URL and then the branch alias; the alias is the stable one to share.
    const url = (branch !== "main" && urls.find((u) => u.startsWith(`https://${branch}.`))) || urls[0] || "";
    writeFileSync(join(out, "done"), new Date().toISOString());
    prune(job.site_key, job.environment);
    await report(job.build_id, { status: "success", pages: Object.keys(manifest).length, duration_ms: Date.now() - started, deployment_url: url, manifest, bundle_hash: bundle.hash || "", log: log.slice(-400).join("\n") });
    clearInterval(ticker);
    console.log(`✓ ${tag} in ${Math.round((Date.now() - started) / 1000)}s ${url}`);
  } catch (err) {
    clearInterval(ticker);
    console.error(`✗ ${tag}: ${err.message}`);
    await report(job.build_id, { status: "failed", error: err.message, duration_ms: Date.now() - started, log: log.slice(-400).join("\n") });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Live view: ONE `astro dev` for every website being edited, in WORK/live/_all (src/lib/live.ts, src/middleware.ts,
// scripts/live-sites.mjs). Each website's draft is src/data/live/<key>.json there; the preview address carries
// ?site=<key>. Switching website never restarts anything, and several people can preview several websites at once.
// Each website's media and fonts are fetched in its own folder (WORK/live-fetch/<key>: fetch-content.mjs keeps only
// that website's files there) and then copied in. Media file names are their Talentum ids, so websites never clash.
// ---------------------------------------------------------------------------------------------------------------
let live = null;   // { dir, proc }
let liveBusy = Promise.resolve();
const LIVE_DIR = join(WORK, "live", "_all");

function liveWorkspace() {
  const dir = LIVE_DIR;
  for (const d of ["media", "data/live", "data/live-fonts"]) mkdirSync(join(dir, "src", d), { recursive: true });
  for (const f of ["astro.config.mjs", "package.json", "tsconfig.json"]) if (existsSync(join(REPO, f))) cpSync(join(REPO, f), join(dir, f));
  for (const d of ["scripts", "public"]) if (existsSync(join(REPO, d))) cpSync(join(REPO, d), join(dir, d), { recursive: true });
  for (const d of readdirSync(join(REPO, "src"))) {
    if (d === "media" || d === "data") continue;
    rmSync(join(dir, "src", d), { recursive: true, force: true });
    cpSync(join(REPO, "src", d), join(dir, "src", d), { recursive: true });
  }
  if (existsSync(join(REPO, "src", "data", "block-schema.json"))) cpSync(join(REPO, "src", "data", "block-schema.json"), join(dir, "src", "data", "block-schema.json"));
  if (!existsSync(join(dir, "node_modules"))) symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"), "dir");
  return dir;
}
function fetchWorkspace(key) {
  const dir = join(WORK, "live-fetch", key);
  for (const d of ["src/media", "src/data", "public"]) mkdirSync(join(dir, d), { recursive: true });
  cpSync(join(REPO, "scripts"), join(dir, "scripts"), { recursive: true });
  return dir;
}

function waitFor(url, ms) {
  const end = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => fetch(url).then(() => resolve()).catch(() => (Date.now() > end ? reject(new Error("The live view didn't start in time.")) : setTimeout(tick, 400)));
    tick();
  });
}

/** Copy a source tree into the running Live view: only files whose content changed, each written to a temporary
 * file and renamed into place, so astro dev never reloads untouched components or reads a half-written one (a reload
 * of every component mid-request is what left "Blocks" undefined). Returns how many files changed. */
function syncTree(from, to, skip) {
  let changed = 0;
  for (const name of readdirSync(from)) {
    if (skip && skip(name)) continue;
    const a = join(from, name), b = join(to, name);
    if (statSync(a).isDirectory()) { mkdirSync(b, { recursive: true }); changed += syncTree(a, b, skip); continue; }
    const data = readFileSync(a);
    if (existsSync(b) && readFileSync(b).equals(data)) continue;
    const tmp = b + ".tmp-" + process.pid;
    writeFileSync(tmp, data);
    renameSync(tmp, b);
    changed++;
  }
  return changed;
}
/** Write a file only when its content changed (atomically). A changed website draft is what makes astro dev reload. */
function writeIfChanged(file, data) {
  if (existsSync(file) && readFileSync(file).equals(data)) return false;
  const tmp = file + ".tmp-" + process.pid;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
  return true;
}

/** Is anything still listening on the Live view's port? */
function portBusy(port) {
  return new Promise((resolve) => {
    const t = net.createServer();
    t.once("error", () => resolve(true));
    t.once("listening", () => t.close(() => resolve(false)));
    t.listen(port, "0.0.0.0");
  });
}
/** Stop the Live view (or whatever is left on its port) and wait until the port is free. */
async function stopLive() {
  const cur = live; live = null;
  if (cur) {
    await new Promise((resolve) => {
      if (cur.proc.exitCode !== null || cur.proc.signalCode) return resolve();
      const done = setTimeout(() => { try { cur.proc.kill("SIGKILL"); } catch {} resolve(); }, 5000);
      cur.proc.once("close", () => { clearTimeout(done); resolve(); });
      try { cur.proc.kill(); } catch { clearTimeout(done); resolve(); }
    });
  }
  const end = Date.now() + 10000;
  while (await portBusy(LIVE_PORT)) {
    if (Date.now() > end) throw new Error("The Live view's port is still in use — try again in a moment.");
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function liveUpdate(key, bundle) {
  // 1. This website's media and fonts, in its own folder (cached between updates).
  const fdir = fetchWorkspace(key);
  const file = join(fdir, ".live-bundle.json");
  writeFileSync(file, JSON.stringify(bundle));
  const env = { ...process.env, BUNDLE_FILE: file, SITE_ENV: "staging", ASTRO_TELEMETRY_DISABLED: "1" };
  const log = [];
  try { await run("node", ["scripts/fetch-content.mjs"], { cwd: fdir, env }, log); }
  catch { throw new Error("Couldn't get this website's media and fonts for the Live view: " + log.filter((l) => !l.startsWith("$ ")).slice(-2).join(" — ").slice(0, 300)); }
  // 2. The shared Live view: renderer code up to date (astro dev hot-reloads it), then this website's files.
  const fresh = !live;
  const dir = fresh ? liveWorkspace() : LIVE_DIR;
  if (!fresh) for (const d of readdirSync(join(REPO, "src"))) if (d !== "media" && d !== "data") {
    const a = join(REPO, "src", d);
    if (statSync(a).isDirectory()) { mkdirSync(join(dir, "src", d), { recursive: true }); syncTree(a, join(dir, "src", d)); }
    else syncTree(join(REPO, "src"), join(dir, "src"), (n) => n === "media" || n === "data" || statSync(join(REPO, "src", n)).isDirectory());
  }
  syncTree(join(fdir, "src", "media"), join(dir, "src", "media"), (n) => n.startsWith("."));
  if (existsSync(join(fdir, "public", "_fonts"))) { mkdirSync(join(dir, "public", "_fonts"), { recursive: true }); syncTree(join(fdir, "public", "_fonts"), join(dir, "public", "_fonts")); }
  const fonts = join(fdir, "src", "data", "fonts.json");
  if (existsSync(fonts)) writeIfChanged(join(dir, "src", "data", "live-fonts", key + ".json"), readFileSync(fonts));
  const content = readFileSync(join(fdir, "src", "data", "bundle.json"));
  // The renderer's normal build input has to exist; in the Live view every request picks its own website instead.
  if (!existsSync(join(dir, "src", "data", "bundle.json"))) writeFileSync(join(dir, "src", "data", "bundle.json"), content);
  writeIfChanged(join(dir, "src", "data", "live", key + ".json"), content);   // last: this is what reloads the preview
  // 3. Start the one dev server the first time.
  if (fresh) {
    if (await portBusy(LIVE_PORT)) await stopLive();   // something left over (e.g. an earlier builder's astro)
    // Astro directly (not through npx), so stopping this process really stops the preview server.
    const proc = spawn("node", [join(dir, "node_modules", "astro", "astro.js"), "dev", "--host", "0.0.0.0", "--port", String(LIVE_PORT)],
      { cwd: dir, env: { ...process.env, LIVE_MULTI: "1", SITE_ENV: "staging", ASTRO_TELEMETRY_DISABLED: "1", NODE_ENV: "development", ASTRO_CACHE_DIR: join(WORK, "astro-cache") }, shell: false });
    let bound = "";
    proc.stdout.on("data", (d) => { const m = /localhost:(\d+)/.exec(String(d)); if (m && !bound) bound = m[1]; process.stdout.write(`[live] ${d}`); });
    proc.stderr.on("data", (d) => process.stderr.write(`[live] ${d}`));
    proc.on("close", () => { if (live && live.proc === proc) live = null; });
    live = { dir, proc };
    await waitFor(`http://127.0.0.1:${LIVE_PORT}/`, 60000);
    if (bound && bound !== String(LIVE_PORT)) { await stopLive(); throw new Error("The Live view couldn't get its port — try again in a moment."); }
  }
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    // A newer queued build of the same site + environment makes this one redundant.
    if (job.mode === "build" && queue.some((q) => q.site_key === job.site_key && q.environment === job.environment && q.mode === "build")) {
      await report(job.build_id, { status: "superseded", log: "A newer publish replaced this build." });
      continue;
    }
    current = job; currentStarted = Date.now();
    try { await handle(job); } finally { current = null; currentStarted = 0; }
  }
  busy = false;
}

// ---------------------------------------------------------------------------------------------------------------
// Live view through the builder's own port. On a server (Sevalla) only one port is public, so every request that
// isn't a builder endpoint goes to the running `astro dev`, including its auto-reload websocket. Set
// LIVE_PUBLIC_URL to the builder's public address there. Locally LIVE_PUBLIC_URL stays http://localhost:4321.
// The Host header is rewritten to localhost so Vite's allowed-hosts check passes.
// ---------------------------------------------------------------------------------------------------------------
const LIVE_HOST = `localhost:${LIVE_PORT}`;
function proxyLive(req, res, retried) {
  if (!live) { res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow" }); return res.end("The Live view isn't running. Open a page in Talentum's editor and switch on Live."); }
  // A page request that fails right after an update (astro dev still reloading) is tried once more before the error
  // reaches the editor's Live view.
  const page = req.method === "GET" && !retried && /text\/html/.test(req.headers.accept || "");
  const up = http.request({ host: "127.0.0.1", port: LIVE_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: LIVE_HOST } }, (r) => {
    if (page && (r.statusCode || 0) >= 500) { r.resume(); return setTimeout(() => proxyLive(req, res, true), 800); }
    res.writeHead(r.statusCode || 502, { ...r.headers, "x-robots-tag": "noindex, nofollow" });
    r.pipe(res);
  });
  up.on("error", () => { if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain" }); res.end("The Live view is starting. Try again in a moment."); });
  if (retried) up.end(); else req.pipe(up);
}

const server = http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, queued: queue.length, busy, cloudflare: !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) });
  if (req.method === "GET" && req.url === "/queue") {
    if (req.headers["x-builder-secret"] !== SECRET) return send(403, { error: "Wrong secret" });
    return send(200, { current: current ? current.build_id : null, current_started: currentStarted ? new Date(currentStarted).toISOString() : null, waiting: queue.map((j) => j.build_id), at: new Date().toISOString() });
  }
  if (req.method === "POST" && req.url === "/live") {
    if (req.headers["x-builder-secret"] !== SECRET) return send(403, { error: "Wrong secret" });
    let raw = "";
    req.on("data", (d) => { raw += d; if (raw.length > 30_000_000) req.destroy(); });
    req.on("end", () => {
      let b;
      try { b = JSON.parse(raw); } catch { return send(400, { error: "Bad JSON" }); }
      if (!/^[a-z0-9-]{1,60}$/.test(b.site_key || "") || !b.bundle || !b.bundle.site) return send(400, { error: "Missing or invalid fields" });
      const path = typeof b.path === "string" && b.path.startsWith("/") ? b.path : "/";
      // Updates run one after another; a newer one simply overwrites the content.
      liveBusy = liveBusy.then(() => liveUpdate(b.site_key, b.bundle))
        .then(() => send(200, { url: LIVE_PUBLIC + path + (path.includes("?") ? "&" : "?") + "site=" + encodeURIComponent(b.site_key) }), (err) => send(500, { error: err.message }));
    });
    return;
  }
  if (req.method !== "POST" || req.url !== "/build") return req.method === "POST" ? send(404, { error: "Not found" }) : proxyLive(req, res);
  if (req.headers["x-builder-secret"] !== SECRET) return send(403, { error: "Wrong secret" });
  let raw = "";
  req.on("data", (d) => { raw += d; if (raw.length > 100000) req.destroy(); });
  req.on("end", () => {
    let job;
    try { job = JSON.parse(raw); } catch { return send(400, { error: "Bad JSON" }); }
    if (!job.build_id || !/^[a-z0-9-]{1,60}$/.test(job.site_key || "") || !/^[a-z0-9][a-z0-9-]{0,57}$/.test(job.cf_project || "") || !["staging", "live", "preview"].includes(job.environment)) return send(400, { error: "Missing or invalid fields" });
    // Sent again (Talentum re-sends a build it thinks the builder lost): never run it twice.
    if ((current && current.build_id === job.build_id) || queue.some((q) => q.build_id === job.build_id)) return send(202, { queued: queue.length, duplicate: true });
    queue.push(job);
    send(202, { queued: queue.length });
    pump();
  });
});
// The Live view's auto-reload connection (Vite's websocket), passed straight through.
server.on("upgrade", (req, socket, head) => {
  if (!live) return socket.destroy();
  const up = net.connect(LIVE_PORT, "127.0.0.1", () => {
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${/^host$/i.test(req.rawHeaders[i]) ? LIVE_HOST : req.rawHeaders[i + 1]}`);
    up.write(lines.join("\r\n") + "\r\n\r\n");
    if (head && head.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  const end = () => { up.destroy(); socket.destroy(); };
  up.on("error", end); socket.on("error", end);
});
server.listen(PORT, () => console.log(`Talentum site builder on :${PORT} → ${PB}`));
