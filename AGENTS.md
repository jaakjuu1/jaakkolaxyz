# jaakkola.xyz

Personal site and apps of Juuso Jaakkola. Two parts:

- The public site (home, blog fi + en, privacy, `/learn/`, `/reports/`) is the EmDash
  app in `cms/` (Astro). Blog posts are edited in the EmDash admin; `content/blog/` is
  the original Markdown the import was made from. Runbook: `docs/deploy-cms.md` (coming).
- This repo's Express server (`server/`, shared types in `shared/`) serves only the
  private Ateneum app (`server/ateneum-*.ts`, `public-static/ateneum/`), the ops
  dashboard at `/dashboard/` (`server/dashboard-*.ts`, `public-static/dashboard/`) and
  the public contact form `POST /api/contact` (`server/contact.ts`). The old React
  client (`client/`) is no longer built or served; it stays only as the source the
  `cms/` import script reads, until the cutover cleanup.

Production runs on `teppo-server` (SSH alias) from `/home/clawdbot/jaakkolaxyz`
as the `jaakkolaxyz` systemd service (`node dist/index.cjs`).

## Learn sections

`/learn/` is static HTML in `data/learn/`, served by the Astro site in `cms/` at request
time (no rebuild). To create, edit, publish or sync a learn section, read
[docs/learn-sections.md](docs/learn-sections.md) first. It covers the folder layout,
page rules, how to deploy and how to verify against production.

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
