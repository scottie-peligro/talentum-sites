import type { APIRoute } from "astro";
import { entries, absolute, isStaging } from "../lib/content";
// Every published, indexable entry with its last change. (Staging still gets one, but robots.txt keeps crawlers out.)
export const GET: APIRoute = () => {
  const urls = entries.filter((e) => !e.seo?.noindex && !e.seo?.canonical)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((e) => `<url><loc>${absolute(e.path)}</loc>${e.updated || e.published_at ? `<lastmod>${new Date(e.updated || e.published_at).toISOString()}</lastmod>` : ""}</url>`);
  void isStaging;
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
