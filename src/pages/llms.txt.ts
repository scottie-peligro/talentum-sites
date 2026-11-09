import type { APIRoute } from "astro";
import { entries, ofType, posts, setLang, settings, site, absolute, plain, truncate } from "../lib/content";
import { pageDescription } from "../lib/seo";
// llms.txt — a plain map of the site for AI assistants (https://llmstxt.org). Each link points at the page's clean
// Markdown copy (<page>/index.md, written by scripts/postbuild.mjs); llms-full.txt has the main pages in one file.
export const GET: APIRoute = () => {
  setLang("");   // endpoints are in the site's main language (language is module state; a page may have left another one set)
  const name = settings.org?.name || site.name;
  const indexed = (list: any[]) => list.filter((e) => !e.seo?.noindex);
  const line = (e: any) => `- [${e.title}](${absolute(e.path)}index.md)${pageDescription(e) ? ": " + truncate(plain(pageDescription(e)), 180) : ""}`;
  const pages = indexed(entries.filter((e) => e.type === "page" || e.type === "landing"));
  const out = [`# ${name}`, "", `> ${settings.org?.description || settings.seo?.default_description || ""}`.trim(), "",
    `Every page below is a Markdown copy of the page on ${absolute("/")} (the same address without "index.md"). The main pages in one file: ${absolute("/llms-full.txt")}`, "",
    "## Pages", ...pages.map(line), "", "## Services", ...indexed(ofType("service")).map(line), "",
    "## Case studies", ...indexed(ofType("case_study")).map(line), "", "## Insights", ...indexed(posts()).slice(0, 50).map(line), ""];
  return new Response(out.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
