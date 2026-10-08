# Deploying the public site (EmDash, `cms/`)

Runbook for the public jaakkola.xyz site after the EmDash migration: home, blog (fi + en),
privacy, `/learn/`, `/reports/`. It is a **plan, not permission**. Every step that writes to
`teppo-server`, restarts a service, edits Caddy or changes production content needs Juuso's
explicit yes first. Steps marked **[read-only]** only read; they still use `ssh`, so they need
the yes too.

Structure follows [ateneum-p0-deploy.md](ateneum-p0-deploy.md): preconditions, build, backup,
stop, apply, start, verify, rollback. The general rules are in [deploy.md](deploy.md).
The Express app (Ateneum, dashboard, `POST /api/contact`) keeps its own runbook there.

## 0. Overview and topology

After cutover, Caddy sends `jaakkola.xyz` traffic to two local processes:

| Requests | Goes to | Notes |
|---|---|---|
| `/api/ateneum/*`, `/ateneum*`, `/api/contact` | Express `127.0.0.1:5000` (`jaakkolaxyz.service`) | unchanged |
| `/api/dashboard/*`, `/dashboard*` | Express `127.0.0.1:5000` | Basic Auth stays in Caddy |
| `/_emdash/*` | EmDash `127.0.0.1:4321` (`jaakkolaxyz-cms.service`) | admin and API limited to Juuso's IP (section 5); media files public |
| `/_astro/*` | EmDash | Astro already sends `Cache-Control: public, max-age=31536000, immutable` for hashed assets; Caddy adds nothing |
| everything else (`/`, `/blog`, `/privacy`, `/learn/`, `/reports/`, `/sitemap*.xml`, `/robots.txt`, `/rss.xml`) | EmDash `127.0.0.1:4321` | |

Until the Express split is deployed (section 12), Express still serves the old SPA at `/`.

The Caddy file is **shared**: it also serves other hosts on teppo-server (for example `kaskas.`,
`aro.` and `hermes.jaakkola.xyz`). Only the `jaakkola.xyz { ... }` block is ever changed
(section 5.4). Other sites stay byte-identical.

**Where the CMS lives: `/home/clawdbot/jaakkolaxyz/cms/`, inside the app checkout.** Reasons:

- Everything in `cms/` that is not git-tracked is already ignored: `cms/.gitignore` covers
  `node_modules/`, `dist/`, `data/`, `.env*`, and the root `.gitignore` covers `releases/`.
- `data/` next to `data/learn/` keeps one backup pattern for all SQLite data (`deploy.md`,
  Backups).
- A release is a directory under `cms/releases/`, and `cms/releases/current` is a symlink.
  Rollback is one `ln -sfn`.
- One thing does show in `git status`: the tracked `cms/` sources are absent on the server, so
  they appear as deleted until section 2.5 aligns the checkout. That step touches tracked paths only.

Layout on the server (`APP=/home/clawdbot/jaakkolaxyz`):

```text
$APP/data/learn/                      Hermes rsync target, unchanged; LEARN_DIR points here
$APP/cms/.env.production              EMDASH_ENCRYPTION_KEY only, chmod 600, not in git
$APP/cms/data/emdash.db               SQLite (WAL), shared by all releases
$APP/cms/data/uploads/                media files, shared by all releases
$APP/cms/data/sessions/               login sessions (fs driver); not backed up, see 11.2
$APP/cms/releases/<MERGE_SHA>/        one complete release: dist/, node_modules/, package*.json,
                                      data -> /home/clawdbot/jaakkolaxyz/cms/data (absolute link)
$APP/cms/releases/current             symlink to the active release (WorkingDirectory of the unit)
$APP/backups/cms-<timestamp>/         nightly backups (section 11)
```

Ports: EmDash `127.0.0.1:4321`. Express **listens on `0.0.0.0:5000`** (all interfaces, a known
fact; see 1.2 for the check from outside); Caddy uses `127.0.0.1:5000` as its upstream, as in the
table above. Hosts: `teppo-server` (app user
`clawdbot`, passwordless sudo, as in `deploy.md`) and `hetzner-teppo` (root, for systemd).

## 1. Preconditions

### 1.1 Facts that must hold before anything else

- The release is built from the merge commit of `feat/emdash-migration` into `main`
  (`MERGE_SHA`). That commit includes the session-driver setting in `cms/astro.config.mjs`.
  Never deploy a dirty tree.
- EmDash needs Node `^22.22.2 || ^24.15.0` (the registry-verification package). Production's
  system Node is **v22.21.0**, which is below that range. So the CMS unit runs a Node 24 LTS
  installed under `/opt` (section 1.4). Express keeps the system Node.
- The build machine needs a Node that meets the range as well (local Node 24.14.1 is too old:
  use 24.15.0 or newer). The build also downloads the self-hosted fonts from Google Fonts, so it
  needs network access.
- The old site is still up on `:5000` and its backup exists.

