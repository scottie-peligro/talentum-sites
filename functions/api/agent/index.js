// GET /api/agent — what this website's agent endpoint offers (a starting point for AI assistants and developers).
import { out, preflight, contactView } from "../../../edge/agent.js";
import { ready } from "../../../edge/agentroute.js";

export async function onRequestGet({ request, env }) {
  const r = await ready(request, env); if (r.res) return r.res;
  const { d, origin } = r;
  return out({
    organization: d.organization.name, description: d.organization.description,
    openapi: origin + "/api/agent/openapi.json", mcp: origin + "/mcp",
    endpoints: {
      services: origin + "/api/agent/services", service: origin + "/api/agent/services/{id}", faqs: origin + "/api/agent/faqs?q={question}",
      team: origin + "/api/agent/team", contact: origin + "/api/agent/contact", availability: origin + "/api/agent/availability?service={id}&from={YYYY-MM-DD}&days={1-14}",
      ...(d.booking.requests ? { booking_request: "POST " + origin + "/api/agent/booking-request" } : {}),
    },
    booking_requests: contactView(d, origin).booking_requests,
    updated: d.generated_at,
  }, 200, true);
}
export const onRequestOptions = preflight;
