# talentum-sites

Static website renderer for **Talentum Websites**. Talentum is the CMS: pages, services, case studies, Insights, media, menus, SEO and tracking are edited in the app. This repo turns one site's published content into plain HTML (Astro) and deploys it to Cloudflare Pages, Staging first, then Live.

Plan: Talentum project doc `claude/website-cms-plan.md`.

```
Talentum (PocketBase)  ── publish ──▶  builder/server.mjs  ──▶  fetch bundle ─▶ astro build ─▶ wrangler pages deploy
   /api/site/{key}/bundle  ◀── X-Builder-Secret ──┘                                   (staging or live project)
   /api/site-builds/{id}/report  ◀── progress + result ─────────────────────────────────┘
```

## How a build works

1. Someone publishes in Talentum. `pb_hooks/websites.pb.js` queues a build and POSTs it to the builder (`SITE_BUILDER_URL`).
2. `scripts/fetch-content.mjs` reads `GET /api/site/{key}/bundle?env=staging`. This returns everything published for that site: entries, menus, sections, proof, testimonials, FAQs, team, media and redirects. Media is downloaded into `src/media/`, and unchanged files are kept between builds.
3. `astro build` renders every entry at its path (`src/pages/[...path].astro`). Images become responsive WebP at the right sizes, with real width and height so nothing shifts as the page loads.
4. `scripts/postbuild.mjs` writes Cloudflare's `_headers` and `_redirects` files, copies the logo, and records a manifest so Talentum can show which pages changed.
5. Wrangler deploys `dist/` to the site's Cloudflare Pages project, and the builder reports the result back to Talentum.

**Promote to Live** rebuilds from the exact content snapshot the staging build used (saved with that build), for the live domain. The content is the same, but the live build is indexable, runs real analytics and uses live canonical URLs. Staging builds always get `noindex` headers and a crawler-blocking `robots.txt`, show a small "Staging" flag, and run GA4 in debug mode only.

## What's in a page

- `src/blocks/*.astro`: one component per block type, registered in `src/components/Blocks.astro` (interactive ones in `src/blocks/interactive/index.ts`). Their fields, defaults and sample data are defined once in Talentum's `frontend/src/lib/block-schema.json`; `src/data/block-schema.json` is a copy (see **Blocks** below).
- `src/layouts/Base.astro`: head (title, description, canonical, robots, Open Graph/Twitter, JSON-LD, icons), header, footer, consent and analytics.
- `src/lib/seo.ts`: titles, descriptions and the schema graph (Organization/ProfessionalService, WebSite, BreadcrumbList, WebPage, BlogPosting/Article, Service, JobPosting, FAQPage).
- `src/pages/sitemap.xml.ts`, `robots.txt.ts`, `rss.xml.ts`, `llms.txt.ts`, `404.astro`.
- `src/styles/themes/<theme>.css`: theme tokens. `nlmc` is nlmarcom.com and `default` is a neutral starting point. A site's brand colours from Settings override the theme's.

Pages ship close to zero JavaScript: a few inline lines for the mobile menu, the video facade, the form and consent. Fonts are self-hosted, and tags load after the page is ready. Lighthouse (mobile) on the NLMC staging content scored 99–100 for Performance and 100 for Best Practices and SEO.

## Run it

```bash
npm install
# build one site against a running Talentum
PB_URL=http://localhost:8090 SITE_KEY=nlmarcom SITE_ENV=staging BUILDER_SECRET=… npm run build
npx astro preview          # or serve dist/
```

### The builder service

```bash
BUILDER_SECRET=… PB_URL=http://localhost:8090 CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… WORK_DIR=.work npm run builder
# DRY_RUN=1 builds without deploying
```

Locally it runs as the `site-builder` service in Talentum's `docker-compose.yml`, with secrets in `talentum-pb/sites.env`. Each site builds in its own working copy (`WORK_DIR/sites/<key>`), so its media and Astro's image cache carry over between builds. A normal publish takes a few seconds plus the upload.

The Cloudflare API token needs **Account → Cloudflare Pages → Edit**. Projects (`<key>-staging`, `<key>`) are created on first deploy.

