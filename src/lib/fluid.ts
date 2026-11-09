// Fluid sizing (Talentum → Website → Styles → Fluid sizing): text and spacing slide smoothly between a phone and a
// wide screen, as CSS clamp() values, so there are no breakpoints to manage. Pure maths, no imports: the same file is
// copied into the app (talentum-pb frontend/src/lib/fluid.ts) for the Styles page's live preview. Keep them in sync.

export type Fluid = { on?: boolean; body_min?: number; body_max?: number; scale_min?: number; scale_max?: number; space_min?: number; space_max?: number; vw_min?: number; vw_max?: number };
export const FLUID_DEFAULTS = { body_min: 16, body_max: 18, scale_min: 1.2, scale_max: 1.333, space_min: 56, space_max: 112, vw_min: 360, vw_max: 1600 };
/** Each heading's step on the type scale: size = body × ratio^step. */
const STEP = { h1: 4, h2: 3, prose_h2: 2, h3: 1, lede: 0.5 } as const;

type Pair = [number, number];   // [px on phones, px on wide screens]
export type FluidSizes = { vw: Pair; body: Pair; h1: Pair; h2: Pair; prose_h2: Pair; h3: Pair; lede: Pair; space: Pair; gutter: Pair };

const n = (v: any, d: number) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const r = (v: number, p = 4) => { const k = 10 ** p; return Math.round(v * k) / k; };

/** The resolved sizes in px (0 / missing values take the defaults). */
export function fluidSizes(f: Fluid = {}): FluidSizes {
  const D = FLUID_DEFAULTS;
  let vmin = n(f.vw_min, D.vw_min), vmax = n(f.vw_max, D.vw_max);
  if (vmax <= vmin) { vmin = D.vw_min; vmax = D.vw_max; }
  const b: Pair = [n(f.body_min, D.body_min), n(f.body_max, D.body_max)];
  const s: Pair = [n(f.scale_min, D.scale_min), n(f.scale_max, D.scale_max)];
  const step = (k: keyof typeof STEP): Pair => [r(b[0] * s[0] ** STEP[k], 2), r(b[1] * s[1] ** STEP[k], 2)];
  const sp: Pair = [n(f.space_min, D.space_min), n(f.space_max, D.space_max)];
  // Side margins follow the section spacing: roomier sections, roomier gutters.
  const gutter: Pair = [Math.min(32, Math.max(16, Math.round(sp[0] / 3))), Math.min(64, Math.max(24, Math.round(sp[1] / 3.5)))];
  return { vw: [vmin, vmax], body: b, h1: step("h1"), h2: step("h2"), prose_h2: step("prose_h2"), h3: step("h3"), lede: step("lede"), space: sp, gutter };
}

/** clamp() that is `a` px at `vmin` wide, `b` px at `vmax` wide, and a straight line between (in rem, so it follows
 *  the visitor's own text size setting). */
export function fluidClamp(a: number, b: number, vmin: number, vmax: number): string {
  if (a === b) return `${r(a / 16)}rem`;
  const slope = (b - a) / (vmax - vmin);
  const at0 = a - slope * vmin;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const pre = `${r(at0 / 16)}rem`, vw = `${r(Math.abs(slope * 100))}vw`;
  const mid = slope >= 0 ? `${pre} + ${vw}` : `${pre} - ${vw}`;
  return `clamp(${r(lo / 16)}rem, ${mid}, ${r(hi / 16)}rem)`;
}

/** The size in px at a given screen width (for previews). */
export function fluidAt([a, b]: Pair, [vmin, vmax]: Pair, w: number): number {
  const t = Math.max(0, Math.min(1, (w - vmin) / (vmax - vmin)));
  return a + (b - a) * t;
}

/** The theme tokens fluid sizing replaces. */
export function fluidVars(f: Fluid = {}): Record<string, string> {
  const z = fluidSizes(f), c = (p: Pair) => fluidClamp(p[0], p[1], z.vw[0], z.vw[1]);
  return { "--fs-body": c(z.body), "--fs-lede": c(z.lede), "--fs-h1": c(z.h1), "--fs-h2": c(z.h2), "--fs-h3": c(z.h3), "--space-section": c(z.space), "--gutter": c(z.gutter) };
}

/** Headings inside written text (.prose) have their own, smaller sizes in the theme; in fluid mode they follow the scale. */
export function fluidProseCss(root: string, f: Fluid = {}): string {
  const z = fluidSizes(f);
  return `${root} .prose h2{font-size:${fluidClamp(z.prose_h2[0], z.prose_h2[1], z.vw[0], z.vw[1])}}${root} .prose h3{font-size:var(--fs-h3)}`;
}

/** A block's own heading size (Style tab, px on wide screens) in fluid mode: it shrinks on phones by the same
 *  proportion as the site's own big headings, between the same two screen widths. */
export function fluidHeading(px: number, f: Fluid = {}): { big: string; small: string } {
  const z = fluidSizes(f), k = z.h1[0] / z.h1[1], k3 = z.h3[0] / z.h3[1];
  const h3 = Math.round(px * 0.6);
  return { big: fluidClamp(Math.max(14, Math.round(px * k)), px, z.vw[0], z.vw[1]), small: fluidClamp(Math.max(14, Math.min(h3, Math.round(h3 * k3))), Math.max(14, h3), z.vw[0], z.vw[1]) };
}
