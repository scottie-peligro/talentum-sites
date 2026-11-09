// POST /api/agent/booking-request — an AI assistant asks for a meeting on someone's behalf. Queued in the D1 inbox;
// Talentum turns it into a booking request the team member accepts or declines (never a confirmed meeting) or a Request.
// Agents can't do Turnstile, so: off unless the site allows it, consent required, honeypot fields, hard rate limits.
import { out, preflight, loadData, OFF, bookingRequest } from "../../../edge/agent.js";

export async function onRequestPost({ request, env }) {
  const d = await loadData(env, request);
  if (!d) return out(OFF, 404);
  if (Number(request.headers.get("content-length") || 0) > 20000) return out({ error: "That's too much to send." }, 413);
  if (!(request.headers.get("content-type") || "").includes("application/json")) return out({ error: "Send JSON (Content-Type: application/json)." }, 415);
  let b;
  try { b = await request.json(); } catch { return out({ error: "The body isn't valid JSON." }, 400); }
  const x = await bookingRequest(env, request, d, new URL(request.url).origin, b, "api", b && typeof b === "object" ? b.assistant : "");
  return out(x.body, x.status);
}
export function onRequestGet() { return out({ error: "POST a JSON booking request. See /api/agent/openapi.json." }, 405); }
export const onRequestOptions = preflight;
