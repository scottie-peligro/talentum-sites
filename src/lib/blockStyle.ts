// A block's own styling (Talentum → block → Style tab), stored in block.data.style. Turned into CSS variables and
// data attributes on a wrapper around that one block (display: contents, so layout is untouched); global.css reads
// them. Every value is validated here because it ends up in an inline style.
import { settings, site } from "./content";
import { fluidHeading } from "./fluid";
const fluid = (settings as any).styles?.fluid?.on === true ? (settings as any).styles.fluid : null;
// Animate on scroll (motion.css): never in the editor's Live view, so nothing there is ever waiting to appear.
const ANIM = ["fade", "up", "left", "right", "zoom"];
const animOk = !(site as any).live;
const siteFx = animOk && (settings as any).styles?.motion?.scroll === "subtle";
const hex = (v: any) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : "");
const num = (v: any, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : 0; };
const font = (v: any) => String(v || "").replace(/[^A-Za-z0-9 ]+/g, "").trim().slice(0, 60);
const SPACE: Record<string, string> = { none: "0", s: "clamp(1.25rem, 2.5vw, 2rem)", m: "clamp(2.5rem, 5vw, 4rem)", l: "clamp(4rem, 8vw, 7rem)", xl: "clamp(6rem, 12vw, 10rem)" };
const WIDTH: Record<string, string> = { reading: "46rem", normal: "var(--max)", wide: "96rem", full: "100%" };

export type BlockWrap = { style: string; attrs: Record<string, string> } | null;

export function blockWrap(style: any): BlockWrap {
  if (!style || typeof style !== "object") return null;
  const v: string[] = [];
  const attrs: Record<string, string> = {};
  const put = (k: string, val: string) => { if (val) v.push(`${k}:${val}`); };

  let w = WIDTH[style.width] || "";
  if (style.width === "custom") { const n = num(style.width_custom, 10, style.width_unit === "%" ? 100 : 2400); w = n ? `${n}${style.width_unit === "%" ? "%" : "px"}` : ""; }
  if (w) { put("--b-w", w); attrs["data-bw"] = style.width === "full" ? "full" : "1"; }

  const left = style.cols === "custom" ? num(style.cols_custom, 15, 85) : num(style.cols, 15, 85);
  if (left) { put("--b-cols", `minmax(0, ${left}fr) minmax(0, ${100 - left}fr)`); attrs["data-bcols"] = ""; }

  if (SPACE[style.pad_top]) { put("--b-pt", SPACE[style.pad_top]); attrs["data-bpt"] = ""; }
  if (SPACE[style.pad_bottom]) { put("--b-pb", SPACE[style.pad_bottom]); attrs["data-bpb"] = ""; }
  if (["left", "center", "right"].includes(style.align)) attrs["data-al"] = style.align;

  const hf = font(style.heading_font), bf = font(style.body_font);
  if (hf) put("--font-heading", `"${hf}", system-ui, sans-serif`);
  if (bf) put("--font-body", `"${bf}", system-ui, sans-serif`);
  const hs = num(style.heading_size, 14, 120);
  if (hs && fluid) { const fh = fluidHeading(hs, fluid); put("--fs-h1", fh.big); put("--fs-h2", fh.big); put("--fs-h3", fh.small); }
  else if (hs) { const s = `clamp(${Math.max(14, Math.round(hs * 0.68))}px, ${(hs / 14).toFixed(2)}vw, ${hs}px)`; put("--fs-h1", s); put("--fs-h2", s); put("--fs-h3", `clamp(${Math.max(14, Math.round(hs * 0.45))}px, ${(hs / 26).toFixed(2)}vw, ${Math.round(hs * 0.6)}px)`); }
  const hw = [400, 500, 600, 700, 800, 900].includes(Number(style.heading_weight)) ? Number(style.heading_weight) : 0;
  if (hw) { put("--b-hw", String(hw)); attrs["data-bhw"] = ""; }
  put("--heading", hex(style.heading_color));
  put("--on-dark-heading", hex(style.heading_color));
  put("--accent-text", hex(style.eyebrow_color));
  const bs = num(style.body_size, 12, 32);
  if (bs) { put("--fs-body", `${(bs / 16).toFixed(4)}rem`); put("--b-fs", `${(bs / 16).toFixed(4)}rem`); attrs["data-bfs"] = ""; }
  const lh = num(style.line_height, 1, 2.4);
  if (lh) put("line-height", String(lh));
  put("--text", hex(style.body_color));
  put("--muted", hex(style.body_color));
  put("--on-dark", hex(style.body_color));
  if (hex(style.accent)) { put("--accent", style.accent); put("--accent-hover", style.accent); put("--brand-band", style.accent); }
  put("--link", hex(style.link_color));
  if (style.hide === "mobile" || style.hide === "desktop") attrs["data-hide"] = style.hide;
  if (animOk && ANIM.includes(style.anim)) {
    attrs["data-anim"] = style.anim;
    if (style.anim_speed === "gentle" || style.anim_speed === "quick") attrs["data-anim-speed"] = style.anim_speed;
  } else if (style.anim === "none" && siteFx) attrs["data-anim"] = "none";   // opts out of the site's default scroll effect

  if (!v.length && !Object.keys(attrs).length) return null;
  return { style: v.join(";"), attrs };
}

/** Google Fonts named in any block's style, for fetch-content.mjs (kept in sync by hand: same field names). */
export const BLOCK_FONT_KEYS = ["heading_font", "body_font"];
