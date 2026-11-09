// The site's content (src/data/bundle.json, from Talentum) and the helpers every template uses.
import raw from "../data/bundle.json";
import sanitizeHtml from "sanitize-html";

export type Link = { label?: string; href?: string; style?: string; new_tab?: boolean };
export type Block = { id: string; type: string; hidden?: boolean; data: Record<string, any> };
export type Entry = {
  id: string; type: "page" | "service" | "case_study" | "post" | "job" | "legal" | "landing" | `x_${string}`; title: string; slug: string; path: string;
  blocks: Block[]; excerpt: string; featured_image: string; authors: string[]; categories: string[]; tags: string[];
  service_line: string; account: string; fields: Record<string, any>; seo: Record<string, any>; parent: string; sort_order: number;
  published_at: string; updated: string;
};
export type Media = { id: string; url: string; file: string; raster: boolean; name: string; alt: string; caption: string; credit: string; focal: { x: number; y: number } | null; width: number; height: number; mime: string };
export type Person = { id: string; name: string; job_title: string; photo: string; photo_file?: string; linkedin: string };
export type Proof = { id: string; kind: string; title: string; metric: string; value: string; unit: string; change: string; period: string; baseline: string; detail: string; source: string; as_of: string; images: string[]; video_url: string; client: string; case_study: string; service_lines: string[] };
export type Testimonial = { id: string; quote: string; person: string; role: string; company: string; photo: string; rating: number; service_lines: string[] };
export type Faq = { id: string; question: string; answer: string; group: string; service_lines: string[] };
export type MenuItem = { label: string; entry: string; url: string; description: string; new_tab: boolean; style: string; children: MenuItem[] };

type Bundle = {
  site: { id: string; key: string; name: string; theme: string; environment: "staging" | "live"; url: string; live_url: string; settings: any };
  generated_at: string; entries: Entry[]; sections: Record<string, Block[]>; menus: Record<string, MenuItem[]>;
  categories: { id: string; name: string; slug: string; description: string; seo: any }[]; proof: Proof[]; testimonials: Testimonial[]; faqs: Faq[];
  team: Person[]; users: Record<string, Person>; service_lines: { id: string; name: string; slug: string }[]; accounts: Record<string, { id: string; name: string; website: string }>;
  media: Record<string, Media>; redirects: { from: string; to: string; code: number }[];
  booking_links?: BookingLink[];
  forms?: Record<string, { id: string; key: string; name: string; mode: string; questions: any[]; fields: any[]; labels: Record<string, string> }>;
};
export type BookingLink = { id: string; user: string; user_name: string; title: string; slug: string; duration: number; description: string; path: string; url: string };

export const bundle = raw as unknown as Bundle;
export const site = bundle.site;
export const settings = site.settings || {};
export const isStaging = site.environment !== "live";
export const entries = bundle.entries;

const byId = new Map(entries.map((e) => [e.id, e]));
export const entryById = (id?: string) => (id ? byId.get(id) : undefined);
export const ofType = (t: Entry["type"]) => entries.filter((e) => e.type === t).sort((a, b) => (a.sort_order - b.sort_order) || a.title.localeCompare(b.title));
export const posts = () => entries.filter((e) => e.type === "post").sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""));
export const media = (id?: string) => (id ? bundle.media[id] : undefined);
export const person = (id?: string) => (id ? bundle.users?.[id] : undefined);
export const bookingLink = (id?: string) => (id ? bundle.booking_links?.find((l) => l.id === id) : undefined);
/** A booking choice → where it goes, the embeddable version, and who it's with. `booking_link` (picked in Talentum) wins over a pasted `booking_url`. */
export function resolveBooking(d: { booking_link?: string; booking_url?: string; member?: string | string[] }) {
  const link = bookingLink(d.booking_link);
  const url = link?.url || (d.booking_url ? href(d.booking_url) : "");
  if (!url) return null;
  const memberId = (Array.isArray(d.member) ? d.member[0] : d.member) || link?.user;
  const embed = /^https?:\/\//.test(url) ? url + (url.includes("?") ? "&" : "?") + "embed=1&src=website" : "";
  return { url, embed, who: person(memberId), duration: link?.duration || 0, title: link?.title || "" };
}
// Custom content types (Talentum → Website → Content types). Their entries have type "x_<key>".
export type ContentType = { key: string; label: string; plural: string; route: string; archive: boolean; archive_title: string; archive_intro: string; show_fields: boolean; fields: { key: string; label: string; type: string; options: string[] }[] };
export const contentTypes: ContentType[] = Array.isArray((settings as any).content_types) ? (settings as any).content_types : [];
export const contentType = (type?: string) => (type && type.startsWith("x_") ? contentTypes.find((t) => "x_" + t.key === type) : undefined);
/** A type's entries, soonest date first when it has a date field, otherwise by order then title. */
export function entriesOf(type: string) {
  const ct = contentType(type);
  const dateKey = ct?.fields.find((f) => f.type === "date")?.key;
  return entries.filter((e) => e.type === type).sort((a, b) => dateKey ? String(a.fields?.[dateKey] || "9999").localeCompare(String(b.fields?.[dateKey] || "9999"))
    : (a.sort_order - b.sort_order) || a.title.localeCompare(b.title));
}
export const lineName = (id?: string) => bundle.service_lines.find((l) => l.id === id)?.name || "";
export const accountName = (id?: string) => (id ? bundle.accounts?.[id]?.name || "" : "");
export const category = (id: string) => bundle.categories.find((c) => c.id === id);
export const routes = { service: "service", case_study: "case-studies", post: "insights", job: "careers", landing: "lp", ...(settings.routes || {}) };

