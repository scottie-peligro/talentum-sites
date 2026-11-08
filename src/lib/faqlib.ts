// The questions a Question library block shows (shared by the block and the page's FAQPage data).
import { bundle, type Entry, type Faq } from "./content";
export function libraryFaqs(d: Record<string, any>, entry?: Entry): Faq[] {
  const line = d.service_line || (entry?.type === "service" ? entry.service_line : "");
  const only: string[] = Array.isArray(d.groups) ? d.groups.map((g: string) => String(g).trim()).filter(Boolean) : [];
  const list = bundle.faqs.filter((f) => (!line || f.service_lines.includes(line)) && (!only.length || only.includes(f.group)));
  const order = only.length ? only : [...new Set(list.map((f) => f.group))];
  return list.slice().sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
}
