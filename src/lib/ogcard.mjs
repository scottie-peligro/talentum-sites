// Auto social images (Talentum → Website → Settings → Search engines & AI → Sharing images): a 1200×630 card for a page
// that has no image of its own — logo, eyebrow, title, a short description, the brand's colours and fonts, and the
// author's headshot on posts. Drawn at build time only (satori: layout → SVG, resvg: SVG → PNG); no JavaScript ships.
//
// Each card is cached by a hash of everything that goes into it, in the builder's cache directory (beside Astro's image
// cache, on the data volume), so a page whose card hasn't changed is never drawn again. Cards are written to
// dist/_og/<hash>.png (.jpg for the photo look). Fonts: the site's heading and body fonts as TrueType from Google Fonts
// (satori can't read woff2), cached the same way; offline, the bundled Archivo / Mulish (src/styles/fonts/og-*.ttf).
// Scripts those fonts don't cover (Japanese, Arabic, Hindi, …) get a Noto Sans subset of just the characters used.
// Anything that fails returns null and the page keeps its old behaviour; a sharing image never breaks a build.
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const W = 1200, H = 630;
const VERSION = "og-2";   // bump when the drawing changes, so cached cards are redrawn
const ROOT = process.cwd();
/** Same place astro.config.mjs puts Astro's own cache (the builder's data volume), else node_modules/.astro. */
export const CACHE = join(process.env.ASTRO_CACHE_DIR || (existsSync("/data/sites") ? "/data/astro-cache" : join(ROOT, "node_modules", ".astro")), "og");
const OUT = join(ROOT, "dist", "_og");
export const stats = { drawn: 0, cached: 0, ms: 0, failed: 0 };
let told = false;
const tell = () => { if (told) return; told = true; process.once("exit", () => { if (stats.drawn + stats.cached + stats.failed) console.log(`Sharing images: ${stats.drawn} drawn (${(stats.ms / 1000).toFixed(1)} s), ${stats.cached} reused from cache${stats.failed ? `, ${stats.failed} skipped` : ""}.`); }); };

// ---------------------------------------------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------------------------------------------
const BUNDLED = join(ROOT, "src", "styles", "fonts");
const bundled = (f) => { try { return readFileSync(join(BUNDLED, f)); } catch { return null; } };
const tried = new Map();
// Set when Google Fonts couldn't be reached: cards drawn then still ship (with the bundled fonts) but aren't cached, so
// the next build draws them properly.
let netDown = false;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-");
async function fetchTtf(cssUrl, cacheName) {
  const p = join(CACHE, "fonts", cacheName);
  if (existsSync(p)) return readFileSync(p);
  if (netDown) return null;                      // the network already failed once this build: don't wait on it again
  if (process.env.OG_OFFLINE === "1") { netDown = true; return null; }
  try {
    const r = await fetch(cssUrl, { signal: AbortSignal.timeout(8000) });   // no browser user agent → TrueType
    if (!r.ok) return null;
    const u = (await r.text()).match(/url\((https:\/\/[^)]+)\)\s*format\('(?:truetype|opentype)'\)/)?.[1];
    if (!u) return null;
    const f = await fetch(u, { signal: AbortSignal.timeout(15000) });
    if (!f.ok) return null;
    const buf = Buffer.from(await f.arrayBuffer());
    mkdirSync(join(CACHE, "fonts"), { recursive: true });
    writeFileSync(p, buf);
    return buf;
  } catch { netDown = true; return null; }
}
const fam = (f) => encodeURIComponent(f).replace(/%20/g, "+");
/** A Google Font at a weight (the nearest weight it has otherwise), as TrueType; null when unreachable. */
function googleFont(family, weight) {
  const k = family + "@" + weight;
  if (!tried.has(k)) tried.set(k, (async () => {
    for (const w of [weight, 700, 400].filter((x, i, a) => a.indexOf(x) === i)) {
      const b = await fetchTtf(`https://fonts.googleapis.com/css2?family=${fam(family)}:wght@${w}`, `${slug(family)}-${w}.ttf`);
      if (b) return { data: b, weight: w };
      if (netDown) return null;                  // stop at the first network failure
    }
    const b = await fetchTtf(`https://fonts.googleapis.com/css2?family=${fam(family)}`, `${slug(family)}.ttf`);
    return b ? { data: b, weight: 400 } : null;
  })());
  return tried.get(k);
}
// Other scripts (satori's language codes → Noto Sans families). Only the characters on the card are downloaded.
const NOTO = { "ja-JP": "Noto Sans JP", "ko-KR": "Noto Sans KR", "zh-CN": "Noto Sans SC", "zh-TW": "Noto Sans TC", "zh-HK": "Noto Sans HK", "th-TH": "Noto Sans Thai",
  "bn-IN": "Noto Sans Bengali", "ar-AR": "Noto Sans Arabic", "ta-IN": "Noto Sans Tamil", "ml-IN": "Noto Sans Malayalam", "he-IL": "Noto Sans Hebrew", "te-IN": "Noto Sans Telugu",
  devanagari: "Noto Sans Devanagari", kannada: "Noto Sans Kannada", unknown: "Noto Sans" };
