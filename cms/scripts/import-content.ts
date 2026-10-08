/**
 * Imports the old site's content into a running EmDash instance over REST:
 * blog posts (content/blog/{fi,en}), the privacy notice (client/src/data/content.ts),
 * the learn track catalogue (data/learn/index.html) and the blog images.
 *
 * Idempotent: an entry whose slug and locale already exist is skipped, or updated
 * with --update. Media files are matched by filename.
 *
 *   cd cms && npx tsx scripts/import-content.ts [--update]
 *   env: EMDASH_URL (default http://localhost:4321), EMDASH_TOKEN (required)
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { parse as parseHtml } from "node-html-parser";
import { markdownToPortableText } from "emdash/client";
import { content as siteContent } from "../../client/src/data/content";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BLOG_DIR = join(ROOT, "content/blog");
const LEARN_DIR = join(ROOT, "data/learn");
const PUBLIC_DIR = join(ROOT, "client/public");

const EMDASH_URL = (process.env.EMDASH_URL ?? "http://localhost:4321").replace(/\/+$/, "");
const EMDASH_TOKEN = process.env.EMDASH_TOKEN;
const UPDATE = process.argv.includes("--update");
const API = `${EMDASH_URL}/_emdash/api`;

const LOCALES = ["fi", "en"] as const;
type Locale = (typeof LOCALES)[number];
const SKIPPED_POSTS = new Set(["example-post", "esimerkki-postaus"]);

/** en entry -> fi entry it translates. The fi entry is created first. */
const TRANSLATION_PAIRS: Array<{ fi: string; en: string }> = [
  { fi: "2026-01-28-ai-cold-email-agent", en: "2026-01-28-ai-cold-email-agent" },
  { fi: "2026-03-10-sointimaisemia", en: "2026-03-10-sointimaisemia" },
  { fi: "2026-05-22-agentiton-palvelinoperointi", en: "2026-05-22-agentless-server-operations" },
];

/**
 * fi tag slug -> en tag slug, for tags that mean the same thing in both languages.
 * Their en terms are created with translationOf, so one post-level assignment resolves
 * in both locales. Tags without a pair stay unlinked.
 */
const TAG_PAIRS: Array<{ fi: string; en: string }> = [
  { fi: "hermes", en: "hermes" },
  { fi: "ssh", en: "ssh" },
  { fi: "devops", en: "devops" },
  { fi: "tuotanto", en: "production" },
  { fi: "agentit", en: "agents" },
];

const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Portable Text blocks are plain JSON; only the fields this script writes are typed. */
type PTSpan = { _type: "span"; _key: string; text: string; marks: string[] };
type PTMarkDef = { _type: string; _key: string; [k: string]: unknown };
type PTBlock = { _type: string; _key: string; [k: string]: unknown };

interface ExistingEntry {
  id: string;
  slug: string | null;
  locale: string | null;
  status: string;
}

interface MediaRef {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  blurhash: string | null;
  dominantColor: string | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

// ---------------------------------------------------------------------------
// REST client and tallies
// ---------------------------------------------------------------------------

class RequestFailed extends Error {}

async function api<T = any>(
  method: string,
  path: string,
  options: { body?: unknown; form?: FormData; query?: Record<string, string> } = {},
): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);

  const headers: Record<string, string> = { Authorization: `Bearer ${EMDASH_TOKEN}` };
  let body: BodyInit | undefined;
  if (options.form) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body });
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause ?? error;
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new RequestFailed(`${method} ${url.pathname}: ${reason}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new RequestFailed(`${method} ${url.pathname}${url.search} failed: HTTP ${res.status}\n${text}`);
  }
  return (JSON.parse(text) as ApiEnvelope<T>).data;
}

/** Follows nextCursor until the collection listing is exhausted. */
async function listAll<T>(path: string, query: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await api<{ items: T[]; nextCursor?: string }>("GET", path, {
      query: { ...query, limit: "100", ...(cursor ? { cursor } : {}) },
    });
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

type Outcome = "created" | "updated" | "skipped" | "removed";
const tallies = new Map<string, Record<Outcome, number>>();

function tally(type: string, outcome: Outcome): void {
  const row = tallies.get(type) ?? { created: 0, updated: 0, skipped: 0, removed: 0 };
  row[outcome]++;
  tallies.set(type, row);
}

function note(message: string): void {
  console.log(`note: ${message}`);
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function randomKey(): string {
  return randomBytes(6).toString("hex");
}

function slugify(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isoDate(value: unknown, where: string): string {
  // gray-matter turns unquoted YAML dates into Date objects (UTC midnight).
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${where}: date "${text}" is not YYYY-MM-DD`);
  return text;
}

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** True when the leading H1 is the post title, or its first part (a restyled title). */
function h1RepeatsTitle(h1: string, title: string): boolean {
  const heading = normalizeForCompare(h1);
  const full = normalizeForCompare(title);
  return heading.length > 0 && (heading === full || full.startsWith(`${heading} `));
}

