// POST /api/nf { path, ref } — the 404 page reports the address that wasn't found, so Talentum can list broken
// links and old URLs that need a redirect (Website → SEO). Live site only; bots and vulnerability scanners ignored.
import { json, sameOrigin, BOT_UA } from "../../edge/shared.js";

const SCANNER = /(\.php|\.asp|\.env|\.git|wp-admin|wp-login|wp-content|wp-includes|xmlrpc|cgi-bin|\.sql|\.bak|phpmyadmin|\/vendor\/|\.well-known\/(?!security))/i;

export async function onRequestPost({ request, env }) {
  if (!env.DB || env.SITE_ENV !== "live" || !sameOrigin(request)) return json({ ok: true });
  if (BOT_UA.test(request.headers.get("User-Agent") || "")) return json({ ok: true });
  let b = {};
  try { b = await request.json(); } catch {}
  let path = String(b.path || "").split("?")[0].split("#")[0].slice(0, 400);
  if (!path.startsWith("/") || SCANNER.test(path)) return json({ ok: true });
  let ref = "";
  try { ref = b.ref ? new URL(b.ref).origin + new URL(b.ref).pathname : ""; } catch {}
  await env.DB.prepare("INSERT INTO notfound (site, path, hits, last, ref) VALUES (?1, ?2, 1, ?3, ?4) ON CONFLICT(site, path) DO UPDATE SET hits = hits + 1, last = ?3, ref = CASE WHEN ?4 != '' THEN ?4 ELSE ref END")
    .bind(env.SITE_KEY || "", path, Date.now(), ref.slice(0, 400)).run();
  return json({ ok: true });
}
