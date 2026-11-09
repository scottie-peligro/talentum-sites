// The site's MCP server (Streamable HTTP, stateless, JSON responses only) at POST /mcp.
//
// Dual-era (https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning):
//   modern  2026-07-28   no handshake; every request carries params._meta["io.modelcontextprotocol/protocolVersion"],
//                        the MCP-Protocol-Version, Mcp-Method (and for tools/call Mcp-Name) headers are checked
//                        against the body; server/discover; results carry resultType, list results ttlMs/cacheScope.
//   legacy  2025-03-26 … 2025-11-25   initialize → (notifications/initialized → 202) → tools/list, tools/call, ping.
//                        No sessions are minted (they're optional there); GET/DELETE → 405.
// Tools: edge/agent.js TOOLS. No secrets, no auth: everything is public facts, and request_booking is rate-limited.
import { CORS, loadData, toolsFor, check, runTool, instructions, TOOLS } from "./agent.js";
import { visitor, limited } from "./shared.js";

export const MODERN = ["2026-07-28"];
export const LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const SUPPORTED = [...MODERN, ...LEGACY];
const META_V = "io.modelcontextprotocol/protocolVersion";
const META_CLIENT = "io.modelcontextprotocol/clientInfo";
const META_SERVER = "io.modelcontextprotocol/serverInfo";

function reply(body, status = 200, version) {
  const h = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", ...CORS };
  if (version) h["MCP-Protocol-Version"] = version;
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: h });
}
const err = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data !== undefined ? { data } : {}) } });

/** "=?base64?…?=" header values (Mcp-Name, Mcp-Param-*) → plain text. */
export function decodeHeader(v) {
  const m = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(v || "");
  if (!m) return v;
  try { return new TextDecoder().decode(Uint8Array.from(atob(m[1]), (c) => c.charCodeAt(0))); } catch { return null; }
}

