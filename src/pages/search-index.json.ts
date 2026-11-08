// Site search index for the New layout's search panel: title, path, kind and a short description per page.
import { entries, plain, truncate, lineName } from "../lib/content";
// "Search Engine Optimization" → "seo", so the short names people type still find the page.
const acronym = (t: string) => { const w = t.split(/[\s&/-]+/).filter((x) => x.length > 2); return w.length >= 2 ? w.map((x) => x[0]).join("") : ""; };
import { pageDescription } from "../lib/seo";

const KIND: Record<string, string> = { page: "Page", service: "Service", case_study: "Case study", post: "Insight", job: "Career", legal: "Legal", landing: "Page" };
export function GET() {
  const list = entries.filter((e) => !e.seo?.noindex && e.type !== "legal" && e.type !== "landing").map((e) => ({
    t: e.title, p: e.path, k: KIND[e.type] || "Page", d: truncate(plain(pageDescription(e)), 120),
    x: [e.seo?.focus_keyword, ...(Array.isArray(e.seo?.keywords) ? e.seo.keywords : []), acronym(e.title), lineName(e.service_line)].filter(Boolean).join(" "),
    f: e.type === "service" || (e.type === "page" && e.path.split("/").filter(Boolean).length === 1) ? 1 : 0,
  }));
  list.sort((a, b) => b.f - a.f);
  return new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } });
}
