import type { APIRoute } from "astro";
import { sitemapOrigin, staticUrlEntries, xmlResponse } from "../utils/sitemap";

export const prerender = false;

/** Home and blog index pages, fi and en, with hreflang alternates. */
export const GET: APIRoute = async ({ url }) => {
	const origin = await sitemapOrigin(url);
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
		...staticUrlEntries(origin),
		"</urlset>",
	];
	return xmlResponse(lines.join("\n"));
};
