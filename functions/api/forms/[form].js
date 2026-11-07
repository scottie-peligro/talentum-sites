// POST /api/forms/<key> — every Form block on the site posts here (JSON from the page's script, or a plain form post
// when scripts are off). The entry waits in D1 until Talentum picks it up (within a minute), then it becomes a
// Request with the visitor's source attached. Spam checks: honeypot, time on page, rate limit, Turnstile (optional).
import { json, sameOrigin, visitor, limited, toInbox, turnstileOk } from "../../../edge/shared.js";

const MAX_FIELDS = 40;

export async function onRequestPost({ request, env, params }) {
  const ct = request.headers.get("content-type") || "";
  const wantsJson = ct.includes("application/json");
  let data = {};
  try {
    if (Number(request.headers.get("content-length") || 0) > 64000) return json({ error: "That's too much to send in one go." }, 413);
    if (wantsJson) data = (await request.json()) || {};
    else { const fd = await request.formData(); for (const [k, v] of fd) if (typeof v === "string") data[k] = v; }
  } catch { return json({ error: "Couldn't read the form." }, 400); }
  const page = String(data._page || "/").slice(0, 300);
  const done = (ok, msg, status = 200) => {
    if (wantsJson) return json(ok ? { ok: true } : { error: msg }, ok ? 200 : status);
    const back = new URL(page.startsWith("/") ? page : "/", request.url);
    back.searchParams.set(ok ? "sent" : "error", "1");
    return Response.redirect(back.toString() + "#contact", 303);
  };
  if (!env.DB) return done(false, "Forms aren't switched on for this site yet.", 503);
  if (!sameOrigin(request)) return done(false, "Not allowed.", 403);

  // Bots fill the hidden field or send within a couple of seconds of the page loading: tell them it worked, keep nothing.
  if (data._hp) return done(true);
  const t = Number(data._t || 0);
  if (t && Date.now() - t < 2500) return done(true);
  if (!(await turnstileOk(env, data["cf-turnstile-response"], request))) return done(false, "Please tick the box to show you're not a robot, then send again.", 400);
  const who = await visitor(request, env);
  if (await limited(env, "f:" + who, 6, 600)) return done(false, "That's a few messages in a short time — please try again in a little while.", 429);

  const form = String(params.form || "contact").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 60) || "contact";
  const fields = {};
  let n = 0;
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith("_") || k === "cf-turnstile-response" || n >= MAX_FIELDS) continue;
    fields[k.slice(0, 60)] = String(v ?? "").slice(0, 5000); n++;
  }
  if (!Object.values(fields).some((v) => v.trim())) return done(false, "The form was empty.", 400);
  let attribution = {};
  try { attribution = typeof data._attr === "string" ? JSON.parse(data._attr) : (data._attr || {}); } catch {}
  const transcript = Array.isArray(data._transcript) ? data._transcript.slice(-40) : undefined;
  const kind = data._kind === "assistant" ? "assistant" : "form";
  await toInbox(env, kind, {
    form, form_name: String(data._form_name || "").slice(0, 120), fields, page, attribution, transcript,
    country: request.cf?.country || "", ua: (request.headers.get("User-Agent") || "").slice(0, 300),
  });
  return done(true);
}

export function onRequestGet() { return json({ error: "Send this form from the website." }, 405); }
