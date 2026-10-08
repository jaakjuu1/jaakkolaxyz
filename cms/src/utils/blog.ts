import {
	decodeSlug,
	getEmDashCollection,
	getEmDashEntry,
	getTermsForEntries,
	getTranslations,
	type CacheHint,
	type ContentEntry,
	type InferCollectionData,
	type TaxonomyTerm,
} from "emdash";
import { DATE_LOCALE, localizePath, otherLang, type Lang } from "../i18n/ui";

/** Placeholder posts from the old site. They were not imported and redirect to /blog. */
const PLACEHOLDER_SLUGS = new Set(["example-post", "esimerkki-postaus"]);

export type PostEntry = ContentEntry<InferCollectionData<"posts">>;

export interface BlogListItem {
	entry: PostEntry;
	tags: TaxonomyTerm[];
}

export interface BlogPostView extends BlogListItem {
	/** Same post in the other language, when that one is published. */
	translation: string | null;
	cacheHint: CacheHint;
}

/** Published posts of one locale, newest first. */
export async function listPublishedPosts(lang: Lang) {
	const { entries, cacheHint } = await getEmDashCollection("posts", {
		status: "published",
		locale: lang,
		orderBy: { published_at: "desc" },
	});
	const posts = entries.filter((entry) => entry.data.publishedAt);
	const tagsByEntry = await termsFor(posts, lang);
	return {
		cacheHint,
		posts: posts.map(
			(entry): BlogListItem => ({ entry, tags: tagsByEntry.get(entry.data.id) ?? [] }),
		),
	};
}

/**
 * One published post of the given locale, or null. `getEmDashEntry` falls
 * back to the default locale when the requested one is missing and reports it
 * in `fallbackLocale`; that counts as not found.
 */
export async function loadPublishedPost(lang: Lang, rawSlug: string | undefined) {
	const slug = decodeSlug(rawSlug);
	if (!slug) return null;
	const { entry, fallbackLocale, cacheHint } = await getEmDashEntry("posts", slug, { locale: lang });
	if (!entry || fallbackLocale) return null;
	if (!entry.data.publishedAt) return null;

	const [tagsByEntry, { translations }] = await Promise.all([
		termsFor([entry], lang),
		getTranslations("posts", entry.data.id),
	]);
	const other = otherLang(lang);
	const counterpart = translations.find(
		(variant) => variant.locale === other && variant.status === "published" && variant.slug,
	);
	const view: BlogPostView = {
		entry,
		tags: tagsByEntry.get(entry.data.id) ?? [],
		translation: counterpart?.slug ? blogPostPath(other, counterpart.slug) : null,
		cacheHint,
	};
	return view;
}

/**
 * Where an old `/blog/<slug>` URL now lives, or null when the slug is unknown.
 * Placeholder posts go to the blog index; English-only posts go to /en/blog.
 */
export async function legacyBlogRedirect(slug: string | undefined): Promise<string | null> {
	const decoded = decodeSlug(slug);
	if (!decoded) return null;
	if (PLACEHOLDER_SLUGS.has(decoded)) return localizePath("/blog", "fi");
	const english = await loadPublishedPost("en", decoded);
	return english ? blogPostPath("en", decoded) : null;
}

/**
 * URL slug of a post. `entry.id` is not the slug for English entries (it is
 * `en/<slug>`), so use the slug field.
 */
export function postSlug(entry: PostEntry): string {
	return entry.data.slug ?? entry.id;
}

/** Locale-aware URL path of a post, e.g. `/blog/<slug>` or `/en/blog/<slug>`. */
export function blogPostPath(lang: Lang, slug: string): string {
	return localizePath(`/blog/${slug}`, lang);
}

export function formatPostDate(date: Date, lang: Lang): string {
	// Posts are published at 09:00 Finnish time; format in that zone so the date does not shift.
	return date.toLocaleDateString(DATE_LOCALE[lang], {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "Europe/Helsinki",
	});
}

/** Tag terms of each entry, in the entry's locale (the default is Finnish). */
async function termsFor(entries: PostEntry[], lang: Lang): Promise<Map<string, TaxonomyTerm[]>> {
	if (entries.length === 0) return new Map();
	return getTermsForEntries(
		"posts",
		entries.map((entry) => entry.data.id),
		"tag",
		{ locale: lang },
	);
}
