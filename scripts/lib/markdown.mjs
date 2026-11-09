// Rendered page HTML → clean Markdown for AI assistants (scripts/postbuild.mjs writes /<path>/index.md beside every
// page that links one). Only the page's <main> content: headings, paragraphs, lists, links, quotes, tables, FAQ
// questions and answers (<details>/<dl>), cards as list items. Navigation, footers, forms, buttons, scripts, icons and
// anything hidden from screen readers are left out. A small tolerant parser: Astro's output is well-formed.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const SKIP = new Set(["script", "style", "noscript", "template", "svg", "nav", "footer", "form", "button", "dialog", "iframe", "select", "textarea",
  "input", "label", "canvas", "video", "audio", "object", "head", "title", "math"]);
const BLOCK = new Set(["address", "article", "aside", "blockquote", "details", "dd", "div", "dl", "dt", "figcaption", "figure", "h1", "h2", "h3", "h4",
  "h5", "h6", "header", "hr", "li", "main", "ol", "p", "pre", "section", "table", "ul", "summary", "tr", "td", "th", "thead", "tbody", "tfoot", "picture"]);

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", copy: "©", reg: "®", trade: "™", middot: "·", bull: "•" };
export const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return m; } }
  return NAMED[e.toLowerCase()] ?? m;
});

