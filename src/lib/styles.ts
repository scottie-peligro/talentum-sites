// Global Styles (Talentum → Website → Styles): settings.styles → CSS that overrides the theme's tokens.
// Anything empty / 0 leaves the theme's value alone. Google Fonts are downloaded at build by fetch-content.mjs
// (src/data/fonts.json) and served from this site, so no request ever goes to Google.
import { settings, site } from "./content";
import { fluidVars, fluidProseCss } from "./fluid";

const fontFiles = import.meta.glob("../data/fonts.json", { eager: true, import: "default" }) as Record<string, { css: string; preload: string[] }>;
const fonts = Object.values(fontFiles)[0] || { css: "", preload: [] };

const st = settings.styles || {};
const f = st.fonts || {}, t = st.type || {}, c = st.colors || {}, b = st.buttons || {}, l = st.layout || {}, h = st.header || {};
const fl = st.fluid || {}, mo = st.motion || {};
const hex = (v: any) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const q = (name: string) => `"${String(name).replace(/["\\]/g, "")}"`;

const always: Record<string, string> = {};
const surface: Record<string, string> = {};   // light-surface colours: not applied when a Guided visitor picks dark / image
const set = (o: Record<string, string>, k: string, v: any) => { if (v !== undefined && v !== null && v !== "") o[k] = String(v); };

if (f.heading) set(always, "--font-heading", `${q(f.heading)}, system-ui, sans-serif`);
if (f.body) set(always, "--font-body", `${q(f.body)}, system-ui, sans-serif`);
if (t.base) set(always, "--fs-body", `${(t.base / 16).toFixed(4)}rem`);
const SCALE: Record<string, [string, string, string]> = {
  compact: ["clamp(2rem, 3.8vw, 3rem)", "clamp(1.5rem, 2.6vw, 2.1rem)", "clamp(1.05rem, 1.3vw, 1.15rem)"],
  large: ["clamp(2.5rem, 5.4vw, 4.25rem)", "clamp(1.9rem, 3.4vw, 2.9rem)", "clamp(1.15rem, 1.7vw, 1.4rem)"],
  xl: ["clamp(2.75rem, 6.4vw, 5.25rem)", "clamp(2rem, 4vw, 3.4rem)", "clamp(1.2rem, 1.9vw, 1.55rem)"],
};
if (SCALE[t.scale]) { const [a, bb, cc] = SCALE[t.scale]; set(always, "--fs-h1", a); set(always, "--fs-h2", bb); set(always, "--fs-h3", cc); }

if (hex(c.accent)) { set(always, "--accent", c.accent); set(always, "--accent-text", c.accent); set(always, "--brand-band", c.accent); set(always, "--stat", c.accent); }
if (hex(c.accent_hover)) set(always, "--accent-hover", c.accent_hover);
if (hex(c.on_accent)) { set(always, "--on-accent", c.on_accent); set(always, "--on-brand", c.on_accent); }
if (hex(c.link)) set(always, "--link", c.link);
if (hex(c.dark)) { set(always, "--dark", c.dark); set(always, "--hero-bg", c.dark); }
if (hex(c.on_dark)) set(always, "--on-dark", c.on_dark);
if (hex(c.footer_bg)) set(always, "--footer-bg", c.footer_bg);
if (hex(c.header_bg)) set(surface, "--header-bg", c.header_bg);
if (hex(c.heading)) set(surface, "--heading", c.heading);
if (hex(c.text)) set(surface, "--text", c.text);
if (hex(c.muted)) set(surface, "--muted", c.muted);
if (hex(c.background)) { set(surface, "--bg", c.background); set(surface, "--surface", c.background); }
if (hex(c.paper)) set(surface, "--paper", c.paper);
if (hex(c.line)) set(surface, "--line", c.line);

const SHAPE: Record<string, string> = { square: "0", soft: "6px", round: "12px", pill: "999px" };
if (SHAPE[b.shape]) set(always, "--radius-btn", SHAPE[b.shape]);
if (l.max) set(always, "--max", `${l.max}px`);
const SPACE: Record<string, string> = { compact: "clamp(2.5rem, 5vw, 4.5rem)", normal: "clamp(4rem, 8vw, 7rem)", roomy: "clamp(5rem, 10vw, 9rem)" };
if (SPACE[l.space]) set(always, "--space-section", SPACE[l.space]);
const RADIUS: Record<string, [string, string]> = { square: ["0", "0"], soft: ["8px", "4px"], round: ["16px", "8px"] };
if (RADIUS[l.radius]) { set(always, "--radius", RADIUS[l.radius][0]); set(always, "--radius-sm", RADIUS[l.radius][1]); }

