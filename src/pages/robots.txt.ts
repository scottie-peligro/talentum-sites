import type { APIRoute } from "astro";
import { settings, isStaging, absolute } from "../lib/content";
// Staging: nobody may crawl. Live: everyone, plus per-bot AI crawler choices (Website → Settings → SEO) and the sitemap.
const AI_BOTS = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Google-Extended", "Applebot-Extended", "CCBot", "Bytespider", "meta-externalagent"];
export const GET: APIRoute = () => {
  if (isStaging) return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } });
  const ai = settings.robots?.ai_crawlers || {};
  const lines = ["User-agent: *", "Allow: /", ""];
  for (const bot of AI_BOTS) if (ai[bot] === "block") lines.push(`User-agent: ${bot}`, "Disallow: /", "");
  if (settings.robots?.extra) lines.push(String(settings.robots.extra).trim(), "");
  lines.push(`Sitemap: ${absolute("/sitemap.xml")}`);
  return new Response(lines.join("\n") + "\n", { headers: { "Content-Type": "text/plain" } });
};
