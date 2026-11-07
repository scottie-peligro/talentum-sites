import type { APIRoute } from "astro";
import { posts, settings, site, absolute, plain, escape } from "../lib/content";
export const GET: APIRoute = () => {
  const items = posts().slice(0, 30).map((p) => `<item><title>${escape(p.title)}</title><link>${absolute(p.path)}</link><guid>${absolute(p.path)}</guid>${p.published_at ? `<pubDate>${new Date(p.published_at).toUTCString()}</pubDate>` : ""}<description>${escape(plain(p.excerpt))}</description></item>`);
  const name = settings.org?.name || site.name;
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${escape(name)} — Insights</title><link>${absolute("/")}</link><description>${escape(settings.seo?.default_description || name)}</description>${items.join("")}</channel></rss>\n`, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};
