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

/** Read a request body as text, stopping once it passes `max` bytes (a missing or false Content-Length can't get
 *  round the limit). → { text } or { tooLarge: true }. */
export async function readCapped(request, max) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > max) return { tooLarge: true };
  if (!request.body) return { text: "" };
  const reader = request.body.getReader();
  const parts = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch {} return { tooLarge: true }; }
    parts.push(value);
  }
  const all = new Uint8Array(size); let o = 0;
  for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return { text: new TextDecoder().decode(all) };
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

// --- Site Assistant question log (functions/api/assistant.js) ------------------------------------------------------
// "Questions people ask" in Talentum (Library → FAQs) learns from what visitors ask the assistant. Only the question's
// text is kept (no IP, no visitor id, no conversation), trimmed and with anything that looks personal swapped out here,
// before it's stored. Talentum's pb_hooks/lib/sitequestions.js runs the same redaction again when it pulls the rows.
export function redactQuestion(s, max = 300) {
  let t = String(s || "").replace(/[\u0000-\u001f\u007f]+/g, " ");
  t = t.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]");
  t = t.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link]");
  // Street addresses ("221B Baker Street", "12 North Oak Ave.") and UK postcodes.
  t = t.replace(/\b\d{1,5}[A-Za-z]?,?\s+(?:[A-Z][\p{L}'-]*\s+){1,4}(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Boulevard|Blvd|Court|Ct|Way|Place|Pl|Close|Crescent|Terrace|Parkway|Pkwy|Highway|Hwy|Square|Sq|Gardens|Grove|Mews)\b\.?/gu, "[address]");
  t = t.replace(/\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b/g, "[postcode]");
  t = t.replace(/(?:\+|\b)\d[\d\s().-]{5,}\d\b/g, (m) => (m.replace(/\D/g, "").length >= 7 ? "[phone]" : m));
  t = t.replace(/\d{6,}/g, "[number]");
  t = t.replace(/\b((?:[Mm]y name is|[Mm]y name's|[Ii] am called|[Tt]his is|[Ii]'m|[Ii] am)\s+)[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+)?/gu, (m, lead, off, all) => {
    const word = m.slice(lead.length).split(/\s+/)[0];
    return /^(I|The|A|An|Looking|Interested|Trying|Wondering|Not|In|From|With|At|On)$/.test(word) ? m : lead + "[name]";
  });
  // "Hi, Jane Doe here" / "Jane here, …" / "It's Jane here"
  const intro = (m, lead, its, word) => (/^(I|The|A|An|We|Our|Is|Are|Who|What|Anyone|Somebody|Someone|Everyone|[A-Z]{2,})$/.test(word) ? m : lead + its + "[name]");
  t = t.replace(/(\b(?:[Hh]i|[Hh]ello|[Hh]ey|[Hh]iya|[Gg]ood (?:morning|afternoon|evening))[,!]?\s+)((?:[Ii]t'?s\s+)?)([A-Z][\p{L}'-]+)(?:\s+[A-Z][\p{L}'-]+)?(?=\s+here\b)/gu, intro);
  t = t.replace(/(^\s*)((?:[Ii]t'?s\s+)?)([A-Z][\p{L}'-]+)(?:\s+[A-Z][\p{L}'-]+)?(?=\s+here\s*[,.!:;\u2013\u2014-])/u, intro);
  t = t.replace(/\s+/g, " ").trim();
  if (t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
  return t;
}
// Consent (Website → Settings → Tracking & consent; components/Analytics.astro has the same modes). Logging a question
// counts as analytics. The browser sends the visitor's stored choice: { analytics: true | false | null (no choice yet),
// europe: true when its time zone is in Europe }. Without a choice: off/notice → allowed; opt_in → not; eu_only → not for
// EU/EEA/UK/CH visitors (by Cloudflare's country or the time zone; an unknown country counts as EU), allowed elsewhere.
const EEA = new Set("AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH".split(" "));
export function consentAllows(mode, consent, country) {
  const c = consent && typeof consent === "object" ? consent : {};
  const choice = c.analytics === true ? true : c.analytics === false ? false : null;
  const m = ["off", "notice", "eu_only", "opt_in"].includes(mode) ? mode : "eu_only";
  if (m === "off") return true;
  if (choice !== null) return choice;
  if (m === "notice") return true;
  if (m === "opt_in") return false;
  const cc = String(country || "").toUpperCase();
  return !(c.europe === true || !cc || cc === "XX" || cc === "T1" || EEA.has(cc));
}

/** Small talk ("thanks", "ok") and one-word replies aren't questions worth learning from. */
export function worthLogging(q) {
  const t = String(q || "").trim();
  if (t.length < 8 || !/[a-z]{2,}.*\s+.*[a-z]{2,}/i.test(t)) return false;
  if (t.length < 30 && /^(thanks?|thank you|thx|ok(ay)?|yes|yeah|no|nope|hi|hello|hey|great|cool|bye|good ?bye|perfect|awesome)\b/i.test(t)) return false;
  return true;
}
/** A retrieval score at or above this means the site's content had something on the question. */
export const GOOD_MATCH = 2;

export const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|curl|wget|python|httpclient|headless|lighthouse/i;

// File types a form can accept (kept the same as Talentum's pb_hooks/lib/websites.js FILE_GROUPS). The page tells the
// visitor the form's own limits; this is the hard ceiling for anything sent here.
export const FILE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "pdf", "doc", "docx", "odt", "rtf", "xls", "xlsx", "csv", "ods",
  "ppt", "pptx", "odp", "key", "txt", "md", "zip", "ai", "eps", "psd", "svg", "indd", "fig", "sketch", "mp4", "mov", "webm", "m4v", "mp3", "wav", "m4a"]);
export const UPLOAD_MAX = 25 * 1048576;          // per file
export const UPLOAD_TOTAL = 60 * 1048576;        // per entry
