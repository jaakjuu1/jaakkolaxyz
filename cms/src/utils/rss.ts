import { getEmDashCollection } from "emdash";
import { localizePath, SITE_FALLBACK_URL, t, type Lang } from "../i18n/ui";
import { postSlug } from "./blog";

/** RSS 2.0 feed of one locale's published posts, newest first. */
export async function renderBlogFeed(lang: Lang, site: URL | undefined): Promise<Response> {
	const origin = site ?? new URL(SITE_FALLBACK_URL);
	const absolute = (path: string) => new URL(path, origin).href;

	const { entries } = await getEmDashCollection("posts", {
		status: "published",
		locale: lang,
		orderBy: { published_at: "desc" },
		limit: 20,
	});

	const items = entries
		.filter((entry) => entry.data.publishedAt)
		.map((entry) => {
			const link = absolute(localizePath(`/blog/${postSlug(entry)}`, lang));
			return `    <item>
      <title>${escapeXml(entry.data.title || "")}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${entry.data.publishedAt!.toUTCString()}</pubDate>
      <description>${escapeXml(entry.data.excerpt || "")}</description>
    </item>`;
		})
		.join("\n");

	const feedPath = localizePath("/rss.xml", lang);
	const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(t(lang, "blog.feedTitle"))}</title>
    <link>${absolute(localizePath("/blog", lang))}</link>
    <description>${escapeXml(t(lang, "blog.intro"))}</description>
    <language>${lang === "fi" ? "fi-FI" : "en-US"}</language>
    <atom:link href="${absolute(feedPath)}" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;

	return new Response(xml, {
		headers: {
			"Content-Type": "application/rss+xml; charset=utf-8",
			"Cache-Control": "public, max-age=3600",
		},
	});
}

const XML_ESCAPES: Array<[RegExp, string]> = [
	[/&/g, "&amp;"],
	[/</g, "&lt;"],
	[/>/g, "&gt;"],
	[/"/g, "&quot;"],
	[/'/g, "&apos;"],
];

function escapeXml(value: string): string {
	return XML_ESCAPES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}
