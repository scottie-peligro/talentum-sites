import type { APIRoute } from "astro";
import { entries, ofType, posts, settings, site, absolute, plain, truncate } from "../lib/content";
import { pageDescription } from "../lib/seo";
// llms.txt — a plain map of the site for AI assistants (https://llmstxt.org).
export const GET: APIRoute = () => {
  const name = settings.org?.name || site.name;
  const line = (e: any) => `- [${e.title}](${absolute(e.path)})${pageDescription(e) ? ": " + truncate(plain(pageDescription(e)), 180) : ""}`;
  const pages = entries.filter((e) => (e.type === "page" || e.type === "landing") && !e.seo?.noindex);
  const out = [`# ${name}`, "", `> ${settings.org?.description || settings.seo?.default_description || ""}`.trim(), "",
    "## Pages", ...pages.map(line), "", "## Services", ...ofType("service").map(line), "",
    "## Case studies", ...ofType("case_study").map(line), "", "## Insights", ...posts().slice(0, 50).map(line), ""];
  return new Response(out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
