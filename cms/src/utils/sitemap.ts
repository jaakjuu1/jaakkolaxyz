/**
 * Sitemap helpers for /sitemap.xml (the index) and the child sitemaps.
 * EmDash serves sitemap-posts.xml and sitemap-pages.xml itself; sitemap-static.xml
 * is ours, for the home pages and the blog indexes (EmDash lists content only).
 */
import { getSiteSettings } from "emdash";
import { DEFAULT_LANG, LANGS, localizePath, type Lang } from "../i18n/ui";

/**
 * Child sitemaps listed in /sitemap.xml, in order. sitemap-learn.xml is ours: the
 * learn tracks are plain files, which EmDash does not list.
 */
export const CHILD_SITEMAPS: readonly string[] = [
	"sitemap-static.xml",
	"sitemap-posts.xml",
	"sitemap-pages.xml",
	"sitemap-learn.xml",
];

/** Locale-neutral paths of the static pages, each listed in every language with alternates. */
export const STATIC_PATHS: readonly string[] = ["/", "/blog"];

/**
 * Origin for absolute URLs, resolved as EmDash resolves it for its own sitemaps: the
 * site setting `url`, then EMDASH_SITE_URL (the value astro.config passes to emdash()),
 * then the request origin. Production sets EMDASH_SITE_URL=https://jaakkola.xyz.
 */
export async function sitemapOrigin(requestUrl: URL): Promise<string> {
	const settings = await getSiteSettings();
	const origin =
		settings.url || process.env.EMDASH_SITE_URL || process.env.SITE_URL || requestUrl.origin;
	return origin.replace(/\/$/, "");
}

/** `<url>` entries for the static paths, one per language, each with hreflang alternates. */
export function staticUrlEntries(origin: string): string[] {
	const lines: string[] = [];
	for (const path of STATIC_PATHS) {
		const variants = LANGS.map((lang: Lang) => ({ lang, href: origin + localizePath(path, lang) }));
		const defaultHref = variants.find((variant) => variant.lang === DEFAULT_LANG)?.href ?? origin;
		for (const variant of variants) {
			lines.push("  <url>", `    <loc>${xmlEscape(variant.href)}</loc>`);
			for (const alt of variants) {
				lines.push(
					`    <xhtml:link rel="alternate" hreflang="${alt.lang}" href="${xmlEscape(alt.href)}" />`,
				);
			}
			lines.push(
				`    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(defaultHref)}" />`,
				"  </url>",
			);
		}
	}
	return lines;
}

export function xmlResponse(body: string): Response {
	return new Response(body, {
		headers: {
			"Content-Type": "application/xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
}

export function xmlEscape(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}
