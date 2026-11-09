// GET /api/agent/team — the people the website shows publicly (name, job title, LinkedIn). Nobody else.
import { out, preflight, teamView } from "../../../edge/agent.js";
import { ready } from "../../../edge/agentroute.js";

export async function onRequestGet({ request, env }) {
  const r = await ready(request, env); if (r.res) return r.res;
  return out(teamView(r.d), 200, true);
}
export const onRequestOptions = preflight;
