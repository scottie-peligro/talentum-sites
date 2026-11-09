// Titles, descriptions and structured data (JSON-LD) for every page.
import { site, settings, bundle, absolute, media, person, plain, truncate, lineName, accountName, crumbs, rich, section, type Entry, type Block, type Person } from "./content";

export function pageTitle(e: Entry) {
  const t = e.seo?.title || (e.path === "/" ? settings.seo?.home_title || e.title : e.title);
  const suffix = settings.seo?.title_suffix || "";
  return (e.seo?.title || e.path === "/") ? t : t + suffix;
}
export function pageDescription(e: Entry) {
  if (e.seo?.description) return e.seo.description;
  if (e.excerpt) return truncate(plain(e.excerpt), 160);
  for (const b of e.blocks || []) {
    const t = plain(b.data?.text || b.data?.html || b.data?.lede || "");
    if (t.length > 60) return truncate(t, 160);
  }
  return settings.seo?.default_description || "";
}
export function ogImageId(e: Entry) {
  return e.seo?.og_image || e.featured_image || (e.blocks || []).find((b) => b.type === "hero" && b.data?.image)?.data.image || settings.seo?.default_og_image || "";
}

// Every entity keeps ONE @id across the whole site (the organisation, the website, each person), so search engines and
// AI assistants can join what different pages say about it. A page's graph only references @ids it also defines.
export const ORG_ID = () => absolute("/#organization");
const httpUrl = (u: any) => typeof u === "string" && /^https?:\/\/[^\s"<>]+\.[^\s"<>]+$/i.test(u.trim()) ? u.trim() : "";
const uniq = (l: string[]) => [...new Set(l.filter(Boolean))];

/** The organisation's profiles elsewhere: Settings → Organisation → Social profiles (+ the X/Twitter handle). */
export function orgSameAs(): string[] {
  const o = settings.org || {};
  const handle = String(o.twitter || "").trim().replace(/^@/, "");
  return uniq([...(o.socials || []).map((s: any) => httpUrl(s?.url)), /^[A-Za-z0-9_]{1,15}$/.test(handle) ? "https://x.com/" + handle : httpUrl(o.twitter)]);
}

const slugOf = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "person";
let personIds: Map<string, string> | null = null;
/** A person's site-wide @id, from their name (ids from Talentum never appear on the site); same name twice → -2, -3. */
export function personId(p: Person): string {
  if (!personIds) {
    personIds = new Map();
    const taken = new Set<string>();
    const all = [...bundle.team || [], ...Object.values(bundle.users || {})].filter(Boolean) as Person[];
    for (const x of all.sort((a, b) => a.id.localeCompare(b.id))) {
      if (personIds.has(x.id)) continue;
      const base = slugOf(x.name || "person");
      let k = base, n = 2;
      while (taken.has(k)) k = base + "-" + n++;
      taken.add(k); personIds.set(x.id, k);
    }
  }
  return absolute("/#person-" + (personIds.get(p.id) || slugOf(p.name)));
}

/** schema.org Person for a published team member. `image` = an absolute URL of their photo (built by the page). */
export function personNode(p: Person, image?: string) {
  const sameAs = uniq([httpUrl(p.linkedin), ...((p as any).profiles || []).map((x: any) => httpUrl(typeof x === "string" ? x : x?.url))]);
  return { "@type": "Person", "@id": personId(p), name: p.name, ...(p.job_title ? { jobTitle: p.job_title } : {}), ...(image ? { image } : {}),
    worksFor: { "@id": ORG_ID() }, ...(sameAs.length ? { sameAs } : {}) };
}

/** Blocks on a page, including those inside containers and global sections. */
function walk(blocks: Block[] = [], out: Block[] = [], depth = 0): Block[] {
  for (const b of blocks) {
    if (!b || b.hidden) continue;
    out.push(b);
    if (depth > 4) continue;
    if (b.type === "container") for (const c of (Array.isArray(b.data?.cols) ? b.data.cols : [])) walk(c?.blocks || [], out, depth + 1);
    if (b.type === "section_ref") walk(section(b.data?.key) || [], out, depth + 1);
  }
  return out;
}

/** The people a page's structured data describes: its authors, the members of any Team block, and (home page) the team. */
export function peopleFor(e: Entry, blocks: Block[] = e.blocks || []): Person[] {
  const ids = new Map<string, Person>();
  const add = (p?: Person | null) => { if (p && p.id && p.name && !ids.has(p.id)) ids.set(p.id, p); };
  for (const id of e.authors || []) add(person(id));
  for (const b of walk(blocks)) if (b.type === "team_grid") {
    const list = b.data?.members?.length ? b.data.members.map((id: string) => person(id)) : bundle.team || [];
    list.forEach(add);
  }
  if (e.path === "/" && !e.translation_of) (bundle.team || []).forEach(add);
  return [...ids.values()];
}

