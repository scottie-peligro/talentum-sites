// GET /mcp/server-card — the MCP Server Card (SEP-2127) for /mcp; /.well-known/ai-catalog.json points here.
import { loadData, out, OFF, CORS } from "../../edge/agent.js";
import { serverCard } from "../../edge/mcp.js";

export async function onRequestGet({ request, env }) {
  const d = await loadData(env, request);
  if (!d) return out(OFF, 404);
  return new Response(JSON.stringify(serverCard(d, new URL(request.url).origin), null, 1), { headers: { ...CORS, "Content-Type": "application/mcp-server-card+json", "Cache-Control": "public, max-age=3600", "X-Robots-Tag": "noindex" } });
}
export function onRequestOptions() { return new Response(null, { status: 204, headers: CORS }); }