async function extraFont(codes, text) {
  // satori may offer several candidates ("ja-JP|zh-CN|zh-TW|zh-HK" for Han characters): the first one we know.
  const code = String(codes).split("|").find((x) => NOTO[x]) || "";
  const family = NOTO[code];
  if (!family || !text) return [];
  const chars = [...new Set([...text])].join("");
  const h = createHash("sha1").update(family + chars).digest("hex").slice(0, 12);
  const out = [];
  for (const w of [700, 400]) {
    const b = await fetchTtf(`https://fonts.googleapis.com/css2?family=${fam(family)}:wght@${w}&text=${encodeURIComponent(chars)}`, `${slug(family)}-${w}-${h}.ttf`);
    if (b) out.push({ name: "X" + h, data: b, weight: w, style: "normal" });
  }
  return out;
}

const fontSets = new Map();
/** One font list per site (satori caches parsed fonts per list, so reusing it matters). */
function fontSet(f) {
  const k = JSON.stringify(f);
  if (!fontSets.has(k)) fontSets.set(k, makeFontSet(f));
  return fontSets.get(k);
}
async function makeFontSet(f) {
  const [hd, b4, b7] = await Promise.all([f.heading ? googleFont(f.heading, f.headingWeight || 700) : null, f.body ? googleFont(f.body, 400) : null, f.body ? googleFont(f.body, 700) : null]);
  const fbH = bundled("og-archivo-700.ttf"), fb4 = bundled("og-mulish-400.ttf"), fb7 = bundled("og-mulish-700.ttf");
  const list = [];
  if (hd) list.push({ name: "H", data: hd.data, weight: 700, style: "normal" }); else if (fbH) list.push({ name: "H", data: fbH, weight: 700, style: "normal" });
  if (b4) list.push({ name: "B", data: b4.data, weight: 400, style: "normal" }); else if (fb4) list.push({ name: "B", data: fb4, weight: 400, style: "normal" });
  if (b7 && b7.weight >= 600) list.push({ name: "B", data: b7.data, weight: 700, style: "normal" }); else if (fb7) list.push({ name: "B", data: fb7, weight: 700, style: "normal" });
  // Fallbacks for characters the site's fonts lack.
  if (fbH) list.push({ name: "F", data: fbH, weight: 700, style: "normal" });
  if (fb4) list.push({ name: "F", data: fb4, weight: 400, style: "normal" });
  return list;
}

