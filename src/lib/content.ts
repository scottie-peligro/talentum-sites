import sanitizeHtml from "sanitize-html";
import { currentLang, setLang, t } from "./i18n";
export { currentLang, setLang, t };

export type Link = { label?: string; href?: string; style?: string; new_tab?: boolean };
export type Block = { id: string; type: string; hidden?: boolean; data: Record<string, any> };
export type Entry = {
  id: string; type: "page" | "service" | "case_study" | "post" | "job" | "legal" | "landing" | `x_${string}`; title: string; slug: string; path: string;
  blocks: Block[]; excerpt: string; featured_image: string; authors: string[]; categories: string[]; tags: string[];
  service_line: string; account: string; fields: Record<string, any>; seo: Record<string, any>; parent: string; sort_order: number;
  published_at: string; updated: string;
  /** Translations only (Talentum → Translate a site): the language and the original entry's id. */
  lang?: string; translation_of?: string;
};
export type Media = { id: string; url: string; file: string; raster: boolean; name: string; alt: string; caption: string; credit: string; focal: { x: number; y: number } | null; width: number; height: number; mime: string };
export type Person = { id: string; name: string; job_title: string; photo: string; photo_file?: string; linkedin: string;
  /** The website's own people (Talentum → Website → Team) carry their details too. */
  site_person?: boolean; group?: string; email?: string; phone?: string; booking_url?: string; location?: string; specialties?: string; bio?: string; page?: string };
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

// ---------------------------------------------------------------------------------------------------------------
// Languages (Talentum → Website → Settings → Languages). A translation is its own entry (lang + translation_of) at
// "/<prefix>/…". While a page in another language renders, setLang(code) makes links, lists, menus, global sections
// and the built-in wording (lib/i18n.ts) use that language, falling back to the original where nothing is translated.
// A site without translations renders exactly as before.
// ---------------------------------------------------------------------------------------------------------------
export type Lang = { code: string; label: string; prefix: string };
// Custom content types and parent pages (Talentum → Website: any page can be a "parent page" with items under it).
// Custom kinds' items have type "x_<key>"; a parent page of a built-in kind (Services, Insights…) keeps that type.
export type CardDesign = { layout?: string; columns?: string; image_ratio?: string; style?: string; show_image?: boolean; show_excerpt?: boolean; show_date?: boolean;
  show_category?: boolean; fields?: string[]; read_more?: string; per_page?: number; sort?: string; empty?: string };
export type ContentType = { key: string; label: string; plural: string; route: string; archive: boolean; archive_title: string; archive_intro: string; show_fields: boolean;
  fields: { key: string; label: string; type: string; options: string[] }[];
  kind?: string; page?: string; card?: CardDesign; filter?: { categories?: boolean; bar?: boolean; all_label?: string }; auto_list?: boolean };

import { onSiteChange as __onSite, currentBundle } from "./live";

