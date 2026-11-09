// GET /api/agent/faqs?q=&service=&limit= — search the published questions and answers.
import { out, preflight, searchFaqs } from "../../../edge/agent.js";
import { ready } from "../../../edge/agentroute.js";

export async function onRequestGet({ request, env }) {
  const r = await ready(request, env); if (r.res) return r.res;
  const x = searchFaqs(r.d, { query: r.q.get("q") || "", service: r.q.get("service") || "", limit: r.q.get("limit") || 10 });
  return x.error ? out(x, 404) : out(x, 200, true);
}
export const onRequestOptions = preflight;
