// The site endpoint for AI agents: what the REST API (functions/api/agent/*) and the MCP server (functions/mcp/)
// share. Everything read-only comes from /_agent/data.json, written at build time by scripts/postbuild.mjs from
// the bundle's `agent` part (Talentum pb_hooks/lib/siteagent.js decides what may be shared). Open times come from
// the D1 table agent_slots, which Talentum refreshes every 15 minutes; booking requests go to the D1 inbox like
// form entries and become a booking request the team member accepts (never a confirmed meeting) or a Request.
import { json, sha, visitor, limited, toInbox } from "./shared.js";

export const STALE_MS = 2 * 3600000;               // availability older than this is called out of date
export const MAX_DAYS = 14;
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};
/** JSON with open CORS. Public GETs may be cached for a few minutes. */
export function out(body, status = 200, cache = false) {
  return json(body, status, { ...CORS, ...(cache ? { "Cache-Control": "public, max-age=300" } : {}), "X-Robots-Tag": "noindex" });
}
export function preflight() { return new Response(null, { status: 204, headers: CORS }); }

// ---------------------------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------------------------
let cache = null;
export function _resetCache() { cache = null; }
/** The site's agent data, or null when the endpoint is switched off (no data.json in the build). */
export async function loadData(env, request) {
  if (cache && cache.at > Date.now() - 300000) return cache.data;
  if (!env.ASSETS) return null;
  let r;
  try { r = await env.ASSETS.fetch(new URL("/_agent/data.json", request.url)); } catch { return null; }
  if (!r || !r.ok) return null;
  let data = null;
  try { data = await r.json(); } catch { return null; }
  if (!data || data.version !== 1) return null;
  cache = { at: Date.now(), data };
  return data;
}
export const OFF = { error: "This website doesn't offer an endpoint for AI assistants.", code: "not_available" };

/** Rate limit for reads: generous, per visitor (hashed IP). Returns a Response when over. */
export async function readLimit(env, request, bucket) {
  const who = await visitor(request, env);
  if (await limited(env, (bucket || "ag") + ":" + who, 240, 600)) return out({ error: "Too many requests. Please slow down and try again in a few minutes.", code: "rate_limited" }, 429);
  return null;
}

