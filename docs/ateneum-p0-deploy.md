# Ateneum P0 — tuotantoonvienti ja rollback

Tämä runbook on **suunnitelma, ei deploy-lupa**. Tuotantotiedostojen kirjoittaminen, palvelun pysäytys ja käynnistys vaativat erillisen eksplisiittisen hyväksynnän.

## Varmistettu tuotantotopologia 2026-07-13

| Kohde | Arvo |
|---|---|
| SSH, sovelluskäyttäjä | `teppo-server` → `clawdbot@ubuntu-teppo` |
| SSH, root/systemd | `hetzner-teppo` |
| WorkingDirectory | `/home/clawdbot/jaakkolaxyz` |
| systemd-yksikkö | `/etc/systemd/system/jaakkolaxyz.service` |
| ExecStart | `/usr/bin/node dist/index.cjs` |
| EnvironmentFile | `/home/clawdbot/jaakkolaxyz/.env` |
| SQLite | `/home/clawdbot/jaakkolaxyz/data/ateneum.db` (oletus) |
| Julkinen osoite | `https://jaakkola.xyz/ateneum/` |

Tuotannon git-työpuu on likainen ja sisältää muuta live-driftiä. **Älä käytä `git pull`, `git reset`, `git clean` tai koko repon rsynciä.** Alla käytetään vain eksplisiittistä tiedostolistaa.

## Hyväksytty tiedostoscope

```text
.env.example
package.json
package-lock.json
script/build.ts
server/index.ts
server/ateneum-auth.ts
server/ateneum-db.ts
server/ateneum-email.ts
server/ateneum-routes.ts
server/ateneum-seed-data.ts
server/ateneum-seed.ts
shared/ateneum-schema.ts
public-static/ateneum/index.html
public-static/ateneum/activity.html
tests/ateneum/p0.test.ts
tests/ateneum/seed.test.ts
dist/index.cjs
dist/public/ateneum/index.html
dist/public/ateneum/activity.html
```

Muita tuotantotiedostoja, dashboardia tai salaista `.env`-tiedostoa ei korvata.

## Esiehdot

- PR on hyväksytty ja merge-SHA on muuttujassa `MERGE_SHA`.
- `npm ci`, `npm run check`, `npm run test:ateneum` ja `npm run build` menevät läpi puhtaassa release-worktreessä.
- Release-bundle sisältää `ateneum_weekly_suggestions`-skeeman.
- Tuotannon externalisoidut runtime-paketit täsmäävät lockiin (`argon2`, `better-sqlite3`, `cookie-parser`). AWS SES -client bundlataan `dist/index.cjs`:ään.
- Tuotannon kahdella ihmisroolilla on jo käyttäjä ja sähköposti tietokannassa. Jos jompikumpi puuttuu, `.env`:ssä pitää olla kyseisen `ATENEUM_PARTNER_A_*`- tai `ATENEUM_PARTNER_B_*`-ryhmän kaikki arvot ennen käynnistystä.
- Julkisen sivun ja palvelun nykytila on kirjattu ennen muutosta.

## 1. Rakenna release puhtaassa paikallisessa worktreessä

```bash
set -euo pipefail
MERGE_SHA=<MERGE_SHA>
RELEASE_DIR=$(mktemp -d /tmp/jaakkolaxyz-ateneum-release.XXXXXX)
ARTIFACT=/tmp/jaakkolaxyz-ateneum-p0-${MERGE_SHA}.tar.gz

git worktree add --detach "$RELEASE_DIR" "$MERGE_SHA"
cd "$RELEASE_DIR"
npm ci
npm run check
npm run test:ateneum
npm run build

test -s dist/index.cjs
test -s dist/public/ateneum/index.html
test -s dist/public/ateneum/activity.html
grep -q 'ateneum_weekly_suggestions' dist/index.cjs
node --check dist/index.cjs
cmp public-static/ateneum/index.html dist/public/ateneum/index.html
cmp public-static/ateneum/activity.html dist/public/ateneum/activity.html

tar -czf "$ARTIFACT" \
  .env.example package.json package-lock.json script/build.ts server/index.ts \
  server/ateneum-auth.ts server/ateneum-db.ts server/ateneum-email.ts \
  server/ateneum-routes.ts server/ateneum-seed-data.ts server/ateneum-seed.ts \
  shared/ateneum-schema.ts public-static/ateneum/index.html \
  public-static/ateneum/activity.html tests/ateneum/p0.test.ts \
  tests/ateneum/seed.test.ts dist/index.cjs dist/public/ateneum/index.html \
  dist/public/ateneum/activity.html
sha256sum "$ARTIFACT"
```

