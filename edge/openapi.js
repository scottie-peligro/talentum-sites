// OpenAPI 3.1 description of the agent API (/api/agent/openapi.json), written at build time by scripts/postbuild.mjs.
import { TOOLS, MAX_DAYS } from "./agent.js";

const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const ok = (schema, description) => ({ description: description || "OK", content: { "application/json": { schema } } });
const errorRes = (description) => ({ description, content: { "application/json": { schema: ref("Error") } } });
const q = (name, description, schema, required) => ({ name, in: "query", required: !!required, description, schema: schema || { type: "string" } });
const str = { type: "string" };

export function openapi(origin, d) {
  const booking = TOOLS.find((t) => t.name === "request_booking").inputSchema;
  const doc = {
    openapi: "3.1.0",
    info: {
      title: `${d.organization.name} — website API for AI assistants`, version: "1.0.0",
      description: `Public, read-only facts from ${d.organization.name}'s website (services${d.prices_shared ? ", published prices" : ""}, FAQs, team, contact options), open meeting times, `
        + (d.booking.requests ? "and meeting requests (the team confirms each one by email; nothing is booked automatically). " : "and booking pages. ")
        + `The same tools are available over MCP at ${origin}/mcp. Answer only from what this API returns.`,
    },
    servers: [{ url: origin }],
    paths: {
      "/api/agent/services": { get: { operationId: "listServices", summary: "List services", parameters: [q("q", "Words to search for."), q("category", "Only this category.")], responses: { 200: ok(ref("ServiceList")), 429: errorRes("Too many requests") } } },
      "/api/agent/services/{id}": { get: { operationId: "getService", summary: "One service in full", parameters: [{ name: "id", in: "path", required: true, schema: str, description: "Service id from listServices." }], responses: { 200: ok(ref("ServiceDetail")), 404: errorRes("No such service") } } },
      "/api/agent/faqs": { get: { operationId: "searchFaqs", summary: "Search questions and answers", parameters: [q("q", "The question or keywords."), q("service", "Only answers about this service id."), q("limit", "1–20 (default 10).", { type: "integer", minimum: 1, maximum: 20 })], responses: { 200: ok(ref("FaqList")) } } },
      "/api/agent/team": { get: { operationId: "getTeam", summary: "The public team", responses: { 200: ok({ type: "object", properties: { organization: str, people: { type: "array", items: ref("Person") } } }) } } },
      "/api/agent/contact": { get: { operationId: "getContactOptions", summary: "Contact options and booking links", responses: { 200: ok(ref("Contact")) } } },
      "/api/agent/availability": { get: { operationId: "getAvailability", summary: `Open times (UTC) over up to ${MAX_DAYS} days`, description: "From a snapshot refreshed every 15 minutes. status = current | stale (more than 2 hours old: check the booking page) | unknown.",
        parameters: [q("service", "A service id (uses its booking link)."), q("booking_link", "A booking link id."), q("from", "First day, YYYY-MM-DD (default today).", { type: "string", format: "date" }), q("days", `1–${MAX_DAYS} (default 7).`, { type: "integer", minimum: 1, maximum: MAX_DAYS })],
        responses: { 200: ok(ref("Availability")), 400: errorRes("Unknown service or link, or a bad date") } } },
    },
    components: {
      schemas: {
        Error: { type: "object", properties: { error: str, code: str }, required: ["error"] },
        Price: { type: "object", properties: { name: str, amount: { type: "number" }, currency: str, unit: { type: "string", description: "one-off, hr, mo, each, or a unit" }, from: { type: "boolean", description: "Starting price (sizes vary)" }, add_on: { type: "boolean" } } },
        Service: { type: "object", properties: { id: str, name: str, category: str, summary: str, url: { type: "string", format: "uri" }, prices: { type: "array", items: ref("Price") }, price_note: str, booking_links: { type: "array", items: str } }, required: ["id", "name", "url"] },
        ServiceList: { type: "object", properties: { organization: str, count: { type: "integer" }, services: { type: "array", items: ref("Service") }, categories: { type: "array", items: str } } },
        BookingLink: { type: "object", properties: { id: str, title: str, duration_minutes: { type: "integer" }, with: str, description: str, booking_page: { type: "string", format: "uri" }, services: { type: "array", items: str } } },
        ServiceDetail: { allOf: [ref("Service"), { type: "object", properties: { booking_links: { type: "array", items: ref("BookingLink") }, faqs: { type: "array", items: { type: "object", properties: { question: str, answer: str } } }, case_studies: { type: "array", items: { type: "object", properties: { title: str, summary: str, url: str } } }, booking_requests: { type: "boolean" } } }] },
        FaqList: { type: "object", properties: { count: { type: "integer" }, faqs: { type: "array", items: { type: "object", properties: { question: str, answer: str, topic: str, services: { type: "array", items: str } } } } } },
        Person: { type: "object", properties: { name: str, job_title: str, linkedin: str } },
        Contact: { type: "object", properties: { organization: { type: "object" }, phone: str, email: str, address: { type: "object" }, hours: str, contact_page: str, booking_page: str, booking_links: { type: "array", items: ref("BookingLink") }, booking_requests: str, people: { type: "array", items: ref("Person") } } },
        Availability: { type: "object", properties: { booking_link: ref("BookingLink"), time_zone: { const: "UTC" }, from: str, days: { type: "integer" }, status: { enum: ["current", "stale", "unknown"] }, as_of: { type: "string", format: "date-time" }, age_minutes: { type: "integer" }, stale: { type: "boolean" },
          slots: { type: "array", items: { type: "object", properties: { start: { type: "string", format: "date-time" }, end: { type: "string", format: "date-time" } } } }, note: str } },
      },
    },
  };
  if (d.booking.requests) {
    doc.components.schemas.BookingRequest = { ...booking, description: "Only send this when the person asked for the meeting and agreed to share their details (consent: true)." };
    doc.paths["/api/agent/booking-request"] = { post: { operationId: "requestBooking", summary: "Request a meeting (the team confirms by email)",
      requestBody: { required: true, content: { "application/json": { schema: ref("BookingRequest") } } },
      responses: { 202: ok({ type: "object", properties: { status: { const: "received" }, reference: str, message: str } }, "Received; nothing is booked until the team confirms"),
        400: errorRes("Missing or invalid details"), 403: errorRes("This website doesn't take booking requests from AI assistants"), 409: errorRes("None of the times is open (open_times lists some that are)"), 429: errorRes("Too many requests") } } };
  }
  return doc;
}
