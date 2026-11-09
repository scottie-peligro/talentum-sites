// The "New" layout (Website → Settings → Layout & video): helpers for the shell, the overview video and the dock.
import { settings, bundle, entryById, menuHref, href, media, plain, menu, localPath, t, type Entry, type MenuItem } from "./content";
import { assetUrl } from "./images";

const display = (settings.display || {}) as Record<string, any>;
/** "next" = the New layout; "guided" = the Guided layout, which builds on it (same dialogs, video, search, comfort). */
export const isGuided = display.layout === "guided";
export const isNext = display.layout === "next" || isGuided;
export const comfortOn = display.comfort !== false;
export const searchOn = display.search !== false;

export type Chapter = { at: number; label: string };
export type VideoInfo = {
  key: string; title: string; kind: "youtube" | "vimeo" | "stream" | "loom" | "wistia" | "heygen" | "file";
  embed: string; file: string; poster: string; posterUrl: string; captions: string; transcript: string; chapters: Chapter[];
  duration: number; durationLabel: string; uploaded: string; description: string;
};

/** "1:30", "90", "1:02:03" → seconds. */
export function seconds(v: any): number {
  if (typeof v === "number") return Math.max(0, Math.round(v));
  const parts = String(v || "").trim().split(":").map((x) => Number(x));
  if (!parts.length || parts.some((n) => !isFinite(n))) return 0;
  return parts.reduce((t, n) => t * 60 + n, 0);
}
export const clock = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : `${Math.floor(s / 60)}`) + ":" + String(s % 60).padStart(2, "0");
const iso = (s: number) => `PT${Math.floor(s / 60) ? Math.floor(s / 60) + "M" : ""}${s % 60}S`;
export const isoDuration = iso;

/** Any of: YouTube, Vimeo, Cloudflare Stream, Loom, Wistia, HeyGen, a direct .mp4/.webm link, or an uploaded file. */
export function parseVideo(url: string): { kind: VideoInfo["kind"]; embed: string; file: string; thumb: string } | null {
  const u = String(url || "").trim();
  if (!u) return null;
  let m;
  if ((m = u.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/)))
    return { kind: "youtube", embed: `https://www.youtube-nocookie.com/embed/${m[1]}?autoplay=1&rel=0&modestbranding=1`, file: "", thumb: `https://i.ytimg.com/vi/${m[1]}/hqdefault.jpg` };
  if ((m = u.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([\da-f]+))?/)))
    return { kind: "vimeo", embed: `https://player.vimeo.com/video/${m[1]}?autoplay=1&dnt=1${m[2] ? "&h=" + m[2] : ""}`, file: "", thumb: "" };
  if ((m = u.match(/^https:\/\/(customer-[a-z0-9]+\.cloudflarestream\.com)\/([a-f0-9]{32})/i)))
    return { kind: "stream", embed: `https://${m[1]}/${m[2]}/iframe?autoplay=true`, file: "", thumb: `https://${m[1]}/${m[2]}/thumbnails/thumbnail.jpg?height=720` };
  if ((m = u.match(/(?:iframe\.videodelivery\.net|watch\.cloudflarestream\.com|videodelivery\.net)\/([a-f0-9]{32})/i)))
    return { kind: "stream", embed: `https://iframe.videodelivery.net/${m[1]}?autoplay=true`, file: "", thumb: `https://videodelivery.net/${m[1]}/thumbnails/thumbnail.jpg?height=720` };
  if ((m = u.match(/loom\.com\/(?:share|embed)\/([a-f0-9]{32})/i)))
    return { kind: "loom", embed: `https://www.loom.com/embed/${m[1]}?autoplay=1&hide_owner=true`, file: "", thumb: "" };
  if ((m = u.match(/(?:wistia\.(?:com|net)\/(?:medias|embed\/iframe)\/|wi\.st\/medias\/)([a-z0-9]{6,})/i)))
    return { kind: "wistia", embed: `https://fast.wistia.net/embed/iframe/${m[1]}?autoPlay=true`, file: "", thumb: "" };
  if ((m = u.match(/app\.heygen\.com\/(?:videos|share|embeds)\/([a-f0-9]{16,})/i)))
    return { kind: "heygen", embed: `https://app.heygen.com/embeds/${m[1]}`, file: "", thumb: "" };
  if (/^https:\/\/[^\s]+\.(mp4|webm|m4v)(\?.*)?$/i.test(u)) return { kind: "file", embed: "", file: u, thumb: "" };
  return null;
}

