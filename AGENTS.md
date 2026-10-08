# jaakkola.xyz

Personal site and apps of Juuso Jaakkola: React + Vite client (`client/`),
Express server (`server/`), shared types (`shared/`), blog posts as Markdown in
`content/blog/{en,fi}/`, the private Ateneum app (`server/ateneum-*.ts`,
`public-static/ateneum/`), the ops dashboard at `/dashboard/` (`server/dashboard-*.ts`),
the public contact form (`server/contact.ts`), and the static learning tracks at `/learn/`.

Production runs on `teppo-server` (SSH alias) from `/home/clawdbot/jaakkolaxyz`
as the `jaakkolaxyz` systemd service (`node dist/index.cjs`).

## Learn sections

`/learn/` is static HTML served from `data/learn/`. To create, edit, publish or
sync a learn section, read [docs/learn-sections.md](docs/learn-sections.md)
first. It covers the folder layout, page rules, how to deploy and how to verify
against production.

## Site content (EmDash)

Posts, pages and the `/learn/` track cards live in the EmDash database on production, not
in git (`content/blog/` is only the source of the 2026-10-08 import). Agents maintain them
with the EmDash CLI, run from `cms/` with Node >= 24.15 (`nvm use 24.21.0`):

- Read `cms/.agents/skills/emdash-cli/SKILL.md` first.
- Auth: `npx emdash login --url https://jaakkola.xyz` (device flow: Juuso approves the code
  at `/_emdash/admin/device`). The token is in `~/.config/emdash/auth.json`: content and
  media read/write, schema read; it refreshes for 90 days. Check with
  `npx emdash whoami --url https://jaakkola.xyz`. New tags, settings, users and plugins
  need the admin UI.
- `/_emdash/*` answers only from Juuso's IP (Caddy), so the CLI works from his machine.
- `create` and `update` publish immediately unless `--draft`. Always write with
  `--draft`, show Juuso the draft, and publish (`content publish`) only on his yes.
- Verify on the live URL (`curl`) and with `CMS_URL=https://jaakkola.xyz npm run test:smoke`
  in `cms/` (adjust the count constants at the top of `cms/tests/smoke.test.ts` when
  posts are added or removed).
- Code or design changes to `cms/`: PR, merge, then a release built on the server
  ([docs/deploy-cms.md](docs/deploy-cms.md) §6.5; the GitHub login secret is inlined at
  build time, so releases are not built locally).

## Deploying

Production is updated by copying built files over SSH; there is no CI/CD. Read
[docs/deploy.md](docs/deploy.md) before any production change: it says which
kind of change needs a build and a restart, how to back up, verify and roll
back. The Ateneum release in detail: [docs/ateneum-p0-deploy.md](docs/ateneum-p0-deploy.md).
The public site (home, blog, privacy, `/learn/`, `/reports/`) is the EmDash app in `cms/`:
its runbook is [docs/deploy-cms.md](docs/deploy-cms.md). Blog posts are edited in the EmDash admin.

## Rules

- Do not commit secrets, `.env*`, SQLite databases or backups; `.gitignore`
  covers them.
- Anything that writes to production (`ssh`/`rsync` to `teppo-server`, service
  restarts) needs Juuso's explicit yes first.
- Verify deployed changes with `curl` against the live URL; an exit code is not
  proof.
