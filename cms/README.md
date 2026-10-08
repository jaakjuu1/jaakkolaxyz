# EmDash Blog Template

A clean, minimal blog built with [EmDash](https://github.com/emdash-cms/emdash). Runs on any Node.js server with SQLite and local file storage.

![Blog template homepage](https://raw.githubusercontent.com/emdash-cms/emdash/main/assets/templates/blog/latest/homepage-light-desktop.jpg)

## What's Included

- Featured post hero on the homepage
- Post archive with reading time estimates
- Category and tag archives
- Full-text search
- RSS feed
- SEO metadata and JSON-LD
- Dark/light mode

## Pages

| Page | Route |
|---|---|
| Homepage | `/` |
| All posts | `/posts` |
| Single post | `/posts/:slug` |
| Category archive | `/category/:slug` |
| Tag archive | `/tag/:slug` |
| Search | `/search` |
| Static pages | `/pages/:slug` |
| 404 | fallback |

## Screenshots

| | Desktop | Mobile |
|---|---|---|
| Light | ![homepage light desktop](https://raw.githubusercontent.com/emdash-cms/emdash/main/assets/templates/blog/latest/homepage-light-desktop.jpg) | ![homepage light mobile](https://raw.githubusercontent.com/emdash-cms/emdash/main/assets/templates/blog/latest/homepage-light-mobile.jpg) |
| Dark | ![homepage dark desktop](https://raw.githubusercontent.com/emdash-cms/emdash/main/assets/templates/blog/latest/homepage-dark-desktop.jpg) | ![homepage dark mobile](https://raw.githubusercontent.com/emdash-cms/emdash/main/assets/templates/blog/latest/homepage-dark-mobile.jpg) |

## Infrastructure

- **Runtime:** Node.js
- **Database:** SQLite (local file)
- **Storage:** Local filesystem
- **Framework:** Astro with `@astrojs/node`

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:4321/_emdash/admin and complete the setup wizard. EmDash runs database migrations and applies the blog seed during setup. The site is available at http://localhost:4321.

## Local development

Reset the local database and uploads (`data/` is gitignored):

```bash
rm -rf data/
npm run dev
```

Skip the setup wizard with the dev bypass (dev server only):

```bash
curl -s -X POST "http://localhost:4321/_emdash/api/setup/dev-bypass?token=1"
```

This applies `seed/seed.json`, creates the admin `dev@emdash.local` and returns an API token in
`data.token`. The migrations also add a built-in `category` taxonomy that the seed cannot remove, so
delete it once after a reset:

```bash
export EMDASH_TOKEN=<data.token from the response above>
curl -s -X DELETE -H "Authorization: Bearer $EMDASH_TOKEN" http://localhost:4321/_emdash/api/taxonomies/category
```

Check the schema (`posts`, `pages`, `learn_tracks`, taxonomy `tag`):

```bash
npx emdash schema list --url http://localhost:4321
npx emdash taxonomy list --url http://localhost:4321
```

A database created before the learn tracks got their `group` and `stats_note` fields (fresh databases
get them from the seed; the seed is not re-applied to an existing one) needs them added once. The CLI
cannot set select options, so create the `group` field with the CLI and set its options with the REST
API. Then re-run the import so the cards get their group and stats note:

```bash
npx emdash schema add-field learn_tracks group --type=select --label=Group --url http://localhost:4321
curl -s -X PUT "http://localhost:4321/_emdash/api/schema/collections/learn_tracks/fields/group" \
  -H "Authorization: Bearer $EMDASH_TOKEN" -H "Content-Type: application/json" \
  -d '{"label":"Group","type":"select","validation":{"options":["ymmartaminen","rakentaja"]}}'
npx emdash schema add-field learn_tracks stats_note --type=text --label="Stats note" --url http://localhost:4321
EMDASH_TOKEN=$EMDASH_TOKEN npm run import -- --update
```

Tokens for scripts: on localhost the CLI needs no token (it uses the dev bypass session). For
`EMDASH_TOKEN`, use the token from `?token=1` as above (each call replaces the previous
`dev-bypass-token`), or create one in the admin under Settings > API Tokens. Scripts read
`EMDASH_URL` (default `http://localhost:4321`) and `EMDASH_TOKEN`.

Import the old site's posts, privacy notice, learn tracks and blog images into a running instance
(idempotent; existing entries are skipped, `--update` rewrites them):

```bash
EMDASH_TOKEN=<token> npm run import                # add what is missing
EMDASH_TOKEN=<token> npm run import -- --update    # also rewrite existing entries
```

## Want Cloudflare Instead?

See the [Cloudflare variant](../blog-cloudflare) for a version that deploys to Cloudflare Workers with D1 and R2.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/emdash-cms/templates/tree/main/blog-cloudflare)

## See Also

- [All templates](../)
- [EmDash documentation](https://docs.emdashcms.com/)
