// Talentum website builder — a small HTTP service Talentum calls when someone publishes.
//
//   POST /build   { build_id, site_key, environment: staging|live|preview, cf_project, mode: build|promote|preview, from_build,
//                   site_url, branch, preview_token, edge: { d1_id, vars, secrets } }
//                 header X-Builder-Secret. Answers 202 at once; progress and the result go back to
//                 Talentum: POST {PB_URL}/api/site-builds/{build_id}/report.
//   GET  /health
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
// Env: BUILDER_SECRET, PB_URL (http://pocketbase:8090), CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
//      WORK_DIR (/data), PORT (8787), KEEP_BUILDS (5 per site and environment)
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
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

function report(id, body) {
  return fetch(`${PB}/api/site-builds/${id}/report`, { method: "POST", headers: { "Content-Type": "application/json", "X-Builder-Secret": SECRET }, body: JSON.stringify(body) })
    .then((r) => { if (!r.ok) console.warn(`report ${id} → ${r.status}`); })
    .catch((e) => console.warn(`report ${id} failed: ${e.message}`));
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

async function ensureProject(project, log, env) {
  try { await run("npx", ["wrangler", "pages", "project", "create", project, "--production-branch", "main"], { cwd: REPO, env }, log); }
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
    await run("node", ["scripts/fetch-content.mjs"], { cwd: dir, env }, log);
    await run("npx", ["astro", "build"], { cwd: dir, env }, log);
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
    if (!dry) await run("npx", ["wrangler", "pages", "deploy", join(out, "dist"), "--project-name", job.cf_project, "--branch", branch, "--commit-dirty=true", "--commit-message", `Talentum ${job.environment} build ${job.build_id}`], { cwd: REPO, env }, dlog);
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
// Live view: one `astro dev` at a time, in WORK/live/<key>.
// ---------------------------------------------------------------------------------------------------------------
let live = null;   // { key, dir, proc, ready: Promise }
let liveBusy = Promise.resolve();

function liveWorkspace(key) {
  const dir = join(WORK, "live", key);
  mkdirSync(join(dir, "src", "media"), { recursive: true });
  mkdirSync(join(dir, "src", "data"), { recursive: true });
  for (const f of ["astro.config.mjs", "package.json", "tsconfig.json"]) if (existsSync(join(REPO, f))) cpSync(join(REPO, f), join(dir, f));
  for (const d of ["scripts", "public"]) if (existsSync(join(REPO, d))) cpSync(join(REPO, d), join(dir, d), { recursive: true });
  for (const d of readdirSync(join(REPO, "src"))) {
    if (d === "media" || d === "data") continue;
    rmSync(join(dir, "src", d), { recursive: true, force: true });
    cpSync(join(REPO, "src", d), join(dir, "src", d), { recursive: true });
  }
  if (!existsSync(join(dir, "node_modules"))) symlinkSync(join(REPO, "node_modules"), join(dir, "node_modules"), "dir");
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
function syncTree(from, to) {
  let changed = 0;
  for (const name of readdirSync(from)) {
    const a = join(from, name), b = join(to, name);
    if (statSync(a).isDirectory()) { mkdirSync(b, { recursive: true }); changed += syncTree(a, b); continue; }
    const data = readFileSync(a);
    if (existsSync(b) && readFileSync(b).equals(data)) continue;
    const tmp = b + ".tmp-" + process.pid;
    writeFileSync(tmp, data);
    renameSync(tmp, b);
    changed++;
  }
  return changed;
}

async function liveUpdate(key, bundle) {
  if (live && live.key !== key) { try { live.proc.kill(); } catch {} live = null; }
  const dir = live ? live.dir : liveWorkspace(key);
  // Already running: bring the renderer's code up to date too (astro dev hot-reloads it), so theme/block changes
  // show in the Live view without restarting the builder.
  if (live) for (const d of readdirSync(join(REPO, "src"))) if (d !== "media" && d !== "data") {
    const a = join(REPO, "src", d);
    if (statSync(a).isDirectory()) { mkdirSync(join(dir, "src", d), { recursive: true }); syncTree(a, join(dir, "src", d)); }
    else syncTree(join(REPO, "src"), join(dir, "src"));
  }
  const file = join(dir, ".live-bundle.json");
  writeFileSync(file, JSON.stringify(bundle));
  const env = { ...process.env, BUNDLE_FILE: file, SITE_ENV: "staging", ASTRO_TELEMETRY_DISABLED: "1" };
  const log = [];
  // Media and fonts (cached between updates), then src/data/bundle.json, which astro dev picks up and reloads.
  await run("node", ["scripts/fetch-content.mjs"], { cwd: dir, env }, log);
  if (!live) {
    const proc = spawn("npx", ["astro", "dev", "--host", "0.0.0.0", "--port", String(LIVE_PORT)], { cwd: dir, env: { ...env, NODE_ENV: "development", ASTRO_CACHE_DIR: join(WORK, "astro-cache") }, shell: false });
    proc.stdout.on("data", (d) => process.stdout.write(`[live] ${d}`));
    proc.stderr.on("data", (d) => process.stderr.write(`[live] ${d}`));
    proc.on("close", () => { if (live && live.proc === proc) live = null; });
    live = { key, dir, proc };
    await waitFor(`http://127.0.0.1:${LIVE_PORT}/`, 60000);
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
    await handle(job);
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
        .then(() => send(200, { url: LIVE_PUBLIC + path }), (err) => send(500, { error: err.message }));
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
