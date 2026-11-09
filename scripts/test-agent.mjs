// Tests for the site endpoint for AI agents (functions/api/agent/*, functions/mcp/, edge/agent.js, edge/mcp.js):
// the handlers are imported and called with a fake env — ASSETS serves a sample /_agent/data.json, DB is a tiny
// in-memory stand-in for D1 (ratelimit, inbox, agent_slots). No network, no wrangler.
//   node --test scripts/test-agent.mjs        (npm run test:agent)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { _resetCache } from "../edge/agent.js";
import { openapi } from "../edge/openapi.js";
import { sample, fakeDB } from "./agent-fixture.mjs";
import * as services from "../functions/api/agent/services.js";
import * as service from "../functions/api/agent/services/[id].js";
import * as faqs from "../functions/api/agent/faqs.js";
import * as team from "../functions/api/agent/team.js";
import * as contact from "../functions/api/agent/contact.js";
import * as index from "../functions/api/agent/index.js";
import * as avail from "../functions/api/agent/availability.js";
import * as booking from "../functions/api/agent/booking-request.js";
import * as mcp from "../functions/mcp/index.js";
import * as card from "../functions/mcp/server-card.js";

const ORIGIN = "https://www.example.com";
const H = 3600000;
const inDays = (n, h = 15) => { const d = new Date(Date.now() + n * 86400000); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };

let data, env;
function makeEnv(d, extra = {}) {
  return {
    SITE_KEY: "acme", SITE_ENV: "live", DB: fakeDB(),
    ASSETS: { fetch: async (u) => (new URL(u).pathname === "/_agent/data.json" && d ? new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } }) : new Response("nope", { status: 404 })) },
    ...extra,
  };
}
beforeEach(() => { _resetCache(); data = sample(); env = makeEnv(data); });
const req = (path, init = {}) => new Request(ORIGIN + path, { ...init, headers: { "CF-Connecting-IP": init.ip || "203.0.113.9", ...(init.headers || {}) } });
const get = async (mod, path, params = {}) => { const r = await mod.onRequestGet({ request: req(path), env, params }); return { status: r.status, headers: r.headers, json: await r.json() }; };
const post = async (mod, path, body, ip) => { const r = await mod.onRequestPost({ request: req(path, { method: "POST", ip, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env }); return { status: r.status, headers: r.headers, json: r.status === 202 && r.headers.get("content-length") === "0" ? null : await r.json() }; };
function slots(list, updated = Date.now() - 5 * 60000, available = true) {
  env.DB.slots.set("acme|darren-15", { data: JSON.stringify({ id: "darren-15", title: "15-minute intro", duration_minutes: 15, available, slots: list }), updated });
}

test("read endpoints: services, one service, FAQs, team, contact, index — CORS open, absolute URLs", async () => {
  let r = await get(services, "/api/agent/services");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(r.json.services.map((s) => s.id), ["seo", "logo-design"]);
  assert.equal(r.json.services[0].url, ORIGIN + "/service/seo/");
  assert.equal(r.json.services[0].prices[0].amount, 900);
  assert.match(r.json.services[1].price_note, /No published price/);
  r = await get(services, "/api/agent/services?q=logo");
  assert.deepEqual(r.json.services.map((s) => s.id), ["logo-design"], "search");
  r = await get(services, "/api/agent/services?category=Search");
  assert.deepEqual(r.json.services.map((s) => s.id), ["seo"], "category");

  r = await get(service, "/api/agent/services/seo", { id: "seo" });
  assert.equal(r.status, 200);
  assert.equal(r.json.booking_links[0].id, "darren-15");
  assert.equal(r.json.faqs.length, 1);
  assert.equal(r.json.case_studies[0].url, ORIGIN + "/case-studies/birch/");
  r = await get(service, "/api/agent/services/nope", { id: "nope" });
  assert.equal(r.status, 404);
  assert.deepEqual(r.json.services, ["seo", "logo-design"]);

  r = await get(faqs, "/api/agent/faqs?q=audit");
  assert.equal(r.json.faqs[0].question, "How long does an SEO audit take?");
  r = await get(faqs, "/api/agent/faqs?service=nope");
  assert.equal(r.status, 404);
  r = await get(team, "/api/agent/team");
  assert.deepEqual(r.json.people, [{ name: "Darren McDougal", job_title: "CMO", linkedin: "" }]);
  r = await get(contact, "/api/agent/contact");
  assert.equal(r.json.contact_page, ORIGIN + "/contact/");
  assert.equal(r.json.booking_links[0].booking_page, "https://app.example.com/book/darren-15");
  r = await get(index, "/api/agent");
  assert.equal(r.json.mcp, ORIGIN + "/mcp");
  assert.ok(r.json.endpoints.booking_request);

  // Prices withheld → only a note.
  _resetCache(); env = makeEnv(sample({ prices_shared: false, services: [{ ...data.services[1] }] }));
  r = await get(services, "/api/agent/services");
  assert.equal(r.json.services[0].prices, undefined);
  assert.match(r.json.services[0].price_note, /aren't published/);
});

test("switched off: no data.json → 404 everywhere", async () => {
  env = makeEnv(null);
  for (const [m, p] of [[services, "/api/agent/services"], [team, "/api/agent/team"], [contact, "/api/agent/contact"]]) assert.equal((await get(m, p)).status, 404);
  assert.equal((await post(booking, "/api/agent/booking-request", {})).status, 404);
  const r = await mcp.onRequestPost({ request: req("/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), env });
  assert.equal(r.status, 404);
});

test("read rate limit", async () => {
  let last;
  for (let i = 0; i < 241; i++) last = await get(team, "/api/agent/team");
  assert.equal(last.status, 429);
  env.DB.rate.clear();
});

test("availability: current, stale, unknown, choosing the link", async () => {
  let r = await get(avail, "/api/agent/availability?service=seo");
  assert.equal(r.status, 200);
  assert.equal(r.json.status, "unknown", "no snapshot yet");
  assert.match(r.json.note, /booking page/);
  slots([inDays(1), inDays(2), inDays(20)]);
  r = await get(avail, "/api/agent/availability?service=seo&days=14");
  assert.equal(r.json.status, "current");
  assert.equal(r.json.stale, false);
  assert.equal(r.json.slots.length, 2, "only inside the window");
  assert.equal(Date.parse(r.json.slots[0].end) - Date.parse(r.json.slots[0].start), 15 * 60000);
  r = await get(avail, "/api/agent/availability?booking_link=darren-15&from=" + inDays(2).slice(0, 10) + "&days=1");
  assert.equal(r.json.slots.length, 1);
  slots([inDays(1)], Date.now() - 3 * H);
  r = await get(avail, "/api/agent/availability");
  assert.equal(r.json.status, "stale");
  assert.match(r.json.note, /out of date/);
  assert.match(r.json.note, /book\/darren-15/);
  slots([inDays(1)], Date.now(), false);
  r = await get(avail, "/api/agent/availability");
  assert.equal(r.json.slots.length, 0);
  assert.match(r.json.note, /isn't taking new bookings/);
  r = await get(avail, "/api/agent/availability?service=nope");
  assert.equal(r.status, 400);
  r = await get(avail, "/api/agent/availability?from=tomorrow");
  assert.equal(r.status, 400);
});

test("booking requests: validation, honeypot, open-time check, inbox, limits, off", async () => {
  const good = { name: "Pat Lee", email: "pat@example.org", service: "seo", preferred_start: inDays(1), message: "SEO for our jobs pages", consent: true, assistant: "TestBot" };
  let r = await post(booking, "/api/agent/booking-request", { ...good, consent: false, email: "nope" });
  assert.equal(r.status, 400);
  assert.ok(r.json.errors.some((e) => /consent/.test(e)) && r.json.errors.some((e) => /email/.test(e)));
  r = await post(booking, "/api/agent/booking-request", { ...good, preferred_start: "next tuesday" });
  assert.equal(r.status, 400);
  r = await post(booking, "/api/agent/booking-request", { ...good, preferred_start: new Date(Date.now() - H).toISOString() });
  assert.equal(r.status, 400, "past");
  r = await post(booking, "/api/agent/booking-request", { ...good, website: "http://spam.example" });
  assert.equal(r.status, 202, "honeypot looks accepted");
  assert.equal(env.DB.inbox.length, 0, "…but nothing is kept");

  // Fresh snapshot without that time → 409 with open times; with it → queued.
  slots([inDays(2), inDays(3)]);
  r = await post(booking, "/api/agent/booking-request", good);
  assert.equal(r.status, 409);
  assert.deepEqual(r.json.open_times, [inDays(2), inDays(3)]);
  r = await post(booking, "/api/agent/booking-request", { ...good, preferred_start: inDays(2) });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal(r.json.status, "received");
  assert.match(r.json.message, /Nothing is booked or held/);
  assert.match(r.json.message, /confirm a time with the person by email/);
  assert.equal(r.json.booked, false);
  assert.equal(r.headers.get("access-control-allow-origin"), null, "no open CORS on the POST endpoint");
  const pre = booking.onRequestOptions({ request: req("/api/agent/booking-request", { method: "OPTIONS" }), env });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), null, "cross-site browsers stop at the preflight");
  assert.equal(env.DB.inbox.length, 1);
  const row = env.DB.inbox[0];
  assert.equal(row.kind, "agent_booking");
  assert.equal(row.site, "acme");
  assert.equal(row.payload.link, "darren-15");
  assert.equal(row.payload.agent, "TestBot");
  assert.equal(row.payload.page, "/api/agent/booking-request");

  // Stale snapshot: accepted without the check (the team confirms).
  slots([], Date.now() - 5 * H);
  r = await post(booking, "/api/agent/booking-request", { ...good, email: "sam@example.org" });
  assert.equal(r.status, 202);
  // Per-email cap (2 a day).
  r = await post(booking, "/api/agent/booking-request", { ...good, email: "sam@example.org" }, "198.51.100.1");
  assert.equal(r.status, 202);
  r = await post(booking, "/api/agent/booking-request", { ...good, email: "sam@example.org" }, "198.51.100.2");
  assert.equal(r.status, 429);
  // Per visitor (3 an hour): this IP already sent 2.
  r = await post(booking, "/api/agent/booking-request", { ...good, email: "a@example.org" });
  assert.equal(r.status, 202);
  r = await post(booking, "/api/agent/booking-request", { ...good, email: "b@example.org" });
  assert.equal(r.status, 429);

  // Staging: still queued, marked as a test.
  _resetCache(); env = makeEnv(sample(), { SITE_ENV: "staging" });
  r = await post(booking, "/api/agent/booking-request", good);
  assert.equal(r.status, 202);
  assert.match(r.json.test, /test copy/);
  assert.equal(env.DB.inbox[0].env, "staging");

  // Off for this site.
  _resetCache(); env = makeEnv(sample({ booking: { requests: false, links: data.booking.links } }));
  r = await post(booking, "/api/agent/booking-request", good);
  assert.equal(r.status, 403);
  assert.equal(env.DB.inbox.length, 0);
  // Not JSON.
  const res = await booking.onRequestPost({ request: req("/api/agent/booking-request", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "hi" }), env });
  assert.equal(res.status, 415);
});

// ---- MCP --------------------------------------------------------------------------------------------------------
async function rpc(body, headers = {}, ip) {
  const r = await mcp.onRequestPost({ request: req("/mcp", { method: "POST", ip, headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }), env });
  const text = await r.text();
  return { status: r.status, headers: r.headers, json: text ? JSON.parse(text) : null };
}
const MODERN = "2026-07-28";
const meta = { "io.modelcontextprotocol/protocolVersion": MODERN, "io.modelcontextprotocol/clientInfo": { name: "TestClient", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
const modern = (id, method, params = {}, extra = {}) => rpc({ jsonrpc: "2.0", id, method, params: { ...params, _meta: meta } }, { "MCP-Protocol-Version": MODERN, "Mcp-Method": method, ...(method === "tools/call" ? { "Mcp-Name": params.name } : {}), ...extra });

test("MCP legacy era: initialize, initialized, ping, tools/list, tools/call", async () => {
  let r = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } } });
  assert.equal(r.status, 200);
  assert.equal(r.json.result.protocolVersion, "2025-06-18");
  assert.ok(r.json.result.capabilities.tools);
  assert.equal(r.json.result.serverInfo.name, "talentum-site-agent");
  assert.match(r.json.result.instructions, /Acme Marketing/);
  assert.equal(r.headers.get("mcp-session-id"), null, "stateless: no session");
  r = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(r.json.result.protocolVersion, "2025-11-25", "unknown → latest legacy");
  r = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, { "MCP-Protocol-Version": "2025-06-18" });
  assert.equal(r.status, 202);
  assert.equal(r.json, null);
  r = await rpc({ jsonrpc: "2.0", id: "p", method: "ping" }, { "MCP-Protocol-Version": "2025-06-18" });
  assert.deepEqual(r.json.result, {});
  r = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "MCP-Protocol-Version": "2025-06-18" });
  assert.deepEqual(r.json.result.tools.map((t) => t.name), ["list_services", "get_service", "search_faqs", "get_availability", "request_booking", "contact_options"]);
  for (const t of r.json.result.tools) { assert.equal(t.inputSchema.type, "object"); assert.ok(t.description); }
  r = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_service", arguments: { service: "seo" } } }, { "MCP-Protocol-Version": "2025-06-18" });
  assert.equal(r.json.result.isError, false);
  assert.equal(r.json.result.structuredContent.name, "Recruitment SEO");
  assert.equal(JSON.parse(r.json.result.content[0].text).id, "seo");
  r = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_service", arguments: { service: 5 } } });
  assert.equal(r.json.result.isError, true, "bad argument type → tool error");
  assert.match(r.json.result.content[0].text, /must be text/);
  r = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "drop_tables", arguments: {} } });
  assert.equal(r.json.error.code, -32602);
  r = await rpc({ jsonrpc: "2.0", id: 6, method: "resources/list" });
  assert.equal(r.json.error.code, -32601);
  r = await rpc("{not json");
  assert.equal(r.status, 400); assert.equal(r.json.error.code, -32700);
  r = await rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }]);
  assert.equal(r.json.error.code, -32600);
  r = await rpc({ jsonrpc: "2.0", id: 7, method: "ping" }, { "MCP-Protocol-Version": "2024-01-01" });
  assert.equal(r.json.error.code, -32022);
  r = await rpc({ jsonrpc: "2.0", id: 8, method: "ping" }, { Origin: "javascript:alert(1)" });
  assert.equal(r.status, 403);
  const g = await mcp.onRequestGet({ request: req("/mcp"), env });
  assert.equal(g.status, 405);
});