function attrs(src) {
  const out = {};
  for (const m of src.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
}

/** HTML → a tree of { tag, a, kids } and strings. */
export function parse(html) {
  const root = { tag: "#root", a: {}, kids: [] };
  const stack = [root];
  const src = String(html).replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|template|noscript|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const re = /<\/?([a-zA-Z][\w:-]*)((?:\s+(?:[^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined || (!m[1] && m[0] === "<")) { top.kids.push(decode(m[4] ?? "<")); continue; }
    const tag = m[1].toLowerCase();
    if (m[0][1] === "/") {
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const node = { tag, a: attrs(m[2] || ""), kids: [] };
    top.kids.push(node);
    if (!VOID.has(tag) && !m[3]) stack.push(node);
  }
  return root;
}

const hidden = (n) => SKIP.has(n.tag) || n.a["aria-hidden"] === "true" || "hidden" in n.a || /\b(skip|visually-hidden-dup)\b/.test(n.a.class || "") || n.a["data-md-skip"] !== undefined;
const isBlock = (n) => typeof n !== "string" && (BLOCK.has(n.tag) || (n.kids || []).some((k) => typeof k !== "string" && !hidden(k) && isBlock(k)));
const squash = (s) => s.replace(/[ \t\r\n\f\u00a0]+/g, " ");
// Text that looks like a tag ("<script>" typed into a field, escaped on the page) stays inert in the Markdown too.
const inert = (s) => s.replace(/<(?=[A-Za-z\/!?])/g, "&lt;");

/**
 * @param {string} html  a whole page or a fragment
 * @param {{ base?: string, title?: string, description?: string, url?: string }} opt
 */
export function htmlToMarkdown(html, opt = {}) {
  const base = opt.base || "https://example.invalid/";
  const abs = (h) => {
    h = String(h || "").trim();
    if (!h || /^(javascript|data):/i.test(h)) return "";
    if (/^(mailto|tel):/i.test(h)) return h;
    try { return new URL(h, base).href; } catch { return ""; }
  };
  const tree = parse(html);
  const find = (n, pred) => { if (typeof n === "string") return null; if (pred(n)) return n; for (const k of n.kids) { const f = find(k, pred); if (f) return f; } return null; };
  const main = find(tree, (n) => n.tag === "main") || find(tree, (n) => n.tag === "body") || tree;

  /** Inline text of a node's children. Block children inside an inline context are joined with " — ". */
  function inline(n, ctx = {}) {
    if (typeof n === "string") return inert(squash(n));
    if (hidden(n)) return "";
    const kidsText = () => {
      const parts = [];
      let cur = "";
      for (const k of n.kids) {
        if (typeof k !== "string" && !hidden(k) && BLOCK.has(k.tag)) { if (cur.trim()) parts.push(cur.trim()); cur = ""; const t = inline(k, ctx).trim(); if (t) parts.push(t); }
        else cur += inline(k, ctx);
      }
      if (cur.trim()) parts.push(cur.trim());
      return parts.join(" — ");
    };
    switch (n.tag) {
      case "br": return "\n";
      case "img": { const alt = squash(n.a.alt || "").trim(); const src = abs(n.a.src); return alt && src && !ctx.inLink && !ctx.inList ? `![${alt}](${src})` : ""; }
      case "a": {
        const href = n.a.href || "";
        const text = (() => { const c = { ...ctx, inLink: true }; return squash(n.kids.map((k) => (typeof k !== "string" && BLOCK.has(k.tag) ? " " + inline(k, c) + " " : inline(k, c))).join("")).trim(); })();
        const u = href.startsWith("#") ? "" : abs(href);
        return text ? (u && !ctx.inLink ? `[${text}](${u})` : text) : "";
      }
      case "strong": case "b": { const t = kidsText().trim(); return t ? `**${t}**` : ""; }
      case "em": case "i": { const t = kidsText().trim(); return t ? `*${t}*` : ""; }
      case "code": { const t = kidsText().trim(); return t ? "`" + t + "`" : ""; }
      case "sup": case "sub": return kidsText();
      case "small": { const t = kidsText().trim(); return t ? " " + t + " " : ""; }
      default: return kidsText();
    }
  }
  const para = (s) => s.split("\n").map((l) => squash(l).trim()).filter(Boolean).join("  \n");

  /** Block render → array of Markdown blocks (strings). */
  function blocks(n, ctx = {}) {
    if (typeof n === "string") { const t = inert(squash(n)).trim(); return t ? [t] : []; }
    if (hidden(n)) return [];
    const t = n.tag;
    if (/^h[1-6]$/.test(t)) {
      const txt = para(inline(n, ctx));
      if (!txt) return [];
      return [ctx.inList ? `**${txt}**` : "#".repeat(Math.min(6, Number(t[1]) + (ctx.shift || 0))) + " " + txt];
    }
    if (t === "p" || t === "figcaption" || t === "address") { const s = para(inline(n, ctx)); return s ? [t === "figcaption" ? `*${s}*` : s] : []; }
    if (t === "hr") return ["---"];
    if (t === "img") { const s = inline(n, ctx); return s ? [s] : []; }
    if (t === "pre") { const s = textOf(n).replace(/\n+$/, ""); return s.trim() ? ["```\n" + s + "\n```"] : []; }
    if (t === "ul" || t === "ol") {
      const out = [];
      let i = 1;
      for (const li of n.kids) {
        if (typeof li === "string" || li.tag !== "li" || hidden(li)) continue;
        const parts = children(li, { ...ctx, inList: true });
        // A card: its bold title and a one-line description read best on one line.
        // A card (title, a line or two, a link): one line.
        if (parts.length >= 2 && parts.length <= 6 && parts.every((x) => !/\n/.test(x) && !/^(- |\d+\. |> |\||#)/.test(x))) parts.splice(0, parts.length, parts.join(" — "));
        const inner = parts.join("\n");
        if (!inner.trim()) continue;
        const mark = t === "ol" ? `${i++}. ` : "- ";
        out.push(mark + inner.split("\n").map((l, j) => (j ? " ".repeat(mark.length) + l : l)).join("\n"));
      }
      return out.length ? [out.join("\n")] : [];
    }
    if (t === "blockquote") { const inner = children(n, ctx).join("\n\n"); return inner ? [inner.split("\n").map((l) => "> " + l).join("\n")] : []; }
    if (t === "details") {
      const sum = n.kids.find((k) => typeof k !== "string" && k.tag === "summary");
      const q = sum ? para(inline(sum, ctx)) : "";
      const rest = children({ ...n, kids: n.kids.filter((k) => k !== sum) }, ctx);
      return [...(q ? [ctx.inList ? `**${q}**` : `### ${q}`] : []), ...rest];
    }
    if (t === "dt") { const q = para(inline(n, ctx)); return q ? [ctx.inList ? `**${q}**` : `### ${q}`] : []; }
    if (t === "table") {
      const rows = [];
      const collect = (x) => { for (const k of x.kids) if (typeof k !== "string") { if (k.tag === "tr") rows.push(k.kids.filter((c) => typeof c !== "string" && (c.tag === "td" || c.tag === "th")).map((c) => para(inline(c, ctx)).replace(/\|/g, "\\|").replace(/\n/g, " "))); else if (!hidden(k)) collect(k); } };
      collect(n);
      if (!rows.length) return [];
      const w = Math.max(...rows.map((r) => r.length));
      const line = (r) => "| " + Array.from({ length: w }, (_, i) => r[i] || "").join(" | ") + " |";
      return [[line(rows[0]), "| " + Array(w).fill("---").join(" | ") + " |", ...rows.slice(1).map(line)].join("\n")];
    }
    if (t === "a" && isBlock(n)) {
      // A whole card that's a link: "[Title](url) — the rest".
      const u = (n.a.href || "").startsWith("#") ? "" : abs(n.a.href);
      const h = find(n, (x) => /^h[1-6]$/.test(x.tag));
      const title = h ? para(inline(h, { ...ctx, inLink: true })) : "";
      const rest = para(inline({ ...without(n, h), tag: "div" }, { ...ctx, inLink: true })).replace(/\n/g, " ");
      const head = title || rest;
      if (!head) return [];
      const link = u ? `[${head}](${u})` : head;
      return [link + (title && rest ? " — " + rest : "")];
    }
    if (!isBlock(n)) { const s = para(inline(n, ctx)); return s ? [s] : []; }
    return children(n, ctx);
  }
  /** Children of a block container: runs of inline nodes become one paragraph. */
  function children(n, ctx) {
    const out = [];
    let run = "";
    const flush = () => { const s = para(run); if (s) out.push(s); run = ""; };
    for (const k of n.kids) {
      if (typeof k !== "string" && !hidden(k) && isBlock(k)) { flush(); out.push(...blocks(k, ctx)); }
      else run += inline(k, ctx);
    }
    flush();
    return out;
  }
  function without(n, target) { return typeof n === "string" ? n : { ...n, kids: n.kids.filter((k) => k !== target).map((k) => without(k, target)) }; }
  function textOf(n) { return typeof n === "string" ? inert(n) : hidden(n) ? "" : n.tag === "br" ? "\n" : n.kids.map(textOf).join(""); }

  let body = children(main, {});
  // The page's own <h1> repeats the title we put on top.
  const norm = (s) => s.replace(/[*_#`[\]()]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  // A different <h1> (e.g. a home page's headline) becomes the document's title; the page title stays in the source line.
  let title = opt.title || "";
  const h1 = body.findIndex((b) => /^# /.test(b));
  if (h1 !== -1) { title = body[h1].slice(2); body.splice(h1, 1); }
  body = body.filter((b, i) => !(b === "---" && (i === 0 || body[i - 1] === "---")));
  // A heading with nothing under it (an empty "More insights" list) is dropped.
  const level = (b) => (/^#{1,6} /.test(b) ? b.indexOf(" ") : 0);
  body = body.filter((b, i) => !level(b) || (i + 1 < body.length && !(level(body[i + 1]) && level(body[i + 1]) <= level(b))));
  const head = [title ? `# ${inert(squash(title)).trim()}` : "", opt.description ? `> ${inert(squash(opt.description)).trim()}` : "", opt.url ? `Source: ${opt.url}${opt.title && norm(opt.title) !== norm(title) ? ` (${inert(squash(opt.title)).trim()})` : ""}` : ""].filter(Boolean);
  return [...head, ...body].join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
