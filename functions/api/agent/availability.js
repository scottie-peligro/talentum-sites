// GET /api/agent/availability?service=|booking_link=&from=YYYY-MM-DD&days=1-14 — open times (UTC) from the snapshot
// Talentum refreshes every 15 minutes; "stale" (with the booking page) when it's more than 2 hours old.
import { out, preflight, availability } from "../../../edge/agent.js";
import { ready } from "../../../edge/agentroute.js";

export async function onRequestGet({ request, env }) {
  const r = await ready(request, env); if (r.res) return r.res;
  const q = r.q;
  const x = await availability(env, r.d, r.origin, { service: q.get("service") || "", booking_link: q.get("booking_link") || q.get("link") || "", from: q.get("from") || "", days: q.get("days") || "" });
  return out(x.body, x.status);
}
export const onRequestOptions = preflight;