test("MCP modern era (2026-07-28): discover, headers checked, resultType, cache hints, tools", async () => {
  let r = await modern(1, "server/discover");
  assert.equal(r.status, 200);
  assert.ok(r.json.result.supportedVersions.includes(MODERN) && r.json.result.supportedVersions.includes("2025-06-18"));
  assert.equal(r.json.result.resultType, "complete");
  assert.equal(r.json.result._meta["io.modelcontextprotocol/serverInfo"].name, "talentum-site-agent");
  assert.equal(r.headers.get("mcp-protocol-version"), MODERN);
  r = await modern(2, "tools/list");
  assert.equal(r.json.result.cacheScope, "public");
  assert.ok(r.json.result.ttlMs > 0);
  r = await modern(3, "tools/call", { name: "search_faqs", arguments: { query: "outside the US" } });
  assert.equal(r.json.result.resultType, "complete");
  assert.equal(r.json.result.structuredContent.faqs[0].question, "Do you work outside the US?");
  r = await modern(4, "tools/call", { name: "contact_options", arguments: {} });
  assert.equal(r.json.result.structuredContent.email, "hello@example.com");
  r = await modern(5, "tools/call", { name: "list_services", arguments: {} }, { "Mcp-Name": "get_service" });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, -32020, "Mcp-Name mismatch");
  r = await modern(5, "tools/call", { name: "list services", arguments: {} }, { "Mcp-Name": "=?base64?" + Buffer.from("list services").toString("base64") + "?=" });
  assert.equal(r.json.error.code, -32602, "base64 Mcp-Name decoded, then unknown tool");
  r = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/list", params: { _meta: meta } }, { "MCP-Protocol-Version": MODERN });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, -32020, "Mcp-Method missing");
  r = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/list", params: { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "2030-01-01" } } }, { "MCP-Protocol-Version": "2030-01-01", "Mcp-Method": "tools/list" });
  assert.equal(r.status, 400); assert.equal(r.json.error.code, -32022);
  assert.ok(r.json.error.data.supported.includes(MODERN));
  r = await modern(8, "prompts/list");
  assert.equal(r.status, 404); assert.equal(r.json.error.code, -32601);

  // get_availability + request_booking over MCP; the client's name travels as the agent.
  slots([inDays(1, 16)]);
  r = await modern(9, "tools/call", { name: "get_availability", arguments: { service: "seo", days: 3 } });
  assert.equal(r.json.result.structuredContent.slots[0].start, inDays(1, 16));
  r = await modern(10, "tools/call", { name: "request_booking", arguments: { name: "Kim", email: "kim@example.org", booking_link: "darren-15", preferred_start: inDays(1, 16), consent: true } });
  assert.equal(r.json.result.isError, false, JSON.stringify(r.json));
  assert.equal(env.DB.inbox[0].payload.agent, "TestClient");
  assert.equal(env.DB.inbox[0].payload.page, "/mcp");
  assert.match(r.json.result.structuredContent.message, /confirm a time with the person by email/);
  assert.equal(r.json.result.structuredContent.booked, false);
  r = await modern(11, "tools/call", { name: "request_booking", arguments: { name: "Kim", email: "kim@example.org", preferred_start: inDays(1, 16) } });
  assert.equal(r.json.result.isError, true);
  assert.match(r.json.result.content[0].text, /consent is required/);
  r = await modern(12, "tools/call", { name: "get_availability", arguments: { days: 99 } });
  assert.equal(r.json.result.isError, true);

  // Booking requests off → the tool isn't offered.
  _resetCache(); env = makeEnv(sample({ booking: { requests: false, links: data.booking.links } }));
  r = await modern(13, "tools/list");
  assert.ok(!r.json.result.tools.some((t) => t.name === "request_booking"));
  r = await modern(14, "tools/call", { name: "request_booking", arguments: {} });
  assert.equal(r.json.error.code, -32602);
});