// ---------------------------------------------------------------------------
// Markdown -> Portable Text
// ---------------------------------------------------------------------------

function span(text: string, marks: string[] = []): PTSpan {
  return { _type: "span", _key: randomKey(), text, marks };
}

/**
 * Applies `*italic*` (the old site's Markdown style) across the spans of one block.
 * markdownToPortableText only knows `_italic_`, so it leaves single asterisks in the text,
 * and an italic run can cross a link span. Each `*` toggles italics; the em mark is added
 * to every span inside a run. Returns null when the asterisks do not pair up.
 */
function applyItalics(spans: PTSpan[]): PTSpan[] | null {
  const out: PTSpan[] = [];
  let italic = false;
  for (const current of spans) {
    const pieces = current.text.split("*");
    pieces.forEach((piece, index) => {
      if (index > 0) italic = !italic;
      if (piece === "") return;
      const marks = italic && !current.marks.includes("em") ? [...current.marks, "em"] : current.marks;
      out.push(span(piece, marks));
    });
  }
  return italic ? null : out;
}

/**
 * Bare URLs and e-mail addresses, matched the way GFM autolinks them (marked does this on
 * the old site). A trailing sentence punctuation mark is not part of the link.
 */
const AUTOLINK = /(?:https?:\/\/|www\.)[^\s<>]*[^\s<>.,;:!?'")\]]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

/**
 * Finishes the inline content of one block: applies italics, then links bare URLs and
 * e-mail addresses that are not already links. Returns the spans and the mark definitions.
 */
function finishSpans(
  spans: PTSpan[],
  markDefs: PTMarkDef[],
  where: string,
): { children: PTSpan[]; markDefs: PTMarkDef[] } {
  const italic = applyItalics(spans);
  if (!italic) throw new Error(`${where}: unbalanced "*" in "${spans.map((s) => s.text).join("")}"`);

  const linkKeys = new Set(markDefs.filter((def) => def._type === "link").map((def) => def._key));
  const defs = [...markDefs];
  const children: PTSpan[] = [];
  for (const current of italic) {
    if (current.marks.includes("code") || current.marks.some((mark) => linkKeys.has(mark))) {
      children.push(current);
      continue;
    }
    let last = 0;
    for (const match of current.text.matchAll(AUTOLINK)) {
      const start = match.index ?? 0;
      const text = match[0];
      if (start > last) children.push(span(current.text.slice(last, start), current.marks));
      const href = /^https?:\/\//.test(text)
        ? text
        : text.startsWith("www.")
          ? `http://${text}`
          : `mailto:${text}`;
      const key = randomKey();
      defs.push({ _type: "link", _key: key, href });
      children.push(span(text, [...current.marks, key]));
      last = start + text.length;
    }
    if (last < current.text.length) children.push(span(current.text.slice(last), current.marks));
  }
  return { children, markDefs: defs };
}

/** Inline Markdown of one line (used for table cells). */
function inlineContent(text: string): { content: PTSpan[]; markDefs: PTMarkDef[] } {
  const [block] = markdownToPortableText(text) as unknown as Array<{
    children?: PTSpan[];
    markDefs?: PTMarkDef[];
  }>;
  const children = block?.children?.length ? block.children : [span(text)];
  const finished = finishSpans(children, block?.markDefs ?? [], `table cell "${text}"`);
  return { content: finished.children, markDefs: finished.markDefs };
}

const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** Builds an EmDash table block (the shape the admin editor writes). */
function tableBlock(rows: string[][]): PTBlock {
  return {
    _type: "table",
    _key: randomKey(),
    hasHeaderRow: true,
    rows: rows.map((cells, rowIndex) => ({
      _type: "tableRow",
      _key: randomKey(),
      cells: cells.map((text) => {
        const { content, markDefs } = inlineContent(text);
        return {
          _type: "tableCell",
          _key: randomKey(),
          isHeader: rowIndex === 0,
          content,
          markDefs,
        };
      }),
    })),
  };
}

function opaque(block: PTBlock): string {
  const json = JSON.stringify(block);
  if (json.includes("-->")) throw new Error("block JSON would end the opaque fence early");
  return `<!--ec:block ${json} -->`;
}

/**
 * Markdown body -> Portable Text blocks.
 * - Consecutive text lines are one paragraph (as `marked` renders them).
 * - Tables and `---` rules are emitted as EmDash table and break blocks.
 * - Everything else goes through markdownToPortableText; italics are fixed up afterwards.
 */
function markdownToBlocks(body: string, where: string): PTBlock[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: Array<{ text: string; paragraph: boolean }> = [];
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      inFence = !inFence;
      out.push({ text: line, paragraph: false });
      continue;
    }
    if (inFence) {
      out.push({ text: line, paragraph: false });
      continue;
    }

    if (line.trim() === "") {
      out.push({ text: "", paragraph: false });
      continue;
    }

    if (/^\s*---\s*$/.test(line)) {
      out.push({ text: opaque({ _type: "break", _key: randomKey(), style: "lineBreak" }), paragraph: false });
      continue;
    }

    if (line.trim().startsWith("|") && i + 1 < lines.length && TABLE_SEPARATOR.test(lines[i + 1])) {
      const rows = [parseTableRow(line)];
      i += 2; // skip the separator row
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      i--;
      out.push({ text: opaque(tableBlock(rows)), paragraph: false });
      continue;
    }

    const isPlain =
      !/^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+\.\s|!\[|\|)/.test(line);
    const previous = out[out.length - 1];
    if (isPlain && previous?.paragraph) {
      previous.text = `${previous.text} ${line.trim()}`;
    } else {
      out.push({ text: isPlain ? line.trim() : line, paragraph: isPlain });
    }
  }

  const blocks = markdownToPortableText(out.map((entry) => entry.text).join("\n")) as unknown as PTBlock[];
  for (const block of blocks) {
    if (block._type !== "block") continue;
    const finished = finishSpans(
      (block.children as PTSpan[]) ?? [],
      (block.markDefs as PTMarkDef[]) ?? [],
      where,
    );
    block.children = finished.children;
    block.markDefs = finished.markDefs;
  }
  return blocks;
}