// Fluid sizing: body, lede and heading sizes, section spacing and side margins slide between a phone and a wide
// screen (src/lib/fluid.ts). It replaces the fixed body size, heading sizes and section spacing above. Off = untouched.
if (fl.on === true) for (const [k, v] of Object.entries(fluidVars(fl))) set(always, k, v);

// Header: the logo's height (desktop / phone) and the bar's height; the bar always fits the logo.
if (h.logo_h) set(always, "--logo-h", `${h.logo_h}px`);
// Phones: their own size, else the desktop size capped so the bar stays slim.
const logoM = h.logo_h_m || (h.logo_h ? Math.min(h.logo_h, 44) : 0);
if (logoM) set(always, "--logo-h-m", `${logoM}px`);
if (h.height || h.logo_h) set(always, "--head-h", `${Math.max(h.height || 0, (h.logo_h || 0) + 24)}px`);
if (logoM || h.height) set(always, "--head-h-m", `${Math.max(64, Math.min(h.height || 0, 96), logoM + 20)}px`);

const vars = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(";");
const tc = `theme-${site.theme || "nlmc"}`;
// Doubled class: the theme stylesheet loads after this inline <style>, so equal specificity would lose.
const root = `html.${tc}.${tc}`;
const rules: string[] = [];
if (Object.keys(always).length) rules.push(`${root}{${vars(always)}}`);
if (fl.on === true) rules.push(fluidProseCss(root, fl));
if (Object.keys(surface).length) rules.push(`${root}:not([data-bg="dark"]):not([data-bg="image"]){${vars(surface)}}`);
if (f.heading_weight) rules.push(`${root} :is(h1,h2,h3,.h1,.h2){font-weight:${f.heading_weight}}`);
const TRACK: Record<string, string> = { tight: "-0.035em", normal: "-0.01em", wide: "0.01em" };
if (TRACK[t.heading_tracking]) rules.push(`${root} :is(h1,h2,h3){letter-spacing:${TRACK[t.heading_tracking]}}`);
if (t.heading_case === "upper") rules.push(`${root} :is(h1,h2){text-transform:uppercase}`);
if (t.line_height) rules.push(`${root} body{line-height:${t.line_height}}`);
if (b.style === "outline") rules.push(`${root} .btn-primary{background:transparent;color:var(--accent);box-shadow:inset 0 0 0 2px var(--accent)}${root} .btn-primary:hover{background:var(--accent);color:var(--on-accent)}${root} .nav a.cta.btn-primary{color:var(--accent)}${root} .nav a.cta.btn-primary:hover{color:var(--on-accent)}`);
if (b.case === "upper") rules.push(`${root} .btn{text-transform:uppercase;letter-spacing:.06em}`);

// Page transitions (Motion → Page transitions): cross-document view transitions, no JavaScript. Both pages of a
// navigation have to opt in, which they do because every page carries this. Not for reduced motion, nor in the
// editor's Live view (it reloads on every change). The animations themselves are in src/styles/motion.css.
export const pageTransition: "" | "fade" | "slide" = !(site as any).live && (mo.transition === "fade" || mo.transition === "slide") ? mo.transition : "";
if (pageTransition) rules.push("@media (prefers-reduced-motion:no-preference){@view-transition{navigation:auto}}");
/** Motion → Scroll effects site default: blocks without their own "Animate on scroll" ease in (motion.css). */
export const scrollDefault: "" | "subtle" = !(site as any).live && mo.scroll === "subtle" ? "subtle" : "";

/** Inline <style> for the head (fonts first, then the overrides). */
export const stylesCss = (fonts.css || "") + rules.join("");
/** Self-hosted font files worth preloading (the Latin subset of the heading and body fonts). */
export const fontPreloads = fonts.preload || [];
/** True when the site uses its own fonts, so the theme's built-in font preloads can be skipped. */
export const customFonts = !!(f.heading || f.body);