Kirjaa artefaktin SHA-256. Poista väliaikainen worktree vasta onnistuneen deployn jälkeen.

## 2. Read-only preflight tuotannossa

```bash
ssh teppo-server '
  set -e
  cd /home/clawdbot/jaakkolaxyz
  git status --short
  systemctl show jaakkolaxyz.service --no-pager \
    -p MainPID -p ActiveState -p SubState -p ExecMainStartTimestamp
  stat -c "%n size=%s mtime=%y owner=%U:%G mode=%a" \
    data/ateneum.db dist/index.cjs
  node -e '\''
    const Database=require("better-sqlite3");
    const db=new Database("data/ateneum.db", {readonly:true});
    const users=db.prepare(
      "SELECT role, username, email FROM ateneum_users WHERE role IN (?,?) ORDER BY role"
    ).all("juuso", "wife");
    console.log(users);
    if (users.length !== 2 || users.some(u => !u.email)) process.exit(2);
    db.close();
  '\''
  node -e '\''
    const fs=require("fs"), path=require("path");
    for (const name of ["argon2","better-sqlite3","cookie-parser"]) {
      const file=path.join("node_modules",name,"package.json");
      console.log(name, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)).version : "MISSING");
    }
  '\''
'

curl -fsSI https://jaakkola.xyz/ateneum/
curl -sS -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/api/ateneum/auth/me
# Odotus: sivu 200, auth/me 401 ilman sessiota.
```

Jos tiedostot, käyttäjätilanne, paketit tai git-drift ovat muuttuneet, pysähdy ja tee uusi diff. Älä ylikirjoita sokkona.

## 3. Upload, release ja validoitu backup

Tämä vaihe luo vain release- ja backup-hakemistot. Se ei muuta live-tiedostoja eikä restarttaa palvelua.

```bash
set -euo pipefail
MERGE_SHA=<MERGE_SHA>
ARTIFACT=/tmp/jaakkolaxyz-ateneum-p0-${MERGE_SHA}.tar.gz
ARTIFACT_SHA=<KIRJATTU_SHA256>
scp "$ARTIFACT" teppo-server:/tmp/
ssh teppo-server "echo '$ARTIFACT_SHA  /tmp/jaakkolaxyz-ateneum-p0-$MERGE_SHA.tar.gz' | sha256sum -c -"
```

