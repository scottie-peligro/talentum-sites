import type { APIRoute } from "astro";
import { bundle, entries, ofType, posts, setLang, settings, site, absolute, plain, truncate } from "../lib/content";
import { pageDescription } from "../lib/seo";
// llms.txt — a plain map of the site for AI assistants (https://llmstxt.org).
export const GET: APIRoute = () => {
  setLang("");   // endpoints are in the site's main language (language is module state; a page may have left another one set)
  const name = settings.org?.name || site.name;
  const line = (e: any) => `- [${e.title}](${absolute(e.path)})${pageDescription(e) ? ": " + truncate(plain(pageDescription(e)), 180) : ""}`;
  const pages = entries.filter((e) => (e.type === "page" || e.type === "landing") && !e.seo?.noindex);
  const out = [`# ${name}`, "", `> ${settings.org?.description || settings.seo?.default_description || ""}`.trim(), "",
    "## Pages", ...pages.map(line), "", "## Services", ...ofType("service").map(line), "",
    "## Case studies", ...ofType("case_study").map(line), "", "## Insights", ...posts().slice(0, 50).map(line), "",
    // The site endpoint for AI agents (functions/api/agent, functions/mcp), when Talentum switched it on for this build.
    ...((bundle as any).agent ? ["## For AI assistants",
      `- [MCP server](${absolute("/mcp")}): Streamable HTTP, no sign-in. Tools: list_services, get_service, search_faqs, get_availability, contact_options${(bundle as any).agent.booking?.requests ? ", request_booking" : ""}.`,
      `- [API for AI assistants (OpenAPI)](${absolute("/api/agent/openapi.json")}): the same facts as JSON.`, ""] : [])];
  return new Response(out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
