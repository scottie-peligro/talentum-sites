// Custom content types' listing pages (components/TypeListing.astro): which types get one, the Content cards block it
// shows, and how many pages it needs. Same order as before paging: soonest date first when the type has a date field,
// otherwise the order set on each page.
import { allEntries, cardPages, contentTypes, entries, type Block, type ContentType } from "./content";

export const LISTING_PER = 24;
/** Types with a listing page: "Listing page" on, an address, and no page of the site already at /<route>/. */
// Only custom kinds with a one-part address (a parent page usually lives there; this covers it until it's published).
export const listedTypes = () => contentTypes.filter((t) => (!t.kind || t.kind === "custom") && t.archive && t.route && !t.route.includes("/") && !entries.some((e) => e.path === "/" + t.route + "/"));
export function listingCards(ct: ContentType): Block {
  const dateKey = ct.fields.find((f) => f.type === "date")?.key || "";
  return { id: "ct-list", type: "content_cards", data: {
    content_type: "x_" + ct.key, all: true, per_page: LISTING_PER, sort: dateKey ? "date_asc" : "manual", date_field: dateKey, layout: "grid", columns: "3",
    show_image: true, show_excerpt: true, show_date: false, fields: ct.show_fields === false ? [] : ct.fields.map((f) => f.key) } } as Block;
}
/** Pages 2, 3… of every listing (an address that's already a page of the site is left to that page). */
export function listingPages(): { ct: ContentType; page: number }[] {
  const taken = new Set(allEntries.map((e) => e.path));
  return listedTypes().flatMap((ct) => {
    const n = cardPages(listingCards(ct).data || {});
    return Array.from({ length: Math.max(0, n - 1) }, (_, i) => ({ ct, page: i + 2 })).filter((x) => !taken.has(`/${ct.route}/page/${x.page}/`));
  });
}