const abs = (origin, p) => (!p ? "" : /^https?:\/\//.test(p) ? p : origin + (p.startsWith("/") ? p : "/" + p));
const STOP = new Set("a an and are as at be but by can do does for from how i if in is it me my of on or our so that the this to us we what when where which who why will with you your have has about any get".split(" "));
export const words = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
function score(text, q) {
  const t = words(text);
  let s = 0;
  for (const w of q) { const n = t.filter((x) => x === w || (w.length > 4 && x.startsWith(w.slice(0, -1)))).length; if (n) s += 1 + Math.log(1 + n); }
  return s;
}
const clip = (v, n) => String(v ?? "").trim().slice(0, n);

/** A service by id (slug) or name, case-insensitive. */
export function findService(d, key) {
  const k = clip(key, 200).toLowerCase();
  if (!k) return null;
  return d.services.find((s) => s.id === k) || d.services.find((s) => s.name.toLowerCase() === k) || null;
}
export function findLink(d, key) {
  const k = clip(key, 200).toLowerCase();
  return k ? d.booking.links.find((l) => l.id === k || l.title.toLowerCase() === k) || null : null;
}
function priceView(d, s) {
  if (s.prices?.length) return { prices: s.prices };
  return { price_note: d.prices_shared ? "No published price for this service. Ask the team for a quote." : "Prices aren't published on this website. Ask the team for a quote." };
}
function linkView(origin, l) {
  return { id: l.id, title: l.title, duration_minutes: l.duration_minutes, ...(l.with ? { with: l.with } : {}), ...(l.description ? { description: l.description } : {}), booking_page: l.url, services: l.services };
}

export function listServices(d, origin, { query, category } = {}) {
  let list = d.services;
  const cat = clip(category, 120).toLowerCase();
  if (cat) list = list.filter((s) => (s.category || "").toLowerCase() === cat);
  const q = words(clip(query, 300));
  if (q.length) list = list.map((s) => [score(s.name + " " + s.name + " " + s.category + " " + s.summary, q), s]).filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).map(([, s]) => s);
  return {
    organization: d.organization.name,
    count: list.length,
    services: list.map((s) => ({ id: s.id, name: s.name, ...(s.category ? { category: s.category } : {}), summary: s.summary, url: abs(origin, s.path), ...priceView(d, s), booking_links: s.booking_links })),
    categories: [...new Set(d.services.map((s) => s.category).filter(Boolean))],
  };
}
export function serviceDetail(d, origin, key) {
  const s = findService(d, key);
  if (!s) return null;
  return {
    id: s.id, name: s.name, ...(s.category ? { category: s.category } : {}), summary: s.summary, url: abs(origin, s.path), ...priceView(d, s),
    booking_links: d.booking.links.filter((l) => s.booking_links.includes(l.id)).map((l) => linkView(origin, l)),
    faqs: d.faqs.filter((f) => f.services.includes(s.id)).slice(0, 10).map((f) => ({ question: f.question, answer: f.answer })),
    case_studies: d.case_studies.filter((c) => s.category && c.category === s.category).slice(0, 5).map((c) => ({ title: c.title, summary: c.summary, url: abs(origin, c.path) })),
    booking_requests: d.booking.requests && s.booking_links.length > 0,
  };
}
export function searchFaqs(d, { query, service, limit } = {}) {
  let list = d.faqs;
  const svc = service ? findService(d, service) : null;
  if (service && !svc) return { error: `No service called "${clip(service, 80)}". Use list_services for the ids.` };
  if (svc) list = list.filter((f) => f.services.includes(svc.id) || !f.services.length);
  const q = words(clip(query, 300));
  const n = Math.max(1, Math.min(20, Number(limit) || 5));
  if (q.length) list = list.map((f) => [score(f.question + " " + f.question + " " + f.topic + " " + f.answer, q), f]).filter(([x]) => x > 0).sort((a, b) => b[0] - a[0]).map(([, f]) => f);
  return { count: Math.min(n, list.length), faqs: list.slice(0, n).map((f) => ({ question: f.question, answer: f.answer, ...(f.topic ? { topic: f.topic } : {}), services: f.services })) };
}
export function teamView(d) { return { organization: d.organization.name, people: d.team }; }
export function contactView(d, origin) {
  const o = d.organization;
  return {
    organization: { name: o.name, ...(o.legal_name ? { legal_name: o.legal_name } : {}), description: o.description, ...(o.service_areas?.length ? { service_areas: o.service_areas } : {}), socials: o.socials },
    phone: d.contact.phone, email: d.contact.email, address: o.address, hours: d.contact.hours,
    contact_page: abs(origin, d.contact.contact_page), booking_page: abs(origin, d.contact.booking_page),
    booking_links: d.booking.links.map((l) => linkView(origin, l)),
    booking_requests: d.booking.requests
      ? "You can send a booking request (request_booking / POST /api/agent/booking-request). The team confirms it by email; nothing is booked until they do."
      : "This website doesn't take booking requests from AI assistants. Share a booking page or the contact details instead.",
    people: d.team,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Availability: the snapshot Talentum keeps in D1 (agent_slots)
// ---------------------------------------------------------------------------------------------------------------
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Which booking link a request means: an explicit link, else the service's only/first link, else the site's only link. */
function pickLink(d, { booking_link, service }) {
  if (booking_link) { const l = findLink(d, booking_link); return l ? { link: l } : { error: `No booking link called "${clip(booking_link, 80)}".`, choices: d.booking.links.map((x) => x.id) }; }
  if (service) {
    const s = findService(d, service);
    if (!s) return { error: `No service called "${clip(service, 80)}". Use list_services for the ids.` };
    const l = d.booking.links.find((x) => s.booking_links.includes(x.id));
    if (l) return { link: l };
    if (d.booking.links.length === 1) return { link: d.booking.links[0] };
    return { error: `There's no booking link for "${s.name}".`, choices: d.booking.links.map((x) => x.id) };
  }
  if (d.booking.links.length === 1) return { link: d.booking.links[0] };
  return { error: d.booking.links.length ? "Say which booking link or service you mean." : "This website has no booking links.", choices: d.booking.links.map((x) => x.id) };
}

async function snapshotOf(env, link) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare("SELECT data, updated FROM agent_slots WHERE site = ?1 AND link = ?2").bind(env.SITE_KEY || "", link.id).first();
    if (!row) return null;
    return { ...JSON.parse(row.data || "{}"), updated: Number(row.updated) || 0 };
  } catch { return null; }
}