## Blocks

A block's fields are defined in ONE place: Talentum's `frontend/src/lib/block-schema.json` (what the editor shows, what the server accepts, and a `sample` that renders the block). This repo keeps a byte-for-byte copy in `src/data/block-schema.json` for its tests; it's never read at build time and isn't copied into a site's build. Talentum's `node scripts/block-schema/sync.mjs` writes the copy.

**Add a block:** add it to the schema in Talentum (fields + sample) and run the sync there, then here write one component in `src/blocks/` (read `block.data` as `d.<key>`, using the schema's field keys) and register it in `src/components/Blocks.astro` `C` (or `src/blocks/interactive/index.ts`). Then:

```bash
npm run test:blocks      # ~5–30 s
```

It checks the copy matches `../talentum-pb` (when it's there), that every schema block has a registered component, lists data keys a component reads that have no field (and fields no component reads) as warnings, then builds a throwaway site in `.work/test-blocks` with one page per block from its sample (on its own and inside a 2-column container, plus a copy with `<script>`/`onerror`/`javascript:` strings in every text field) and fails on a build error, a block that renders nothing, or hostile markup that got through. `--only hero,cta`, `--no-build`, `--keep`, `--strict-keys`.

## AI assistants (the site's agent endpoint)

Each site can answer AI assistants (ChatGPT, Claude, Copilot…) through a small public API and an MCP server. Talentum decides what may be shared (Website → Settings → AI assistants; `pb_hooks/lib/siteagent.js`) and puts it in `bundle.agent`; `null` means switched off and every endpoint answers 404.

- **Read-only facts** — `scripts/postbuild.mjs` writes `bundle.agent` to `/_agent/data.json` (noindex). Services (summary, page, prices only when the site shares them), FAQs, the public team, case-study summaries, contact options and booking links.
- **Open times** — Talentum writes the next 14 days of open slots per booking link into the D1 table `agent_slots` every 15 minutes. The edge serves them with their age; older than 2 hours = `stale`, with the booking page to check.
- **Booking requests** — off unless the site allows them. Validated (consent required, honeypot fields, a fresh snapshot must have the time open), rate-limited (3/hour and 8/day per visitor, 2/day per email, 40/day per site), then queued in the D1 inbox as `agent_booking`. Talentum turns each into a *requested* booking the team member accepts or declines (never a confirmed meeting), or a Request when no time fits.

| Endpoint | |
| --- | --- |
| `GET /api/agent` | index of what's offered |
| `GET /api/agent/services?q=&category=` · `GET /api/agent/services/{id}` | services; one in full (FAQs, case studies, booking links) |
| `GET /api/agent/faqs?q=&service=&limit=` · `/team` · `/contact` | questions and answers; public team; contact options |
| `GET /api/agent/availability?service=\|booking_link=&from=YYYY-MM-DD&days=1-14` | open times (UTC), `status` current / stale / unknown |
| `POST /api/agent/booking-request` | `{ name, email, service \| booking_link, preferred_start, alternative_starts?, time_zone?, message?, phone?, company?, consent: true }` → 202 |
| `GET /api/agent/openapi.json` | OpenAPI 3.1 (written at build) |
| `POST /mcp` | MCP server, Streamable HTTP, stateless, JSON responses. Dual-era: `2026-07-28` (per-request `_meta`, `server/discover`, header checks) and `2025-11-25`/`2025-06-18`/`2025-03-26` (`initialize`, `ping`). Tools: `list_services`, `get_service`, `search_faqs`, `get_availability`, `request_booking` (only when allowed), `contact_options` |
| `GET /mcp/server-card` · `/.well-known/ai-catalog.json` · `/.well-known/api-catalog` | MCP Server Card (SEP-2127) and the AI Catalog that points to it; RFC 9727 API catalog → the OpenAPI document. `llms.txt` lists both endpoints. |

Code: `edge/agent.js` (data, tools, availability, booking requests), `edge/mcp.js`, `edge/openapi.js`, `functions/api/agent/*`, `functions/mcp/*`. Tests: `npm run test:agent` (handlers with a fake D1 and assets; no network).
