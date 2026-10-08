# Plan: move the public jaakkola.xyz site to EmDash

Status: planned 2026-10-08 (Opus). Branch `feat/emdash-migration`. New code lives in `cms/`.
Implementation: one section at a time, implemented by Haiku, reviewed by Sonnet against the
acceptance criteria below. If Haiku fails a section twice, Sonnet implements it.

Research behind this plan (session scratchpad, not in git): EmDash 1.2.0 docs/source notes and an
inventory of the current site. The facts that shape the plan are repeated here so the plan stands alone.

## Decisions (made by Juuso)

- The public site moves: home, blog (fi + en), privacy, `/learn/` (added by Juuso 2026-10-08) and
  `/reports/`. Ateneum, the ops dashboard and the contact form API (`POST /api/contact`) stay on the
  Express app (port 5000).
- EmDash runs as its own Node.js process on teppo-server (not Cloudflare Workers), behind Caddy.
- Same look, rebuilt in Astro; small refinements are fine, no redesign.
- Keep fi + en and keep existing URLs working.

## Confirmed defaults (Juuso approved all of them 2026-10-08)

1. **URL scheme.** EmDash only supports Astro's `prefix-other-locales` i18n routing (prefixing the
   default locale breaks the admin). Finnish is the default locale (it is the site's default today):
   `/`, `/blog`, `/blog/<fi-slug>`, `/tietosuoja`; English gets `/en/`, `/en/blog`, `/en/blog/<en-slug>`,
   `/en/privacy`. Every old URL keeps working: `/blog/<slug>` that exists only in English answers
   301 → `/en/blog/<slug>`; `/privacy` answers 301 → `/en/privacy`. The language comes from the URL,
   no longer from localStorage.
2. **English home page.** Today's English home has older services and three Replit placeholder case
   studies with invented metrics. Default: the English home is translated from the Finnish content
   (6 services, 5 real cases); the invented cases are dropped.
3. **Placeholder posts** `example-post` and `esimerkki-postaus` are not imported (301 → `/blog`).
4. **Fonts are self-hosted**, so the privacy notice's Google Fonts paragraph is removed in both languages.
5. **Learn, step A (this migration):** the track catalogue ("Oppimispolut", `/learn/`) becomes CMS
   content (`learn_tracks` collection) rendered in the site design and linked from the nav; the 335
   lesson/concept pages stay self-contained HTML, served by the Astro app at runtime from the same
   `data/learn/` directory, so Hermes keeps publishing with rsync, no build or restart.
   Step B (later, separate project): lessons as EmDash content with a quiz block, Hermes publishing
   through the EmDash CLI.
6. **Reports:** `/reports/age-pressure-finland/` (a standalone Three.js page) moves as a static file
   into `cms/public/reports/`, URL unchanged, still unlinked.
7. Not in this migration (listed for later): 12-month deletion of contact submissions promised by the
   privacy notice; Cloudflare in front of teppo-server.

## Facts that constrain the build

- EmDash 1.2.0, Astro 7, `@astrojs/node` standalone, Node ≥ 22.16 (local Node is 24). The standalone
  server does **not** read `.env`; production gets env from systemd.
- DB and media config is evaluated at build time: `sqlite({ url: "file:./data/emdash.db" })`,
  `local({ directory: "./data/uploads", baseUrl: "/_emdash/api/media/file" })`; relative to the
  process working directory. `cms/data/` is gitignored.
- `siteUrl` (or `EMDASH_SITE_URL`) must be set at build and run time in production; passkeys are bound
  to it. Set `trustedProxyHeaders: ["x-forwarded-for"]` (Caddy).
- No Markdown importer. Seed and CLI stamp "now" as the publish date; REST create accepts
  `publishedAt`, `locale`, `translationOf`, `taxonomies`. Markdown → Portable Text via
  `markdownToPortableText` from `emdash/client` (exported, undocumented). Tables are probably not
  converted. Image fields are objects; render with `<Image>` from `emdash/ui`.
- Never `getStaticPaths` for CMS content; pages are server-rendered. `entry.id` ≠ `entry.data.id`.
  Taxonomy names must match the seed exactly. Validate the seed with `npx emdash seed seed/seed.json --validate`.
- EmDash serves `/_emdash/*`, `/_astro/*`, `/_image`, `/sitemap*.xml`, `/robots.txt`.
- On a fresh production DB the first visitor to finish the setup wizard becomes admin.
- SQLite does not create `data/`; `astro.config.mjs` creates `data/uploads` at config load (dev and
  build only). In production `data/` must exist before the first start (`mkdir -p` in the runbook).
- Production gets its own `EMDASH_ENCRYPTION_KEY` (never the dev key from `cms/.env`), kept in a
  secret backup.
- `@emdash-cms/registry-verification` wants Node `^22.22.2 || ^24.15.0`; production needs that.
- The template already self-hosts fonts through Astro's `fonts` config (downloaded at build time).

## Rules for every implementer

- Work only inside the paths your section names. Never touch `.env*`, databases outside `cms/data/`,
  or anything on `teppo-server`. No `ssh`, `rsync`, `git push`. Do not commit; the orchestrator commits.
- Write and edit files only with the Edit/Write tools, never through shell heredocs or `python -c`
  scripts that embed file content: on 2026-10-08 a heredoc whose body contained its own terminator
  executed runbook commands against production (no damage; Caddy reloaded the same config).
- Read `cms/AGENTS.md` and `cms/.agents/skills/building-emdash-site/SKILL.md` (after section 1 exists)
  before writing EmDash code. Use the installed packages' own types and docs; do not guess APIs.
  When unsure, read the source under `cms/node_modules/emdash/`.
- Run the acceptance commands yourself and paste their real output in your report. If one fails and
  you cannot fix it, stop and report the failure; do not weaken the criterion.
- Old site sources to port from: `client/src/` (components, `data/content.ts`, `index.css`),
  `content/blog/{fi,en}/*.md`, `client/public/`, `attached_assets/generated_images/`.
- Text: Finnish strings use proper ä/ö (fix the ones that lack them). No invented facts or numbers.

## Sections

### 1. Scaffold and configure (`cms/`)

- `npm create emdash@latest cms -- --template node:blog --platform node --pm npm --install --yes`
  from the repo root.
- `astro.config.mjs`: `output: "server"`, `node({ mode: "standalone" })`, `react()`,
  `i18n: { defaultLocale: "fi", locales: ["fi", "en"] }` (no `routing` block, plain string locales),
  `site: "https://jaakkola.xyz"`, emdash with the sqlite/local paths above, `siteUrl` from
  `process.env.EMDASH_SITE_URL` (unset in dev), `trustedProxyHeaders: ["x-forwarded-for"]`.
- Tailwind v4 via `@tailwindcss/vite` in `vite.plugins`, with one `src/styles/global.css` that starts
  `@import "tailwindcss";`.
- Dev convenience: Vite `server.proxy` sends `/api/contact` to `http://localhost:5000`.
- `.gitignore` in `cms/`: `data/`, `.env`, `.emdash/`, `dist/`, `node_modules/`.
- Acceptance: `cd cms && npm run build` succeeds; `npm run dev` then `curl -s -o /dev/null -w '%{http_code}'`
  gives 200 for `/` and `/_emdash/admin/`; a page using a Tailwind class renders that class's CSS;
  `git status` shows no `.env` or `data/` files.

### 2. Content model (`cms/seed/seed.json`)

- Collections:
  - `posts`: `title` (string, required), `excerpt` (text), `content` (portableText), `featured_image`
    (image, optional, `translatable: false`); `supports: ["drafts","revisions","seo","search"]`;
    `urlPattern: "/blog/{slug}"`.
  - `pages`: `title`, `content` (portableText); `supports: ["drafts","revisions","seo"]`;
    `urlPattern: "/{slug}"`.
  - `learn_tracks` (fields in section 6b), `urlPattern: "/learn/{slug}/"`.
- Taxonomy `tag` on posts. Remove template sample content, categories and anything the site doesn't use.
- Site settings: title "Juuso Jaakkola", tagline from the Finnish hero.
- A short `cms/README.md` section on how to reset the local DB (`rm -rf data/`) and re-run setup in dev
  (the dev setup bypass, `/_emdash/api/setup/dev-bypass`) and how to get an API token for scripts.
- Acceptance: `npx emdash seed seed/seed.json --validate` passes; after a fresh local DB and dev setup,
  `npx emdash schema list` (or the REST schema endpoint) shows exactly `posts`, `pages` and
  `learn_tracks` and the `tag` taxonomy.

### 3. Import script (`cms/scripts/import-content.ts`)

Imports into a running EmDash instance via REST (`EMDASH_URL`, `EMDASH_TOKEN`), idempotent (an entry
whose slug+locale exists is skipped, or updated with `--update`).

- Posts from `../content/blog/{fi,en}/*.md` (gray-matter): skip `example-post`, `esimerkki-postaus`.
  slug = filename; `title`, `excerpt`; `date` → `publishedAt` (`YYYY-MM-DDT09:00:00+03:00`);
  `tags` → taxonomy `tag` (create terms per locale first); locale from folder.
- Drop a leading `# H1` that repeats the title (5 imported posts have one; john-dee's differing H1
  becomes an h2).
- Translation pairs (create fi first, en with `translationOf`): `2026-01-28-ai-cold-email-agent` (fi/en),
  `2026-03-10-sointimaisemia` (fi/en), `2026-05-22-agentiton-palvelinoperointi` (fi) ↔
  `2026-05-22-agentless-server-operations` (en). Expect 4 fi + 5 en posts.
- Markdown → Portable Text with `markdownToPortableText` from `emdash/client`. Verify the output for
  code fences (language kept), lists, blockquotes, links and the table in `en/john-dee.md`; if tables
  are not converted, emit the block type the EmDash editor uses for tables (find it in the emdash
  source) and say so in the report.
- Images (`/blog-images/*.jpg` in `client/public/blog-images/`): upload each once to the media library
  (REST media upload), then point the Portable Text image blocks at the uploaded media; keep alt text.
  The italic line right after an image stays as a caption paragraph.
- Privacy pages from `client/src/data/content.ts` `privacy` (fi slug `tietosuoja`, en slug `privacy`,
  linked as translations), converted to Portable Text. Remove the Google Fonts paragraph (fonts are
  self-hosted now) and keep everything else verbatim, including the "updated" date line.
  The cookies/storage paragraph must say the **theme** choice is kept in localStorage (the language now
  comes from the URL); section 6 updates that sentence in both languages.
- Learn track cards: the 7 `.path` cards in `data/learn/index.html` → `learn_tracks` entries (fi),
  fields as in section 6b; `order` = position on the page.
  All 7 cards link to a track; only the `mikroauktoriteetti` folder has no card.
  Every track folder without a card becomes a **draft** entry (title from its `index.html`
  `<title>`), so Juuso can publish it from the admin.
- Verified API facts (section 2 review): create accepts only `status: "draft"`; send `publishedAt`
  on create, then `POST /_emdash/api/content/{collection}/{id}/publish`, which keeps it.
  `translationOf` is the source entry's id. Tag terms must exist per locale first:
  `POST /_emdash/api/taxonomies/tag/terms {"slug","label","locale"}`; the fi and en `tag`
  taxonomies come from the seed. Media upload: `POST /_emdash/api/media` (multipart).
  Every fresh DB also gets a built-in `category` taxonomy from a core migration; the script deletes
  it (`DELETE /_emdash/api/taxonomies/category`) if present.
- Publish everything after create, keeping `publishedAt`.
- Acceptance: running it twice against a fresh local instance gives the same counts (4 fi + 5 en posts,
  2 pages, 7 learn tracks) and no duplicates; a REST/CLI read of `2026-05-22-agentless-server-operations` shows
  `publishedAt` 2026-05-22, locale `en`, a translation link to the fi post, and code blocks with
  language `bash`; john-dee has its 4 images and the table.

### 4. Design foundation (layout, tokens, i18n strings)

- Port tokens from `client/src/index.css:1-115` into `cms/src/styles/global.css` (Tailwind v4
  `@theme inline`, same HSL values, `.dark` class variant), and the blog prose block
  (`index.css:118-425`) into `cms/src/styles/prose.css`, scoped to `.prose`.
- Fonts self-hosted: Inter, Playfair Display, Geist Mono through the template's Astro `fonts` config
  (replace its Inter + JetBrains Mono), or `@fontsource` packages if that config can't do it.
- Copy `client/public/reports/` to `cms/public/reports/` unchanged.
- `src/i18n/ui.ts`: every UI string fi + en (nav, blog list/post labels, 404, form labels), plus
  helpers `getLang(Astro)`, `localizePath(path, lang)`.
- `src/layouts/Base.astro`: `<html lang>` from the locale, `<EmDashHead>` / body hooks, per-page title
  and description, `og:image` → `/opengraph.jpg` (absolute), no `twitter:site @replit`, favicon,
  canonical, hreflang via EmDash where available; inline head script that applies the saved theme
  (localStorage `theme`, else `prefers-color-scheme`) before paint.
- `Navbar.astro` (logo "JJ.", Blog link, language switch that goes to the translation when one exists,
  else the other language's equivalent page; theme toggle that saves its choice; "Ota yhteyttä"/"Contact"
  → `#lead-capture` on the home page of the current language) and `Footer.astro` (links from
  `content.ts` footer; privacy link per language; year computed).
- `src/pages/404.astro`: bilingual, real 404 status, uses the layout.
- Copy `favicon.png` and `opengraph.jpg` into `cms/public/`; remove template pages and components that
  the site doesn't use (search, category, tag, author pages) and their links.
- Acceptance: build passes; `/` and `/en/` render header/footer with the right language and
  `<html lang>`; theme choice survives navigation; `/no-such-page` returns 404 with the styled page;
  no request goes to fonts.googleapis.com (check built HTML/CSS with grep).

### 5. Blog pages and RSS

- `src/pages/blog/index.astro` and `src/pages/en/blog/index.astro` (or one shared component): list of
  published posts for the locale, newest first, card like `client/src/components/BlogCard.tsx`
  (date in the page's locale format, serif title, 3-line excerpt, `#tag` chips).
- `src/pages/blog/[slug].astro` and `src/pages/en/blog/[slug].astro`: post header (date, H1, tags),
  `<PortableText>` inside `.prose`, back link, link to the translation when it exists. Code blocks
  highlighted server-side (Astro `<Code>`/shiki, a dark theme like github-dark). Images through
  EmDash `<Image>`. SEO via `getSeoMeta` (title, description = excerpt, canonical, hreflang).
- Legacy redirects in the fi `[slug]` route: if no fi post has the slug but an en post does → 301 to
  `/en/blog/<slug>`; `example-post` and `esimerkki-postaus` → 301 `/blog`. Unknown slug → 404.
- RSS: `/rss.xml` (fi) and `/en/rss.xml` (en), adapted from the template's `rss.xml.ts`.
- Acceptance (dev server with imported content): `/blog` lists 4, `/en/blog` lists 5;
  `/blog/2026-02-18-lahituottajatori` 200; `/blog/john-dee` 301 → `/en/blog/john-dee` which is 200 and
  contains the table and 4 images; `/blog/2026-05-22-agentless-server-operations` 301 →
  `/en/blog/2026-05-22-agentless-server-operations`; `/blog/nope` 404; RSS files are valid XML with
  4 and 5 items; a code block has shiki markup.

### 6. Privacy page and redirects

- `src/pages/[slug].astro` and `src/pages/en/[slug].astro` render `pages` entries
  (`/tietosuoja`, `/en/privacy`) in the same layout and style as `client/src/pages/privacy.tsx`.
- `/privacy` → 301 `/en/privacy` (Astro redirect or EmDash redirect).
- Update the privacy cookies/storage sentence: localStorage holds the theme choice, not the language
  (fi and en), via `npm run import -- --update` or the REST API.
- Delete the template `src/pages/pages/` and `src/pages/posts/` routes once `/blog` and the privacy
  routes exist (section 5 deletes `posts/`).
- Acceptance: `/tietosuoja` 200 Finnish, `/en/privacy` 200 English, `/privacy` 301; neither page
  mentions Google Fonts; `/sitemap.xml` lists home, blog, posts and privacy pages with hreflang alternates.

### 6b. Learn (`/learn/`)

- Collection `learn_tracks` (add to the seed; Finnish only): `title`, `kind` (string), `blurb` (text),
  `lesson_count` (integer), `track_status` (select: julkaistu / tulossa), `order` (integer);
  slug = track folder name. Import the 7 cards from `data/learn/index.html` in the import script.
- `src/pages/learn/index.astro`: the catalogue in the site design (cards like the current page:
  title link to `/learn/<slug>/`, kind, blurb, stats), title "Oppimispolut". Nav gets an
  "Oppimispolut"/"Learn" link (English nav links to the Finnish page; content is Finnish).
- `src/pages/learn/[...path].ts`: serves files from `LEARN_DIR` (env, default `../data/learn` in dev)
  at request time with the right content type: `<dir>/` → `<dir>/index.html`, `/learn/<slug>` →
  301 `/learn/<slug>/`, real 404 for missing files, rejects any path that resolves outside
  `LEARN_DIR` (test with `..` and `%2e%2e`). `/learn/index.html` → 301 `/learn/`. Track pages and
  lessons are returned byte-for-byte; no rebuild is needed when Hermes rsyncs new files.
- Sitemap: add `/learn/` and every track index and lesson (a custom sitemap entry or a
  `sitemap-learn.xml` route listed in robots.txt), Finnish only.
- Update `docs/learn-sections.md`: Astro serves `/learn` now; the card list on `/learn/` is edited in
  the EmDash admin (`learn_tracks`), not in `data/learn/index.html`. Hermes's rsync target is unchanged.
- Acceptance: `/learn/` 200 with 7 published cards (draft `mikroauktoriteetti` hidden); `/learn/ai-music/` and
  `/learn/ai-music/lessons/0004-suno-promptitiede.html` 200 and byte-identical to the files;
  a `.wav` and `.png` from a `reference/` folder have the right content type; `/learn/ai-music` 301;
  `/learn/nope.html` 404; `/learn/..%2f..%2fpackage.json` and `/learn/%2e%2e/%2e%2e/package.json` 404;
  a file added to `data/learn/` while the server runs is served without restart.

### 7. Home page sections

- `src/pages/index.astro` and `src/pages/en/index.astro` render Hero, Services, CaseStudies, Process,
  About and the LeadCapture slot (section 8) from `src/i18n/home.ts`, which holds the content of
  `client/src/data/content.ts` (`fi` verbatim with ä fixes; `en` translated from `fi`, replacing the old
  English services and placeholder cases). Hard-coded English labels ("Challenge", "Solution",
  "System Thinker & Developer") become localized strings.
- Port markup and Tailwind classes from `client/src/components/sections/*.tsx` closely. Replace
  framer-motion with CSS (fade/slide-up) plus one small IntersectionObserver script for in-view
  reveals; respect `prefers-reduced-motion`.
- Images via `astro:assets` (`<Image>`/`<Picture>` with webp/avif) from
  `attached_assets/generated_images/` copied into `cms/src/assets/`; the three service icons at small
  sizes. CaseStudies layout must work for 5 items.
- Acceptance: build passes; `/` and `/en/` contain every service and case title from `home.ts`; no
  "+40%" or other invented metric anywhere in `cms/src`; total image bytes on `/` under 400 KB
  (check the built files); Lighthouse-style sanity: no layout shift from images (width/height set).

### 8. Contact section (React island)

- `src/components/LeadCapture.tsx` as a `client:visible` island ported from
  `client/src/components/sections/LeadCapture.tsx`: booking card (Calendly link), form/quiz tabs,
  same payload `POST /api/contact` `{name,email,company,message,budget}`, same field rules as today,
  localized validation messages. Keep react-hook-form + zod; replace Radix select with a native
  `<select>` and the toast with an inline status message; drop unused shadcn pieces. The quiz's final
  button does something (scrolls to the form, or opens Calendly when the recommendation is a call).
- Acceptance: with Express running on :5000 (`npm run dev` at the repo root) and Astro dev proxying,
  submitting the form returns 201 and a row appears in a scratch contact DB (email off); the island's
  own chunk stays under 25 KB gzip (React runtime ≈ 60 KB is fixed; total measured 82 KB, accepted);
  form works in both languages.

### 9. Smoke tests and visual check

- `cms/tests/smoke.test.ts` (node:test, `CMS_URL` env, default `http://localhost:4321`): status codes
  and redirect targets for every URL in sections 4-6, `<html lang>`, titles, RSS/sitemap/robots
  validity, and that `/_emdash/admin/` is reachable. Read-only so it can run against production later.
- Visual check (reviewer): screenshots of `/`, `/blog`, a post and `/tietosuoja` in light and dark
  mode, mobile and desktop, side by side with the current site; list differences.
- Acceptance: `CMS_URL=http://localhost:4321 npx tsx --test cms/tests/*.test.ts` passes.

### 10. Express side (in this repo's `server/`)

Done on its own branch `feat/express-split` (based on this one). Merge and deploy it only after the
EmDash site is live behind Caddy and verified: once deployed, Express no longer serves `/`, so a
Caddy-only rollback stops working (restore the previous `dist/` instead).

- Remove the blog API and its helpers from `server/routes.ts` (keep `/api/contact` there; the contact test
  checks it). Remove the `/learn` static mount from `server/index.ts` (Astro serves it).
  In `server/static.ts` keep `express.static(dist/public)` (Ateneum and dashboard live there) but remove the SPA catch-all, so unknown paths get a real 404; keep the
  `serveStatic(app)` call and its position (dashboard wiring test). Stop building the React client
  into `dist/public` only if Ateneum/dashboard/reports still get copied there.
- Update tests that read these files; add a test that `/` is not served by Express.
- Acceptance: `npm run check`, `npm run test:ateneum`, `npm run test:dashboard`, `npm run test:contact`
  pass at the repo root.

### 11. Deployment runbook (docs only, no production writes)

- `docs/deploy-cms.md`: build (in a clean worktree, with `EMDASH_SITE_URL=https://jaakkola.xyz`),
  files to copy, systemd unit `jaakkolaxyz-cms.service` (`node dist/server/entry.mjs`, `PORT=4321`,
  `HOST=127.0.0.1`, `WorkingDirectory` with `data/` for DB and uploads, `EnvironmentFile`), Caddy
  config (routes to :5000 for `/api/ateneum/*`, `/ateneum*`, `/api/dashboard/*`, `/dashboard*`,
  `/api/contact`; everything else, including `/learn*` and `/reports*`, → :4321; `LEARN_DIR` in the
  unit points at `/home/clawdbot/jaakkolaxyz/data/learn` so Hermes's rsync target is unchanged;
  `/_emdash/*` limited to Juuso's IP until the setup wizard is done), first-start procedure (setup
  wizard with passkey, then `emdash site import` of a package exported from the local instance),
  backups (`sqlite3 .backup`, uploads, encryption key), verification (`cms/tests` against
  production), and rollback (point Caddy back at :5000 only; the old Express app keeps serving the
  SPA until section 10 is deployed).
- `/_astro/*` already gets `Cache-Control: public, max-age=31536000, immutable` from Astro; Caddy adds
  nothing (verified in the section 11 review).
- Update `AGENTS.md` and `docs/deploy.md` to point at it; note that blog posts are now edited in the
  EmDash admin.
- Acceptance: a Sonnet review confirms every step is concrete, ordered, and has a check and a rollback.

### Cutover (needs Juuso's explicit yes for each production write)

Node version check on teppo-server, install, first start with `/_emdash` restricted, setup wizard by
Juuso (passkey), site import, Caddy switch, verification, then a later merge + deploy of
`feat/express-split` (section 10), then cleanup: delete `client/`, `attached_assets/`, Vite config and
unused deps once production content is imported and verified.
