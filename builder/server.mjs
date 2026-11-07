// Talentum website builder — a small HTTP service Talentum calls when someone publishes.
//
//   POST /build   { build_id, site_key, environment: staging|live, cf_project, mode: build|promote, from_build, site_url }
//                 header X-Builder-Secret. Answers 202 at once; progress and the result go back to
//                 Talentum: POST {PB_URL}/api/site-builds/{build_id}/report.
//   GET  /health
//
// Each site builds in its own working copy (WORK_DIR/sites/<key>) so its downloaded media and Astro's image cache
// survive between builds — a normal publish only re-renders pages and re-optimises new images.
// "Promote to Live" rebuilds from the exact content snapshot the staging build used (saved with that build), for
// the live domain: same content, but indexable, real analytics, live canonical URLs.
//
// Env: BUILDER_SECRET, PB_URL (http://pocketbase:8090), CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID,
//      WORK_DIR (/data), PORT (8787), KEEP_BUILDS (5 per site and environment)
import http from "node:http";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.BUILDER_SECRET || process.env.SITE_BUILDER_SECRET || "";
const PB = (process.env.PB_URL || "http://pocketbase:8090").replace(/\/+$/, "");
const WORK = process.env.WORK_DIR || join(REPO, ".work");
const KEEP = Number(process.env.KEEP_BUILDS || 5);
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
    const env = { ...process.env, ASTRO_CACHE_DIR: join(WORK, "astro-cache"), PB_URL: PB, SITE_KEY: job.site_key, SITE_ENV: job.environment, BUILDER_SECRET: SECRET, SITE_URL: job.site_url || "", ASTRO_TELEMETRY_DISABLED: "1" };
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
    else await ensureProject(job.cf_project, log, env);
    if (!dry) await run("npx", ["wrangler", "pages", "deploy", join(out, "dist"), "--project-name", job.cf_project, "--branch", "main", "--commit-dirty=true", "--commit-message", `Talentum ${job.environment} build ${job.build_id}`], { cwd: REPO, env }, dlog);
    log.push(...dlog);
    const url = (dlog.join("\n").match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.pages\.dev/i) || [""])[0];
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

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const job = queue.shift();
    // A newer queued build of the same site + environment makes this one redundant.
    if (job.mode !== "promote" && queue.some((q) => q.site_key === job.site_key && q.environment === job.environment && q.mode !== "promote")) {
      await report(job.build_id, { status: "superseded", log: "A newer publish replaced this build." });
      continue;
    }
    await handle(job);
  }
  busy = false;
}

http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, queued: queue.length, busy, cloudflare: !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) });
  if (req.method !== "POST" || req.url !== "/build") return send(404, { error: "Not found" });
  if (req.headers["x-builder-secret"] !== SECRET) return send(403, { error: "Wrong secret" });
  let raw = "";
  req.on("data", (d) => { raw += d; if (raw.length > 100000) req.destroy(); });
  req.on("end", () => {
    let job;
    try { job = JSON.parse(raw); } catch { return send(400, { error: "Bad JSON" }); }
    if (!job.build_id || !/^[a-z0-9-]{1,60}$/.test(job.site_key || "") || !/^[a-z0-9][a-z0-9-]{0,57}$/.test(job.cf_project || "") || !["staging", "live"].includes(job.environment)) return send(400, { error: "Missing or invalid fields" });
    queue.push(job);
    send(202, { queued: queue.length });
    pump();
  });
}).listen(PORT, () => console.log(`Talentum site builder on :${PORT} → ${PB}`));
