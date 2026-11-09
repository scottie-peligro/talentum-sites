import type { APIRoute } from "astro";
import { entries, allEntries, translated, versionsOf, absolute, isStaging, contentTypes } from "../lib/content";
// Every published, indexable entry with its last change. (Staging still gets one, but robots.txt keeps crawlers out.)
// Translated sites: every language version is listed, each with xhtml:link alternates to all of them (+ x-default).
export const GET: APIRoute = () => {
  const alt = (e: (typeof entries)[number]) => {
    if (!translated) return "";
    const v = versionsOf(e);
    return v.length > 1 ? v.map((x) => `<xhtml:link rel="alternate" hreflang="${x.hreflang}" href="${absolute(x.path)}"/>`).join("") + `<xhtml:link rel="alternate" hreflang="x-default" href="${absolute(v[0].path)}"/>` : "";
  };
  const urls = (translated ? allEntries : entries).filter((e) => !e.seo?.noindex && !e.seo?.canonical)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((e) => `<url><loc>${absolute(e.path)}</loc>${e.updated || e.published_at ? `<lastmod>${new Date(e.updated || e.published_at).toISOString()}</lastmod>` : ""}${alt(e)}</url>`);
  void isStaging;
  // Custom content types' listing pages.
  for (const t of contentTypes) if (t.archive && t.route && !entries.some((e) => e.path === "/" + t.route + "/")) urls.push(`<url><loc>${absolute("/" + t.route + "/")}</loc></url>`);
  const ns = translated ? ` xmlns:xhtml="http://www.w3.org/1999/xhtml"` : "";
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${ns}>\n${urls.join("\n")}\n</urlset>\n`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