// ---------------------------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------------------------
const rgb = (hex) => { const h = String(hex).replace("#", ""); const x = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) || 0); };
const rgba = (hex, a) => `rgba(${rgb(hex).join(",")},${a})`;
const lum = (hex) => { const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** The wanted colour on this background if it reads (≥ min), else white or near-black, whichever reads better. */
const readable = (want, bg, min = 4.5) => (want && contrast(want, bg) >= min ? want : contrast("#ffffff", bg) >= contrast("#0b1220", bg) ? "#ffffff" : "#0b1220");

// ---------------------------------------------------------------------------------------------------------------
// Images (logo, headshot, photo) → data URIs at the size they're drawn (×2 for the logo so it stays crisp)
// ---------------------------------------------------------------------------------------------------------------
const MEDIA = join(ROOT, "src", "media");
const logos = new Map();
function logoImg(file, maxH, maxW) {
  if (!file) return null;
  const k = [file, maxH, maxW].join("|");
  if (!logos.has(k)) logos.set(k, makeLogo(file, maxH, maxW));
  return logos.get(k);
}
async function makeLogo(file, maxH, maxW) {
  try {
    const p = join(MEDIA, file);
    const img = sharp(p, file.endsWith(".svg") ? { density: 300 } : {}).trim({ threshold: 1 }).resize({ width: maxW * 2, height: maxH * 2, fit: "inside", withoutEnlargement: false }).png();
    const { data, info } = await img.toBuffer({ resolveWithObject: true });
    return { src: `data:image/png;base64,${data.toString("base64")}`, w: Math.round(info.width / 2), h: Math.round(info.height / 2) };
  } catch { return null; }
}
async function coverImg(file, w, h, focal) {
  if (!file) return null;
  try {
    const pos = focal && typeof focal.x === "number" ? undefined : sharp.strategy.attention;
    let img = sharp(join(MEDIA, file));
    if (focal && typeof focal.x === "number") {
      const m = await img.metadata();
      const s = Math.max(w / (m.width || w), h / (m.height || h));
      const rw = Math.round((m.width || w) * s), rh = Math.round((m.height || h) * s);
      const left = Math.max(0, Math.min(rw - w, Math.round(rw * focal.x - w / 2))), top = Math.max(0, Math.min(rh - h, Math.round(rh * focal.y - h / 2)));
      img = sharp(await img.resize(rw, rh).toBuffer()).extract({ left, top, width: w, height: h });
    } else img = img.resize(w, h, { fit: "cover", position: pos });
    const data = await img.jpeg({ quality: 84 }).toBuffer();
    return `data:image/jpeg;base64,${data.toString("base64")}`;
  } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------------------------
const h = (type, style, ...children) => {
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false && c !== "");
  const st = Object.fromEntries(Object.entries(type === "div" ? { display: "flex", ...style } : style).filter(([, v]) => v !== undefined && v !== null));
  return { type, props: { style: st, children: kids.length === 0 ? undefined : kids.length === 1 ? kids[0] : kids } };
};
const img = (src, w, ht, style = {}) => ({ type: "img", props: { src, width: w, height: ht, style: { width: w, height: ht, ...style } } });
const clip = (s, n) => { const a = [...s]; return a.length > n ? a.slice(0, n - 1).join("").replace(/[\s,.;:–—-]+$/, "") + "…" : s; };
const wide = (s) => /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/.test(s);
/** Title size from its length (CJK characters are about twice as wide). */
function titleSize(t, roomy) {
  const n = [...t].length * (wide(t) ? 1.9 : 1);
  const s = n <= 26 ? 84 : n <= 44 ? 72 : n <= 64 ? 62 : n <= 90 ? 54 : 46;
  return roomy ? s : Math.round(s * 0.92);
}
const rtl = (s) => /[֐-ࣿיִ-﷿ﹰ-ﻼ]/.test(s);

function tree(o, x) {
  const { colors: c, template } = o;
  const title = clip(o.title, 130);
  const desc = o.description ? clip(o.description, 150) : "";
  const dir = rtl(title) ? "rtl" : undefined;
  const align = dir ? "flex-end" : "flex-start";
  const showDesc = !!desc && [...title].length <= 70;
  const bigTitle = titleSize(title, !showDesc);

  // Per look: background, text colours, and how the logo sits.
  const dark = template === "minimal" ? null : template === "bold" ? c.accent : c.dark;
  const bg = dark || c.background;
  const ink = template === "minimal" ? readable(c.heading, bg) : template === "photo" ? "#ffffff" : readable(template === "bold" ? c.on_accent : "#ffffff", bg);
  const soft = template === "minimal" ? readable(c.muted, bg, 4.5) : template === "photo" ? "rgba(255,255,255,.86)" : template === "bold" ? (ink === "#ffffff" ? "rgba(255,255,255,.86)" : rgba(ink, 0.78)) : readable(c.on_dark, bg, 4.5);
  const accentOn = template === "minimal" ? readable(c.accent, bg, 3) : template === "bold" ? readable(c.dark, "#ffffff") : readable(c.accent, bg, 3);

  const logo = !o.showLogo ? null : x.logo
    ? (x.logoBare ? img(x.logo.src, x.logo.w, x.logo.h) : h("div", { padding: "12px 18px", borderRadius: 12, background: "#ffffff", boxShadow: "0 2px 10px rgba(0,0,0,.12)" }, img(x.logo.src, x.logo.w, x.logo.h)))
    : h("div", { fontFamily: "H", fontSize: 32, fontWeight: 700, color: ink, letterSpacing: "-0.01em" }, clip(o.siteName || "", 40));

  const eyebrow = !o.eyebrow ? null : template === "bold" || template === "photo"
    ? h("div", { alignSelf: align, padding: "8px 18px", borderRadius: 999, background: template === "bold" ? (lum(bg) > 0.4 ? c.dark : "#ffffff") : c.accent,
        color: template === "bold" ? (lum(bg) > 0.4 ? "#ffffff" : readable(c.accent, "#ffffff", 3)) : readable(c.on_accent, c.accent), fontFamily: "B", fontWeight: 700, fontSize: 22, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 26 }, clip(o.eyebrow, 40))
    : h("div", { alignItems: "center", marginBottom: 24, flexDirection: dir ? "row-reverse" : "row" },
        h("div", { width: 44, height: 6, borderRadius: 3, background: accentOn, marginRight: dir ? 0 : 16, marginLeft: dir ? 16 : 0 }),
        h("div", { fontFamily: "B", fontWeight: 700, fontSize: 23, letterSpacing: "0.1em", textTransform: "uppercase", color: template === "minimal" ? accentOn : soft }, clip(o.eyebrow, 40)));

  const titleEl = h("div", { fontFamily: "H", fontWeight: 700, fontSize: bigTitle, lineHeight: 1.08, letterSpacing: wide(title) ? "0" : "-0.02em", color: ink, maxWidth: o.author && template !== "photo" ? 1056 : 1056, textAlign: dir ? "right" : "left", lineClamp: 4, display: "block" }, title);
  const descEl = showDesc ? h("div", { fontFamily: "B", fontSize: 28, lineHeight: 1.35, color: soft, marginTop: 22, maxWidth: 940, textAlign: dir ? "right" : "left", lineClamp: 2, display: "block" }, desc) : null;

  const author = o.author ? h("div", { alignItems: "center" },
    x.headshot ? img(x.headshot, 68, 68, { borderRadius: 34, marginRight: 18, border: `3px solid ${template === "minimal" ? c.line || "#e5e7eb" : "rgba(255,255,255,.85)"}` }) : null,
    h("div", { flexDirection: "column" },
      h("div", { fontFamily: "B", fontWeight: 700, fontSize: 25, color: ink }, clip(o.author.name, 40)),
      o.author.role ? h("div", { fontFamily: "B", fontSize: 21, color: soft, marginTop: 2 }, clip(o.author.role, 50)) : null)) : null;
  const domain = o.domain ? h("div", { fontFamily: "B", fontWeight: 700, fontSize: 22, color: soft, letterSpacing: "0.02em" }, o.domain) : null;
  const foot = h("div", { justifyContent: "space-between", alignItems: "flex-end", width: "100%", minHeight: 40 }, author || h("div", {}), domain);

  const body = h("div", { flexDirection: "column", flexGrow: 1, justifyContent: template === "photo" ? "flex-end" : "center", alignItems: align, paddingBottom: template === "photo" ? 34 : 0, width: "100%" }, eyebrow, titleEl, descEl);
  const head = h("div", { justifyContent: dir ? "flex-end" : "flex-start", alignItems: "center", minHeight: 40, width: "100%" }, logo);

  const deco = [];
  if (template === "classic") {
    deco.push(h("div", { position: "absolute", left: 0, top: 0, width: W, height: H, backgroundImage: `radial-gradient(circle at 1.5px 1.5px, ${rgba(ink === "#ffffff" ? "#ffffff" : "#000000", 0.09)} 1.5px, transparent 0)`, backgroundSize: "30px 30px" }));
    deco.push(h("div", { position: "absolute", right: -220, top: -260, width: 760, height: 760, borderRadius: 380, backgroundImage: `radial-gradient(circle, ${rgba(c.accent, 0.55)} 0%, ${rgba(c.accent, 0)} 68%)` }));
    deco.push(h("div", { position: "absolute", left: 0, bottom: 0, width: W, height: 12, background: c.accent }));
  } else if (template === "bold") {
    const tone = lum(bg) > 0.4 ? "#000000" : "#ffffff";
    deco.push(h("div", { position: "absolute", right: -170, top: -170, width: 560, height: 560, borderRadius: 280, border: `70px solid ${rgba(tone, 0.08)}` }));
    deco.push(h("div", { position: "absolute", right: 210, bottom: -120, width: 260, height: 260, borderRadius: 130, background: rgba(tone, 0.07) }));
  } else if (template === "minimal") {
    deco.push(h("div", { position: "absolute", left: 0, top: 0, width: 16, height: H, background: c.accent }));
    deco.push(h("div", { position: "absolute", right: 72, top: 64, width: 120, height: 120, backgroundImage: `radial-gradient(circle at 3px 3px, ${rgba(c.accent, 0.6)} 3px, transparent 0)`, backgroundSize: "24px 24px" }));
  } else if (template === "photo") {
    if (x.photo) deco.push(img(x.photo, W, H, { position: "absolute", left: 0, top: 0, objectFit: "cover" }));
    deco.push(h("div", { position: "absolute", left: 0, top: 0, width: W, height: H, backgroundImage: `linear-gradient(180deg, ${rgba(c.dark, 0.3)} 0%, ${rgba(c.dark, 0.42)} 38%, ${rgba(c.dark, 0.86)} 64%, ${rgba(c.dark, 0.96)} 100%)` }));
  }
  return h("div", { width: W, height: H, position: "relative", flexDirection: "column", background: bg, padding: template === "minimal" ? "60px 80px 56px 96px" : "60px 72px 58px", fontFamily: "B", direction: dir },
    ...deco, head, body, foot);
}

// ---------------------------------------------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------------------------------------------
const fileSig = (file) => { try { const s = statSync(join(MEDIA, file)); return `${file}:${s.size}`; } catch { return file || ""; } };
const pending = new Map();

/**
 * The card for one page: { path: "/_og/<hash>.png", width, height } or null (nothing drawn; keep the old behaviour).
 * o = { template: classic|bold|minimal|photo, title, eyebrow, description, showLogo, logo (media file), logoBare (true when
 *       it's the "on dark backgrounds" logo or the look is light), colors { accent, on_accent, dark, on_dark, heading, muted,
 *       background, line }, fonts { heading, body, headingWeight }, author { name, role, photo } | null, photo (media file),
 *       focal, domain, siteName }
 */
export function ogCard(o) {
  const key = createHash("sha256").update(JSON.stringify([VERSION, o, o.logo && fileSig(o.logo), o.photo && fileSig(o.photo), o.author?.photo && fileSig(o.author.photo)])).digest("hex").slice(0, 20);
  const ext = o.template === "photo" ? "jpg" : "png";
  const name = `${key}.${ext}`;
  tell();
  if (!pending.has(name)) pending.set(name, (async () => {
    try {
      const cached = join(CACHE, name), out = join(OUT, name);
      mkdirSync(OUT, { recursive: true });
      if (existsSync(cached)) { stats.cached++; const t = new Date(); try { utimesSync(cached, t, t); } catch {} if (!existsSync(out)) copyFileSync(cached, out); }
      else {
        const t0 = Date.now();
        const buf = await draw(o, ext);
        writeFileSync(out, buf);
        if (!netDown) writeFileSync(cached, buf);
        stats.drawn++; stats.ms += Date.now() - t0;
      }
      return { path: `/_og/${name}`, width: W, height: H };
    } catch (e) {
      stats.failed++;
      console.warn(`Sharing image skipped for "${o.title}": ${e?.message || e}`);
      return null;
    }
  })());
  return pending.get(name);
}

/** Draws a card. Returns the encoded image. */
export async function draw(o, ext = "png") {
  mkdirSync(CACHE, { recursive: true });
  const dark = o.template !== "minimal";
  const [fonts, logo, headshot, photo] = await Promise.all([
    fontSet(o.fonts || {}),
    o.showLogo ? logoImg(o.logo, o.template === "minimal" ? 64 : 52, 340) : null,
    o.author?.photo ? coverImg(o.author.photo, 136, 136, null) : null,
    o.template === "photo" ? coverImg(o.photo, W, H, o.focal) : null,
  ]);
  // No logo for dark backgrounds: the normal logo sits on a white chip (on the light Minimal look it sits bare).
  const x = { logo, logoBare: !dark || (!!o.logoBare && o.template !== "photo"), headshot, photo };
  const title = String(o.title || "").replace(/\p{Extended_Pictographic}|️|‍/gu, "").trim();
  let missing = false;
  const svg = await satori(tree({ ...o, title, description: String(o.description || "").replace(/\p{Extended_Pictographic}|️|‍/gu, "").trim() }, x), {
    width: W, height: H, fonts,
    loadAdditionalAsset: async (code, segment) => { if (code === "emoji") return []; const f = await extraFont(code, segment); if (!f.length) missing = true; return f; },
  });
  // Characters no font could draw (Google Fonts unreachable): no card rather than one with empty boxes.
  if (missing) throw new Error("no font for some of its characters (Google Fonts unreachable?)");
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W }, font: { loadSystemFonts: false } }).render().asPng();
  return ext === "jpg" ? sharp(png).jpeg({ quality: 84, mozjpeg: true }).toBuffer() : sharp(png).png({ compressionLevel: 9 }).toBuffer();
}