/** "entry:<id>" → that entry's path; "#x", "/x", "https://…", "mailto:" and "tel:" pass through. */
export function href(h?: string): string {
  if (!h) return "#";
  if (h.startsWith("entry:")) return entryById(h.slice(6))?.path || "#";
  return safeHref(h);
}
/** Only web, mail, phone, page and in-page links reach the HTML: "javascript:", "data:" and the like become "#". */
export function safeHref(h: string): string {
  const v = String(h || "").trim();
  if (!v) return "#";
  if (/^(https?:|mailto:|tel:|#|\/(?!\/)|\.{0,2}\/|\?)/i.test(v)) return v;
  if (/^\/\//.test(v)) return "https:" + v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return "#";
  return v;   // a relative address such as "contact/"
}
export const menuHref = (m: MenuItem) => (m.entry ? entryById(m.entry)?.path || "#" : safeHref(m.url || "#"));
export const isExternal = (h: string) => /^https?:\/\//i.test(h) && !(site.live_url && h.startsWith(site.live_url));

export function absolute(path: string) {
  const base = (site.url || "").replace(/\/+$/, "");
  return /^https?:/i.test(path) ? path : base + path;
}

const ALLOWED = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "h2", "h3", "h4", "blockquote", "code", "pre", "hr", "table", "thead", "tbody", "tr", "th", "td", "figure", "figcaption", "img", "span", "sup", "sub"],
  allowedAttributes: { a: ["href", "title", "target", "rel"], img: ["src", "alt", "width", "height", "loading"], th: ["colspan", "rowspan", "style"], td: ["colspan", "rowspan", "style"], p: ["style"], h2: ["style", "id"], h3: ["style", "id"], span: ["class"] },
  allowedStyles: { "*": { "text-align": [/^(left|right|center|justify)$/] } },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  transformTags: {
    a: (_tag: string, attrs: Record<string, string>) => {
      const h = href(attrs.href);
      const out: Record<string, string> = { ...attrs, href: h };
      if (isExternal(h)) { out.rel = "noopener"; }
      return { tagName: "a", attribs: out };
    },
    img: (_tag: string, attrs: Record<string, string>) => ({ tagName: "img", attribs: { ...attrs, loading: "lazy", decoding: "async" } }),
  },
};
/** Rich text from the editor, cleaned for the page. Plain text becomes paragraphs. */
export function rich(html?: string): string {
  const s = String(html || "");
  if (!s.trim()) return "";
  if (!/<[a-z!\/]/i.test(s)) return s.trim().split(/\n{2,}/).map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`).join("");
  return sanitizeHtml(s, ALLOWED as any);
}
export const plain = (html?: string) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
export const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);

/** Proof, testimonials and FAQs for a service line ("" = all). */
export const proofFor = (line?: string, kinds?: string[]) => bundle.proof.filter((p) => (!line || p.service_lines.includes(line)) && (!kinds?.length || kinds.includes(p.kind)));
export const testimonialsFor = (line?: string) => bundle.testimonials.filter((t) => !line || t.service_lines.includes(line) || !t.service_lines.length);
export const faqsFor = (line?: string, group?: string) => bundle.faqs.filter((f) => (!line || f.service_lines.includes(line)) && (!group || f.group === group));
export const caseStudies = (line?: string) => ofType("case_study").filter((c) => !line || c.service_line === line);

export function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(+d) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** Breadcrumb trail for an entry: Home › (parent pages | section index) › entry. */
export function crumbs(e: Entry): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [{ name: "Home", path: "/" }];
  if (e.path === "/") return out;
  if (e.type === "page") {
    const chain: Entry[] = [];
    let p = entryById(e.parent);
    while (p && chain.length < 5) { chain.unshift(p); p = entryById(p.parent); }
    chain.forEach((x) => out.push({ name: x.title, path: x.path }));
  } else if (e.type.startsWith("x_")) {
    const ct = contentType(e.type);
    const index = ct && entries.find((x) => x.path === "/" + ct.route + "/");
    if (index) out.push({ name: index.title, path: index.path });
    else if (ct?.archive) out.push({ name: ct.archive_title || ct.plural, path: "/" + ct.route + "/" });
  } else if (e.type !== "legal") {
    const prefix = "/" + String((routes as any)[e.type] || "").replace(/^\/+|\/+$/g, "") + "/";
    const index = entries.find((x) => x.path === prefix);
    if (index) out.push({ name: index.title, path: index.path });
  }
  out.push({ name: e.title, path: e.path });
  return out;
}

/** The questions a FAQ block shows (shared by the block and the page's FAQPage schema). */
export function resolveFaqs(d: Record<string, any>, entry?: Entry): Faq[] {
  const line = d.service_line || (entry?.type === "service" ? entry.service_line : "");
  let list: Faq[] = d.items?.length ? d.items.map((id: string) => bundle.faqs.find((f) => f.id === id)).filter(Boolean) : faqsFor(line, d.group);
  if (d.inline?.length) list = [...(d.inline as any[]).filter((x) => x && x.question).map((x, i) => ({ id: "i" + i, question: x.question, answer: x.answer || "", group: "", service_lines: [] })), ...list];
  return list.slice(0, Number(d.limit) || 30);
}
export const readingMinutes = (e: Entry) => Math.max(1, Math.round(e.blocks.reduce((n, b) => n + plain(b.data?.html || b.data?.text || "").split(/\s+/).length, 0) / 230));
