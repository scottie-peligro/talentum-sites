// POST /api/forms/<key> — every Form block on the site posts here (JSON from the page's script, or a plain form post
// when scripts are off). The entry waits in D1 until Talentum picks it up (within a minute), then it becomes a
// Request with the visitor's source attached. Spam checks: honeypot, time on page, rate limit, Turnstile (optional).
import { json, sameOrigin, visitor, limited, toInbox, turnstileOk, FILE_EXT, UPLOAD_MAX, UPLOAD_TOTAL } from "../../../edge/shared.js";

const MAX_FIELDS = 40;

export async function onRequestPost({ request, env, params }) {
  const ct = request.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  // The page's script asks for a JSON answer (also when it sends files); a plain form post gets a redirect back.
  const wantsJson = isJson || (request.headers.get("accept") || "").includes("application/json");
  let data = {};
  const uploads = [];   // { field, file } — forms with a file field send multipart
  try {
    const multipart = ct.includes("multipart/form-data");
    if (Number(request.headers.get("content-length") || 0) > (multipart ? UPLOAD_TOTAL + 200000 : 64000)) return json({ error: "That's too much to send in one go." }, 413);
    if (isJson) data = (await request.json()) || {};
    else {
      const fd = await request.formData();
      for (const [k, v] of fd) {
        if (typeof v === "string") data[k] = data[k] !== undefined && v !== "" ? (data[k] ? data[k] + ", " + v : v) : (data[k] ?? v);
        else if (v && v.size) uploads.push({ field: k, file: v });
      }
    }
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
  // Uploads wait in R2 until Talentum picks the entry up (and checks them against the form's own rules).
  const files = [];
  if (uploads.length) {
    if (!env.UPLOADS) return done(false, "This form can't take files yet. Please email them to us instead.", 503);
    if (uploads.length > 10) return done(false, "Please send 10 files or fewer.", 400);
    let total = 0;
    for (const u of uploads) {
      const name = String(u.file.name || "file").replace(/[^\w.\- ()]+/g, "_").slice(-120);
      const ext = (name.split(".").pop() || "").toLowerCase();
      if (!FILE_EXT.has(ext)) return done(false, `${name}: that type of file can't be sent here.`, 400);
      if (u.file.size > UPLOAD_MAX) return done(false, `${name} is too big (25 MB at most).`, 413);
      total += u.file.size;
      if (total > UPLOAD_TOTAL) return done(false, "Those files are too big together (60 MB at most).", 413);
      const key = `${env.SITE_KEY || "site"}/${crypto.randomUUID()}/${name}`;
      await env.UPLOADS.put(key, u.file.stream(), { httpMetadata: { contentType: u.file.type || "application/octet-stream" } });
      files.push({ key, field: u.field.slice(0, 60), name, size: u.file.size, type: (u.file.type || "").slice(0, 100) });
    }
  }
  await toInbox(env, kind, {
    form, form_name: String(data._form_name || "").slice(0, 120), fields, page, attribution, transcript, files,
    country: request.cf?.country || "", ua: (request.headers.get("User-Agent") || "").slice(0, 300),
  });
  return done(true);
}

export function onRequestGet() { return json({ error: "Send this form from the website." }, 405); }
