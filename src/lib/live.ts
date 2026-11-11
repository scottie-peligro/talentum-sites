// Which website is being rendered.
//
// A normal build (publish, staging, live) has exactly one: src/data/bundle.json, loaded once — nothing here changes it.
//
// The page editor's Live view runs one `astro dev` for every website being edited at once (builder/server.mjs). Each
// website's draft content is src/data/live/<key>.json; middleware.ts picks the website for each request with
// useSite(key). Library modules that work things out from the site when they load (content.ts, styles.ts, og.ts…)
// register onSiteChange() so they redo that for whichever website is picked. Pages render one at a time in the Live
// view (middleware.ts), so a page never sees two websites.
import raw from "../data/bundle.json";

const files = import.meta.glob("../data/live/*.json", { eager: true, import: "default" }) as Record<string, any>;
const fontFiles = import.meta.glob("../data/live-fonts/*.json", { eager: true, import: "default" }) as Record<string, { css: string; preload: string[] }>;

let current: any = raw;
const hooks: ((b: any) => void)[] = [];

/** True in the editor's Live view (one dev server, many websites). Never in a build. */
export const multi = import.meta.env.DEV && Object.keys(files).length > 0;
/** The content bundle of the website being rendered. */
export const currentBundle = () => current;
/** Run `fn` whenever the website being rendered changes (not straight away: the module has just loaded for this one). */
export function onSiteChange(fn: (bundle: any) => void) { hooks.push(fn); }
/** A Live view website's content, by key. */
export const liveBundle = (key: string) => (key ? files[`../data/live/${key}.json`] : undefined);
/** A Live view website's downloaded fonts (src/data/live-fonts/<key>.json), when it has any. */
export const liveFonts = (key: string) => (key ? fontFiles[`../data/live-fonts/${key}.json`] : undefined);
/** Every Live view website's key. */
export const liveKeys = () => Object.keys(files).map((p) => p.split("/").pop()!.replace(/\.json$/, ""));

/** Render this Live view website from now on. False when there's no such website. */
export function useSite(key: string): boolean {
  const b = liveBundle(key);
  if (!b) return false;
  if (b !== current) { current = b; for (const h of hooks) h(b); }
  return true;
}

/**
 * A page's getStaticPaths for every Live view website (a path any of them has), or just this website's in a build.
 * `paths` lists one website's; `id` names a path ({ params } → "a/b"). The dev server keeps one list for all
 * websites, so the page looks its own props up again for the website being rendered (liveProps).
 */
export function livePaths<T extends { params: Record<string, any> }>(paths: () => T[]): T[] {
  if (!multi) return paths();
  const was = current, seen = new Set<string>(), out: T[] = [];
  try {
    for (const k of liveKeys()) {
      useSite(k);
      for (const p of paths()) { const id = paramsId(p.params); if (!seen.has(id)) { seen.add(id); out.push(p); } }
    }
  } finally {
    if (current !== was) { current = was; for (const h of hooks) h(was); }
  }
  return out;
}
/** The props for this address in the website being rendered (Live view), or Astro's own props in a build. Null = not on this website. */
export function liveProps<T extends { params: Record<string, any>; props: any }>(paths: () => T[], params: Record<string, any>, props: any): any {
  if (!multi) return props;
  const id = paramsId(params);
  const hit = paths().find((p) => paramsId(p.params) === id);
  return hit ? hit.props : null;
}
const paramsId = (params: Record<string, any>) => Object.keys(params).sort().map((k) => `${k}=${String(params[k] ?? "").replace(/^\/|\/$/g, "")}`).join("&");
