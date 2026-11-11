// The addresses each page template builds (their getStaticPaths), here so the template can also look its own props
// up again for the website being rendered in the editor's Live view (lib/live.ts livePaths / liveProps).
import { allEntries, cardPages, pagedCards } from "./content";
import { listedTypes, listingPages } from "./listing";

/** Every published entry at its path, plus pages 2, 3… of a paged Content cards block ([...path].astro). */
export function entryPaths() {
  const taken = new Set(allEntries.map((e) => e.path));
  // A Content cards block set to "Show all" with a number per page: pages 2, 3… at <page>/page/<n>/.
  const paged = allEntries.flatMap((e) => {
    const b = pagedCards(e.blocks);
    if (!b) return [];
    const n = cardPages(b.data || {}, e.id);
    // Each address keeps its own number: one that's already a page of the site is skipped (that page wins), the rest
    // don't shift down.
    return Array.from({ length: Math.max(0, n - 1) }, (_, i) => ({ p: `${e.path}page/${i + 2}/`, page: i + 2 })).filter((x) => !taken.has(x.p))
      .map((x) => ({ params: { path: x.p.replace(/^\/|\/$/g, "") }, props: { entry: e, page: x.page, pagedId: b.id } }));
  });
  return [...allEntries.map((e) => ({ params: { path: e.path === "/" ? undefined : e.path.replace(/^\/|\/$/g, "") }, props: { entry: e } as { entry: typeof e; page?: number; pagedId?: string } })), ...paged];
}
/** A custom content type's listing page ([ct].astro). */
export const typePaths = () => listedTypes().map((t) => ({ params: { ct: t.route }, props: { ct: t } }));
/** Pages 2, 3… of a listing page ([ct]/page/[n].astro). */
export const typePagePaths = () => listingPages().map((x) => ({ params: { ct: x.ct.route, n: String(x.page) }, props: { ct: x.ct, page: x.page } }));
