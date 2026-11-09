// Shared helpers for the site's Pages Functions (functions/). Bundled by wrangler at deploy time.
// Bindings and variables are set on the Pages project by the builder (builder/server.mjs → configureProject):
//   DB (D1 "talentum-sites"), SITE_KEY, SITE_ENV (live | staging | preview), ASSISTANT_* and TURNSTILE_SECRET.

export function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });
}

/** Requests from another site are refused (stops other pages posting into our forms). No Origin header = a plain form post. */
export function sameOrigin(request) {
  const o = request.headers.get("Origin");
  if (!o || o === "null") return true;
  try { return new URL(o).host === new URL(request.url).host; } catch { return false; }
}

export async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

/** Who's asking, hashed (no raw IPs are stored). */
export async function visitor(request, env) {
  return sha((request.headers.get("CF-Connecting-IP") || "") + "|" + (env.SITE_KEY || ""));
}

/** Count a hit against `key`; returns true when over `max` per `windowSec`. */
export async function limited(env, key, max, windowSec) {
  if (!env.DB) return false;
  const now = Date.now();
  const reset = now + windowSec * 1000;
  try {
    const row = await env.DB.prepare(
      "INSERT INTO ratelimit (k, n, reset) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = CASE WHEN reset < ?3 THEN 1 ELSE n + 1 END, reset = CASE WHEN reset < ?3 THEN ?2 ELSE reset END RETURNING n"
    ).bind(key, reset, now).first();
    if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM ratelimit WHERE reset < ?1").bind(now).run();
    return (row?.n || 0) > max;
  } catch { return false; }
}

/** Leave something for Talentum to pick up (it checks every minute). */
export async function toInbox(env, kind, payload) {
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO inbox (id, site, env, kind, payload, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(id, env.SITE_KEY || "", env.SITE_ENV || "live", kind, JSON.stringify(payload), Date.now()).run();
  return id;
}

export async function turnstileOk(env, token, request) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  body.append("remoteip", request.headers.get("CF-Connecting-IP") || "");
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    return !!(await r.json()).success;
  } catch { return false; }
}

export const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|curl|wget|python|httpclient|headless|lighthouse/i;

// File types a form can accept (kept the same as Talentum's pb_hooks/lib/websites.js FILE_GROUPS). The page tells the
// visitor the form's own limits; this is the hard ceiling for anything sent here.
export const FILE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "pdf", "doc", "docx", "odt", "rtf", "xls", "xlsx", "csv", "ods",
  "ppt", "pptx", "odp", "key", "txt", "md", "zip", "ai", "eps", "psd", "svg", "indd", "fig", "sketch", "mp4", "mov", "webm", "m4v", "mp3", "wav", "m4a"]);
export const UPLOAD_MAX = 25 * 1048576;          // per file
export const UPLOAD_TOTAL = 60 * 1048576;        // per entry