export async function availability(env, d, origin, args = {}) {
  const p = pickLink(d, args);
  if (p.error) return { status: 400, body: { error: p.error, ...(p.choices ? { booking_links: p.choices } : {}) } };
  const link = p.link;
  const today = new Date().toISOString().slice(0, 10);
  const from = clip(args.from, 10) || today;
  if (!DATE.test(from) || isNaN(Date.parse(from + "T00:00:00Z"))) return { status: 400, body: { error: "from must be a date like 2026-11-20." } };
  const days = Math.max(1, Math.min(MAX_DAYS, Math.round(Number(args.days) || 7)));
  const startMs = Math.max(Date.parse(from + "T00:00:00Z"), Date.now());
  const endMs = Date.parse(from + "T00:00:00Z") + days * 86400000;
  const base = { booking_link: linkView(origin, link), time_zone: "UTC", from, days };
  const snap = await snapshotOf(env, link);
  if (!snap) return { status: 200, body: { ...base, status: "unknown", slots: [], note: `Open times aren't available here right now. The booking page shows live times: ${link.url}` } };
  const age = Date.now() - snap.updated;
  const slots = (snap.available === false ? [] : snap.slots || []).filter((s) => { const t = Date.parse(s); return t >= startMs && t < endMs; }).slice(0, 60)
    .map((s) => ({ start: s, end: new Date(Date.parse(s) + link.duration_minutes * 60000).toISOString() }));
  const stale = age > STALE_MS;
  const note = snap.available === false ? `${link.with || "This person"} isn't taking new bookings right now.`
    : stale ? `These times were last checked ${Math.round(age / 3600000)} hours ago and may be out of date. Check the booking page for live times: ${link.url}`
    : `Times are in UTC and were checked ${Math.max(1, Math.round(age / 60000))} minutes ago. A time can still be taken before the team confirms.`;
  return { status: 200, body: { ...base, status: stale ? "stale" : "current", as_of: new Date(snap.updated).toISOString(), age_minutes: Math.round(age / 60000), stale, slots, note } };
}

