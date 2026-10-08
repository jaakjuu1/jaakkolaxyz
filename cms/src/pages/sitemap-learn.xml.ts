import type { APIRoute } from "astro";
import { listPublishedTracks, trackSlug } from "../utils/learn";
import { listLearnHtmlPaths } from "../utils/learn-files";
import { sitemapOrigin, xmlEscape, xmlResponse } from "../utils/sitemap";

export const prerender = false;

/**
 * /learn/ and the pages of every published track under data/learn/, Finnish only (no
 * hreflang). A track without a published learn_tracks entry (a draft) is left out, so
 * the sitemap matches the catalogue; its pages stay reachable by URL.
 */
export const GET: APIRoute = async ({ url }) => {
	const origin = await sitemapOrigin(url);
	const { tracks } = await listPublishedTracks();
	const published = new Set(tracks.map(trackSlug));
	const pages = (await listLearnHtmlPaths()).filter((path) => {
		const folder = path.slice("/learn/".length).split("/")[0];
		return published.has(decodeURIComponent(folder));
	});
	const paths = ["/learn/", ...pages];
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...paths.map((path) => `  <url>\n    <loc>${xmlEscape(origin + path)}</loc>\n  </url>`),
		"</urlset>",
	];
	return xmlResponse(lines.join("\n"));
};
