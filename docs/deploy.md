# Deploying to production

How changes get from this repo to <https://jaakkola.xyz>. Read this before any
production write. For the Ateneum P0 release in full detail (explicit file
manifest, stop/apply/start with automatic restore) see
[ateneum-p0-deploy.md](ateneum-p0-deploy.md); this page is the general version.

**Every step that writes to `teppo-server` needs Juuso's explicit yes**, including
service restarts. A runbook is a plan, not permission.

## Production topology

| Item | Value |
|---|---|
| SSH (app user, owns the files) | alias `teppo-server` (`clawdbot`, passwordless sudo) |
| SSH (root) | alias `hetzner-teppo` |
| App directory | `/home/clawdbot/jaakkolaxyz` (git checkout of this repo, plus untracked runtime files) |
| Service | `jaakkolaxyz.service` (systemd): `node dist/index.cjs`, `WorkingDirectory` = app directory, `EnvironmentFile` = `.env`, `PORT=5000`, `Restart=on-failure` |
| Reverse proxy | Caddy: everything on `jaakkola.xyz` → `localhost:5000`; `/api/dashboard/*` and `/dashboard/*` additionally sit behind basic auth (the dashboard code is not in the running bundle, so those routes have nothing behind them) |
| Runtime data, **not in git** | `.env`, `data/ateneum.db`, `data/dashboard.db` (SQLite, WAL mode), `releases/`, `backups/` |

There is no CI/CD. Production is updated by copying built files over SSH. The
server never builds from git itself.

## What changes where (pick the lightest path)

| You changed | Needs build | Needs restart | How |
|---|---|---|---|
| `data/learn/**` (learning tracks) | no | no | rsync, see [learn-sections.md](learn-sections.md) |
| `content/blog/{en,fi}/*.md` | no | no | copy the files; posts are read from disk on each request (`server/routes.ts`) |
| Blog images (`client/public/blog-images/`) | no | no | copy into **both** `client/public/blog-images/` and `dist/public/blog-images/` on the server (static files are served from `dist/public/`) |
| `client/`, `server/`, `shared/`, `public-static/`, `package.json` | **yes** | **yes** | full release (below) |

## Full release (code or client)

1. **Start from merged `main`.** Work happens on a branch and PR; deploy the merge
   commit (`MERGE_SHA`), never a dirty working tree.
2. **Build in a clean worktree**, not in your working copy:

   ```bash
   RELEASE_DIR=$(mktemp -d /tmp/jaakkolaxyz-release.XXXXXX)
   git worktree add --detach "$RELEASE_DIR" "$MERGE_SHA" && cd "$RELEASE_DIR"
   npm ci && npm run check && npm run test:ateneum && npm run build
   test -s dist/index.cjs && node --check dist/index.cjs
   ```

   Output: `dist/index.cjs` (server bundle) and `dist/public/` (client). Native
   packages listed in `dist/runtime-externals.json` (`argon2`, `better-sqlite3`,
   ...) are **not** bundled; they must exist in the server's `node_modules` at
   the lockfile version.
3. **Check server dependencies.** If `package.json` changed, compare
   `dist/runtime-externals.json` with `node_modules` on the server before
   deploying; run `npm ci` there only with permission, because it changes
   production's `node_modules`.
4. **Back up** before touching anything (see Backups).
5. **Dry run.** Upload to `releases/<name>/` on the server and `rsync -n` against
   the app directory with an explicit file list. The dry run must show only
   files you intend to change.
6. **Apply with a short stop:** stop the service, copy the files, start it. Stopping
   first means the new frontend is never served by the old API. Never rsync the
   whole repo or the whole `dist/`: `.env`, `data/`, `releases/`, `backups/` and
   `node_modules/` must not be overwritten or deleted. Do not use `--delete`.
7. **Verify** (below). If anything fails, roll back.

The Ateneum P0 runbook contains a complete, tested implementation of steps 4-7
(manifest-based backup, drift check after stop, restore on failure). Reuse its
structure for other releases.

## Backups

Before any release or schema change:

```bash
ssh teppo-server 'cd ~/jaakkolaxyz && B=backups/db-$(date +%Y%m%d-%H%M%S) && mkdir -m 700 "$B" &&
  for db in ateneum dashboard; do sqlite3 data/$db.db ".backup $B/$db.db"; done &&
  cp -p .env "$B/env.bak" && chmod 600 "$B"/* && echo "$B"'
```

`.backup` is safe on a live WAL database. Check the copies with
`PRAGMA integrity_check;`. Do not copy `data/*.db` with `cp` while the service is
running. Backups sit on the same disk; copy them off the server if the data
matters beyond a bad deploy. Migrations run on service start
(`migrateAteneumSchema`), so test schema changes against a copy of the database
(`tests/ateneum/migration_qa.py`) before the live start.

## Verify after every deploy

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/                      # 200
curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/api/ateneum/auth/me   # 401 without a session
curl -s https://jaakkola.xyz/learn/ | grep -o '<title>[^<]*'                        # Oppimispolut title, not the SPA
ssh teppo-server 'systemctl is-active jaakkolaxyz; journalctl -u jaakkolaxyz -n 30 --no-pager'
```

Check the page you actually changed (title and a snippet of unique content), not
just the status code. Look for restart loops in the journal.

## Rollback

- **Files:** restore from the backup taken in step 4 (`files-before.tar.gz` in the
  P0 pattern), then `node --check dist/index.cjs` and start the service.
- **Database:** only if a migration damaged data. Stop the service, keep the
  damaged file as `data/ateneum.db.failed-<timestamp>`, copy the backup over,
  run `PRAGMA quick_check`, start.
- Keep the previous release directory under `releases/` until the new one has
  been stable.

## Keeping production's git checkout aligned

The app directory is a git checkout, but files arrive by copy, so its `HEAD` can
drift from what is actually running. After each release, point `HEAD` at the
deployed commit **without touching files**:

```bash
ssh teppo-server 'cd ~/jaakkolaxyz && git fetch origin && git reset origin/main && git status --short'
```

`git reset` here is the default mixed reset: it moves `HEAD` and the index only.
The expected `git status` is empty except for ignored runtime files. Never use
`git reset --hard`, `git clean` or `git pull` there: untracked and ignored
runtime data (`.env`, databases, `data/learn/.backups`) lives in that directory.
Anything unexpected in `git status` is drift: stop and investigate it, do not
overwrite it.
