// Writes the Talentum editor's icon-picker data from the installed lucide-static (same version the renderer draws with):
//   node scripts/lucide-for-editor.mjs ../talentum-pb/frontend/src/lib/lucideIcons.json
// Output: { "kebab-name": ["search tags", "<path d=\"…\"/>…"] } — the inner markup of each 24×24 icon.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const nodes = require("lucide-static/icon-nodes.json");
const tags = require("lucide-static/tags.json");
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const out = {};
for (const name of Object.keys(nodes).sort()) {
  const inner = nodes[name].map(([tag, attrs]) => `<${tag}${Object.entries(attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join("")}/>`).join("");
  out[name] = [(tags[name] || []).join(" "), inner];
}
const dest = process.argv[2];
if (!dest) throw new Error("Usage: node scripts/lucide-for-editor.mjs <output.json>");
writeFileSync(dest, JSON.stringify(out));
console.log(`Wrote ${Object.keys(out).length} icons (lucide-static ${JSON.parse(readFileSync(require.resolve("lucide-static/package.json"), "utf8")).version}) to ${dest}`);