```bash
ssh teppo-server '
  set -euo pipefail
  APP=/home/clawdbot/jaakkolaxyz
  MERGE_SHA=<MERGE_SHA>
  TS=$(date +%Y%m%d-%H%M%S)
  BACKUP="$APP/backups/ateneum-p0-$TS"
  RELEASE="$APP/releases/ateneum-p0-$MERGE_SHA"
  mkdir -p "$BACKUP" "$RELEASE"

  FILES=(
    .env.example package.json package-lock.json script/build.ts server/index.ts
    server/ateneum-auth.ts server/ateneum-db.ts server/ateneum-email.ts
    server/ateneum-routes.ts server/ateneum-seed-data.ts server/ateneum-seed.ts
    shared/ateneum-schema.ts public-static/ateneum/index.html
    public-static/ateneum/activity.html tests/ateneum/p0.test.ts
    tests/ateneum/seed.test.ts dist/index.cjs dist/public/ateneum/index.html
    dist/public/ateneum/activity.html
  )

  cd "$APP"
  : > "$BACKUP/manifest.txt"
  EXISTING=()
  declare -A SEEN_MISSING_DIRS=()
  for file in "${FILES[@]}"; do
    if [ -e "$file" ]; then
      printf "E %s\n" "$file" >> "$BACKUP/manifest.txt"
      EXISTING+=("$file")
    else
      printf "M %s\n" "$file" >> "$BACKUP/manifest.txt"
      parent=$(dirname "$file")
      while [ "$parent" != "." ]; do
        if [ ! -d "$parent" ] && [ -z "${SEEN_MISSING_DIRS[$parent]:-}" ]; then
          printf "D %s\n" "$parent" >> "$BACKUP/manifest.txt"
          SEEN_MISSING_DIRS[$parent]=1
        fi
        parent=$(dirname "$parent")
      done
    fi
  done
  tar -czf "$BACKUP/files-before.tar.gz" "${EXISTING[@]}"

  node -e '\''
    (async () => {
      const Database=require("better-sqlite3");
      const src=new Database("/home/clawdbot/jaakkolaxyz/data/ateneum.db");
      await src.backup(process.argv[1]);
      src.close();
    })().catch(error => { console.error(error); process.exit(1); });
  '\'' "$BACKUP/ateneum.db"

  awk '\''$1=="E" {print $2}'\'' "$BACKUP/manifest.txt" | sort > "$BACKUP/expected-files.txt"
  tar -tzf "$BACKUP/files-before.tar.gz" | sed '\''s#^\./##'\'' | sort > "$BACKUP/archived-files.txt"
  cmp "$BACKUP/expected-files.txt" "$BACKUP/archived-files.txt"
  node -e '\''
    const Database=require("better-sqlite3");
    const db=new Database(process.argv[1], {readonly:true});
    const result=db.pragma("quick_check", {simple:true});
    const hasUsers=db.prepare(
      "SELECT count(*) AS n FROM sqlite_master WHERE type=? AND name=?"
    ).get("table", "ateneum_users").n;
    db.close();
    if (result !== "ok" || hasUsers !== 1) process.exit(2);
  '\'' "$BACKUP/ateneum.db"

  tar -xzf "/tmp/jaakkolaxyz-ateneum-p0-$MERGE_SHA.tar.gz" -C "$RELEASE"
  node -e '\''
    const fs=require("fs"), path=require("path");
    const [app, release]=process.argv.slice(1);
    const lock=JSON.parse(fs.readFileSync(path.join(release,"package-lock.json"), "utf8"));
    let invalid=false;
    for (const name of ["argon2","better-sqlite3","cookie-parser"]) {
      const file=path.join(app,"node_modules",name,"package.json");
      const actual=fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)).version : "MISSING";
      const expected=lock.packages?.[`node_modules/${name}`]?.version ?? "MISSING_FROM_LOCK";
      console.log(name, {actual, expected});
      if (actual !== expected) invalid=true;
    }
    if (invalid) process.exit(2);
  '\'' "$APP" "$RELEASE"
  test -s "$RELEASE/dist/index.cjs"
  test -s "$RELEASE/dist/public/ateneum/index.html"
  test -s "$RELEASE/dist/public/ateneum/activity.html"
  grep -q ateneum_weekly_suggestions "$RELEASE/dist/index.cjs"
  node --check "$RELEASE/dist/index.cjs"
  cmp "$RELEASE/public-static/ateneum/index.html" "$RELEASE/dist/public/ateneum/index.html"
  cmp "$RELEASE/public-static/ateneum/activity.html" "$RELEASE/dist/public/ateneum/activity.html"

  printf "BACKUP=%s\nRELEASE=%s\n" "$BACKUP" "$RELEASE"
'
```

Kirjaa tulostuneet `BACKUP`- ja `RELEASE`-polut. **Älä jatka**, jos manifestin, tar-arkiston, artefaktin tai SQLite-kopion validointi epäonnistuu.

## 4. Live-scopen dry-run

Tämä on viimeinen vaihe ilman live-kirjoituksia.

```bash
ssh teppo-server '
  set -euo pipefail
  APP=/home/clawdbot/jaakkolaxyz
  RELEASE="$APP/releases/ateneum-p0-<MERGE_SHA>"
  FILES=(
    .env.example package.json package-lock.json script/build.ts server/index.ts
    server/ateneum-auth.ts server/ateneum-db.ts server/ateneum-email.ts
    server/ateneum-routes.ts server/ateneum-seed-data.ts server/ateneum-seed.ts
    shared/ateneum-schema.ts public-static/ateneum/index.html
    public-static/ateneum/activity.html tests/ateneum/p0.test.ts
    tests/ateneum/seed.test.ts dist/index.cjs dist/public/ateneum/index.html
    dist/public/ateneum/activity.html
  )
  cd "$RELEASE"
  rsync -rlti --dry-run --relative --omit-dir-times \
    --no-perms --no-owner --no-group "${FILES[@]}" "$APP/"
'
```