**Known production values** (checked read-only with Juuso's approval before this revision). The
commands in 1.2 and 1.3 stay in the runbook so that the values are re-checked on the day:

| Item | Known value |
|---|---|
| Caddy | v2.10.2 (older than the local test version 2.11.7; section 5.1 and 5.3) |
| System Node | v22.21.0 at `/usr/bin/node` (below the EmDash range, so section 1.4) |
| npm | 10.9.4 (system); the CMS commands use the npm of the `/opt` Node 24 |
| sqlite3 | 3.45.1 |
| Free disk | about 13 GB on `/` |
| Express | listens on `0.0.0.0:5000` (all interfaces) |
| App git checkout | `bee9465` (main) |
| Juuso's IPv4 (for the `/_emdash` restriction) | `80.220.157.227` (IPv6 not known; section 5.2) |

### 1.2 Read-only checks on teppo-server **[read-only, needs Juuso's yes]**

```bash
ssh teppo-server '
  set -u
  echo "system node: $(/usr/bin/node -v 2>/dev/null || echo MISSING)"
  echo "caddy: $(caddy version 2>/dev/null || echo "not on PATH")"
  sudo -n true && echo "sudo: passwordless OK"
  sqlite3 --version
  df -h / /home | tail -2
  du -sh /home/clawdbot/jaakkolaxyz/data /home/clawdbot/jaakkolaxyz/data/learn 2>/dev/null
  ss -ltnp | grep -E ":(4321|5000)[[:space:]]" || echo "ports 4321 and 5000: no listener on the first look (4321 must be free)"
  systemctl is-active jaakkolaxyz.service
  crontab -l
  hostname -I
'
ssh hetzner-teppo 'systemctl cat caddy | grep -E "ExecStart|ExecReload"; caddy version 2>/dev/null; ls -l /etc/caddy/'
```

Expect: system Node `v22.21.0` (note it, do not change it), Caddy `v2.10.2`, sqlite3 `3.45.1`, port 4321
free, Express on `0.0.0.0:5000`, about 13 GB free on `/` (room for a few hundred MB per release:
`node_modules` with `sharp`). The Caddy `ExecStart` line shows the config path (usually
`/etc/caddy/Caddyfile`). The crontab still has the dashboard refresh line. A different value from the
table in 1.1 is a reason to stop and re-read the affected section.

**External reachability (read-only, from outside the server, for example your laptop):** Express
listens on **all interfaces** (`0.0.0.0:5000`), so check from the internet that neither `:5000` nor
`:4321` answers. Use the public address from `hostname -I` (or the Hetzner console):

```bash
curl -m 5 -s -o /dev/null -w '%{http_code}\n' http://<PUBLIC_IP>:5000/   # expect 000 (refused or timeout)
curl -m 5 -s -o /dev/null -w '%{http_code}\n' http://<PUBLIC_IP>:4321/   # expect 000
```

If either answers, the firewall must be fixed first (a separate change that needs Juuso's yes).
`:5000` is the likelier one, because Express is bound to `0.0.0.0`; `:4321` is bound to
`127.0.0.1` by the unit (section 4), so it should never answer from outside.

### 1.3 Back up the current Caddyfile **[needs Juuso's yes, writes to /etc/caddy]**

```bash
ssh teppo-server 'TS=$(date +%Y%m%d-%H%M%S) && sudo cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$TS && sudo chmod 0644 /etc/caddy/Caddyfile.bak.$TS && sudo mkdir -p /root/caddy-backups && sudo cp -a /etc/caddy/Caddyfile /root/caddy-backups/Caddyfile.$TS && echo "/etc/caddy/Caddyfile.bak.$TS"'
mkdir -p ~/backups/jaakkolaxyz
ssh teppo-server 'sudo cat /etc/caddy/Caddyfile' > ~/backups/jaakkolaxyz/Caddyfile.$(date +%Y%m%d).original
```

`/root/caddy-backups/` already exists on the server (earlier Caddy changes were backed up there as
`Caddyfile.<YYYYMMDD-HHMMSS>`), so the new backup goes there too, with the same naming. The
copy next to the Caddyfile is the one the commands below use.

Write down the backup path (`CADDY_BAK=/etc/caddy/Caddyfile.bak.<TS>`). The `basic_auth` user and
hash for `/dashboard*` and `/api/dashboard/*` are copied from this file, not retyped (section 5).
Do not confuse it with a stale file: `/tmp/Caddyfile.new` and `/tmp/Caddyfile.old` on the server may
be left over from an earlier change. Section 5.4 deletes `/tmp/Caddyfile.new` before it uploads.

**Check:** `ssh teppo-server 'sudo caddy validate --config /etc/caddy/Caddyfile.bak.<TS> --adapter caddyfile'`
prints `Valid configuration`.

### 1.4 Node 24 for the CMS unit only **[needs Juuso's yes; installs under /opt, does not touch the system Node]**

The tarball comes from nodejs.org and is checked against the published SHA-256 list. Pick the
newest 24.x release that is 24.15.0 or later and set it here:

```bash
ssh teppo-server '
  set -euo pipefail
  NODE_VER=v24.15.0                     # any 24.x >= 24.15.0
  cd /tmp
  curl -fsSLO "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-x64.tar.xz"
  curl -fsSLO "https://nodejs.org/dist/$NODE_VER/SHASUMS256.txt"
  grep "node-$NODE_VER-linux-x64.tar.xz$" SHASUMS256.txt | sha256sum -c -
  sudo mkdir -p "/opt/node-$NODE_VER"
  sudo tar -xJf "node-$NODE_VER-linux-x64.tar.xz" -C "/opt/node-$NODE_VER" --strip-components=1
  "/opt/node-$NODE_VER/bin/node" -v
  /usr/bin/node -v
'
```

The `sha256sum -c` against `SHASUMS256.txt` is the accepted minimum. Optional and stronger: also
verify the GPG signature of the list (`SHASUMS256.txt.asc`, `gpg --verify`) against the Node.js
release keys published in the nodejs/node README; that protects against a tampered list, not
only a tampered tarball.

**Check:** the first `node -v` prints the `/opt` version (24.15.0 or newer); the second still prints
`v22.21.0`. The unit (section 4) and every `npm`/`npx` for the CMS use `/opt/node-v24.15.0/bin`.

## 2. Build the release

> **GitHub login is enabled (section 6.5), so releases are built on the server.** EmDash reads
> `EMDASH_OAUTH_GITHUB_CLIENT_ID`/`_SECRET` through `import.meta.env`, which Astro inlines into
> `dist/server` at build time (not into `dist/client`; checked). A release built without them has
> no GitHub login, and building locally would copy the secret off the server. Follow 6.5 for the
> build; 2.1-2.4 below describe the first release, which had no OAuth.

### 2.1 Build in a clean worktree (local machine, no production access)

```bash
set -euo pipefail
MERGE_SHA=<MERGE_SHA>
NODE_BIN=<bin dir of a Node >= 24.15.0 or >= 22.22.2, e.g. installed with nvm>   # local Node 24.14.1 is too old
RELEASE_DIR=$(mktemp -d /tmp/jaakkolaxyz-cms-release.XXXXXX)
git -C /home/juuso/temp/jaakkolaxyz worktree add --detach "$RELEASE_DIR" "$MERGE_SHA"
cd "$RELEASE_DIR/cms"
export PATH="$NODE_BIN:$PATH"
node -v                                # must be v24.15.0+ or v22.22.2+
npm ci
npm run typecheck
EMDASH_SITE_URL=https://jaakkola.xyz npm run build

# Build guards (fail the release if either is false)
test -s dist/server/entry.mjs
test -d dist/client
test -s .emdash/migrations.json
grep -qF '"allowedDomains":[{"hostname":"jaakkola.xyz"}]' dist/server/chunks/app_*.mjs || { echo "FAIL: site URL not in build"; exit 1; }
! grep -rqF 'node_modules/.astro/sessions' dist || { echo "FAIL: session path baked in"; exit 1; }
```

`EMDASH_SITE_URL` must be set **at build time and at run time** (passkeys are bound to it;
sitemaps and canonical URLs use it). The run-time value is in the unit (section 4). The first guard
checks the build-time value: EmDash writes `allowedDomains` from the site URL, and a build without
`EMDASH_SITE_URL` produces `"allowedDomains":[]`. That was checked locally, with and without the variable.
The second guard checks the session setting in `cms/astro.config.mjs`: without it, the adapter bakes a
`node_modules/.astro/sessions` path of the build directory into the bundle.

Keep the worktree until the release is verified, then remove it:
`git -C /home/juuso/temp/jaakkolaxyz worktree remove "$RELEASE_DIR"`.

### 2.2 What to copy, and why

| Item | Copy? | Why |
|---|---|---|
| `dist/` | **yes** | the server bundle (`dist/server/entry.mjs`) and the static client (`dist/client/`, including `reports/` and fonts) |
| `package.json`, `package-lock.json` | **yes** | `npm ci --omit=dev` on the server; `emdash` finds the project root from them |
| `.emdash/migrations.json` | **yes** | written by `astro build`; `npx emdash migrate` reads it on the server (section 11.3) |
| `seed/seed.json` | no | the seed is embedded in `dist/` at build time (`virtual:emdash/seed`); the setup wizard does not read the file at run time |
| `scripts/`, `tests/`, `src/`, `.astro/` | no | the import script reads `../content/` and `../client/` from the repo, so it runs from the local checkout against the production URL; smoke tests run locally with `CMS_URL` |
| `node_modules/` | **no, install on the server** | see the decision below |

**node_modules decision: `npm ci --omit=dev` on the server, from the copied lockfile.** The
dependency tree contains `sharp` (Astro's image service), which ships native code in platform
packages (`@img/sharp-linux-x64`, ...) chosen at install time. Copying `node_modules` from the
WSL build machine risks a platform mismatch and drags in dev-only packages (`@astrojs/check`,
Tailwind, `tsx`) that the server never needs. Installing from the same lockfile on the server
reproduces the verified tree. The cost is that the server needs npm registry access during the
release. Before the first production release, run `npm ci --omit=dev` on a scratch copy of the
tarball and start it with a copy of the DB (section 9.1, optional test).

### 2.3 Package and upload **[needs Juuso's yes]**

```bash
set -euo pipefail
cd "$RELEASE_DIR/cms"
ARTIFACT=/tmp/jaakkolaxyz-cms-${MERGE_SHA}.tar.gz
tar -czf "$ARTIFACT" dist package.json package-lock.json .emdash/migrations.json
SHA=$(sha256sum "$ARTIFACT" | cut -d' ' -f1); echo "$SHA"   # record it in the release notes
scp "$ARTIFACT" teppo-server:/tmp/
ssh teppo-server "echo '$SHA  /tmp/jaakkolaxyz-cms-${MERGE_SHA}.tar.gz' | sha256sum -c -"
```

### 2.4 Install the release next to the running one **[needs Juuso's yes; does not touch the live release]**

```bash
ssh teppo-server '
  set -euo pipefail
  CMS=/home/clawdbot/jaakkolaxyz/cms
  MERGE_SHA=<MERGE_SHA>
  NODE_BIN=/opt/node-v24.15.0/bin
  REL="$CMS/releases/$MERGE_SHA"
  test ! -e "$REL"                                  # never overwrite a release
  mkdir -p "$CMS/data/uploads" "$CMS/data/sessions" "$REL"
  chmod 700 "$CMS/data"
  tar -xzf "/tmp/jaakkolaxyz-cms-$MERGE_SHA.tar.gz" -C "$REL"
  ln -sfn "$CMS/data" "$REL/data"                   # absolute target: the same DB and uploads for every release
  cd "$REL"
  PATH="$NODE_BIN:$PATH" npm ci --omit=dev
  test -s dist/server/entry.mjs
  test -d dist/client
  "$NODE_BIN/node" -e "require(\"./node_modules/sharp\")" && echo "sharp loads"
  echo "RELEASE=$REL"
'
```

Record the `RELEASE=` path. The step only creates files under `cms/releases/` and `cms/data/`.
It does not stop or restart anything.

**Check:** `sharp loads` is printed. If not, the platform package is wrong; stop and fix the install,
do not start the service.

**Rollback at this point:** `rm -rf cms/releases/<MERGE_SHA>` (nothing live changed).

### 2.5 Align the server checkout after the merge to main **[needs Juuso's yes]**

`deploy.md` realigns the production checkout with `git reset origin/main` (mixed reset: `HEAD` and
the index move, files do not). The checkout is at `bee9465` (main) today. After the reset, the
tracked `cms/` sources are in git but absent on disk, so `git status` shows `D cms/...`. Restore only
the tracked `cms/` paths:

```bash
ssh teppo-server 'cd /home/clawdbot/jaakkolaxyz && git fetch origin && git reset origin/main && git checkout origin/main -- cms && git status --short'
```

`git checkout origin/main -- cms` writes and stages only tracked paths under `cms/`. It does not touch
`cms/data/`, `cms/releases/`, `cms/node_modules/`, `cms/dist/` or `cms/.env.production`, because
those are ignored and untracked. The expected `git status` after it is empty (ignored runtime
files do not show), except for the `data/learn/**` drift that `deploy.md` describes.

## 3. Secrets: the production encryption key

The production key is new. **Never copy `cms/.env` from the dev machine** and never reuse the dev
key: it protects plugin secrets and encrypted settings, and the dev key is in a dev file.

Generate it on the server, so it never travels through the chat, a repo or a laptop:

```bash
ssh teppo-server '
  set -euo pipefail
  umask 077
  export PATH=/opt/node-v24.15.0/bin:$PATH
  ENVF=/home/clawdbot/jaakkolaxyz/cms/.env.production
  test ! -e "$ENVF" || { echo "exists, not overwriting"; exit 1; }
  : > "$ENVF"
  chmod 600 "$ENVF"
  cd /home/clawdbot/jaakkolaxyz/cms/releases/<MERGE_SHA>
  npx emdash secrets generate --write "$ENVF"
  chmod 600 "$ENVF"
  KEY=$(cut -d= -f2- "$ENVF")
  npx emdash secrets fingerprint "$KEY"
  unset KEY
'
```

`--write` refuses to overwrite an existing key without `--force`, and the file was created with
mode 600 first. The fingerprint (8 characters) is not the key; write it into the secret backup.
The key passes through the process arguments of the fingerprint command for a moment; this is a
single-user server.

**Secret backup (Juuso):** copy the single line `EMDASH_ENCRYPTION_KEY=...` from the server into
the password manager. Print it only in your own terminal
(`ssh teppo-server 'grep ^EMDASH_ENCRYPTION_KEY= ~/jaakkolaxyz/cms/.env.production'`), and do not
paste it into a chat, a commit or a log. Losing this key means losing every secret encrypted with
it.

`.env.production` contains only the key. Everything else is in the unit (section 4), where it is
reviewed in git. The file is ignored by `cms/.gitignore` (`.env.*`).

## 4. systemd unit `jaakkolaxyz-cms.service`

Non-secret configuration is in the unit. The secret is read from `.env.production`.

```ini
[Unit]
Description=jaakkola.xyz public site (EmDash, Astro on Node)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=clawdbot
Group=clawdbot
WorkingDirectory=/home/clawdbot/jaakkolaxyz/cms/releases/current
EnvironmentFile=/home/clawdbot/jaakkolaxyz/cms/.env.production
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=4321
Environment=EMDASH_SITE_URL=https://jaakkola.xyz
Environment=LEARN_DIR=/home/clawdbot/jaakkolaxyz/data/learn
ExecStart=/opt/node-v24.15.0/bin/node dist/server/entry.mjs
Restart=on-failure
RestartSec=3
UMask=0077

NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=/home/clawdbot/jaakkolaxyz/cms/data
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=

[Install]
WantedBy=multi-user.target
```

Why these settings:

- `WorkingDirectory` is the `current` symlink. The config reads `file:./data/emdash.db`,
  `./data/uploads` and `./data/sessions` relative to the working directory; each release has
  `data -> /home/clawdbot/jaakkolaxyz/cms/data`, so the DB, uploads and sessions are shared.
- `ReadWritePaths` must **exist before the unit starts**, or systemd fails the namespace setup
  (exit 226). That is why `mkdir -p cms/data/uploads cms/data/sessions` is a manual step in 2.4 and
  not an `ExecStartPre`.
- `ProtectSystem=full` keeps `/usr` and `/etc` read-only. It does not break SQLite WAL (the DB
  directory is in `ReadWritePaths`), uploads or sessions. `ProtectSystem=strict` is a later option.
- `CapabilityBoundingSet=` drops all capabilities; the service listens on 4321, above 1024.
- `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX` allows TCP/UDP over IPv4 and IPv6 and Unix
  sockets only. It was tested: the smoke suite passed 60/60 with it set.
- Not set, on purpose: `MemoryDenyWriteExecute` (V8 needs writable and executable memory) and
  `ProtectHome=true` (the working directory is under `/home`).

Install the unit **[needs Juuso's yes; writes /etc/systemd/system]**:

```bash
scp jaakkolaxyz-cms.service teppo-server:/tmp/
ssh teppo-server 'sudo install -o root -g root -m 0644 /tmp/jaakkolaxyz-cms.service /etc/systemd/system/jaakkolaxyz-cms.service'
ssh hetzner-teppo 'systemd-analyze verify /etc/systemd/system/jaakkolaxyz-cms.service; systemctl daemon-reload; echo reloaded'
```

The file is installed but **not started or enabled**. Section 6 does that. Verification warnings
about the unit are read, not ignored.

**Rollback:** `ssh hetzner-teppo 'rm /etc/systemd/system/jaakkolaxyz-cms.service && systemctl daemon-reload'`
(the unit is not running at this point).

## 5. Caddy

Caddy serves other sites from the same file, so the change is **one block**: `jaakkola.xyz { ... }`.
Everything else stays byte-identical. The `basic_auth` user and hash, and any directive inside the
block that is not shown here (logging, TLS), are copied from the backup (`$CADDY_BAK`), not retyped.
The placeholders below stand for those values.

### 5.1 Why `header_up X-Forwarded-For {remote_host}`

EmDash takes the **first** entry of `X-Forwarded-For` as the client IP. That IP keys the passkey and
login rate limits (`trustedProxyHeaders: ["x-forwarded-for"]` in `astro.config.mjs`). If a client
could choose that value, it could get a fresh rate-limit bucket on every request.

Caddy 2.11.7 already replaces a client-sent `X-Forwarded-For` with the TCP peer. A local test with
an echo upstream showed this without any `header_up` (the spoofed value never reached the upstream).
The server runs Caddy **v2.10.2**, which was not tested that way, and older Caddy versions append
instead. So the override is set explicitly, `header_up X-Forwarded-For {remote_host}`, rather than
relying on the version. The explicit `header_up` also matters if `trusted_proxies` is configured
globally in the shared Caddyfile (global options): Caddy then trusts the peers it lists and keeps
what they send, so the override is what keeps the value honest. (Caddy's validator may warn
"Unnecessary header_up X-Forwarded-For" on a version that already does this; the warning is harmless
and the line stays.) `{remote_host}` is the TCP peer, which is the real client here. Express is unaffected:
`server/index.ts` uses `trust proxy: loopback`; the Express blocks keep Caddy's default.

When Cloudflare goes in front (section 12), the peer becomes Cloudflare's address. Then Caddy needs
`trusted_proxies` and the client IP must come from `CF-Connecting-IP`. Revisit this block then.

### 5.2 First start (the admin is open only to Juuso's IP)

Use this block **during section 6**. Save it as `jaakkola-block.caddy`. Juuso's IPv4 is known:
`80.220.157.227` (re-check it with `curl -4 -s https://ifconfig.me` from the machine with the
browser; it can change). His **IPv6 is not known**, so the block starts with the IPv4 only. If the
browser gets `403` on `/_emdash/admin`, it is connecting over IPv6 (or from another IPv4): read the
address from the Caddy access log (the file named in the `log` directive of the backup block, or
`journalctl -u caddy`), or run `curl -6 -s https://ifconfig.me` on that machine, then add it after the
IPv4 on the `not remote_ip` line (space-separated) and redeploy with 5.4. A `403` here is the
restriction working, not a bug.

```text
jaakkola.xyz {
	# Express (127.0.0.1:5000): Ateneum, dashboard, contact form. Same as today.
	handle /api/ateneum/* {
		reverse_proxy 127.0.0.1:5000
	}
	handle /ateneum* {
		reverse_proxy 127.0.0.1:5000
	}
	handle /api/contact {
		reverse_proxy 127.0.0.1:5000
	}
	handle /dashboard* {
		basic_auth {
			<USER-FROM-BACKUP> <HASH-FROM-BACKUP>
		}
		reverse_proxy 127.0.0.1:5000
	}
	handle /api/dashboard/* {
		basic_auth {
			<USER-FROM-BACKUP> <HASH-FROM-BACKUP>
		}
		reverse_proxy 127.0.0.1:5000
	}

	# EmDash admin and API: Juuso's IP only. Media files stay public.
	# Add his IPv6 after the IPv4 (space-separated) if the browser gets 403 over IPv6.
	@emdash_blocked {
		path /_emdash/*
		not path /_emdash/api/media/file/*
		not remote_ip 80.220.157.227
	}
	handle @emdash_blocked {
		respond 403
	}

	# Admin and its assets go to EmDash.
	@emdash_assets path /_emdash/* /_astro/*
	handle @emdash_assets {
		reverse_proxy 127.0.0.1:4321 {
			header_up X-Forwarded-For {remote_host}
		}
	}

	# Public traffic still goes to the old Express SPA until the switch (section 8).
	handle {
		reverse_proxy 127.0.0.1:5000
	}
}
```

### 5.3 Final (after the switch, section 8)

Public traffic goes to EmDash. The admin stays limited to Juuso's IP unless he decides otherwise
(section 8). Save it as `jaakkola-block.caddy` (replacing the 5.2 file).

```text
jaakkola.xyz {
	# Express (127.0.0.1:5000): Ateneum, dashboard, contact form.
	handle /api/ateneum/* {
		reverse_proxy 127.0.0.1:5000
	}
	handle /ateneum* {
		reverse_proxy 127.0.0.1:5000
	}
	handle /api/contact {
		reverse_proxy 127.0.0.1:5000
	}
	handle /dashboard* {
		basic_auth {
			<USER-FROM-BACKUP> <HASH-FROM-BACKUP>
		}
		reverse_proxy 127.0.0.1:5000
	}
	handle /api/dashboard/* {
		basic_auth {
			<USER-FROM-BACKUP> <HASH-FROM-BACKUP>
		}
		reverse_proxy 127.0.0.1:5000
	}

	# EmDash admin and API: Juuso's IP only. Delete this handle to open the admin to everyone (passkeys still required).
	@emdash_blocked {
		path /_emdash/*
		not path /_emdash/api/media/file/*
		not remote_ip 80.220.157.227
	}
	handle @emdash_blocked {
		respond 403
	}

	# Everything else: EmDash (home, blog, privacy, /learn/, /reports/, sitemaps, robots, RSS, hashed assets).
	# Optional: add `header -Server-Timing` here to hide timing headers.
	handle {
		reverse_proxy 127.0.0.1:4321 {
			header_up X-Forwarded-For {remote_host}
		}
	}
}
```

Both blocks were validated locally with Caddy 2.11.7 (`caddy validate --adapter caddyfile`), with
dummy values in the placeholders. The admin matcher adapts to `path /_emdash/*` AND NOT (media OR
`remote_ip`), which is the intent. The server runs Caddy 2.10.2, so validate again there with its own
Caddy (5.4, step 4); a directive that 2.10.2 does not know fails there, before anything is installed.

### 5.4 Replace only the jaakkola.xyz block **[needs Juuso's yes; reloads Caddy, which serves all sites]**

```bash
# 1. The full current file, read-only, and a check that it equals the backup from 1.3
CADDY_BAK=/etc/caddy/Caddyfile.bak.<TS>          # the path written down in 1.3 (in section 8: the new <TS-SWITCH> backup)
ssh teppo-server 'sudo cat /etc/caddy/Caddyfile' > Caddyfile.current
ssh teppo-server "sudo cat $CADDY_BAK" | cmp - Caddyfile.current && echo "matches backup"
grep -n '^jaakkola\.xyz' Caddyfile.current        # must print exactly one line: "jaakkola.xyz {"; note its line number
wc -l < Caddyfile.current                         # note the total number of lines

# 2. Splice: only the jaakkola.xyz block is replaced. The script (below the code block) stops if the
#    header is not unique, if the closing brace is not found, or if an unindented line is inside the block.
python3 splice-caddy.py Caddyfile.current jaakkola-block.caddy Caddyfile.new

# 3. Read the result (checks below). Do not go on until both hold.
diff -u Caddyfile.current Caddyfile.new

# 4. Upload, validate IN PLACE (relative imports resolve against /etc/caddy, not /tmp), install, reload.
#    First remove any stale upload, so that a failed upload can never install an old file.
ssh teppo-server 'rm -f /tmp/Caddyfile.new'
scp Caddyfile.new teppo-server:/tmp/Caddyfile.new
sha256sum Caddyfile.new                           # local checksum
ssh teppo-server 'sha256sum /tmp/Caddyfile.new'   # must be the same checksum, or stop
ssh teppo-server '
  set -e
  sudo install -o root -g root -m 0644 /tmp/Caddyfile.new /etc/caddy/Caddyfile.new
  if sudo caddy validate --config /etc/caddy/Caddyfile.new --adapter caddyfile; then
    sudo mv /etc/caddy/Caddyfile.new /etc/caddy/Caddyfile && sudo systemctl reload caddy && systemctl is-active caddy
  else
    sudo rm -f /etc/caddy/Caddyfile.new
    echo "validate failed: nothing installed, Caddy untouched"; exit 1
  fi
'
```

Save this as `splice-caddy.py` next to the files (it is reviewed and was tested on a multi-site sample
with a trailing-space closing brace, a snippet, a top-level `import` and a CRLF variant):

```python
import re, sys
full, block, out = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(full, encoding="utf-8", newline="").read().splitlines(keepends=True)
starts = [i for i, l in enumerate(lines) if re.match(r"^jaakkola\.xyz[ \t]*\{[ \t]*\r?\n?$", l)]
if len(starts) != 1:
    sys.exit(f"expected exactly one 'jaakkola.xyz {{' header, found {len(starts)}")
start, depth, end = starts[0], 0, None
for j in range(start, len(lines)):
    code = lines[j].split("#")[0]
    depth += code.count("{") - code.count("}")
    if depth == 0:
        end = j; break
if end is None:
    sys.exit("no matching closing brace")
for l in lines[start + 1:end]:
    if l.strip() and l[0] not in " \t#":
        sys.exit(f"unexpected unindented line inside the block: {l.strip()!r}")
new = open(block, encoding="utf-8", newline="").read()
new = new if new.endswith("\n") else new + "\n"
open(out, "w", encoding="utf-8", newline="").write("".join(lines[:start]) + new + "".join(lines[end + 1:]))
print(f"replaced lines {start+1}-{end+1}; {start} lines before and {len(lines)-end-1} after are untouched")
```

Checks after step 3 (by the operator, not by the script):

1. **The untouched lines match the backup.** The script prints
   `replaced lines S-E; N lines before and M after are untouched`. `S` must equal the line number
   `grep -n` printed in step 1, `N` must be `S-1`, and `M` must equal the `wc -l` total minus `E`.
   Any other numbers mean the script found a different block than you expect: stop.
2. **Read `diff -u` line by line.** Every change must be inside the `jaakkola.xyz { ... }` block;
   the `@@` headers and context lines show that the other sites are not touched. Look especially at
   every `-` line of the old block that has no counterpart in the new block (for example `encode`,
   `log`, `import ...`, `header ...`, `tls`). The splice drops them **silently**. Carry each one into
   `jaakkola-block.caddy` deliberately (or decide with Juuso to remove it), then repeat steps 2 and 3,
   before anything is installed.

**Line endings:** the script keeps the line endings of the untouched parts and inserts the block file
as it is. If the live file uses CRLF (`file Caddyfile.current` says "CRLF line terminators"), convert
`jaakkola-block.caddy` to CRLF first (`sed -i 's/$/\r/' jaakkola-block.caddy`), so that the result does
not mix endings. If the header is not a plain `jaakkola.xyz {` line (for example
`jaakkola.xyz, www.jaakkola.xyz {`), the script finds no header and stops; edit that case by hand
with Juuso.

If the validate step fails, `/etc/caddy/Caddyfile.new` is removed, `/etc/caddy/Caddyfile` and the
running Caddy are unchanged. Stop and report the error; do not retry blindly.

**Check:** `systemctl is-active caddy` prints `active`. From a network other than Juuso's,
`curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/_emdash/admin/` returns `403`. The
public `https://jaakkola.xyz/` still returns the old site (section 6 keeps public traffic on Express).
The other hosts (`kaskas.`, `aro.`, `hermes.`) still answer as before: check one of them.

**Rollback (whole file, from the backup of 1.3):**
`ssh teppo-server 'sudo install -o root -g root -m 0644 /etc/caddy/Caddyfile.bak.<TS> /etc/caddy/Caddyfile && sudo systemctl reload caddy && systemctl is-active caddy'`.

## 6. First start and setup

The unit is started **while Caddy still sends public traffic to Express**. Only `/_emdash/*` for
Juuso's IP reaches EmDash.

### 6.1 Start the service **[needs Juuso's yes]**

```bash
ssh teppo-server '
  set -euo pipefail
  CMS=/home/clawdbot/jaakkolaxyz/cms
  ln -sfn "$CMS/releases/<MERGE_SHA>" "$CMS/releases/current.new"
  mv -T "$CMS/releases/current.new" "$CMS/releases/current"
  readlink "$CMS/releases/current"
'
ssh hetzner-teppo 'systemctl enable --now jaakkolaxyz-cms.service && systemctl is-active jaakkolaxyz-cms.service'
ssh teppo-server 'journalctl -u jaakkolaxyz-cms.service -n 40 --no-pager; ss -ltnp | grep 4321'
ssh teppo-server 'curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4321/_emdash/api/setup/status'
```

The first request runs the database migrations (`EMDASH_MIGRATIONS_MODE` defaults to `auto`).

**Check:** the journal shows the server listening, with no migration error and no restart loop.
`ss` shows the listener on `127.0.0.1:4321` only (not `0.0.0.0`). The setup endpoint answers `200`
with a JSON body. Do not trust the exit code alone.

**Rollback:** `ssh hetzner-teppo 'systemctl disable --now jaakkolaxyz-cms.service'`. The DB stays in
`cms/data/`, so a later start picks up where this one left off.

### 6.2 Setup wizard and passkeys **[Juuso does this in a browser]**

1. From Juuso's IP, open `https://jaakkola.xyz/_emdash/admin`. The public origin is required: a
   passkey created on `localhost` is bound to that origin and will not work here.
2. Complete the setup wizard. The first person to finish it becomes the admin. Create the passkey
   on this device.
3. Register a **second passkey** on another device (account and security settings).
4. Create an API token for scripts: Settings > API Tokens. Store it in the password manager. Do not
   put it in a file in the repo.

The dev bypass (`/_emdash/api/setup/dev-bypass`) is refused in production (`import.meta.env.DEV`
is false). Do not try it.

### 6.3 Delete the built-in `category` taxonomy **[needs Juuso's yes: write]**

Every fresh DB gets a built-in `category` taxonomy from a core migration, which the seed cannot
remove. Run from the laptop; the token is read silently so it stays out of shell history.

```bash
read -rs EMDASH_TOKEN && export EMDASH_TOKEN
curl -s -X DELETE -H "Authorization: Bearer $EMDASH_TOKEN" https://jaakkola.xyz/_emdash/api/taxonomies/category
curl -s -H "Authorization: Bearer $EMDASH_TOKEN" https://jaakkola.xyz/_emdash/api/taxonomies | head -c 600
```

**Check:** the taxonomy list shows `tag` and no `category`. A `404` on the DELETE means it was
already gone, which is fine.

### 6.4 Check the schema **[read-only; run from the local cms/ checkout]**

`npx` resolves the local `emdash` package in `cms/`; the commands talk to production over HTTPS.

```bash
cd /home/juuso/temp/jaakkolaxyz/cms
npx emdash schema list --url https://jaakkola.xyz --token "$EMDASH_TOKEN"
npx emdash schema get learn_tracks --url https://jaakkola.xyz --token "$EMDASH_TOKEN"
npx emdash taxonomy list --url https://jaakkola.xyz --token "$EMDASH_TOKEN"
```

**Check:** collections are exactly `posts`, `pages`, `learn_tracks`. `learn_tracks` has the fields
`title`, `kind`, `blurb`, `lesson_count`, `track_status`, `order`, `group` (select:
`ymmartaminen`, `rakentaja`) and `stats_note`. Taxonomy `tag` is present. A fresh DB gets all of
this from the seed. If `group` or `stats_note` is missing, the seed did not apply: follow the
"older database" steps in `cms/README.md`, not a hand edit.

**Rollback for section 6:** no content has been imported yet. Stop the unit and restore the Caddy
file (5.4 rollback). Recreating the DB is a data move: only with Juuso's yes, and only before any
import:
`ssh teppo-server 'mv /home/clawdbot/jaakkolaxyz/cms/data/emdash.db /home/clawdbot/jaakkolaxyz/cms/data/emdash.db.empty-<TS>'`
(after `systemctl stop`).

### 6.5 GitHub login and building on the server **[needs Juuso's yes]**

Passkeys stay the main login; GitHub is the fallback (`authProviders: [github()]` in
`cms/astro.config.mjs`). EmDash links the GitHub account to the EmDash user whose email equals the
GitHub account's **primary verified** email.

1. Juuso creates a GitHub OAuth app (github.com/settings/applications/new): homepage
   `https://jaakkola.xyz`, callback `https://jaakkola.xyz/_emdash/api/auth/oauth/github/callback`,
   then a client secret. He appends both to the server's env file himself, so the secret never
   leaves his terminal:
   ```bash
   read -rp "Client ID: " ID && read -rsp "Client secret: " SEC && echo && printf 'EMDASH_OAUTH_GITHUB_CLIENT_ID=%s\nEMDASH_OAUTH_GITHUB_CLIENT_SECRET=%s\n' "$ID" "$SEC" | ssh teppo-server 'cat >> ~/jaakkolaxyz/cms/.env.production' && unset ID SEC
   ```
2. Build on the server from the merge commit, with only the variables the build needs (the
   encryption key is not exported into the build). The source is `git archive` of `cms/`:
   ```bash
   git -C /home/juuso/temp/jaakkolaxyz archive --format=tar.gz -o /tmp/cms-src-<SHA>.tar.gz <SHA> cms
   scp /tmp/cms-src-<SHA>.tar.gz teppo-server:/tmp/
   ssh teppo-server '
     set -euo pipefail
     CMS=/home/clawdbot/jaakkolaxyz/cms; SHA=<SHA>; REL="$CMS/releases/$SHA"; NODE_BIN=/opt/node-v24.21.0/bin
     test ! -e "$REL"; mkdir -p "$REL"
     tar -xzf /tmp/cms-src-$SHA.tar.gz -C "$REL" --strip-components=1
     cd "$REL"
     ID=$(grep ^EMDASH_OAUTH_GITHUB_CLIENT_ID= "$CMS/.env.production" | cut -d= -f2-)
     SEC=$(grep ^EMDASH_OAUTH_GITHUB_CLIENT_SECRET= "$CMS/.env.production" | cut -d= -f2-)
     PATH="$NODE_BIN:$PATH" npm ci
     env -i PATH="$NODE_BIN:/usr/bin:/bin" HOME="$HOME" EMDASH_SITE_URL=https://jaakkola.xyz \
       EMDASH_OAUTH_GITHUB_CLIENT_ID="$ID" EMDASH_OAUTH_GITHUB_CLIENT_SECRET="$SEC" npm run build
     grep -rqF -- "$ID" dist/server && ! grep -rqF -- "$SEC" dist/client   # in the server bundle, never in the client
     unset ID SEC
     grep -qF "\"allowedDomains\":[{\"hostname\":\"jaakkola.xyz\"}]" dist/server/chunks/app_*.mjs
     ! grep -rqF node_modules/.astro/sessions dist
     PATH="$NODE_BIN:$PATH" npm prune --omit=dev
     chmod -R go-rwx dist
     # astro.config.mjs creates data/uploads at config load, so the build leaves a real data/ dir.
     # `ln -sfn` onto a directory would put the link INSIDE it; remove the empty dirs first.
     find "$REL/data" -mindepth 1 ! -type d | grep -q . && { echo "files in build data/, stop"; exit 1; }
     rm -rf "$REL/data"
     ln -s "$CMS/data" "$REL/data"
     test "$(readlink "$REL/data")" = "$CMS/data"
     rm -f /tmp/cms-src-$SHA.tar.gz
   '
   ```
   `dist/server` now holds the secret: the release directory is mode 700 for `clawdbot`, like
   `.env.production`. The server needs npm registry and Google Fonts access during the build.
3. Switch: `ln -sfn` the new release to `releases/current.new`, `mv -T` it over `current`,
   `systemctl restart jaakkolaxyz-cms`, then the smoke suite (9.1). Rollback: point `current` back at
   the previous release and restart (10.4).
4. Juuso tests the "GitHub" button on `/_emdash/admin/login` from his IP.

## 7. Content

Production starts with the seed scaffold only. The import needs an **empty** target: a package
can only go into a site without content rows (`TRANSFER_TARGET_NOT_EMPTY` otherwise). Import
before anyone writes content in production.

### 7.1 Preferred: export the verified local site, analyze, then confirm

Prerequisite: the local dev server runs the imported content (the state the smoke suite was checked
against: `npm run dev` in `cms/`, then `npm run import`). Keep the export **outside the repo**. Run
these from the local `cms/` checkout.

```bash
mkdir -p ~/backups/emdash
cd /home/juuso/temp/jaakkolaxyz/cms
npx emdash site export --url http://localhost:4321 --output ~/backups/emdash/site-$(date +%Y%m%d).emdash
```

Analyze against production. **[the analysis uploads the package to production; needs Juuso's yes]**

```bash
read -rs EMDASH_TOKEN && export EMDASH_TOKEN
npx emdash site import ~/backups/emdash/site-<DATE>.emdash \
  --url https://jaakkola.xyz --token "$EMDASH_TOKEN" --analyze \
  --map-principal "dev@emdash.local=<PROD-ADMIN-EMAIL>"
```

The package carries the id, name and email of each user who authored exported rows (principals),
never passwords or passkeys. `--map-principal` maps the local dev author to Juuso's production user;
without it the plan may show a blocker. Read the plan: expected 4 fi and 5 en posts, 2 pages, 7
`learn_tracks`, the `tag` terms, and media (the blog images). Exit code `2` means the plan has
blockers; do not confirm then. The analysis prints a plan digest.

**Juuso reviews the plan and the digest.** Take a DB backup first (section 11.1, run by hand), then,
**[needs Juuso's explicit yes; writes to production]**:

```bash
npx emdash site import ~/backups/emdash/site-<DATE>.emdash \
  --url https://jaakkola.xyz --token "$EMDASH_TOKEN" \
  --plan <DIGEST-FROM-ANALYZE> --confirm
```

`--plan` carries the decisions of the analysis (including the principal mapping), so `--confirm`
does not take `--map-principal`; it is valid only with `--analyze`. Any change to the mapping changes
the digest and needs a new analysis. If the import fails or is interrupted, the site is
write-blocked: check it with `npx emdash site import status <OPERATION-ID> --url https://jaakkola.xyz --token "$EMDASH_TOKEN"`,
resume with `npx emdash site import resume <OPERATION-ID> ...`, or lift the block with
`npx emdash site import abandon <OPERATION-ID> ...` (this does not delete what was written). If the
result is wrong, restore the DB backup (section 10.3).

### 7.2 Alternative: the import script against production

Runs from the local checkout, which has the content, learn files and client assets.

```bash
read -rs EMDASH_TOKEN && export EMDASH_TOKEN
cd /home/juuso/temp/jaakkolaxyz/cms
EMDASH_URL=https://jaakkola.xyz EMDASH_TOKEN="$EMDASH_TOKEN" npm run import   # [needs Juuso's yes: writes production]
```

It is idempotent (existing slug and locale are skipped). Use `-- --update` only to rewrite entries on
purpose. The token is created in the admin (section 6.2).

### 7.3 Verify the content **[read-only]**

```bash
cd /home/juuso/temp/jaakkolaxyz/cms
CMS_URL=https://jaakkola.xyz npm run test:smoke          # section 9: counts, slugs, translation links
```

Expect: `/blog` lists 4, `/en/blog` lists 5, `/learn/` lists 7 published cards, and
`2026-05-22-agentless-server-operations` has `publishedAt` 2026-05-22, locale `en`, and a link to the
fi post. Publish dates come from the package, not from the import day. For a count of published
posts per locale, `npx emdash content list --help` shows the flags of the installed version.

**Rollback:** section 10.3 (DB restore from the pre-import backup). Do not hand-delete rows.

## 8. The switch

Precondition: section 9 passes against the first-start Caddy block (smoke suite, curls, passkey
login). Public traffic has so far gone to Express; this step moves it.

1. **[needs Juuso's yes]** Replace the block with the 5.3 version and deploy it exactly as in 5.4
   (splice, read the diff, validate in place, install, reload). 5.4 is reused with one change:
   **before the switch, repeat 1.3 with a new `<TS>`** (call it `<TS-SWITCH>` so the original `<TS>`
   from the first backup stays unambiguous) and use that backup as `$CADDY_BAK` in 5.4. Its `cmp`
   step then compares the live file against the backup taken just now, which catches any change made
   to the Caddyfile since the first deploy (by anyone). Do the same for the line-ending conversion and
   the "carry over every dropped `-` line" review: the 5.3 block must keep whatever 5.2 carried.
2. Check: `curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/` returns 200 and the page
   is the new one (`<html lang="fi">`, title from the seed, no old SPA markup).
3. Check the Express routes still answer (section 9.2).
4. Admin access: **keep the IP restriction** unless Juuso wants the admin reachable from anywhere.
   Passkeys protect the login, and the rate limits use the real client IP through the
   `X-Forwarded-For` override (5.1). Lifting the restriction is a one-handle change (delete the
   `@emdash_blocked` handle) and needs his yes. If he keeps the restriction and his IP changes, the
   admin is unreachable until the `remote_ip` address is updated the same way (5.4, with a fresh
   backup first).

**Rollback:** the smaller step is to restore `Caddyfile.bak.<TS-SWITCH>` (back to the 5.2 state:
public traffic on Express, the admin still on EmDash). The full rollback is section 10.1.

## 9. Verify

Verification is by **the smoke suite and live requests**, not by exit codes.

### 9.1 Main check: the smoke suite against production **[read-only: GET and HEAD only]**

```bash
cd /home/juuso/temp/jaakkolaxyz/cms
CMS_URL=https://jaakkola.xyz npm run test:smoke
```

Run it **from Juuso's IP** while the admin restriction is in place (sections 5.2 and 5.3). The suite
checks that `/_emdash/admin/` is reachable. From any other IP, that one check fails with `403`:
this is the restriction working, not a bug. Read the list of failures rather than trusting the
exit code.

This is 60 read-only tests (GET and HEAD only, redirects never followed). It covers status codes,
redirect targets, `<html lang>`, the learn files and traversal refusals, RSS, sitemaps and robots.

The sitemap origin comes from `settings.url`, then `EMDASH_SITE_URL`, then `SITE_URL`, then the
request origin (`src/utils/sitemap.ts`). There is **no** hard-coded jaakkola.xyz default for it. The
unit sets `EMDASH_SITE_URL` explicitly. If the sitemaps list `http://localhost:4321`, the variable
did not reach the process: the smoke suite fails on it, and the fix is in the unit, not in the code.

Optional, before the switch: run the production-only install (section 2.2) with a **copy** of the DB,
so the live database is never written to. It needs Juuso's yes because it runs on the server:

```bash
ssh teppo-server '
  set -euo pipefail
  export PATH=/opt/node-v24.15.0/bin:$PATH
  T=$(mktemp -d /home/clawdbot/cms-smoke.XXXXXX)
  cp -a /home/clawdbot/jaakkolaxyz/cms/releases/<MERGE_SHA>/dist /home/clawdbot/jaakkolaxyz/cms/releases/<MERGE_SHA>/node_modules /home/clawdbot/jaakkolaxyz/cms/releases/<MERGE_SHA>/package.json "$T/"
  mkdir "$T/data" && cp -a /home/clawdbot/jaakkolaxyz/cms/data/emdash.db /home/clawdbot/jaakkolaxyz/cms/data/uploads "$T/data/"
  mkdir -p "$T/data/sessions"
  cd "$T" && (EMDASH_SITE_URL=https://jaakkola.xyz LEARN_DIR=/home/clawdbot/jaakkolaxyz/data/learn HOST=127.0.0.1 PORT=4333 NODE_ENV=production node dist/server/entry.mjs > "$T/run.log" 2>&1 &)
  echo "$T"
'
# from the local checkout, through an SSH tunnel (ssh -L 4333:127.0.0.1:4333 teppo-server):
CMS_URL=http://127.0.0.1:4333 npm run test:smoke
```

Expect **5 sitemap origin failures** with `CMS_URL=http://127.0.0.1:4333`: the sitemaps use
`https://jaakkola.xyz` (from `EMDASH_SITE_URL`), not the tunnel origin. Everything else should pass.

Stop it afterwards: `ss -ltnp | grep ':4333 '` gives the PID; kill that PID, then delete the scratch
directory the command printed. Skip this if 9.1 already covers the same checks.

### 9.2 Live checks **[read-only GET/HEAD; run from the laptop]**

```bash
# Public site
curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/                       # 200
curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/blog                   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/tietosuoja             # 200
curl -s -D - -o /dev/null https://jaakkola.xyz/privacy | grep -i '^location\|^HTTP'  # 301 -> /en/privacy (GET)
curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/en/privacy             # 200
curl -s https://jaakkola.xyz/learn/ | grep -o '<title>[^<]*'                        # the learn catalogue title
curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/reports/age-pressure-finland/   # 200
curl -s https://jaakkola.xyz/sitemap.xml | grep -c 'https://jaakkola.xyz/'          # more than 0
curl -s https://jaakkola.xyz/sitemap.xml | grep -c localhost                        # 0
curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/robots.txt             # 200
curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/no-such-page           # 404 (styled page)

# Hashed assets: Astro sends the long cache header itself
ASSET=$(curl -s https://jaakkola.xyz/ | grep -o '/_astro/[^"]*\.js' | head -1)
curl -s -D - -o /dev/null "https://jaakkola.xyz$ASSET" | grep -i '^cache-control'   # public, max-age=31536000, immutable

# Ateneum and dashboard (Express)
curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/ateneum/               # 200
curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/api/ateneum/auth/me    # 401 without a session
curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/dashboard/             # 401 without Basic Auth
curl -s -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/api/dashboard/snapshot # 401 without Basic Auth

# Contact form: do NOT POST in production. A GET shows that Express answers the route.
curl -s -D - -o /dev/null https://jaakkola.xyz/api/contact | grep -i '^x-powered-by\|^HTTP'   # 404 with X-Powered-By: Express

# Other hosts in the same Caddy file (one check is enough; use a real host from the backup)
curl -s -o /dev/null -w '%{http_code}\n' https://<OTHER-HOST-FROM-BACKUP>/        # same code as before the change
```

The `/privacy` check is a GET: Astro answers HEAD with 308 and GET with 301. That is expected;
do not flag a HEAD 308 in monitoring.

### 9.3 Dashboard cron **[read-only]**

The crontab line on `teppo-server` calls `http://127.0.0.1:5000/api/dashboard/refresh?source=cron`
every 6 hours. That is Express, and it does not change in this migration.

```bash
ssh teppo-server 'crontab -l | grep dashboard'
```

After the next 6-hour tick, the newest snapshot should carry the cron source. Check it in the
dashboard UI, or with Juuso's Basic Auth against `GET /api/dashboard/snapshot` (read-only; do not
POST refresh to test it).

### 9.4 Passkey login **[manual, Juuso]**

Sign out, then sign in at `https://jaakkola.xyz/_emdash/admin` with each of the two passkeys. The
session must work from both devices. Check the journal for rate-limit or origin errors:
`ssh teppo-server 'journalctl -u jaakkolaxyz-cms.service --since "10 min ago" --no-pager'`.

### 9.5 Journal

```bash
ssh teppo-server 'systemctl is-active jaakkolaxyz-cms; journalctl -u jaakkolaxyz-cms.service -n 50 --no-pager'
ssh teppo-server 'systemctl is-active jaakkolaxyz; journalctl -u jaakkolaxyz -n 30 --no-pager'
```

No restart loop, no `EMDASH_ENCRYPTION_KEY` errors, no `localhost` origins in the log.

## 10. Rollback

### 10.1 Before the Express split is deployed (the current state)

Express still serves the SPA at `/`, so a Caddy-only rollback works:

```bash
ssh teppo-server 'sudo install -o root -g root -m 0644 /etc/caddy/Caddyfile.bak.<TS> /etc/caddy/Caddyfile && sudo systemctl reload caddy && systemctl is-active caddy'
ssh hetzner-teppo 'systemctl disable --now jaakkolaxyz-cms.service; systemctl is-active jaakkolaxyz-cms.service || true'
curl -s https://jaakkola.xyz/learn/ | grep -o '<title>[^<]*'    # old Express serves the page again
```

The backup restores the whole file, so the other hosts go back too. Stopping the CMS unit does not
delete its data: the DB, uploads and sessions stay in `cms/data/`.

### 10.2 After the Express split (`feat/express-split` is deployed)

(The "Order matters after the EmDash split" note and the "After the EmDash split" bullet in
[deploy.md](deploy.md) exist only after `feat/express-split` is merged; on `main` before that merge
they are not there yet.)

Old Express no longer serves `/`, so a Caddy-only rollback does not bring the old site back.
**Prefer fix-forward**: fix the CMS (or the Caddy block) and redeploy. A full rollback, when needed:

1. Stop the Express service: `ssh hetzner-teppo 'systemctl stop jaakkolaxyz.service'`.
2. Restore the **pre-split** Express files from the backup taken before that deploy: the
   `files-before.tar.gz` of that release, which includes `dist/`. The manifest procedure in
   [ateneum-p0-deploy.md](ateneum-p0-deploy.md) (section 7, files) applies unchanged. Do not restore
   `data/`.
3. Start Express: `ssh hetzner-teppo 'systemctl start jaakkolaxyz.service && systemctl is-active jaakkolaxyz.service'`.
4. Restore the Caddy file: the 10.1 command (whole file from `Caddyfile.bak.<TS>`, reload).
5. Run the section 9.2 checks. The CMS can keep running on `:4321` for the others.

There is no CMS symlink target to switch on the first deploy; 10.4 applies from the second release on.

### 10.3 Database

Only for damage from a bad content import or a migration. Never restore the DB for a code rollback:
it would delete content written after the backup. The order matters: stop, move the WAL/SHM files of
the current DB aside, then copy.

```bash
ssh hetzner-teppo 'systemctl stop jaakkolaxyz-cms.service'
ssh teppo-server '
  set -euo pipefail
  CMS=/home/clawdbot/jaakkolaxyz/cms
  TS=$(date +%Y%m%d-%H%M%S)
  # 1. keep the damaged DB and its WAL/SHM, all three together
  cp -a "$CMS/data/emdash.db" "$CMS/data/emdash.db.failed-$TS"
  for f in "$CMS/data/emdash.db-wal" "$CMS/data/emdash.db-shm"; do
    [ -e "$f" ] && mv "$f" "$f.failed-$TS"
  done
  # 2. only now the stale WAL/SHM are gone from the live name; copy the backup in
  cp -a /home/clawdbot/jaakkolaxyz/backups/cms-<TS>/emdash.db "$CMS/data/emdash.db"
  # 3. check it
  sqlite3 "$CMS/data/emdash.db" "PRAGMA quick_check;"
'
ssh hetzner-teppo 'systemctl start jaakkolaxyz-cms.service && systemctl is-active jaakkolaxyz-cms.service'
```

Restore the matching `uploads.tar.gz` too if media changed. `quick_check` must print `ok`. Keep the
`.failed-` files until the restored site is checked (section 9).

### 10.4 Release directory

Switch the `current` symlink to the previous release (the one before `<MERGE_SHA>`), stop, switch,
start, and run section 9:

```bash
ssh hetzner-teppo 'systemctl stop jaakkolaxyz-cms.service'
ssh teppo-server 'cd /home/clawdbot/jaakkolaxyz/cms/releases && ln -sfn <PREVIOUS-SHA> current.new && mv -T current.new current && readlink current'
ssh hetzner-teppo 'systemctl start jaakkolaxyz-cms.service && systemctl is-active jaakkolaxyz-cms.service'
```

Keep two releases (the current one and the previous one). Delete older ones only after a stable
backup cycle: `rm -rf cms/releases/<OLDER-SHA>` (**needs Juuso's yes**).

## 11. Backups and upgrades

### 11.1 Nightly backup (cron, `clawdbot`) **[needs Juuso's yes: writes the crontab]**

```bash
# crontab -e as clawdbot; one line
20 3 * * * cd /home/clawdbot/jaakkolaxyz/cms && B=/home/clawdbot/jaakkolaxyz/backups/cms-$(date +\%Y\%m\%d-\%H\%M) && mkdir -m 700 "$B" && sqlite3 data/emdash.db ".backup $B/emdash.db" && tar -C data -czf "$B/uploads.tar.gz" uploads && chmod 600 "$B"/* && find /home/clawdbot/jaakkolaxyz/backups -maxdepth 1 -name 'cms-*' -mtime +14 -exec rm -rf {} +
```

`.backup` is safe on a live WAL database. The `%` signs are escaped for cron. Retention is 14 days,
the same as the Ateneum release backups. Run it once by hand before relying on it, and check the
copy: `sqlite3 <copy> "PRAGMA integrity_check;"`.

The uploads folder grows with media. Check its size with `du -sh cms/data/uploads` (section 1) and
move the backups off the server when they matter (as in `deploy.md`, Backups).

### 11.2 Not in the backups

- **The encryption key.** It lives only in Juuso's secret backup (section 3). A DB backup cannot
  decrypt encrypted settings without it.
- **Sessions** (`cms/data/sessions/`). They are not backed up and are safe to delete: deleting them
  logs everyone out, and nothing else depends on them.

### 11.3 EmDash upgrades (new `emdash` version)

1. Build the new release (section 2) from the new lockfile. Read the EmDash upgrade notes for every
   version in between before deploying.
2. **Backup first**: the nightly backup command (11.1), run by hand; note the timestamp.
3. Check the pending migrations **on the server, read-only**, from the new release directory:
   ```bash
   export PATH=/opt/node-v24.15.0/bin:$PATH
   cd /home/clawdbot/jaakkolaxyz/cms/releases/<NEW-SHA>
   npx emdash migrate --status --json
   npx emdash migrate --check --json
   ```
4. Migrations are **forward-only**. There is no down-migration. The rollback for a schema change is
   the DB backup (section 10.3) together with the previous release (section 10.4).
5. Apply the migrations **before** the new code serves traffic, in this order (not with
   `EMDASH_MIGRATIONS_MODE=check`: with that mode the old or new site refuses to serve until it is
   migrated):
   1. **[needs Juuso's yes]** stop the service: `ssh hetzner-teppo 'systemctl stop jaakkolaxyz-cms.service'`;
   2. take the backup (step 2);
   3. `cd cms/releases/<NEW-SHA> && npx emdash migrate` (it asks for confirmation; it also accepts
      `--expected-target-fingerprint` for non-interactive use). The `--check` in step 3 shows what it
      will run;
   4. switch the symlink (10.4, the `ln -sfn` and `mv -T` part) to `<NEW-SHA>`;
   5. start the service and run section 9.
6. Section 9 after the start.

## 12. Later

1. **Express split** (`feat/express-split`): merge and deploy it only after section 9 passes on the
   live CMS. Follow [deploy.md](deploy.md), with the "Order matters" note (that text arrives in
   `deploy.md` with the `feat/express-split` merge and is not there before it). After that deploy, the
   rollback is section 10.2, not the Caddy file.
2. **Cleanup** once production content is imported and verified: delete `client/`, `attached_assets/`,
   the Vite config for the old client, and unused dependencies. The import script still reads
   `client/src/data/content.ts` and `client/public/`, so do the cleanup only after the last import.
3. **Cloudflare in front of teppo-server**: a separate project. It changes the client IP, so the
   `header_up` in section 5 and `trustedProxyHeaders` must be revisited together with it (5.1).
4. Privacy: the 12-month deletion of contact submissions promised in the privacy notice is still open
   (see the migration plan).

## Open items (need information from the server or from Juuso)

- The current `/etc/caddy/Caddyfile` contents: the `basic_auth` user and hash, and any directive
  inside the `jaakkola.xyz` block that is not shown here (known: Caddy v2.10.2).
- Juuso's IPv6 address for the `remote_ip` matcher (IPv4 `80.220.157.227` is known; 5.2 says how to
  find the IPv6 if the browser gets 403), and whether he keeps the admin restriction.
- Whether `:4321` and `:5000` answer from the internet (1.2). Express is bound to `0.0.0.0:5000`, so
  check it; if either answers, a firewall change comes first.
- Which Node 24.x release to install under `/opt` (1.4), and that `sha256sum -c` passes on the server.
- Confirm on the server that npm registry access works for `clawdbot`, and that `python3` is
  available to the operator (known: system npm 10.9.4, sqlite3 3.45.1).