function orgNode() {
  const o = settings.org || {};
  const logo = media(settings.brand?.logo);
  const sameAs = orgSameAs();
  const node: any = {
    "@type": o.schema_type || "ProfessionalService", "@id": ORG_ID(), name: o.name || site.name, url: absolute("/"),
    ...(o.legal_name ? { legalName: o.legal_name } : {}), ...(o.description ? { description: o.description } : {}),
    ...(o.phone ? { telephone: o.phone } : {}), ...(o.email ? { email: o.email } : {}),
    ...(logo ? { logo: absolute("/logo." + (logo.file.split(".").pop() || "png")) } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
  if (o.street || o.address) {
    node.address = { "@type": "PostalAddress", streetAddress: o.street || o.address, addressLocality: o.city || undefined, addressRegion: o.region || undefined, postalCode: o.postal || undefined, addressCountry: o.country || undefined };
  }
  return node;
}

/** JSON-LD graph for an entry: organisation, website, breadcrumbs, the people on it, plus the type's own node.
 *  `blocks` = what the page shows (its blocks + automatic ones), `photos` = person id → absolute photo URL. */
export function schemaFor(e: Entry, image?: string, blocks?: Block[], photos: Record<string, string> = {}): object {
  const url = absolute(e.path);
  const graph: any[] = [orgNode(), { "@type": "WebSite", "@id": absolute("/#website"), url: absolute("/"), name: settings.org?.name || site.name, publisher: { "@id": ORG_ID() } }];
  const trail = crumbs(e);
  if (trail.length > 1) graph.push({ "@type": "BreadcrumbList", itemListElement: trail.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: absolute(c.path) })) });
  const page: any = { "@type": "WebPage", "@id": url + "#webpage", url, name: pageTitle(e), description: pageDescription(e), isPartOf: { "@id": absolute("/#website") }, ...(image ? { primaryImageOfPage: image } : {}) };
  graph.push(page);
  const people = peopleFor(e, blocks || e.blocks || []);
  for (const p of people) graph.push(personNode(p, photos[p.id]));
  const authors = (e.authors || []).map((id) => person(id)).filter((p) => p && p.name).map((p) => ({ "@id": personId(p!) }));
  if (authors.length && e.type !== "post" && e.type !== "case_study") page.author = authors;
  if (e.type === "post" || e.type === "case_study") {
    graph.push({
      "@type": e.type === "post" ? "BlogPosting" : "Article", "@id": url + "#article", headline: e.title, description: pageDescription(e), mainEntityOfPage: { "@id": url + "#webpage" },
      datePublished: e.published_at, dateModified: e.updated || e.published_at, ...(image ? { image } : {}),
      author: authors.length ? authors : { "@id": ORG_ID() }, publisher: { "@id": ORG_ID() },
      ...(e.type === "case_study" && accountName(e.account) ? { about: { "@type": "Organization", name: accountName(e.account) } } : {}),
    });
  }
  if (e.type === "service") {
    graph.push({ "@type": "Service", name: e.title, description: pageDescription(e), provider: { "@id": ORG_ID() }, url, ...(lineName(e.service_line) ? { serviceType: lineName(e.service_line) } : {}), areaServed: settings.org?.area_served || undefined });
  }
  if (e.type === "job") {
    const f = e.fields || {};
    graph.push({ "@type": "JobPosting", title: e.title, description: rich(f.description || e.excerpt) || e.title, datePosted: e.published_at, hiringOrganization: { "@id": ORG_ID() },
      employmentType: f.employment_type || undefined, ...(f.location ? { jobLocation: { "@type": "Place", address: f.location } } : {}), ...(f.remote ? { jobLocationType: "TELECOMMUTE" } : {}) });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

/** FAQPage node when a page carries FAQ blocks (Google shows these only for authoritative sites, but AI search reads them). */
export function faqSchema(items: { question: string; answer: string }[]) {
  if (!items.length) return null;
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: items.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: plain(f.answer) } })) };
}

export const visibleBlocks = (blocks: Block[] = []) => blocks.filter((b) => !b.hidden);

/** VideoObject for a page's overview video. Google needs a name, a thumbnail and an upload date; the transcript lets
 *  search engines and AI assistants read what the video says. */
export function videoSchema(v: import("./next").VideoInfo, e: Entry, thumb?: string) {
  if (!thumb) return null;
  const node: any = {
    "@context": "https://schema.org", "@type": "VideoObject", name: v.title, description: v.description || v.title,
    thumbnailUrl: [thumb], uploadDate: v.uploaded, ...(v.duration ? { duration: `PT${Math.floor(v.duration / 60)}M${v.duration % 60}S` } : {}),
    ...(v.file ? { contentUrl: absolute(v.file) } : v.embed ? { embedUrl: v.embed.split("?")[0] } : {}),
    ...(v.transcript ? { transcript: truncate(plain(v.transcript), 5000) } : {}),
    isPartOf: { "@id": absolute(e.path) + "#webpage" },
  };
  if (v.chapters.length) node.hasPart = v.chapters.map((c, i) => ({ "@type": "Clip", name: c.label, startOffset: c.at, ...(v.chapters[i + 1] ? { endOffset: v.chapters[i + 1].at } : v.duration ? { endOffset: v.duration } : {}), url: absolute(e.path) + "#t=" + c.at }));
  return node;
}
