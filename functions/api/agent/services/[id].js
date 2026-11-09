// GET /api/agent/services/{id} — one service in full: prices (or how to get a quote), FAQs, case studies, booking links.
import { out, preflight, serviceDetail } from "../../../../edge/agent.js";
import { ready } from "../../../../edge/agentroute.js";

export async function onRequestGet({ request, env, params }) {
  const r = await ready(request, env); if (r.res) return r.res;
  const x = serviceDetail(r.d, r.origin, decodeURIComponent(String(params.id || "")));
  return x ? out(x, 200, true) : out({ error: "No service with that id.", code: "not_found", services: r.d.services.map((s) => s.id) }, 404);
}
export const onRequestOptions = preflight;