// ---------------------------------------------------------------------------------------------------------------
// Booking requests
// ---------------------------------------------------------------------------------------------------------------
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;
const HONEYPOT = ["website", "url", "hp", "_hp", "fax", "homepage"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Validate and queue a booking request. → { status, body }. `via` = "api" | "mcp"; `agent` = the client's name if it gave one. */
export async function bookingRequest(env, request, d, origin, b, via, agent) {
  if (!d.booking.requests) return { status: 403, body: { error: "This website doesn't take booking requests from AI assistants. Use a booking page or the contact details instead.", code: "not_accepted", booking_page: abs(origin, d.contact.booking_page) || d.booking.links[0]?.url || "", contact_page: abs(origin, d.contact.contact_page), email: d.contact.email, phone: d.contact.phone } };
  b = b && typeof b === "object" && !Array.isArray(b) ? b : {};
  // Bots that fill every field they find: tell them it worked, keep nothing.
  if (HONEYPOT.some((k) => b[k] !== undefined && String(b[k]).trim())) return { status: 202, body: accepted("x" + crypto.randomUUID().slice(0, 7), env) };
  const errors = [];
  const name = clip(b.name, 200), email = clip(b.email, 200).toLowerCase();
  if (!name) errors.push("name is required (the person's full name).");
  if (!EMAIL.test(email)) errors.push("email must be the person's email address.");
  if (b.consent !== true) errors.push("consent must be true: only send a request the person asked for, with their agreement to share their name and email with us.");
  const p = pickLink(d, b);
  if (p.error) errors.push(p.error + (p.choices?.length ? ` Booking links: ${p.choices.join(", ")}.` : ""));
  const start = clip(b.preferred_start, 40);
  const alts = (Array.isArray(b.alternative_starts) ? b.alternative_starts : []).slice(0, 3).map((x) => clip(x, 40));
  const now = Date.now();
  for (const t of [start, ...alts]) {
    if (!ISO.test(t) || isNaN(Date.parse(t))) { errors.push(`"${t || "preferred_start"}" must be a date and time with a time zone, like 2026-11-20T15:00:00Z.`); continue; }
    if (Date.parse(t) < now + 15 * 60000) errors.push(`${t} is in the past or too soon.`);
    else if (Date.parse(t) > now + 60 * 86400000) errors.push(`${t} is more than 60 days away.`);
  }
  const message = clip(b.message, 2000), phone = clip(b.phone, 40), company = clip(b.company, 200), tz = clip(b.time_zone, 60);
  if (tz && !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/.test(tz)) errors.push("time_zone must be an IANA name like America/Chicago.");
  if (errors.length) return { status: 400, body: { error: "The request wasn't sent: " + errors.join(" "), errors } };
  if (!env.DB) return { status: 503, body: { error: "Booking requests aren't switched on for this website yet. Use the booking page instead.", booking_page: p.link.url } };

  // If the snapshot is fresh and none of the times is open, say so now (with what is open) rather than send it.
  const snap = await snapshotOf(env, p.link);
  if (snap && snap.available !== false && Date.now() - snap.updated <= STALE_MS) {
    const open = new Set(snap.slots || []);
    const want = [start, ...alts].map((t) => new Date(Date.parse(t)).toISOString());
    if (!want.some((t) => open.has(t))) {
      const near = (snap.slots || []).filter((s) => Date.parse(s) > now).sort((a, x) => Math.abs(Date.parse(a) - Date.parse(start)) - Math.abs(Date.parse(x) - Date.parse(start))).slice(0, 6).sort();
      return { status: 409, body: { error: "None of those times is open. Pick one of the open times (get_availability) and try again.", code: "time_not_open", open_times: near, booking_page: p.link.url } };
    }
  }

  // Hard limits: agents can't do Turnstile, so per visitor, per email and per site.
  const who = await visitor(request, env);
  const site = env.SITE_KEY || "";
  if (await limited(env, "ab:h:" + who, 3, 3600) || await limited(env, "ab:d:" + who, 8, 86400)) return { status: 429, body: { error: "Too many booking requests from here. Please try again later, or use the booking page.", code: "rate_limited", booking_page: p.link.url } };
  if (await limited(env, "ab:e:" + site + ":" + (await sha(email)), 2, 86400)) return { status: 429, body: { error: "We already have booking requests for this email today. The team will reply by email.", code: "rate_limited" } };
  if (await limited(env, "ab:site:" + site, 40, 86400)) return { status: 429, body: { error: "This website isn't taking more booking requests from AI assistants today. Please use the booking page.", code: "rate_limited", booking_page: p.link.url } };

  const id = await toInbox(env, "agent_booking", {
    name, email, phone, company, message, link: p.link.id, service: b.service ? clip(b.service, 120) : "", start, alternatives: alts, time_zone: tz,
    agent: clip(agent || b.assistant, 80), page: via === "mcp" ? "/mcp" : "/api/agent/booking-request",
    country: request.cf?.country || "", ua: (request.headers.get("User-Agent") || "").slice(0, 300),
  });
  return { status: 202, body: accepted(id, env, p.link) };
}
function accepted(id, env, link) {
  return {
    status: "received", reference: String(id).slice(0, 8),
    message: "Thanks — the request is with the team. Nothing is booked yet: " + (link?.with ? link.with : "the team") + " will confirm by email (usually within a working day), and the email has a link to change or cancel it.",
    ...(env.SITE_ENV && env.SITE_ENV !== "live" ? { test: "This is the test copy of the website, so the request is kept for testing only." } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Tools (MCP) — the same functions, described once. Input schemas are JSON Schema (2020-12 compatible).
// ---------------------------------------------------------------------------------------------------------------
const S = (description, extra = {}) => ({ type: "string", description, ...extra });
export const TOOLS = [
  { name: "list_services", title: "List services", description: "List the company's services with a short summary, the page address, prices when the company publishes them, and booking link ids. Optionally search or filter by category.",
    inputSchema: { type: "object", properties: { query: S("Words to search for, e.g. 'logo design'.", { maxLength: 300 }), category: S("Only services in this category (see 'categories' in the result).", { maxLength: 120 }) }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "get_service", title: "Get a service", description: "Everything about one service: summary, page, prices (or how to get a quote), related questions and answers, case studies and booking links.",
    inputSchema: { type: "object", properties: { service: S("The service id from list_services (or its exact name).", { minLength: 1, maxLength: 200 }) }, required: ["service"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "search_faqs", title: "Search questions and answers", description: "Search the company's published questions and answers.",
    inputSchema: { type: "object", properties: { query: S("The question or keywords.", { maxLength: 300 }), service: S("Only answers about this service (id).", { maxLength: 200 }), limit: { type: "integer", minimum: 1, maximum: 20, description: "How many answers (default 5)." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "get_availability", title: "Get open times", description: `Open meeting times (UTC) for a booking link or a service over the next ${MAX_DAYS} days, from a snapshot the company refreshes every 15 minutes. Says when the snapshot is out of date; the booking page always has live times.`,
    inputSchema: { type: "object", properties: { service: S("A service id; uses its booking link.", { maxLength: 200 }), booking_link: S("A booking link id (from contact_options or get_service).", { maxLength: 200 }), from: S("First day, YYYY-MM-DD (default today).", { pattern: "^\\d{4}-\\d{2}-\\d{2}$" }), days: { type: "integer", minimum: 1, maximum: MAX_DAYS, description: "How many days (default 7)." } }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false } },
  { name: "request_booking", title: "Request a meeting", description: "Send a meeting request for the person you're helping. Only when they asked for it and agreed to share their name and email. Nothing is booked automatically: the team confirms by email, and the email lets the person change or cancel it. Use a time from get_availability.",
    inputSchema: { type: "object", properties: {
      name: S("The person's full name.", { minLength: 1, maxLength: 200 }), email: S("The person's email address; the confirmation goes there.", { format: "email", maxLength: 200 }),
      booking_link: S("Booking link id.", { maxLength: 200 }), service: S("Or a service id (its booking link is used).", { maxLength: 200 }),
      preferred_start: S("Preferred start, ISO 8601 with a time zone, e.g. 2026-11-20T15:00:00Z.", { minLength: 16, maxLength: 40 }),
      alternative_starts: { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 3, description: "Up to three other start times that also work." },
      time_zone: S("The person's time zone (IANA), e.g. America/Chicago.", { maxLength: 60 }),
      message: S("What they'd like to talk about.", { maxLength: 2000 }), phone: S("Phone (optional).", { maxLength: 40 }), company: S("Company (optional).", { maxLength: 200 }),
      consent: { type: "boolean", description: "true = the person asked for this meeting and agreed to share these details with the company." },
    }, required: ["name", "email", "preferred_start", "consent"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  { name: "contact_options", title: "Contact options", description: "How to reach the company: phone, email, address, hours, contact and booking pages, booking links (with meeting lengths), whether booking requests are accepted, and the public team.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false } },
];
export function toolsFor(d) { return TOOLS.filter((t) => t.name !== "request_booking" || d.booking.requests); }

/** Minimal JSON Schema check for the tools' own schemas → list of problems. */
export function check(schema, v) {
  const errs = [];
  if (!v || typeof v !== "object" || Array.isArray(v)) return ["arguments must be an object."];
  for (const k of schema.required || []) if (v[k] === undefined || v[k] === null || v[k] === "") errs.push(`${k} is required.`);
  for (const [k, x] of Object.entries(v)) {
    const p = schema.properties[k];
    if (!p) { if (!HONEYPOT.includes(k)) errs.push(`Unknown argument "${k}".`); continue; }
    if (x === undefined || x === null) continue;
    if (p.type === "string") { if (typeof x !== "string") errs.push(`${k} must be text.`); else { if (p.maxLength && x.length > p.maxLength) errs.push(`${k} is too long (${p.maxLength} at most).`); if (p.pattern && !new RegExp(p.pattern).test(x)) errs.push(`${k} isn't in the right format.`); } }
    else if (p.type === "integer") { if (!Number.isInteger(x)) errs.push(`${k} must be a whole number.`); else if (x < p.minimum || x > p.maximum) errs.push(`${k} must be between ${p.minimum} and ${p.maximum}.`); }
    else if (p.type === "boolean") { if (typeof x !== "boolean") errs.push(`${k} must be true or false.`); }
    else if (p.type === "array") { if (!Array.isArray(x) || x.length > p.maxItems || x.some((i) => typeof i !== "string")) errs.push(`${k} must be a list of up to ${p.maxItems} texts.`); }
  }
  return errs;
}

/** Run a tool → { ok, data } (data is what the REST API would return). */
export async function runTool(name, args, ctx) {
  const { env, request, d, origin, agent } = ctx;
  if (name === "list_services") return { ok: true, data: listServices(d, origin, args) };
  if (name === "get_service") { const x = serviceDetail(d, origin, args.service); return x ? { ok: true, data: x } : { ok: false, data: { error: `No service called "${clip(args.service, 80)}".`, services: d.services.map((s) => s.id) } }; }
  if (name === "search_faqs") { const x = searchFaqs(d, args); return { ok: !x.error, data: x }; }
  if (name === "contact_options") return { ok: true, data: contactView(d, origin) };
  if (name === "get_availability") { const r = await availability(env, d, origin, args); return { ok: r.status < 300, data: r.body }; }
  if (name === "request_booking") { const r = await bookingRequest(env, request, d, origin, args, "mcp", agent); return { ok: r.status < 300, data: r.body }; }
  return { ok: false, data: { error: "Unknown tool." } };
}

export function instructions(d) {
  const o = d.organization;
  return `Facts about ${o.name} from its website: services${d.prices_shared ? " and published prices" : ""}, questions and answers, contact options and open meeting times. `
    + "Answer only from what the tools return; don't guess prices, guarantees or timelines. "
    + (d.booking.requests ? "request_booking sends a meeting request only when the person asked for it; the team confirms by email, so never tell them the meeting is booked." : "This company doesn't take booking requests through this server; share a booking page or contact details instead.");
}