test("discovery documents: server card, OpenAPI", async () => {
  const r = await card.onRequestGet({ request: req("/mcp/server-card"), env });
  assert.equal(r.headers.get("content-type"), "application/mcp-server-card+json");
  const c = await r.json();
  assert.equal(c.$schema, "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json");
  assert.match(c.name, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  assert.ok(c.description.length <= 100);
  assert.equal(c.remotes[0].url, ORIGIN + "/mcp");
  const doc = openapi(ORIGIN, data);
  assert.equal(doc.openapi, "3.1.0");
  assert.ok(doc.paths["/api/agent/booking-request"]);
  assert.ok(!openapi(ORIGIN, sample({ booking: { requests: false, links: [] } })).paths["/api/agent/booking-request"]);
  // Every $ref resolves.
  const refs = JSON.stringify(doc).match(/#\/components\/schemas\/\w+/g);
  for (const x of refs) assert.ok(doc.components.schemas[x.split("/").pop()], x);
});

test("MCP and booking request bodies are capped while reading, not only by Content-Length", async () => {
  const big = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: { pad: "x".repeat(70000) } });
  const stream = (text) => new ReadableStream({ start(c) { const b = new TextEncoder().encode(text); for (let i = 0; i < b.length; i += 8192) c.enqueue(b.slice(i, i + 8192)); c.close(); } });
  const mk = (path, text) => new Request(ORIGIN + path, { method: "POST", body: stream(text), duplex: "half", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.50" } });
  let r = await mcp.onRequestPost({ request: mk("/mcp", big), env });
  assert.equal(r.status, 413);
  r = await booking.onRequestPost({ request: mk("/api/agent/booking-request", JSON.stringify({ name: "x".repeat(25000) })), env });
  assert.equal(r.status, 413);
  r = await mcp.onRequestPost({ request: mk("/mcp", JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })), env });
  assert.equal(r.status, 200);
});