// ---------------------------------------------------------------------------
// Blog posts
// ---------------------------------------------------------------------------

interface PostSource {
  locale: Locale;
  slug: string;
  where: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  tags: string[];
  blocks: PTBlock[];
  imageFiles: Array<{ file: string; alt: string }>;
}

function readPost(locale: Locale, slug: string, imageFiles: Set<string>): PostSource {
  const where = `${locale}/${slug}`;
  const path = join(BLOG_DIR, locale, `${slug}.md`);
  const { data, content } = matter(readFileSync(path, "utf8"));

  const title = String(data.title ?? "").trim();
  if (!title) throw new Error(`${where}: missing title`);
  const excerpt = String(data.excerpt ?? "").trim();
  const date = isoDate(data.date, where);
  const tags: string[] = Array.isArray(data.tags) ? data.tags.map((tag: unknown) => String(tag)) : [];

  // A leading "# H1" is the old page's heading. The post page already shows the title,
  // so an H1 that repeats it is dropped; a different H1 is kept as an h2.
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first >= 0) {
    const h1 = /^# (.+)$/.exec(lines[first]);
    if (h1) {
      if (h1RepeatsTitle(h1[1], title)) {
        lines.splice(first, 1);
        note(`${where}: dropped leading H1 "${h1[1]}" (repeats title)`);
      } else {
        lines[first] = `## ${h1[1]}`;
        note(`${where}: leading H1 "${h1[1]}" differs from title, kept as h2`);
      }
    }
  }

  const blocks = markdownToBlocks(lines.join("\n"), where);

  const imageRefs: Array<{ file: string; alt: string }> = [];
  for (const block of blocks) {
    if (block._type !== "image") continue;
    const asset = block.asset as { url?: string };
    const url = asset?.url ?? "";
    const file = basename(url);
    if (!url.startsWith("/blog-images/") || !imageFiles.has(file)) {
      throw new Error(`${where}: image "${url}" is not in client/public/blog-images`);
    }
    imageRefs.push({ file, alt: String(block.alt ?? "") });
  }

  return {
    locale,
    slug,
    where,
    title,
    excerpt,
    publishedAt: `${date}T09:00:00+03:00`,
    tags,
    blocks,
    imageFiles: imageRefs,
  };
}