Dry-runin pitää sisältää vain hyväksytty scope.

## 5. Yksi atominen tuotantoportti: stop → apply → start

**Tämä koko vaihe vaatii yhden eksplisiittisen tuotantoluvan.** Palvelu pysäytetään ennen ensimmäistä live-tiedoston kirjoitusta, joten uusi frontend ei voi koskaan olla tarjolla vanhan API-bundlen kanssa. Lyhyt huoltokatko on tarkoituksellinen.

Aseta kirjattu backup-polku. Jos apply tai uuden palvelun käynnistys epäonnistuu, skripti palauttaa tiedostot manifestista ennen vanhan version käynnistystä.

```bash
set -euo pipefail
APP=/home/clawdbot/jaakkolaxyz
MERGE_SHA=<MERGE_SHA>
RELEASE="$APP/releases/ateneum-p0-$MERGE_SHA"
BACKUP=<KIRJATTU_BACKUP_POLKU>

restore_files() {
  ssh teppo-server "APP='$APP' BACKUP='$BACKUP' bash -s" <<'REMOTE'
set -euo pipefail
cd "$APP"
MISSING_DIRS=()
while IFS=" " read -r kind target; do
  case "$kind" in
    M) rm -f -- "$target" ;;
    D) MISSING_DIRS+=("$target") ;;
  esac
done < "$BACKUP/manifest.txt"
tar -xzf "$BACKUP/files-before.tar.gz" -C "$APP"
for dir in "${MISSING_DIRS[@]}"; do
  rmdir -- "$APP/$dir" 2>/dev/null || true
done
node --check "$APP/dist/index.cjs"
REMOTE
}

restore_database() {
  ssh teppo-server "APP='$APP' BACKUP='$BACKUP' bash -s" <<'REMOTE'
set -euo pipefail
cp -a "$APP/data/ateneum.db" "$APP/data/ateneum.db.failed-$(date +%Y%m%d-%H%M%S)"
cp -a "$BACKUP/ateneum.db" "$APP/data/ateneum.db"
node -e '
  const Database=require("better-sqlite3");
  const db=new Database(process.argv[1], {readonly:true});
  const result=db.pragma("quick_check", {simple:true});
  db.close();
  if (result !== "ok") process.exit(2);
' "$APP/data/ateneum.db"
REMOTE
}

ssh hetzner-teppo 'set -e; systemctl stop jaakkolaxyz.service; systemctl is-active --quiet jaakkolaxyz.service && exit 1 || true'

if ! ssh teppo-server "APP='$APP' RELEASE='$RELEASE' bash -s" <<'REMOTE'
set -euo pipefail
FILES=(
  .env.example package.json package-lock.json script/build.ts server/index.ts
  server/ateneum-auth.ts server/ateneum-db.ts server/ateneum-email.ts
  server/ateneum-routes.ts server/ateneum-seed-data.ts server/ateneum-seed.ts
  shared/ateneum-schema.ts public-static/ateneum/index.html
  public-static/ateneum/activity.html tests/ateneum/p0.test.ts
  tests/ateneum/seed.test.ts dist/index.cjs dist/public/ateneum/index.html
  dist/public/ateneum/activity.html
)
cd "$RELEASE"
rsync -rlti --relative --omit-dir-times \
  --no-perms --no-owner --no-group "${FILES[@]}" "$APP/"
cd "$APP"
node --check dist/index.cjs
grep -q ateneum_weekly_suggestions dist/index.cjs
cmp public-static/ateneum/index.html dist/public/ateneum/index.html
cmp public-static/ateneum/activity.html dist/public/ateneum/activity.html
REMOTE
then
  restore_files
  ssh hetzner-teppo 'systemctl start jaakkolaxyz.service && systemctl is-active jaakkolaxyz.service'
  exit 1
fi

if ! ssh hetzner-teppo '
  systemctl start jaakkolaxyz.service
  systemctl is-active --quiet jaakkolaxyz.service
  for attempt in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:5000/ateneum/ >/dev/null; then exit 0; fi
    sleep 1
  done
  exit 1
'; then
  ssh hetzner-teppo 'systemctl stop jaakkolaxyz.service || true'
  restore_files
  restore_database
  ssh hetzner-teppo 'systemctl start jaakkolaxyz.service && systemctl is-active jaakkolaxyz.service'
  exit 1
fi

ssh hetzner-teppo 'systemctl show jaakkolaxyz.service --no-pager -p MainPID -p ExecMainStartTimestamp'
```

