// Lucide icons for Icon.astro, drawn at build time from lucide-static (pinned; the editor's picker is generated from the
// same version by scripts/lucide-for-editor.mjs). Only the icons a page uses end up in its HTML — nothing ships as JS.
import nodes from "lucide-static/icon-nodes.json";

const ICONS = nodes as unknown as Record<string, [string, Record<string, string | number>][]>;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const esc = (v: unknown) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const cache = new Map<string, string | undefined>();

/** The inner markup (paths etc. on a 24×24 grid) of a Lucide icon by its kebab-case name, or undefined if there's no such icon. */
export function lucideBody(name: string): string | undefined {
  if (cache.has(name)) return cache.get(name);
  const node = name.length < 80 && NAME.test(name) && Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : undefined;
  const body = node?.map(([tag, attrs]) => `<${tag}${Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join("")}/>`).join("");
  cache.set(name, body);
  return body;
}
