// Auto social images: which pages get a generated sharing card, and what goes on it (the drawing is lib/ogcard.mjs).
// Talentum → Website → Settings → Search engines & AI → Sharing images: settings.seo.og = { template, description, logo }.
//   template "classic" | "bold" | "minimal" | "photo" | "off". Not chosen yet: Classic, unless the site already has a
//   default sharing image (then that image stays, as before).
// A page's own sharing image (page settings → SEO) always wins. A page with a featured or hero image shares that image,
// except with the Photo look, which puts the title over it. Everything else (and every translation) gets a card.
// Only real builds draw cards: the editor's Live view (astro dev) keeps the old behaviour.
import { site, settings, media, person, lineName, category, contentType, plain, t, entryById, inLang, type Entry, type ContentType } from "./content";
import { pageDescription } from "./seo";

export type SocialCard = { url: string; width: number; height: number; alt: string };
const og = (settings.seo?.og || {}) as { template?: string; description?: boolean; logo?: boolean };
const LOOKS = ["classic", "bold", "minimal", "photo", "off"];
export const ogTemplate: string = LOOKS.includes(String(og.template)) ? String(og.template) : settings.seo?.default_og_image ? "off" : "classic";

// The site's colours: the theme's, then Brand colours, then Styles (the same order the pages use).
const THEME: Record<string, Record<string, string>> = {
  nlmc: { accent: "#7c3aed", on_accent: "#ffffff", dark: "#0b1a2e", on_dark: "#c9d2e3", heading: "#0d1526", muted: "#5a6478", background: "#ffffff", line: "#e2e6ef" },
  nlmarcom: { accent: "#025a8a", on_accent: "#ffffff", dark: "#012c44", on_dark: "#dcddde", heading: "#0a141a", muted: "#4e5a63", background: "#ffffff", line: "#dcddde" },
  default: { accent: "#0065b8", on_accent: "#ffffff", dark: "#001b2e", on_dark: "#cbd5e1", heading: "#0f172a", muted: "#64748b", background: "#ffffff", line: "#e5e7eb" },
};
const FONTS: Record<string, [string, string]> = { nlmc: ["Bricolage Grotesque", "Hanken Grotesk"], nlmarcom: ["Archivo", "Mulish"], default: ["Inter", "Inter"] };
const hex = (v: any) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const theme = THEME[site.theme] ? site.theme : "nlmc";
const colors: Record<string, string> = { ...THEME[theme] };
for (const src of [settings.brand?.colors || {}, settings.styles?.colors || {}]) for (const k of Object.keys(colors)) if (hex(src[k])) colors[k] = src[k].toLowerCase();
const sf = settings.styles?.fonts || {};
const fonts = { heading: sf.heading || FONTS[theme][0], body: sf.body || FONTS[theme][1], headingWeight: Number(sf.heading_weight) || 700 };
const logoMedia = media(settings.brand?.logo), inverseMedia = media(settings.brand?.logo_inverse);
const rasterOk = (f?: string) => !!f && /\.(svg|png|jpe?g|webp|avif|gif)$/i.test(f);
const host = (u?: string) => { try { return new URL(String(u)).host.replace(/^www\./, ""); } catch { return ""; } };
const domain = host(site.live_url) || host(site.url);
const siteName = settings.org?.name || site.name;
const showLogo = og.logo !== false, showDesc = og.description !== false;
const enabled = !import.meta.env.DEV && !(site as any).live && ogTemplate !== "off";

function base(template: string) {
  // Dark looks use the "on dark backgrounds" logo bare when there is one; otherwise (and over a photo) the logo sits on a white chip.
  const inv = template !== "minimal" && template !== "photo" && rasterOk(inverseMedia?.file);
  const logo = inv ? inverseMedia!.file : rasterOk(logoMedia?.file) ? logoMedia!.file : "";
  return { template, showLogo, logo, logoBare: inv, colors, fonts, domain, siteName };
}
async function make(o: Record<string, any>): Promise<SocialCard | null> {
  const { ogCard } = await import("./ogcard.mjs");   // build only: satori and resvg never load in the Live view
  const r = await ogCard(o);
  return r ? { url: r.path, width: r.width, height: r.height, alt: o.title } : null;
}

/** What the card says above the title: the kind of page, or the section it's in. */
function eyebrowFor(e: Entry): string {
  if (e.type === "post") return category(e.categories?.[0])?.name || t("insights");
  if (e.type === "case_study") return t("case_study");
  if (e.type === "service") return lineName(e.service_line) || t("services");
  if (e.type === "job") return t("careers");
  const ct = contentType(e.type);
  if (ct) return ct.label;
  if (e.type === "page" && e.parent) {
    let p = entryById(e.parent), top = p;
    for (let i = 0; p && i < 5; i++) { top = p; p = entryById(p.parent); }
    return top ? inLang(top).title : "";
  }
  return "";
}

/** The sharing card for an entry, or null (the page keeps its own image, or the site default). */
export async function socialCard(e: Entry): Promise<SocialCard | null> {
  if (!enabled || e.seo?.og_image) return null;
  const own = e.featured_image || (e.blocks || []).find((b) => b.type === "hero" && b.data?.image)?.data.image || "";
  const ownMedia = media(own);
  let template = ogTemplate, photo = "", focal: any = null;
  if (own) {
    if (template !== "photo" || !ownMedia?.raster || !/\.(png|jpe?g|webp|avif|gif|tiff?)$/i.test(ownMedia.file)) return null;
    photo = ownMedia.file; focal = ownMedia.focal || null;
  } else if (template === "photo") template = "classic";
  const home = e.path === "/" || (!!e.translation_of && entryById(e.translation_of)?.path === "/");
  const title = home ? (settings.seo?.home_title || siteName || e.title) : e.title;
  let description = showDesc ? (home && settings.org?.description ? plain(settings.org.description) : pageDescription(e)) : "";
  if (description && description.trim().toLowerCase() === title.trim().toLowerCase()) description = "";
  const a = e.type === "post" ? person(e.authors?.[0]) : undefined;
  const author = a ? { name: a.name, role: a.job_title || "", photo: a.photo_file && rasterOk(a.photo_file) ? a.photo_file : "" } : null;
  return make({ ...base(template), title, eyebrow: home ? "" : eyebrowFor(e), description, author, photo, focal });
}

/** The card for a content type's listing page. */
export async function listingCard(ct: ContentType): Promise<SocialCard | null> {
  if (!enabled) return null;
  const template = ogTemplate === "photo" ? "classic" : ogTemplate;
  return make({ ...base(template), title: ct.archive_title || ct.plural, eyebrow: siteName, description: showDesc ? plain(ct.archive_intro || "") : "", author: null, photo: "", focal: null });
}