export function serverInfo(d) {
  const name = (d.organization.name || "website").replace(/[^\w .&'-]/g, "").trim().slice(0, 80) || "website";
  return { name: "talentum-site-agent", title: `${name} (website)`, version: "1.0.0" };
}

export async function handleMcp(request, env) {
  // Origin check (DNS-rebinding guard): this server is public, so any web origin may call it, but a malformed one is refused.
  const og = request.headers.get("Origin");
  if (og && og !== "null" && !/^https?:\/\/[^\s/]+$/i.test(og)) return reply(err(null, -32600, "Origin not allowed."), 403);
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 65536) return reply(err(null, -32600, "Request too large."), 413);
  let msg;
  try { msg = await request.json(); } catch { return reply(err(null, -32700, "Parse error: send one JSON-RPC 2.0 message."), 400); }
  if (Array.isArray(msg)) return reply(err(null, -32600, "Batches aren't supported. Send one message per request."), 400);
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return reply(err(msg?.id, -32600, "Invalid request: expected a JSON-RPC 2.0 message."), 400);
  const isNote = msg.id === undefined || msg.id === null;
  if (!isNote && typeof msg.id !== "string" && typeof msg.id !== "number") return reply(err(null, -32600, "Invalid request id."), 400);
  if (isNote) return msg.method.startsWith("notifications/") ? reply(null, 202) : reply(err(null, -32600, "Unknown notification."), 400);
  const id = msg.id;
  const params = msg.params && typeof msg.params === "object" && !Array.isArray(msg.params) ? msg.params : {};
  const meta = params._meta && typeof params._meta === "object" ? params._meta : {};
  const headerV = request.headers.get("MCP-Protocol-Version") || "";

  // Which era is this request in?
  let version = "", modern = false;
  if (msg.method === "initialize") {
    const asked = String(params.protocolVersion || "");
    version = LEGACY.includes(asked) ? asked : LEGACY[0];
  } else if (meta[META_V] !== undefined || MODERN.includes(headerV)) {
    modern = true;
    version = String(meta[META_V] || "");
    if (!SUPPORTED.includes(version) || LEGACY.includes(version)) return reply(err(id, -32022, "Unsupported protocol version", { supported: SUPPORTED, requested: version || headerV }), 400);
    const mismatch = (h, want) => `Header mismatch: ${h} ${request.headers.get(h) === null ? "is missing" : "doesn't match the body"} (expected ${want}).`;
    if (headerV !== version) return reply(err(id, -32020, mismatch("MCP-Protocol-Version", version)), 400);
    if (request.headers.get("Mcp-Method") !== msg.method) return reply(err(id, -32020, mismatch("Mcp-Method", msg.method)), 400);
    if (msg.method === "tools/call" && decodeHeader(request.headers.get("Mcp-Name")) !== String(params.name ?? "")) return reply(err(id, -32020, mismatch("Mcp-Name", params.name)), 400);
  } else {
    version = LEGACY.includes(headerV) ? headerV : (headerV ? "" : "2025-03-26");
    if (!version) return reply(err(id, -32022, "Unsupported protocol version", { supported: SUPPORTED, requested: headerV }), 400);
  }

  const d = await loadData(env, request);
  if (!d) return reply(err(id, -32001, "This website doesn't offer an MCP server for AI assistants."), 404, version);
  const who = await visitor(request, env);
  if (await limited(env, "mcp:" + who, 240, 600)) return reply(err(id, -32000, "Too many requests. Please slow down and try again in a few minutes."), 429, version);

  const origin = new URL(request.url).origin;
  const info = serverInfo(d);
  const done = (result) => reply({ jsonrpc: "2.0", id, result: modern ? { resultType: "complete", ...result, _meta: { ...(result._meta || {}), [META_SERVER]: info } } : result }, 200, version);

  switch (msg.method) {
    case "initialize":
      return done({ protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: info, instructions: instructions(d) });
    case "server/discover":
      return done({ supportedVersions: SUPPORTED, capabilities: { tools: {} }, instructions: instructions(d), ttlMs: 300000, cacheScope: "public", ...(modern ? {} : { serverInfo: info }) });
    case "ping":
      return done({});
    case "tools/list":
      return done({ tools: toolsFor(d), ...(modern ? { ttlMs: 300000, cacheScope: "public" } : {}) });
    case "tools/call": {
      const name = String(params.name || "");
      const tool = toolsFor(d).find((t) => t.name === name);
      if (!tool) return reply(err(id, -32602, TOOLS.some((t) => t.name === name) ? `${name} isn't available on this website.` : `Unknown tool: ${name || "(none)"}.`), 200, version);
      const args = params.arguments === undefined ? {} : params.arguments;
      const problems = check(tool.inputSchema, args);
      if (problems.length) return done({ content: [{ type: "text", text: "Invalid arguments: " + problems.join(" ") }], isError: true });
      const agent = String((modern ? meta[META_CLIENT]?.name : "") || request.headers.get("User-Agent") || "").replace(/[^\w .()/-]/g, "").slice(0, 80);
      const r = await runTool(name, args, { env, request, d, origin, agent });
      return done({ content: [{ type: "text", text: JSON.stringify(r.data, null, 1) }], structuredContent: r.data, isError: !r.ok });
    }
    default:
      return reply(err(id, -32601, `Method not found: ${msg.method}`), modern ? 404 : 200, version);
  }
}

export function onGetOrDelete() {
  return new Response(JSON.stringify(err(null, -32600, "This MCP server takes POST only (stateless Streamable HTTP).")), { status: 405, headers: { Allow: "POST, OPTIONS", "Content-Type": "application/json", ...CORS } });
}

/** The MCP Server Card (SEP-2127) for this site's server, at /mcp/server-card. */
export function serverCard(d, origin) {
  const host = new URL(origin).hostname.replace(/[^a-zA-Z0-9.-]/g, "");
  const reversed = host.split(".").reverse().join(".") || "site";
  const desc = `Services, prices, FAQs, open times and meeting requests for ${d.organization.name}.`;
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: `${reversed}/website`, version: "1.0.0", title: `${d.organization.name}`.slice(0, 100) || "Website", description: desc.length > 100 ? desc.slice(0, 99) + "…" : desc,
    websiteUrl: origin + "/", remotes: [{ type: "streamable-http", url: origin + "/mcp", supportedProtocolVersions: SUPPORTED }],
  };
}
