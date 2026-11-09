// GET /api/agent/services?q=&category= — the company's services (summary, page, prices when published, booking links).
import { out, preflight, listServices } from "../../../edge/agent.js";
import { ready } from "../../../edge/agentroute.js";

export async function onRequestGet({ request, env }) {
  const r = await ready(request, env); if (r.res) return r.res;
  return out(listServices(r.d, r.origin, { query: r.q.get("q") || "", category: r.q.get("category") || "" }), 200, true);
}
export const onRequestOptions = preflight;
