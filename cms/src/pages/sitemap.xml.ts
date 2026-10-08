import type { APIRoute } from "astro";
import { CHILD_SITEMAPS, sitemapOrigin, xmlEscape, xmlResponse } from "../utils/sitemap";

export const prerender = false;

/**
 * Sitemap index. Overrides EmDash's own /sitemap.xml (EmDash skips its route when this
 * file exists); the child sitemaps it lists are still EmDash's own routes, or ours.
 */
export const GET: APIRoute = async ({ url }) => {
	const origin = await sitemapOrigin(url);
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...CHILD_SITEMAPS.map(
			(file) => `  <sitemap>\n    <loc>${xmlEscape(`${origin}/${file}`)}</loc>\n  </sitemap>`,
		),
		"</sitemapindex>",
	];
	return xmlResponse(lines.join("\n"));
};
