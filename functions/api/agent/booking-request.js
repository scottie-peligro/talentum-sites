// POST /api/agent/booking-request — an AI assistant asks for a meeting on someone's behalf. Queued in the D1 inbox;
// Talentum turns it into a Request the team confirms (unverified: nothing is booked or held, nobody is emailed).
// Agents can't do Turnstile, so: off unless the site allows it, consent required, honeypot fields, hard rate limits.
// No open CORS here (unlike the read-only GETs): web pages on other sites can't post requests from visitors' browsers.
import { outPost as out, preflightPost, loadData, OFF, bookingRequest } from "../../../edge/agent.js";
import { readCapped } from "../../../edge/shared.js";

export async function onRequestPost({ request, env }) {
  const d = await loadData(env, request);
  if (!d) return out(OFF, 404);
  if (!(request.headers.get("content-type") || "").includes("application/json")) return out({ error: "Send JSON (Content-Type: application/json)." }, 415);
  const body = await readCapped(request, 20000);
  if (body.tooLarge) return out({ error: "That's too much to send." }, 413);
  let b;
  try { b = JSON.parse(body.text); } catch { return out({ error: "The body isn't valid JSON." }, 400); }
  const x = await bookingRequest(env, request, d, new URL(request.url).origin, b, "api", b && typeof b === "object" ? b.assistant : "");
  return out(x.body, x.status);
}
export function onRequestGet() { return out({ error: "POST a JSON booking request. See /api/agent/openapi.json." }, 405); }
export const onRequestOptions = preflightPost;