## 6. Välitön verifiointi

```bash
ssh hetzner-teppo '
  systemctl is-active jaakkolaxyz.service
  journalctl -u jaakkolaxyz.service --since "5 minutes ago" --no-pager
'

curl -fsSI https://jaakkola.xyz/ateneum/
curl -sS -o /dev/null -w '%{http_code}\n' https://jaakkola.xyz/api/ateneum/auth/me
```

Lisäksi selaimessa molemmilla oikeilla rooleilla:

- molemmat näkevät saman viikkoehdotuksen
- reload ei vaihda ehdotusta
- yksityinen QA-toive näkyy vain omistajalleen
- omistaja näkee “Toteutui”-painikkeen, kumppani ei
- aktiviteetin done/skip/undo/rating toimivat sekä listassa että detail-sivulla
- footer-unsubscribe sammuttaa kaikki oman käyttäjän ilmoitukset
- Ideat-välilehti latautuu ilman JS-virheitä
- 390×844-mobiilinäkymässä neljä alavalikon kohtaa ja detail-wrapper näkyvät ilman vaakaylivuotoa

## 7. Rollback

### Tiedostot

Pysäytä palvelu ennen rollbackia. Manifesti palauttaa deployta ennen olemassa olleet tiedostot, poistaa vain deployssa uutena syntyneet tiedostot ja yrittää poistaa vain ennen deployta puuttuneet, nyt tyhjät hakemistot.

```bash
set -euo pipefail
APP=/home/clawdbot/jaakkolaxyz
BACKUP=<KIRJATTU_BACKUP_POLKU>
ssh hetzner-teppo 'systemctl stop jaakkolaxyz.service'
ssh teppo-server "APP='$APP' BACKUP='$BACKUP' bash -s" <<'REMOTE'
set -euo pipefail
cd "$APP"
MISSING_DIRS=()
while IFS=" " read -r kind target; do
  case "$kind" in
    M) rm -f -- "$target" ;;
    D) MISSING_DIRS+=("$target") ;;
  esac
done < "$BACKUP/manifest.txt"
tar -xzf "$BACKUP/files-before.tar.gz" -C "$APP"
for dir in "${MISSING_DIRS[@]}"; do
  rmdir -- "$APP/$dir" 2>/dev/null || true
done
node --check "$APP/dist/index.cjs"
REMOTE
ssh hetzner-teppo '
  systemctl start jaakkolaxyz.service
  systemctl is-active jaakkolaxyz.service
  journalctl -u jaakkolaxyz.service --since "5 minutes ago" --no-pager
'
```

### Tietokanta vain datavaurion tapauksessa

Älä palauta tietokantaa tavallisessa kood rollbackissa: se poistaisi deployn jälkeen syntyneitä oikeita toiveita ja aktiviteetteja. Jos kanta on vioittunut:

```bash
ssh hetzner-teppo 'systemctl stop jaakkolaxyz.service'
ssh teppo-server '
  set -euo pipefail
  APP=/home/clawdbot/jaakkolaxyz
  BACKUP=<KIRJATTU_BACKUP_POLKU>
  cp -a "$APP/data/ateneum.db" "$APP/data/ateneum.db.failed-$(date +%Y%m%d-%H%M%S)"
  cp -a "$BACKUP/ateneum.db" "$APP/data/ateneum.db"
  node -e '\''
    const Database=require("better-sqlite3");
    const db=new Database(process.argv[1], {readonly:true});
    const result=db.pragma("quick_check", {simple:true});
    db.close();
    if (result !== "ok") process.exit(2);
  '\'' "$APP/data/ateneum.db"
'
ssh hetzner-teppo 'systemctl start jaakkolaxyz.service && systemctl is-active jaakkolaxyz.service'
```

Säilytä release ja backup vähintään 14 päivää sekä yhden onnistuneen varmistuskierron yli.
