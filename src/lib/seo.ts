// Titles, descriptions and structured data (JSON-LD) for every page.
import { site, settings, absolute, media, person, plain, truncate, lineName, accountName, crumbs, rich, type Entry, type Block } from "./content";

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

function orgNode() {
  const o = settings.org || {};
  const logo = media(settings.brand?.logo);
  const sameAs = (o.socials || []).map((s: any) => s.url).filter(Boolean);
  const node: any = {
    "@type": o.schema_type || "ProfessionalService", "@id": absolute("/#organization"), name: o.name || site.name, url: absolute("/"),
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

/** JSON-LD graph for an entry: organisation, website, breadcrumbs, plus the type's own node and any FAQ block. */
export function schemaFor(e: Entry, image?: string): object {
  const url = absolute(e.path);
  const graph: any[] = [orgNode(), { "@type": "WebSite", "@id": absolute("/#website"), url: absolute("/"), name: settings.org?.name || site.name, publisher: { "@id": absolute("/#organization") } }];
  const trail = crumbs(e);
  if (trail.length > 1) graph.push({ "@type": "BreadcrumbList", itemListElement: trail.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: absolute(c.path) })) });
  const page: any = { "@type": "WebPage", "@id": url + "#webpage", url, name: pageTitle(e), description: pageDescription(e), isPartOf: { "@id": absolute("/#website") }, ...(image ? { primaryImageOfPage: image } : {}) };
  graph.push(page);
  const authors = (e.authors || []).map((id) => person(id)).filter(Boolean).map((p) => ({ "@type": "Person", name: p!.name, ...(p!.job_title ? { jobTitle: p!.job_title } : {}), ...(p!.linkedin ? { sameAs: [p!.linkedin] } : {}) }));
  if (e.type === "post" || e.type === "case_study") {
    graph.push({
      "@type": e.type === "post" ? "BlogPosting" : "Article", headline: e.title, description: pageDescription(e), mainEntityOfPage: { "@id": url + "#webpage" },
      datePublished: e.published_at, dateModified: e.updated || e.published_at, ...(image ? { image } : {}),
      author: authors.length ? authors : { "@id": absolute("/#organization") }, publisher: { "@id": absolute("/#organization") },
      ...(e.type === "case_study" && accountName(e.account) ? { about: { "@type": "Organization", name: accountName(e.account) } } : {}),
    });
  }
  if (e.type === "service") {
    graph.push({ "@type": "Service", name: e.title, description: pageDescription(e), provider: { "@id": absolute("/#organization") }, url, ...(lineName(e.service_line) ? { serviceType: lineName(e.service_line) } : {}), areaServed: settings.org?.area_served || undefined });
  }
  if (e.type === "job") {
    const f = e.fields || {};
    graph.push({ "@type": "JobPosting", title: e.title, description: rich(f.description || e.excerpt) || e.title, datePosted: e.published_at, hiringOrganization: { "@id": absolute("/#organization") },
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
