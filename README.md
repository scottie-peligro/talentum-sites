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

- `src/blocks/*.astro`: one component per block type. Talentum's `frontend/src/lib/siteBlocks.ts` describes their fields. Add a block in both places.
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
