import {
	decodeSlug,
	getEmDashEntry,
	getTranslations,
	type CacheHint,
	type ContentEntry,
	type InferCollectionData,
} from "emdash";
import { localizePath, otherLang, type Lang } from "../i18n/ui";
import { requestPath } from "./request-path";

export type PageEntry = ContentEntry<InferCollectionData<"pages">>;

export interface PageView {
	entry: PageEntry;
	/** Same page in the other language, when that one is published. */
	translation: string | null;
	cacheHint: CacheHint;
}

/**
 * One published page of the given locale, or null. `getEmDashEntry` falls back
 * to the default locale when the requested one is missing and reports it in
 * `fallbackLocale`; that counts as not found.
 */
export async function loadPublishedPage(lang: Lang, rawSlug: string | undefined) {
	const slug = decodeSlug(rawSlug);
	if (!slug) return null;
	const { entry, fallbackLocale, cacheHint } = await getEmDashEntry("pages", slug, { locale: lang });
	if (!entry || fallbackLocale) return null;
	if (!entry.data.publishedAt) return null;

	const { translations } = await getTranslations("pages", entry.data.id);
	const other = otherLang(lang);
	const counterpart = translations.find(
		(variant) => variant.locale === other && variant.status === "published" && variant.slug,
	);
	const view: PageView = {
		entry,
		translation: counterpart?.slug ? pagePath(other, counterpart.slug) : null,
		cacheHint,
	};
	return view;
}

/** URL slug of a page. `entry.id` is `en/<slug>` for English entries, so use the slug field. */
export function pageSlug(entry: PageEntry): string {
	return entry.data.slug ?? entry.id;
}

/** Locale-aware URL path of a page: `/<slug>` (fi) or `/en/<slug>` (en). */
export function pagePath(lang: Lang, slug: string): string {
	return localizePath(`/${slug}`, lang);
}

/**
 * True when the request is the page's own URL (a trailing slash is allowed). Variants
 * such as /tietosuoja.html must not serve the page.
 */
export function isPagePath(url: URL, lang: Lang, slug: string): boolean {
	return requestPath(url) === pagePath(lang, slug);
}
