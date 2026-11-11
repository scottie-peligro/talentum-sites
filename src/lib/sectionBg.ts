// A section's height and its photo / looping video / slideshow background, shared by the Hero and the Container
// (components/SectionBg.astro draws it). Every value is checked here because it ends up in an inline style.
//   min_height: none | s | m | l | 50 | 75 | 90 | 100 (% of the screen) | screen (the screen, up to 60rem) | custom
//   min_height_custom: 10–100 (% of the screen)    valign: top | center | bottom
//   bg_type: image | video | slideshow (a container also has none | color | gradient, drawn by Container.astro)
//   bg_image, bg_video + bg_poster, bg_images (2–8 slides) · bg_effect: fade | zoom | zoom_out | slide · bg_interval (s)
//   bg_fit: cover | contain | none · bg_pos: focal ("") or centre / a side / a corner · bg_fill: colour around it
//   bg_parallax: "" | subtle | strong · overlay_color + overlay (0–95%): a tint over the picture
import { media } from "./content";
import { assetUrl } from "./images";

const hex = (v: any) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : "");
const num = (v: any, lo: number, hi: number, fb: number) => { const n = Number(v); return v !== "" && v !== null && v !== undefined && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fb; };

const FIXED: Record<string, string> = { s: "20rem", m: "32rem", l: "44rem", screen: "min(100dvh, 60rem)" };
const POS: Record<string, string> = {
  center: "50% 50%", top: "50% 0%", bottom: "50% 100%", left: "0% 50%", right: "100% 50%",
  "top-left": "0% 0%", "top-right": "100% 0%", "bottom-left": "0% 100%", "bottom-right": "100% 100%",
};
const PARALLAX: Record<string, number> = { subtle: 0.15, strong: 0.3 };
const EFFECTS = ["fade", "zoom", "zoom_out", "slide"];

/** The section's least height as CSS ("" = fit the content). Screen shares use svh (the screen without a phone's bars). */
export function sectionHeight(d: Record<string, any>): string {
  const h = String(d.min_height ?? "");
  if (FIXED[h]) return FIXED[h];
  if (h === "50" || h === "75" || h === "90" || h === "100") return `${h}svh`;
  if (h === "custom") { const n = num(d.min_height_custom, 10, 100, 0); return n ? `${n}svh` : ""; }
  return "";
}
/** Where the content sits in a section taller than it: start | center | end. */
export function sectionAlign(d: Record<string, any>): string {
  return ({ top: "start", center: "center", bottom: "end" } as Record<string, string>)[d.valign] || "center";
}

export type SectionBg = {
  kind: "image" | "video" | "slideshow";
  image?: string; video?: string; poster?: string; slides?: string[];
  fit: "cover" | "contain" | "none"; pos: string; fill: string; parallax: number;
  effect: string; ms: number; overlay: string;
};
/** The photo / video / slideshow behind a section, or null when it has none (or nothing usable is picked). */
export function sectionBg(d: Record<string, any>): SectionBg | null {
  const kind = d.bg_type;
  if (kind !== "image" && kind !== "video" && kind !== "slideshow") return null;
  const fit = d.bg_fit === "contain" || d.bg_fit === "none" ? d.bg_fit : "cover";
  const bg: SectionBg = {
    kind, fit, pos: POS[d.bg_pos] || "", fill: fit !== "cover" ? hex(d.bg_fill) : "", parallax: PARALLAX[d.bg_parallax] || 0,
    effect: EFFECTS.includes(d.bg_effect) ? d.bg_effect : "fade", ms: Math.round(num(d.bg_interval, 3, 30, 6) * 1000),
    overlay: `${hex(d.overlay_color) || "#011e2f"}${Math.round(num(d.overlay, 0, 95, 55) * 2.55).toString(16).padStart(2, "0")}`,
  };
  if (kind === "image") { if (!media(d.bg_image)) return null; bg.image = d.bg_image; }
  if (kind === "video") {
    const v = media(d.bg_video), p = media(d.bg_poster);
    bg.video = v ? assetUrl(v.file) || "" : "";
    bg.poster = p ? assetUrl(p.file) || "" : "";
    if (!bg.video && !bg.poster) return null;
  }
  if (kind === "slideshow") {
    bg.slides = (Array.isArray(d.bg_images) ? d.bg_images : []).filter((id: string) => media(id)).slice(0, 8);
    if (!bg.slides.length) return null;
  }
  return bg;
}