/** The overview video for an entry: its own, or (for the home page) the site's welcome video. */
export function overviewVideo(e?: Entry | null): VideoInfo | null {
  if (!isNext) return null;
  const own = e?.fields?.overview_video;
  const isHome = e?.path === "/" || (!!e?.translation_of && entryById(e.translation_of)?.path === "/");
  const v = own && (own.url || own.file) ? own : isHome ? display.welcome_video : null;
  if (!v || !(v.url || v.file)) return null;
  // A link wins over an upload (switching an uploaded video for a YouTube link shouldn't need the upload removed).
  const linked = v.url ? parseVideo(v.url) : null;
  const up = !linked && v.file ? media(v.file) : undefined;
  const fileUrl = up ? assetUrl(up.file) || "" : "";
  const parsed = linked || (fileUrl ? { kind: "file" as const, embed: "", file: fileUrl, thumb: "" } : null);
  if (!parsed) return null;
  const cap = v.captions ? media(v.captions) : undefined;
  const dur = seconds(v.duration);
  const chapters: Chapter[] = (Array.isArray(v.chapters) ? v.chapters : []).map((c: any) => ({ at: seconds(c?.time), label: String(c?.label || "").trim() })).filter((c: Chapter) => c.label).sort((a: Chapter, b: Chapter) => a.at - b.at);
  return {
    key: (e?.id || "site") + ":" + (linked ? v.url : v.file), title: String(v.title || (isHome ? t("welcome_video") : `${e?.title || ""} — ${t("overview")}`)).trim(),
    kind: parsed.kind, embed: parsed.embed, file: parsed.file, poster: v.poster || "", posterUrl: parsed.thumb,
    captions: cap ? assetUrl(cap.file) || "" : "", transcript: String(v.transcript || "").trim(), chapters, duration: dur, durationLabel: dur ? clock(dur) : "",
    uploaded: v.uploaded || e?.published_at || bundle.generated_at, description: String(v.description || plain(e?.excerpt || "") || v.title || "").slice(0, 300),
  };
}

/** Bottom bar on phones: Home, the first two header items, the header button, Menu. */
export function dockItems(): { label: string; href: string; icon: string }[] {
  const items = menu("header") as MenuItem[];
  const out = [{ label: t("home"), href: localPath("/"), icon: "home" }];
  for (const it of items.slice(0, 2)) out.push({ label: it.label, href: menuHref(it) === "#" ? menuHref(it.children?.[0] || it) : menuHref(it), icon: iconFor(it.label) });
  const cta = settings.header_cta || {};
  if (cta.label) out.push({ label: shortLabel(cta.label), href: href(cta.url), icon: "chat" });
  return out;
}
const shortLabel = (s: string) => (s.length > 12 ? (/(contact|talk|conversation|call)/i.test(s) ? "Contact" : s.split(/\s+/)[0]) : s);
export function iconFor(label: string): string {
  const l = label.toLowerCase();
  if (/service|what we do|solution/.test(l)) return "grid";
  if (/question|faq|answer|help/.test(l)) return "question";
  if (/result/.test(l)) return "chart";
  if (/case|work|portfolio|proof/.test(l)) return "trophy";
  if (/^(home|start)/.test(l)) return "home";
  if (/insight|blog|news|article|resource/.test(l)) return "book";
  if (/about|team|who/.test(l)) return "users";
  if (/consult|strategy|plan/.test(l)) return "compass";
  if (/job|career/.test(l)) return "briefcase";
  if (/contact|talk|call/.test(l)) return "chat";
  return "dot";
}
export { entryById };

/** The right-hand panel for one page: the site's panel, with the page's own choices on top (page editor →
 *  Right-hand panel, entry.fields.panel: show "" | "show" | "hide", and any field filled in replaces the site's). */
export function panelFor(own?: Record<string, any> | null) {
  const p = { ...guided().panel };
  if (!own || typeof own !== "object") return p;
  if (own.show === "show") p.show = true; else if (own.show === "hide") p.show = false;
  const member = Array.isArray(own.member) ? own.member[0] : own.member;
  if (member) { p.member = member; if (!own.photo) p.photo = ""; }
  for (const k of ["photo", "heading", "text", "button_label"] as const) if (own[k]) (p as any)[k] = own[k];
  if (own.button_url) p.button_url = href(own.button_url);
  if (own.phone === "show") p.phone = true; else if (own.phone === "hide") p.phone = false;
  return p;
}

/** Guided layout settings (Website → Settings → Layout & video). */
export function guided() {
  const g = (display.guided || {}) as Record<string, any>;
  const cta = settings.header_cta || {};
  const bgImage = g.background_image ? media(g.background_image) : undefined;
  return {
    background: ["light", "dark", "image", "auto"].includes(g.background) ? g.background : "light",
    switcher: g.switcher !== false,
    bgImage: bgImage ? bgImage.id : "",
    search_label: g.search_label || "Ask us anything",
    // How solid pop-ups (reading comfort, search, menu) are over the photo background: 50–100 %, default solid.
    popup: Math.min(100, Math.max(50, Number(g.popup_opacity) || 100)),
    panel: {
      show: g.panel_show !== false,
      member: Array.isArray(g.panel_member) ? g.panel_member[0] || "" : g.panel_member || "",
      photo: g.panel_photo || "",
      heading: g.panel_heading || "Talk to us",
      text: g.panel_text || "",
      button_label: g.panel_button_label || cta.label || "Book a time",
      button_url: href(g.panel_button_url || cta.url || ""),
      phone: g.panel_phone !== false,
      faq_url: href(g.faq_url || ""),
      faq_label: g.faq_label || "Have a question first?",
      faq_text: g.faq_text || "Browse the answers",
    },
  };
}
