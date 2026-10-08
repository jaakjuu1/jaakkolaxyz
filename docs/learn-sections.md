# Learn sections (`/learn/`)

How the learning tracks at <https://jaakkola.xyz/learn/> are structured, created,
published and kept in sync with this repo. Written for agents (Claude, Hermes,
others) and humans. The content itself is in Finnish.

## What `/learn` is

- Plain static HTML. No React, no build step, no database.
- Served by the Astro site in `cms/` (`cms/src/pages/learn/`, helpers in
  `cms/src/utils/learn-files.ts`) from the directory named by `LEARN_DIR`. Files
  are read at request time and returned byte for byte. An unknown `/learn/...`
  path is a real 404 (the site's 404 page). `/learn/` is the catalogue page; its
  cards are CMS content (see below).
- `LEARN_DIR` defaults to `../data/learn` (the dev server runs in `cms/`).
  Production sets `LEARN_DIR=/home/clawdbot/jaakkolaxyz/data/learn` in the CMS
  service's environment, so Hermes's rsync target does not change. The directory
  lives outside `dist/`, so `npm run build` does not touch it. **Publishing a
  section needs no rebuild and no restart.**
- Never served: dot-files and dot-directories (`.backups/`, `.git`) and
  `teach-manual-publish-*/`. Symlinks that point outside `LEARN_DIR` are not
  followed.
- Until the production cutover (see `docs/plans/emdash-migration.md`), production
  still serves `/learn` with `express.static` from `server/index.ts`.
- This directory is the **published output**. It is committed to git so the repo
  matches what is live.

## Where things live

| What | Where |
|---|---|
| Published pages (this repo) | `data/learn/` |
| Catalogue cards on `/learn/` (page "Oppimispolut") | EmDash admin, collection `learn_tracks` (not a file in this repo) |
| Old catalogue page | `data/learn/index.html`: no longer served. It is the source of the initial `learn_tracks` import and stays here only until the production cutover |
| One track | `data/learn/<slug>/` |
| Live copy on production | `teppo-server:/home/clawdbot/jaakkolaxyz/data/learn/` |
| Authoring workspaces (**not** in this repo) | `~/learn/<slug>/` on Juuso's machine, plus `~/learn/_root/` for the aggregate index |
| Generator and publisher | Hermes `teach` skill, `~/.hermes/skills/productivity/teach/` on `teppo-server` (`SKILL.md`, `references/jaakkola-publishing.md`, `scripts/publish-jaakkola.sh`, `scripts/manual-publish.sh`, `scripts/build-wikilinks.js`) |

Authoring workspaces also hold private material: `MISSION.md`, `RESOURCES.md`,
`NOTES.md`, `PUBLISH.md`, `learning-records/`, `_sources/` (source PDFs,
transcripts). **None of it belongs in `data/learn/` or in git.**

Current tracks: `ai-music`, `b2c-appit`, `esoteria`, `fysiikka`, `hypnoterapia`,
`mielenterveys`, `mikroauktoriteetti`, `systeemiajattelu`.

Not versioned (see `.gitignore`): `data/learn/.backups/` (publish-time snapshots),
`data/learn/teach-manual-publish-*/` (stray output of a mis-targeted publish),
SQLite databases and `.env` files elsewhere under `data/`.

## Anatomy of a track

### Single-path track (most tracks)

```
data/learn/<slug>/
  index.html                  track front page
  lessons/0001-<ascii-slug>.html
  lessons/0002-<ascii-slug>.html
  reference/<name>.html       cheat sheets, glossaries (quick-reference pages)
  reference/<asset>.png|wav|…  ALL assets: images, audio, css, js
```

Examples: `ai-music`, `b2c-appit`, `hypnoterapia`, `mikroauktoriteetti`.

### Multi-path track (several sub-paths plus a concept layer)

```
data/learn/<slug>/
  index.html
  <path-a>/index.html
  <path-a>/lessons/0001-….html
  <path-b>/…
  concepts/<concept>.html              encyclopedia entries
  concepts/concept-manifest.json       slug -> file map used by [[wikilinks]]
```

Examples: `systeemiajattelu` (5 paths, ~120 concept pages), `esoteria`,
`mielenterveys`, `fysiikka`. Lessons link to concepts with `[[slug]]` in the
authoring source; `build-wikilinks.js` rewrites those to real `<a href>` links at
publish time, so the HTML in `data/learn/` already contains resolved links.
Design rationale: `references/wiki-pattern.md` in the teach skill.

### Rules that prevent silent 404s

- **ASCII-only file names and slugs**: `0002-mina.html`, never `0002-minä.html`.
  The teach skill recorded silent 404s caused by non-ASCII slugs in URLs, so
  this is a house rule rather than a style preference.
- Lessons are numbered `NNNN-<dash-case>.html`; the number only increases.
- **Assets go in `reference/`**, never in `lessons/` (the publisher only copies
  assets from `reference/`). Reference them relatively: `../reference/foo.png`.
- Use relative links only: `../index.html`, `../reference/glossary.html`. No
  absolute `/learn/...` URLs, no `file://`, no local paths.
- Every track needs its own `index.html`. If a workspace has none, the publisher
  generates a bare listing titled `Teach workspace: <slug>`; treat that title as
  a bug on a finished track.

## Page requirements

Each lesson is **one self-contained HTML file** (inline `<style>`, `lang="fi"`,
`<meta viewport>`, a meaningful `<title>`). Copy the CSS from an existing
lesson in the same track (for example
`data/learn/ai-music/lessons/0004-suno-promptitiede.html`) so tracks stay visually
consistent; keep the footer link back to `../index.html`.

Content rules from the teach skill:

- One tightly scoped skill per lesson, short enough to finish quickly, tied to
  the track's mission, with citations and one recommended primary source.
- **Lessons must stand alone.** A reader can land on any lesson from a public
  link. Use generic example scenarios; never refer to "your earlier answer" or
  other learner-specific state.
- Quizzes use real `<textarea>`/`<input>` fields plus a "Kopioi vastaukset"
  button that copies the answers to the clipboard (there is no backend). Quiz
  answer options should be equal in length so formatting gives no clue.
- Reference pages are the compressed essence of lessons (glossary, cheat sheet);
  once a glossary exists, lessons follow it.
- No private material: grep for `MISSION.md`, `NOTES.md`, `learning-records/`,
  `/home/`, `file://` before publishing:

  ```bash
  grep -RInE 'MISSION\.md|NOTES\.md|learning-records/|/home/|file://' data/learn \
    --exclude-dir=.backups
  ```

  That command must print nothing.

## Adding a new section

Pick the path that fits. In both cases the result must end up in
`data/learn/<slug>/` here **and** on production.

### A. Through the Hermes teach skill (the usual way for Juuso)

1. In `~/learn/<slug>/` Hermes writes `MISSION.md`, `RESOURCES.md`, lessons and
   reference pages following the teach skill.
2. Hermes publishes with `publish-jaakkola.sh` (single path) or
   `manual-publish.sh` (any multi-path track; the former fails for them). Both
   rsync to `data/learn/<slug>/` on production and back up the previous version.
3. **Pull the result into this repo** (see "Keeping git in sync") and commit.
   Hermes does this itself after every verified publish (Hermes skill
   `jaakkola-xyz-site`): a worktree from `origin/main`, `rsync` of the published
   track down from production, a branch `learn/<slug>-<date>` and a pull request.
   Juuso merges it. Until the PR is merged, production's git checkout shows
   `data/learn/**` as modified; that is expected, not drift to be "fixed".
   After the merge, realign the checkout as described in
   [deploy.md](deploy.md) (mixed `git reset`, files untouched).

### B. Directly by an agent working in this repo

1. Create `data/learn/<slug>/` following the anatomy above. Start from a similar
   existing track and reuse its CSS.
2. Write the track `index.html`, lessons and reference pages. Run the grep check
   above.
3. Add a card in the EmDash admin, collection `learn_tracks`, and publish it.
   The slug is the track folder name (`<slug>`). Fields: `title`, `kind` (short
   category), `blurb` (one or two sentences), `lesson_count` (integer),
   `track_status` (`julkaistu` or `tulossa`), `group` (`ymmartaminen` for
   "Ymmärtämisen ja harjoituksen polut", `rakentaja` for "Rakentajan polut") and
   `order` (position within its group on `/learn/`). Only published entries appear
   on `/learn/`. Update `lesson_count` when lessons are added. A track without a
   published entry (a draft, such as `mikroauktoriteetti`) is not listed on `/learn/`
   or in `sitemap-learn.xml`, but its pages still answer at their URLs. Do not edit `data/learn/index.html` for cards: it is no longer served.
4. Commit, then deploy (next section).

## Deploying to production

Production changes are outward-facing. **Get Juuso's explicit yes before running
any `ssh`/`rsync` that writes to `teppo-server`.**

`teppo-server` is an SSH alias in Juuso's `~/.ssh/config` for the `clawdbot` user,
which owns the app directory. Deploy one track without deleting anything on the server:

```bash
rsync -rc --chmod=D755,F644 data/learn/<slug>/ teppo-server:jaakkolaxyz/data/learn/<slug>/
```

The track folder is the only thing to copy. `data/learn/index.html` is not synced
any more; the catalogue cards are CMS content.

Do not pass `--delete` against `data/learn/` as a whole, and never replace the
whole directory: it contains every other track. Do not restart the service.

### Verify against production (mandatory)

An exit code of 0 proves nothing: a wrong or empty source path still exits 0.
Check the live URLs and their titles:

```bash
for u in /learn/<slug>/ /learn/<slug>/lessons/0001-<name>.html /learn/; do
  printf '%s  ' "$u"
  curl -s -o /tmp/learn-check.html -w '%{http_code}  ' "https://jaakkola.xyz$u"
  grep -o -i -m1 '<title>[^<]*' /tmp/learn-check.html || echo NO_TITLE
done
```

Expect HTTP 200 and the real lesson title. `Teach workspace: <slug>` means the
auto-generated listing won over the track's own `index.html`. A 200 with a small
generic page for a URL you just added usually means a non-ASCII or wrong path.
Also check one **old** page of the same track, because a replace can drop files.

## Keeping git in sync with production

Production is where Hermes writes, so it can move ahead of git. After any
Hermes publish, or whenever `git status` should be checked against reality:

```bash
rsync -rc --exclude='.backups/' --exclude='teach-manual-publish-*/' \
  teppo-server:jaakkolaxyz/data/learn/ data/learn/
git status data/learn      # review what changed
git add data/learn && git commit -m "feat(learn): sync published content from production"
```

(`rsync` without `--delete` never removes anything locally. If production removed
a page on purpose, delete it in git as well.)

## Pitfalls collected from past incidents

- Writing into a parallel tree (for example `~/data/learn/...`) instead of the real
  workspace: nothing reads it, and tools report success anyway. `ls` the target
  before writing.
- Reporting "published" without a `curl` check. Do not do this.
- Passing slug `.` to `manual-publish.sh` creates `data/learn/./` (a
  `teach-manual-publish-*` directory) which nothing serves. To update the
  aggregate index use `TEACH_JAAKKOLA_ROOT=1 publish-jaakkola.sh ~/learn/_root`.
  That only rewrites `data/learn/index.html`, which is no longer served: the
  catalogue cards on `/learn/` are changed in the admin.
- Large source PDFs (for example books) belong in the authoring workspace's
  `_sources/`, not in `data/learn/` or git.
- Subagents writing many pages time out (about 10 minutes). Check what was
  written before re-dispatching, and give each subagent at most about 6 full
  lessons or 12 short concept pages.