// Everything below is worked out from the website being rendered (lib/live.ts): once in a build, again whenever the
// editor's Live view switches website.
function __make(raw: any) {
  const bundle = raw as unknown as Bundle;
  const site = bundle.site;
  const settings = site.settings || {};
  const isStaging = site.environment !== "live";
  /** Every page in the bundle, translations included (what gets built). */
  const allEntries = bundle.entries;
  const langCfg = (settings.languages || {}) as { default?: string; default_label?: string; extra?: Lang[]; switcher?: boolean };
  const defaultLang: string = langCfg.default || "en";
  const defaultLangLabel: string = langCfg.default_label || "English";
  const extraLangs: Lang[] = Array.isArray(langCfg.extra) ? langCfg.extra.filter((l) => l && l.code && l.prefix) : [];
  /** True when the site has at least one published translation. */
  const translated = extraLangs.length > 0 && allEntries.some((e) => e.translation_of && e.lang);
  const switcherOn = translated && langCfg.switcher !== false;
  /** The site's pages in its main language (translations are reached through inLang). */
  const entries = translated ? allEntries.filter((e) => !e.translation_of) : allEntries;
  const trans = new Map<string, Record<string, Entry>>();
  if (translated) for (const e of allEntries) if (e.translation_of && e.lang) trans.set(e.translation_of, { ...(trans.get(e.translation_of) || {}), [e.lang]: e });
  const byPath = new Map(entries.map((e) => [e.path, e]));
  // The header button and footer wording in the current language (settings.languages.ui[<code>].header_cta / footer_text /
  // footer_button), read wherever settings.header_cta / settings.footer are. Only on translated sites.
  if (translated) {
    const base = { header_cta: settings.header_cta, footer: settings.footer };
    const own = (k: string): string => { const c = currentLang(); const v = c ? (langCfg as any).ui?.[c]?.[k] : ""; return typeof v === "string" ? v.trim() : ""; };
    Object.defineProperty(settings, "header_cta", { configurable: true, enumerable: true, get: () => (own("header_cta") ? { ...(base.header_cta || {}), label: own("header_cta") } : base.header_cta) });
    Object.defineProperty(settings, "footer", { configurable: true, enumerable: true, get: () => ({ ...(base.footer || {}), ...(own("footer_text") ? { text: own("footer_text") } : {}), ...(own("footer_button") ? { button_label: own("footer_button") } : {}) }) });
  }

  const byId = new Map(allEntries.map((e) => [e.id, e]));
  const entryById = (id?: string) => (id ? byId.get(id) : undefined);
  /** The version of an entry in `code` (default: the current page's language), else the original. */
  function inLang(e: Entry, code = currentLang()): Entry {
    if (!translated) return e;
    const orig = e.translation_of ? byId.get(e.translation_of) || e : e;
    return (code && trans.get(orig.id)?.[code]) || orig;
  }
  /** An entry picked by id (in a block), in the current page's language when it's translated. */
  const pickEntry = (id?: string) => { const e = entryById(id); return e ? inLang(e) : undefined; };
  const loc = (list: Entry[]) => (currentLang() ? list.map((e) => inLang(e)) : list);
  /** Every language version of an entry: [{ code, hreflang, label, path, current }], main language first ([] on a one-language site). */
  function versionsOf(e: Entry) {
    if (!translated) return [];
    const orig = e.translation_of ? byId.get(e.translation_of) : e;
    if (!orig) return [];
    const t = trans.get(orig.id) || {};
    return [{ code: "", hreflang: defaultLang, label: defaultLangLabel, path: orig.path, current: !e.translation_of },
      ...extraLangs.filter((l) => t[l.code]).map((l) => ({ code: l.code, hreflang: l.code, label: l.label, path: t[l.code].path, current: e.lang === l.code }))];
  }
  /** A site address in the current language: "/contact/" → "/es/contacto/" when that page is translated. */
  function localPath(h: string): string {
    if (!currentLang() || !h.startsWith("/")) return h;
    const m = h.match(/^([^?#]*)(.*)$/)!;
    const e = byPath.get(m[1]);
    return e ? inLang(e).path + m[2] : h;
  }
  /** A menu in the current language ("header:es"), else the main one. */
  const menu = (key: string): MenuItem[] => (currentLang() && bundle.menus?.[key + ":" + currentLang()]) || bundle.menus?.[key] || [];
  /** A global section in the current language ("cta:es"), else the main one. */
  const section = (key?: string): Block[] | undefined => (key ? (currentLang() && bundle.sections?.[key + ":" + currentLang()]) || bundle.sections?.[key] : undefined);

  const ofType = (t: Entry["type"]) => loc(entries.filter((e) => e.type === t).sort((a, b) => (a.sort_order - b.sort_order) || a.title.localeCompare(b.title)));
  const posts = () => loc(entries.filter((e) => e.type === "post").sort((a, b) => (b.published_at || "").localeCompare(a.published_at || "")));
  const media = (id?: string) => (id ? bundle.media[id] : undefined);
  const person = (id?: string) => (id ? bundle.users?.[id] : undefined);
  const bookingLink = (id?: string) => (id ? bundle.booking_links?.find((l) => l.id === id) : undefined);
  /** A booking choice → where it goes, the embeddable version, and who it's with. `booking_link` (picked in Talentum) wins over a pasted `booking_url`. */
  function resolveBooking(d: { booking_link?: string; booking_url?: string; member?: string | string[] }) {
    const link = bookingLink(d.booking_link);
    const url = link?.url || (d.booking_url && !foreignBooking(d.booking_url) ? href(d.booking_url) : "");
    if (!url) return null;
    const memberId = (Array.isArray(d.member) ? d.member[0] : d.member) || link?.user;
    const embed = /^https?:\/\//.test(url) ? url + (url.includes("?") ? "&" : "?") + "embed=1&src=website" : "";
    return { url, embed, who: person(memberId), duration: link?.duration || 0, title: link?.title || "" };
  }
  const contentTypes: ContentType[] = Array.isArray((settings as any).content_types) ? (settings as any).content_types : [];
  /** The type key of a content type's items: "x_<key>", or the built-in type for a built-in kind. */
  const typeKey = (t: ContentType) => (t.kind && t.kind !== "custom" ? t.kind : "x_" + t.key);
  /** A custom content type (type "x_<key>"). */
  const contentType = (type?: string) => (type && type.startsWith("x_") ? contentTypes.find((t) => "x_" + t.key === type) : undefined);
  /** The parent page settings for any kind of item (custom or built-in), if it has any. */
  const parentOf = (type?: string) => (type ? contentTypes.find((t) => typeKey(t) === type) : undefined);
  /** The parent page entry for a kind of item (in the current language), if it's on the site. */
  function parentPage(type?: string): Entry | undefined {
    const ct = parentOf(type);
    const e = ct?.page ? byId.get(ct.page) : undefined;
    return e && !e.translation_of ? inLang(e) : undefined;
  }
  // The parent page lists its items under its own blocks (its Card design), unless it already lists them itself.
  const OWN_LISTS: Record<string, string[]> = { service: ["service_cards", "service_groups"], case_study: ["case_study_cards"], post: ["posts_list"], job: ["jobs_list"] };
  function listsItself(blocks: Block[] = [], type: string): boolean {
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === "content_cards" && (b.data?.content_type || "post") === type) return true;
      if ((OWN_LISTS[type] || []).includes(b.type)) return true;
      if (b.type === "container") for (const c of b.data?.cols || []) if (listsItself(c?.blocks || [], type)) return true;
    }
    return false;
  }
  /** The Content cards block a parent page gets for its items. */
  function parentListBlock(ct: ContentType, heading = ""): Block {
    const c = ct.card || {};
    const type = typeKey(ct);
    const dateKey = ct.fields.find((f) => f.type === "date")?.key || "";
    const bar = !!ct.filter?.bar;
    return { id: "pp-list", type: "content_cards", data: {
      content_type: type, all: true, per_page: bar ? 0 : Number(c.per_page ?? 12) || 0, design: "parent", filter_bar: bar, heading,
      sort: c.sort || (dateKey ? "date_asc" : type === "post" ? "newest" : "manual"), date_field: dateKey, empty: c.empty || "" } } as Block;
  }
  for (const ct of contentTypes) {
    if (!ct.page || ct.auto_list === false) continue;
    const type = typeKey(ct);
    for (const e of allEntries) {
      if (e.id !== ct.page && e.translation_of !== ct.page) continue;
      if (listsItself(e.blocks, type)) continue;
      const shown = (e.blocks || []).filter((b) => b && !b.hidden);
      e.blocks = [...(e.blocks || []), parentListBlock(ct, shown.length ? "" : e.title)];
    }
  }
  /** A type's entries, soonest date first when it has a date field, otherwise by order then title. */
  function entriesOf(type: string) {
    const ct = contentType(type);
    const dateKey = ct?.fields.find((f) => f.type === "date")?.key;
    return loc(entries.filter((e) => e.type === type).sort((a, b) => dateKey ? String(a.fields?.[dateKey] || "9999").localeCompare(String(b.fields?.[dateKey] || "9999"))
      : (a.sort_order - b.sort_order) || a.title.localeCompare(b.title)));
  }
  // Content cards (blocks/ContentCards.astro, Talentum's "Content cards" block): the entries one block lists.
  // Unpaged "Show all" stops at CARD_CAP cards (one long page); a paged one (a number per page, or a type's listing page)
  // can list up to PAGED_CAP, spread over its pages.
  const CARD_CAP = 200;
  const PAGED_CAP = 2400;
  /** The entries a Content cards block shows (all of them, before paging), in the current language. */
  function cardEntries(d: Record<string, any>, exclude?: string): Entry[] {
    const type = String(d.content_type || "post");
    const ct = parentOf(type);
    const dateKey = ct ? String(d.date_field || ct.fields.find((f) => f.type === "date")?.key || "") : "";
    const today = new Date().toISOString().slice(0, 10);
    let list = entries.filter((e) => e.type === type && e.id !== exclude);
    if (d.category) list = list.filter((e) => (e.categories || []).includes(d.category));
    if ((type === "service" || type === "case_study") && d.service_line) list = list.filter((e) => e.service_line === d.service_line);
    if (ct && d.filter_field && d.filter_value) list = list.filter((e) => String(e.fields?.[d.filter_field] ?? "") === String(d.filter_value));
    if (ct && d.featured_field) list = list.filter((e) => e.fields?.[d.featured_field] === true || e.fields?.[d.featured_field] === "true");
    const isDate = (d.sort === "date_asc" || d.sort === "date_desc") && !!dateKey;
    if (isDate && d.upcoming) list = list.filter((e) => String(e.fields?.[dateKey] || "").slice(0, 10) >= today);
    const pub = (e: Entry) => e.published_at || "";
    const by: Record<string, (a: Entry, b: Entry) => number> = {
      newest: (a, b) => pub(b).localeCompare(pub(a)) || a.title.localeCompare(b.title),
      oldest: (a, b) => pub(a).localeCompare(pub(b)) || a.title.localeCompare(b.title),
      title: (a, b) => a.title.localeCompare(b.title),
      manual: (a, b) => (a.sort_order - b.sort_order) || a.title.localeCompare(b.title),
      date_asc: (a, b) => String(a.fields?.[dateKey] || "9999").localeCompare(String(b.fields?.[dateKey] || "9999")),
      date_desc: (a, b) => String(b.fields?.[dateKey] || "").localeCompare(String(a.fields?.[dateKey] || "")),
    };
    list = list.slice().sort(by[isDate ? d.sort : d.sort === "date_asc" || d.sort === "date_desc" ? "newest" : d.sort] || by.newest);
    list = list.slice(0, d.all ? (Number(d.per_page) > 0 ? PAGED_CAP : CARD_CAP) : Math.max(1, Math.min(48, Number(d.limit) || 6)));
    return loc(list);
  }
  /** How many pages a paged Content cards block needs (1 = no paging). */
  function cardPages(d: Record<string, any>, exclude?: string): number {
    const per = d.all ? Number(d.per_page) || 0 : 0;
    return per > 0 ? Math.max(1, Math.ceil(cardEntries(d, exclude).length / per)) : 1;
  }
  /** The first Content cards block on a page that pages (containers too): it gets the /page/2/… addresses. Any other
   *  paged Content cards block on that page (a second one, or one in a global section) shows its first page only. */
  function pagedCards(blocks: Block[] = []): Block | undefined {
    for (const b of blocks) {
      if (!b || b.hidden) continue;
      if (b.type === "content_cards" && b.data?.all && Number(b.data?.per_page) > 0) return b;
      if (b.type === "container") for (const col of b.data?.cols || []) { const x = pagedCards(col?.blocks || []); if (x) return x; }
    }
    return undefined;
  }
  // Which page of the paged block is being built (set by [...path].astro before each page renders, like setLang).
  let cardsPageNo = 1, cardsPagedId = "";
  function setCardsPage(n: number, blockId: string) { cardsPageNo = n; cardsPagedId = blockId; }
  const cardsPage = (blockId: string) => (blockId && blockId === cardsPagedId ? cardsPageNo : 1);
  const lineName = (id?: string) => bundle.service_lines.find((l) => l.id === id)?.name || "";
  const accountName = (id?: string) => (id ? bundle.accounts?.[id]?.name || "" : "");
  const category = (id: string) => bundle.categories.find((c) => c.id === id);
  const routes = { service: "service", case_study: "case-studies", post: "insights", job: "careers", landing: "lp", ...(settings.routes || {}) };

  /** "entry:<id>" → that entry's path; "#x", "/x", "https://…", "mailto:" and "tel:" pass through. */
  function href(h?: string): string {
    if (!h) return "#";
    if (h.startsWith("entry:")) { const e = entryById(h.slice(6)); return e ? inLang(e).path : "#"; }
    return currentLang() ? localPath(safeHref(h)) : safeHref(h);
  }
  // Booking pages (Talentum's /book/<slug>) this site offers: a client's site carries only the client's own links, the
  // agency's site only the agency's. A pasted booking address for any other link (say the agency's, on a client's site)
  // goes to the contact page instead.
  const bookingBase = String((bundle as any).booking_base || "").replace(/\/+$/, "");
  const bookingSlugs = new Set((bundle.booking_links || []).map((l) => l.slug));
  /** Is this a Talentum booking page this site doesn't offer? */
  function foreignBooking(u?: string): boolean {
    const v = String(u || "").trim();
    if (!bookingBase || !v.startsWith(bookingBase + "/book/")) return false;
    const slug = v.slice(bookingBase.length + 6).split(/[?#/]/)[0];
    if (!slug || slug === "m" || slug === "route") return false;
    return !bookingSlugs.has(slug);
  }
  /** The site's contact page ("" when it has none) — where booking buttons go when the site has no booking link. */
  function contactPath(): string {
    const e = entries.find((x) => x.type === "page" && /^\/?contact(-us)?\/?$/.test(x.path.replace(/^\/[a-z]{2}\//, "/")));
    return e ? inLang(e).path : "";
  }
  /** Only web, mail, phone, page and in-page links reach the HTML: "javascript:", "data:" and the like become "#". */
  function safeHref(h: string): string {
    let v = String(h || "").trim();
    if (!v) return "#";
    if (foreignBooking(v)) v = contactPath() || "#";
    if (/^(https?:|mailto:|tel:|#|\/(?!\/)|\.{0,2}\/|\?)/i.test(v)) return v;
    if (/^\/\//.test(v)) return "https:" + v;
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return "#";
    return v;   // a relative address such as "contact/"
  }
  const menuHref = (m: MenuItem) => (m.entry ? (entryById(m.entry) ? inLang(entryById(m.entry)!).path : "#") : currentLang() ? localPath(safeHref(m.url || "#")) : safeHref(m.url || "#"));
  const isExternal = (h: string) => /^https?:\/\//i.test(h) && !(site.live_url && h.startsWith(site.live_url));

  function absolute(path: string) {
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
  function rich(html?: string): string {
    const s = String(html || "");
    if (!s.trim()) return "";
    if (!/<[a-z!\/]/i.test(s)) return s.trim().split(/\n{2,}/).map((p) => `<p>${escape(p).replace(/\n/g, "<br>")}</p>`).join("");
    return sanitizeHtml(s, ALLOWED as any);
  }
  const plain = (html?: string) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s);

  /** Proof, testimonials and FAQs for a service line ("" = all). */
  const proofFor = (line?: string, kinds?: string[]) => bundle.proof.filter((p) => (!line || p.service_lines.includes(line)) && (!kinds?.length || kinds.includes(p.kind)));
  const testimonialsFor = (line?: string) => bundle.testimonials.filter((t) => !line || t.service_lines.includes(line) || !t.service_lines.length);
  const faqsFor = (line?: string, group?: string) => bundle.faqs.filter((f) => (!line || f.service_lines.includes(line)) && (!group || f.group === group));
  const caseStudies = (line?: string) => ofType("case_study").filter((c) => !line || c.service_line === line);

  function formatDate(iso?: string) {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(+d) ? "" : d.toLocaleDateString(currentLang() || "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  }

  /** Breadcrumb trail for an entry: Home › (parent pages | section index) › entry. */
  function crumbs(e: Entry): { name: string; path: string }[] {
    const out: { name: string; path: string }[] = [{ name: currentLang() ? t("home") : "Home", path: currentLang() ? localPath("/") : "/" }];
    if (e.path === "/" || e.path === out[0].path) return out;
    if (e.type === "page") {
      const chain: Entry[] = [];
      let p = entryById(e.parent);
      while (p && chain.length < 5) { chain.unshift(inLang(p)); p = entryById(p.parent); }
      chain.forEach((x) => out.push({ name: x.title, path: x.path }));
    } else if (parentPage(e.type)) {
      const p = parentPage(e.type)!;
      out.push({ name: p.title, path: p.path });
    } else if (e.type.startsWith("x_")) {
      const ct = contentType(e.type);
      const index = ct && entries.find((x) => x.path === "/" + ct.route + "/");
      if (index) out.push({ name: inLang(index).title, path: inLang(index).path });
      else if (ct?.archive) out.push({ name: ct.archive_title || ct.plural, path: "/" + ct.route + "/" });
    } else if (e.type !== "legal") {
      const prefix = "/" + String((routes as any)[e.type] || "").replace(/^\/+|\/+$/g, "") + "/";
      const index = prefix === "/" ? null : entries.find((x) => x.path === prefix);   // "/" = no prefix (copied WordPress addresses)
      if (index) out.push({ name: inLang(index).title, path: inLang(index).path });
    }
    out.push({ name: e.title, path: e.path });
    return out;
  }

  /** The questions a FAQ block shows (shared by the block and the page's FAQPage schema). */
  function resolveFaqs(d: Record<string, any>, entry?: Entry): Faq[] {
    const line = d.service_line || (entry?.type === "service" ? entry.service_line : "");
    let list: Faq[] = d.items?.length ? d.items.map((id: string) => bundle.faqs.find((f) => f.id === id)).filter(Boolean) : faqsFor(line, d.group);
    if (d.inline?.length) list = [...(d.inline as any[]).filter((x) => x && x.question).map((x, i) => ({ id: "i" + i, question: x.question, answer: x.answer || "", group: "", service_lines: [] })), ...list];
    return list.slice(0, Number(d.limit) || 30);
  }
  const readingMinutes = (e: Entry) => Math.max(1, Math.round(e.blocks.reduce((n, b) => n + plain(b.data?.html || b.data?.text || "").split(/\s+/).length, 0) / 230));

  return { bundle, site, settings, isStaging, allEntries, defaultLang, defaultLangLabel, extraLangs, translated, switcherOn, entries, entryById, inLang, pickEntry, versionsOf, localPath, menu, section, ofType, posts, media, person, bookingLink, resolveBooking, contentTypes, typeKey, contentType, parentOf, parentPage, parentListBlock, entriesOf, CARD_CAP, PAGED_CAP, cardEntries, cardPages, pagedCards, setCardsPage, cardsPage, lineName, accountName, category, routes, href, foreignBooking, contactPath, safeHref, menuHref, isExternal, absolute, rich, plain, escape, truncate, proofFor, testimonialsFor, faqsFor, caseStudies, formatDate, crumbs, resolveFaqs, readingMinutes };
}
const __cache = new WeakMap<object, ReturnType<typeof __make>>();
const __get = (raw: any) => { let m = __cache.get(raw); if (!m) { m = __make(raw); __cache.set(raw, m); } return m; };
let __m = __get(currentBundle());
export let bundle = __m.bundle;
export let site = __m.site;
export let settings = __m.settings;
export let isStaging = __m.isStaging;
export let allEntries = __m.allEntries;
export let defaultLang = __m.defaultLang;
export let defaultLangLabel = __m.defaultLangLabel;
export let extraLangs = __m.extraLangs;
export let translated = __m.translated;
export let switcherOn = __m.switcherOn;
export let entries = __m.entries;
export let entryById = __m.entryById;
export let inLang = __m.inLang;
export let pickEntry = __m.pickEntry;
export let versionsOf = __m.versionsOf;
export let localPath = __m.localPath;
export let menu = __m.menu;
export let section = __m.section;
export let ofType = __m.ofType;
export let posts = __m.posts;
export let media = __m.media;
export let person = __m.person;
export let bookingLink = __m.bookingLink;
export let resolveBooking = __m.resolveBooking;
export let contentTypes = __m.contentTypes;
export let typeKey = __m.typeKey;
export let contentType = __m.contentType;
export let parentOf = __m.parentOf;
export let parentPage = __m.parentPage;
export let parentListBlock = __m.parentListBlock;
export let entriesOf = __m.entriesOf;
export let CARD_CAP = __m.CARD_CAP;
export let PAGED_CAP = __m.PAGED_CAP;
export let cardEntries = __m.cardEntries;
export let cardPages = __m.cardPages;
export let pagedCards = __m.pagedCards;
export let setCardsPage = __m.setCardsPage;
export let cardsPage = __m.cardsPage;
export let lineName = __m.lineName;
export let accountName = __m.accountName;
export let category = __m.category;
export let routes = __m.routes;
export let href = __m.href;
export let foreignBooking = __m.foreignBooking;
export let contactPath = __m.contactPath;
export let safeHref = __m.safeHref;
export let menuHref = __m.menuHref;
export let isExternal = __m.isExternal;
export let absolute = __m.absolute;
export let rich = __m.rich;
export let plain = __m.plain;
export let escape = __m.escape;
export let truncate = __m.truncate;
export let proofFor = __m.proofFor;
export let testimonialsFor = __m.testimonialsFor;
export let faqsFor = __m.faqsFor;
export let caseStudies = __m.caseStudies;
export let formatDate = __m.formatDate;
export let crumbs = __m.crumbs;
export let resolveFaqs = __m.resolveFaqs;
export let readingMinutes = __m.readingMinutes;
__onSite(() => { __m = __get(currentBundle()); ({ bundle, site, settings, isStaging, allEntries, defaultLang, defaultLangLabel, extraLangs, translated, switcherOn, entries, entryById, inLang, pickEntry, versionsOf, localPath, menu, section, ofType, posts, media, person, bookingLink, resolveBooking, contentTypes, typeKey, contentType, parentOf, parentPage, parentListBlock, entriesOf, CARD_CAP, PAGED_CAP, cardEntries, cardPages, pagedCards, setCardsPage, cardsPage, lineName, accountName, category, routes, href, foreignBooking, contactPath, safeHref, menuHref, isExternal, absolute, rich, plain, escape, truncate, proofFor, testimonialsFor, faqsFor, caseStudies, formatDate, crumbs, resolveFaqs, readingMinutes } = __m); });