// ---------------------------------------------------------------------------
// Existing content lookup and upserts
// ---------------------------------------------------------------------------

async function indexEntries(collection: string): Promise<Map<string, ExistingEntry>> {
  const index = new Map<string, ExistingEntry>();
  for (const locale of LOCALES) {
    const items = await listAll<ExistingEntry>(`/content/${collection}`, { status: "all", locale });
    for (const item of items) {
      if (item.slug) index.set(`${item.locale ?? locale}/${item.slug}`, item);
    }
  }
  return index;
}

interface UpsertInput {
  collection: string;
  type: string;
  slug: string;
  locale: Locale;
  data: Record<string, unknown>;
  publish: boolean;
  publishedAt?: string;
  taxonomies?: Record<string, string[]>;
  translationOf?: string;
  /** SEO fields (REST `seo`); only sent when given. */
  seo?: { description: string };
}

/**
 * Creates the entry as a draft (with publishedAt when given), then publishes it.
 * An existing entry is skipped; with --update its fields are rewritten.
 * Returns the entry id.
 */
async function upsert(input: UpsertInput, index: Map<string, ExistingEntry>): Promise<string> {
  const { collection, type, slug, locale } = input;
  const key = `${locale}/${slug}`;
  const existing = index.get(key);

  if (existing) {
    if (UPDATE) {
      const current = await api<{ _rev: string }>("GET", `/content/${collection}/${existing.id}`, {
        query: { locale },
      });
      await api("PUT", `/content/${collection}/${existing.id}`, {
        query: { locale },
        body: {
          data: input.data,
          _rev: current._rev,
          ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
          ...(input.taxonomies ? { taxonomies: input.taxonomies } : {}),
          ...(input.seo ? { seo: input.seo } : {}),
        },
      });
      if (input.publish) {
        await api("POST", `/content/${collection}/${existing.id}/publish`, { body: {} });
      }
      tally(type, "updated");
      console.log(`updated ${type} ${key}`);
    } else if (input.publish && existing.status !== "published") {
      // An earlier run stopped between create and publish.
      await api("POST", `/content/${collection}/${existing.id}/publish`, { body: {} });
      tally(type, "updated");
      console.log(`published ${type} ${key} (left as draft by an earlier run)`);
    } else {
      tally(type, "skipped");
    }
    return existing.id;
  }

  const created = await api<{ item: { id: string } }>("POST", `/content/${collection}`, {
    body: {
      slug,
      locale,
      status: "draft",
      data: input.data,
      ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
      ...(input.taxonomies ? { taxonomies: input.taxonomies } : {}),
      ...(input.translationOf ? { translationOf: input.translationOf } : {}),
      ...(input.seo ? { seo: input.seo } : {}),
    },
  });
  const id = created.item.id;
  if (input.publish) {
    await api("POST", `/content/${collection}/${id}/publish`, { body: {} });
  }
  index.set(key, { id, slug, locale, status: input.publish ? "published" : "draft" });
  tally(type, "created");
  console.log(`created ${type} ${key}${input.publish ? "" : " (draft)"}`);
  return id;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function removeBuiltinCategory(): Promise<void> {
  const { taxonomies } = await api<{ taxonomies: Array<{ name: string }> }>("GET", "/taxonomies");
  if (!taxonomies.some((taxonomy) => taxonomy.name === "category")) {
    tally("category taxonomy", "skipped");
    return;
  }
  await api("DELETE", "/taxonomies/category");
  tally("category taxonomy", "removed");
  console.log("removed built-in category taxonomy");
}

/**
 * Creates the tag terms of both locales. fi first; an en term that has a pair in TAG_PAIRS
 * is created with translationOf = the fi term id, so the two share a translation group.
 */
async function ensureTagTerms(tagsByLocale: Map<Locale, Map<string, string>>): Promise<void> {
  const termIds = new Map<string, string>(); // `${locale}/${slug}` -> term id
  for (const locale of LOCALES) {
    const { terms } = await api<{ terms: Array<{ id: string; slug: string }> }>(
      "GET",
      "/taxonomies/tag/terms",
      { query: { locale } },
    );
    for (const term of terms) termIds.set(`${locale}/${term.slug}`, term.id);
    for (const [slug, label] of tagsByLocale.get(locale) ?? new Map<string, string>()) {
      if (termIds.has(`${locale}/${slug}`)) {
        tally("tag terms", "skipped");
        continue;
      }
      const pair = locale === "en" ? TAG_PAIRS.find((candidate) => candidate.en === slug) : undefined;
      const translationOf = pair ? termIds.get(`fi/${pair.fi}`) : undefined;
      if (pair && !translationOf) throw new Error(`en tag ${slug}: fi term ${pair.fi} missing`);
      const created = await api<{ term: { id: string } }>("POST", "/taxonomies/tag/terms", {
        body: { slug, label, locale, ...(translationOf ? { translationOf } : {}) },
      });
      termIds.set(`${locale}/${slug}`, created.term.id);
      tally("tag terms", "created");
    }
  }
}

function mimeTypeFor(file: string): string {
  const type = MIME_TYPES[extname(file).toLowerCase()];
  if (!type) throw new Error(`${file}: unsupported image type`);
  return type;
}

interface MediaResponseItem {
  id: string;
  url: string;
  width?: number | null;
  height?: number | null;
  blurhash?: string | null;
  dominantColor?: string | null;
}

function mediaRef(item: MediaResponseItem): MediaRef {
  return {
    id: item.id,
    url: item.url,
    width: item.width ?? null,
    height: item.height ?? null,
    blurhash: item.blurhash ?? null,
    dominantColor: item.dominantColor ?? null,
  };
}

/** Uploads each file in client/public/blog-images once; returns filename -> media. */
async function ensureMedia(altByFile: Map<string, string>): Promise<Map<string, MediaRef>> {
  const dir = join(PUBLIC_DIR, "blog-images");
  type MediaItem = MediaRef & { filename: string };
  const existing = await listAll<MediaItem>("/media");
  const byFilename = new Map(existing.map((item) => [item.filename, item]));
  const refs = new Map<string, MediaRef>();

  for (const file of readdirSync(dir).sort()) {
    const found = byFilename.get(file);
    if (found) {
      refs.set(file, mediaRef(found));
      tally("media", "skipped");
      continue;
    }
    const form = new FormData();
    const bytes = readFileSync(join(dir, file));
    form.append("file", new Blob([bytes], { type: mimeTypeFor(file) }), file);
    form.append("alt", altByFile.get(file) ?? "");
    const uploaded = await api<{ item: MediaItem }>("POST", "/media", { form });
    refs.set(file, mediaRef(uploaded.item));
    tally("media", "created");
    console.log(`uploaded media ${file}`);
  }
  return refs;
}

function pageParagraph(text: string): PTBlock {
  return { _type: "block", _key: randomKey(), style: "normal", markDefs: [], children: [span(text)] };
}

function pageHeading(text: string): PTBlock {
  return { _type: "block", _key: randomKey(), style: "h2", markDefs: [], children: [span(text)] };
}

function pageListItem(text: string): PTBlock {
  return {
    _type: "block",
    _key: randomKey(),
    style: "normal",
    listItem: "bullet",
    level: 1,
    markDefs: [],
    children: [span(text)],
  };
}

type PrivacyPage = (typeof siteContent)["fi"]["privacy"];

/**
 * The storage sentence of the privacy notice. The old site kept the language in
 * localStorage; now the language comes from the URL and localStorage keeps the
 * theme. client/src/data/content.ts still has the old sentence, so it is replaced here.
 */
const STORAGE_SENTENCE: Record<Locale, { old: string; replacement: string }> = {
  fi: {
    old: "Kielivalintasi tallennetaan vain selaimesi paikalliseen muistiin (localStorage).",
    replacement: "Valitsemasi teema (vaalea tai tumma) tallennetaan vain selaimesi paikalliseen muistiin (localStorage).",
  },
  en: {
    old: "Your language choice is kept only in your browser's local storage (localStorage).",
    replacement: "Your theme choice (light or dark) is kept only in your browser's local storage (localStorage).",
  },
};

/**
 * Privacy page -> Portable Text. The Google Fonts sentence is dropped (fonts are
 * self-hosted) and the storage sentence is updated; the rest of each paragraph is kept verbatim.
 */
function privacyBlocks(page: PrivacyPage, locale: Locale): PTBlock[] {
  const storage = STORAGE_SENTENCE[locale];
  const blocks: PTBlock[] = [pageParagraph(page.updated)];
  for (const section of page.sections) {
    blocks.push(pageHeading(section.heading));
    for (const paragraph of section.body ?? []) {
      const kept = /Google Fonts|fonts\.googleapis/i.test(paragraph)
        ? paragraph
            .split(/(?<=\.)\s+/)
            .filter((sentence) => !/Google Fonts|fonts\.googleapis/i.test(sentence))
            .join(" ")
        : paragraph;
      const text = kept.replace(storage.old, storage.replacement);
      if (text.trim()) blocks.push(pageParagraph(text));
    }
    for (const item of section.items ?? []) blocks.push(pageListItem(item));
    for (const paragraph of section.after ?? []) blocks.push(pageParagraph(paragraph));
  }
  const updated = blocks.some((block) => JSON.stringify(block).includes(storage.replacement));
  if (!updated) throw new Error(`privacy (${locale}): storage sentence not found; update STORAGE_SENTENCE`);
  return blocks;
}

/** Search-result descriptions of the privacy pages (the pages have no excerpt field). */
const PRIVACY_DESCRIPTION: Record<Locale, string> = {
  fi: "Miten jaakkola.xyz käsittelee yhteydenottolomakkeen henkilötietoja, kuinka kauan niitä säilytetään ja mitkä ovat oikeutesi.",
  en: "How jaakkola.xyz handles personal data from the contact form, how long it is kept, and your rights.",
};

async function importPrivacy(index: Map<string, ExistingEntry>): Promise<void> {
  const fiId = await upsert(
    {
      collection: "pages",
      type: "pages",
      slug: "tietosuoja",
      locale: "fi",
      data: { title: siteContent.fi.privacy.title, content: privacyBlocks(siteContent.fi.privacy, "fi") },
      publish: true,
      seo: { description: PRIVACY_DESCRIPTION.fi },
    },
    index,
  );
  await upsert(
    {
      collection: "pages",
      type: "pages",
      slug: "privacy",
      locale: "en",
      data: { title: siteContent.en.privacy.title, content: privacyBlocks(siteContent.en.privacy, "en") },
      publish: true,
      translationOf: fiId,
      seo: { description: PRIVACY_DESCRIPTION.en },
    },
    index,
  );
}

// ---------------------------------------------------------------------------
// Learn tracks
// ---------------------------------------------------------------------------

const TRACK_STATUSES = new Set(["julkaistu", "tulossa"]);

/** Group headings (h2) of the old catalogue page and the `group` value each one starts. */
const GROUP_BY_HEADING: Record<string, string> = {
  "Ymmärtämisen ja harjoituksen polut": "ymmartaminen",
  "Rakentajan polut": "rakentaja",
};

async function importLearnTracks(index: Map<string, ExistingEntry>): Promise<void> {
  const indexHtml = join(LEARN_DIR, "index.html");
  const page = parseHtml(readFileSync(indexHtml, "utf8"));
  // Headings and cards in document order: a card belongs to the nearest h2 before it.
  const sections = page.querySelectorAll("h2, div.path");
  const cards: { card: (typeof sections)[number]; group: string | null }[] = [];
  let group: string | null = null;
  for (const node of sections) {
    if (node.tagName === "H2") {
      group = GROUP_BY_HEADING[node.text.trim()] ?? null;
    } else {
      cards.push({ card: node, group });
    }
  }
  const linked = new Set<string>();

  for (const [position, { card, group }] of cards.entries()) {
    const link = card.querySelector("h3 a");
    const href = link?.getAttribute("href") ?? "";
    const slug = href.replace(/\/+$/, "");
    if (!slug || !existsSync(join(LEARN_DIR, slug, "index.html"))) {
      throw new Error(`learn card "${href}" has no track folder with index.html`);
    }
    linked.add(slug);

    const statusText = card.querySelector(".status")?.text.trim().toLowerCase() ?? "";
    if (!TRACK_STATUSES.has(statusText)) throw new Error(`learn card ${slug}: unknown status "${statusText}"`);
    if (!group) throw new Error(`learn card ${slug} is not under a known group heading`);

    const lessonStat = card
      .querySelectorAll(".stats span")
      .find((stat) => /oppituntia/.test(stat.text));
    const lessonCount = Number.parseInt(lessonStat?.querySelector("strong")?.text ?? "", 10);
    // The other stats spans (topic, format, duration) are the card's stats note.
    const statsNote = card
      .querySelectorAll(".stats span")
      .filter((stat) => stat !== lessonStat)
      .map((stat) => stat.text.trim())
      .filter(Boolean)
      .join(" · ");

    await upsert(
      {
        collection: "learn_tracks",
        type: "learn_tracks",
        slug,
        locale: "fi",
        data: {
          title: link?.text.trim() ?? slug,
          kind: card.querySelector(".kind")?.text.trim() ?? "",
          blurb: card.querySelector(".blurb")?.text.trim() ?? "",
          ...(Number.isFinite(lessonCount) ? { lesson_count: lessonCount } : {}),
          ...(statsNote ? { stats_note: statsNote } : {}),
          track_status: statusText,
          group,
          order: position + 1,
        },
        publish: statusText === "julkaistu",
      },
      index,
    );
  }

  // Track folders without a card on the catalogue page become drafts.
  const folders = readdirSync(LEARN_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(LEARN_DIR, entry.name, "index.html")))
    .map((entry) => entry.name)
    .filter((name) => !linked.has(name))
    .sort();

  for (const [offset, folder] of folders.entries()) {
    const trackTitle = parseHtml(readFileSync(join(LEARN_DIR, folder, "index.html"), "utf8"))
      .querySelector("title")
      ?.text.trim();
    await upsert(
      {
        collection: "learn_tracks",
        type: "learn_tracks",
        slug: folder,
        locale: "fi",
        data: {
          title: trackTitle || folder,
          track_status: "tulossa",
          // No card on the old page: the one draft track is a "build" path (its page
          // describes a practical path for building a micro-authority).
          group: "rakentaja",
          order: cards.length + offset + 1,
        },
        publish: false,
      },
      index,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function printSummary(): void {
  const rows = [...tallies.entries()].map(([type, counts]) => ({ type, ...counts }));
  console.log("\nSummary");
  console.table(rows);
}

async function main(): Promise<void> {
  if (!EMDASH_TOKEN) throw new Error("EMDASH_TOKEN is not set (use the token from the dev bypass or the admin)");
  console.log(`importing into ${EMDASH_URL}${UPDATE ? " (--update)" : ""}`);

  await removeBuiltinCategory();

  // Parse every post first so tags and images are known before anything is written.
  const imageFiles = new Set(readdirSync(join(PUBLIC_DIR, "blog-images")));
  const postSources: PostSource[] = [];
  for (const locale of LOCALES) {
    const slugs = readdirSync(join(BLOG_DIR, locale))
      .filter((file) => file.endsWith(".md"))
      .map((file) => basename(file, ".md"))
      .filter((slug) => !SKIPPED_POSTS.has(slug))
      .sort();
    for (const slug of slugs) postSources.push(readPost(locale, slug, imageFiles));
  }

  const tagsByLocale = new Map<Locale, Map<string, string>>();
  for (const locale of LOCALES) tagsByLocale.set(locale, new Map());
  for (const post of postSources) {
    for (const label of post.tags) {
      const slug = slugify(label);
      if (!tagsByLocale.get(post.locale)?.has(slug)) tagsByLocale.get(post.locale)?.set(slug, label);
    }
  }
  await ensureTagTerms(tagsByLocale);

  const altByFile = new Map<string, string>();
  for (const post of postSources) {
    for (const image of post.imageFiles) if (!altByFile.has(image.file)) altByFile.set(image.file, image.alt);
  }
  const media = await ensureMedia(altByFile);

  const postIndex = await indexEntries("posts");
  const fiIdBySlug = new Map<string, string>();
  const ordered = [...postSources].sort((a, b) => (a.locale === b.locale ? 0 : a.locale === "fi" ? -1 : 1));
  for (const post of ordered) {
    const blocks = post.blocks.map((block) => {
      if (block._type !== "image") return block;
      const file = basename((block.asset as { url: string }).url);
      const ref = media.get(file);
      if (!ref) throw new Error(`${post.where}: no media for ${file}`);
      // Same fields the admin editor writes for an image block (width/height, plus the
      // placeholders Image.astro reads), without the nulls.
      const sized = Object.fromEntries(
        Object.entries({
          width: ref.width,
          height: ref.height,
          blurhash: ref.blurhash,
          dominantColor: ref.dominantColor,
        }).filter(([, value]) => value !== null),
      );
      return { ...block, asset: { _ref: ref.id, url: ref.url }, ...sized };
    });
    const translation = TRANSLATION_PAIRS.find((pair) => pair.en === post.slug && post.locale === "en");
    const translationOf = translation ? fiIdBySlug.get(translation.fi) : undefined;
    if (translation && !translationOf) throw new Error(`${post.where}: fi translation ${translation.fi} missing`);

    const tagSlugs = post.tags.map(slugify);
    const id = await upsert(
      {
        collection: "posts",
        type: `posts ${post.locale}`,
        slug: post.slug,
        locale: post.locale,
        data: { title: post.title, excerpt: post.excerpt, content: blocks },
        publish: true,
        publishedAt: post.publishedAt,
        taxonomies: tagSlugs.length > 0 ? { tag: tagSlugs } : undefined,
        translationOf,
      },
      postIndex,
    );
    if (post.locale === "fi") fiIdBySlug.set(post.slug, id);
  }

  const pageIndex = await indexEntries("pages");
  await importPrivacy(pageIndex);

  const learnIndex = await indexEntries("learn_tracks");
  await importLearnTracks(learnIndex);

  printSummary();
}

main().catch((error: unknown) => {
  if (error instanceof RequestFailed) {
    console.error(`\n${error.message}`);
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
  }
  process.exit(1);
});
