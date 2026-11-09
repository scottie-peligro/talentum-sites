// GET /api/agent/contact — phone, email, address, hours, contact and booking pages, booking links.
import { out, preflight, contactView } from "../../../edge/agent.js";
import { ready } from "../../../edge/agentroute.js";

export async function onRequestGet({ request, env }) {
  const r = await ready(request, env); if (r.res) return r.res;
  return out(contactView(r.d, r.origin), 200, true);
}
export const onRequestOptions = preflight;
