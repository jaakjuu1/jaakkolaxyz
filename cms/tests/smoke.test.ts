/**
 * Read-only smoke tests for the public site (plan sections 4-6b and 9).
 *
 * Run from cms/:  npm run test:smoke            (CMS_URL defaults to http://localhost:4321)
 *                 CMS_URL=https://jaakkola.xyz npm run test:smoke
 *
 * Only GET and HEAD are sent. Redirects are never followed: a 301 is asserted by its Location.
 * Nothing here writes, so the same suite can run against production.
 *
 * Origins: CMS_URL is where the requests go. Canonical, og:url, og:image and hreflang must name
 * the public origin, SITE_URL (default https://jaakkola.xyz). Sitemap and Location URLs must be on
 * CMS_URL's own origin, which catches a missing EMDASH_SITE_URL or a bad proxy in production.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import https from "node:https";

// ---------------------------------------------------------------------------------------------
// Content-dependent expectations. When posts, learn tracks or home-page items are published,
// unpublished or renamed in the EmDash admin, change the values here. Nothing else in this file
// depends on the content.
// ---------------------------------------------------------------------------------------------
const COUNTS = {
	/** Published Finnish posts on /blog (content/blog/fi, minus the esimerkki-postaus placeholder). */
	fiPosts: 4,
	/** Published English posts on /en/blog (content/blog/en, minus the example-post placeholder). */
	enPosts: 5,
	/** Published learn_tracks cards on /learn/. */
	learnTracks: 7,
	/** <img> tags inside the john-dee article (the English post with the table). */
	johnDeeImages: 4,
};

const SLUGS = {
	/** Finnish post without a translation. */
	fiOnly: "2026-02-18-lahituottajatori",
	/** English post without a Finnish version. Its old /blog/<slug> URL 301s to /en/blog/<slug>. */
	enOnly: "john-dee",
	/** English post with bash code blocks; its old /blog/<slug> URL 301s to /en/blog/<slug>. */
	enCode: "2026-05-22-agentless-server-operations",
	/** Translation pairs as [fi, en]. */
	pairs: [
		["2026-01-28-ai-cold-email-agent", "2026-01-28-ai-cold-email-agent"],
		["2026-03-10-sointimaisemia", "2026-03-10-sointimaisemia"],
		["2026-05-22-agentiton-palvelinoperointi", "2026-05-22-agentless-server-operations"],
	] as const,
};

/** Service and case-study titles that must appear on the home pages (src/i18n/home.ts). */
const HOME_TITLES = {
	fi: {
		services: ["AI & Automaatio", "WordPress & WooCommerce", "Agentit & Botit"],
		cases: ["Sisältö- ja verkkokauppavetoinen organisaatio", "Rakennusalan urakoitsija (saumaus / julkisivutyöt)"],
	},
	en: {
		services: ["AI & Automation", "WordPress & WooCommerce", "Agents & Bots"],
		cases: ["Content- and e-commerce-driven organization", "Construction contractor (joint sealing / façade work)"],
	},
};

/** Learn track folders with no published card (drafts): /learn/ must not link them. */
const DRAFT_TRACKS = ["mikroauktoriteetti"] as const;

const LEARN = {
	track: "/learn/ai-music/",
	lesson: "/learn/ai-music/lessons/0004-suno-promptitiede.html",
	wav: "/learn/ai-music/reference/sound-guitar.wav",
	png: "/learn/ai-music/reference/mel-vs-linear.png",
	headings: ["Ymmärtämisen ja harjoituksen polut", "Rakentajan polut"],
};

const THEME_SENTENCE = {
	fi: /Valitsemasi teema \(vaalea tai tumma\) tallennetaan vain selaimesi paikalliseen muistiin/,
	en: /Your theme choice \(light or dark\) is kept only in your browser's local storage/,
};

const TRAVERSAL_PATHS = [
	"/learn/..%2f..%2fpackage.json",
	"/learn/%2e%2e/%2e%2e/package.json",
	"/learn/..%5c..%5cpackage.json",
];

const SITEMAP_CHILDREN = ["sitemap-static.xml", "sitemap-posts.xml", "sitemap-pages.xml", "sitemap-learn.xml"];

// ---------------------------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------------------------
const BASE = new URL(process.env.CMS_URL ?? "http://localhost:4321");
/** The public origin that canonical, og:* and hreflang must name. */
const SITE_ORIGIN = new URL(process.env.SITE_URL ?? "https://jaakkola.xyz").origin;
const TIMEOUT_MS = 30_000;

interface Reply {
	status: number;
	headers: Headers;
	body: string;
}

/** fetch with GET or HEAD only. Redirects come back as they are. Paths resolve against CMS_URL. */
async function call(method: "GET" | "HEAD", path: string, headers: Record<string, string> = {}): Promise<Reply> {
	if (method !== "GET" && method !== "HEAD") throw new Error(`read-only suite: ${method} refused`);
	const res = await fetch(new URL(path, BASE), {
		method,
		redirect: "manual",
		headers,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	const body = method === "GET" ? await res.text() : "";
	return { status: res.status, headers: res.headers, body };
}

/**
 * GET with the path sent exactly as written. fetch would normalise `..` and %2e%2e before
 * sending, so traversal probes go through node:http, which does not.
 */
function rawGet(path: string): Promise<Reply> {
	const transport = BASE.protocol === "https:" ? https : http;
	return new Promise((resolve, reject) => {
		const req = transport.request(
			{ hostname: BASE.hostname, port: BASE.port || undefined, method: "GET", path, timeout: TIMEOUT_MS },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					const headers = new Headers();
					for (const [name, value] of Object.entries(res.headers)) {
						for (const item of [value ?? []].flat()) headers.append(name, item);
					}
					resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks).toString("utf8") });
				});
			},
		);
		req.on("timeout", () => req.destroy(new Error(`timeout: GET ${path}`)));
		req.on("error", reject);
		req.end();
	});
}

/** Pathname of a redirect target. The Location must be relative or on CMS_URL's origin. */
function locationPath(reply: Reply): string {
	const location = reply.headers.get("location");
	assert.ok(location, `redirect (${reply.status}) has no Location header`);
	const target = new URL(location, BASE);
	assert.equal(target.origin, BASE.origin, `Location ${location} is relative or on CMS_URL's origin`);
	return target.pathname;
}

/** GET a page that must answer 200 with an HTML body. */
async function htmlPage(path: string): Promise<string> {
	const res = await call("GET", path);
	assert.equal(res.status, 200, `GET ${path}`);
	expectMatch(res.headers.get("content-type") ?? "", /^text\/html/, `content type of ${path}`);
	return res.body;
}

/** GET `path`, which must answer 301 to `target` (compared as paths). */
async function assertRedirect(path: string, target: string): Promise<void> {
	const res = await call("GET", path);
	assert.equal(res.status, 301, `GET ${path} should be 301`);
	assert.equal(locationPath(res), target, `Location of ${path}`);
}

/** GET `path`, which must answer 404 (and, when given, a 404 page in that language). */
async function assertNotFound(path: string, lang?: "fi" | "en"): Promise<void> {
	const res = await call("GET", path);
	assert.equal(res.status, 404, `GET ${path} should be 404`);
	if (lang) assert.equal(htmlLang(res.body), lang, `<html lang> of the 404 for ${path}`);
}

// ---------------------------------------------------------------------------------------------
// Text and HTML helpers (regex based; the pages are server-rendered and predictable)
// ---------------------------------------------------------------------------------------------
/** Pattern check with a short failure message (assert.match would print the whole page). */
function expectMatch(text: string, pattern: RegExp, label: string): void {
	assert.ok(pattern.test(text), `${label}: no match for ${pattern}`);
}

/** Visible text: no tags, scripts or styles, and the entities the pages use decoded. */
function visibleText(html: string): string {
	return html
		.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/\s+/g, " ");
}

/** The fonts are self-hosted: no page may reference Google Fonts. */
function assertNoGoogleFonts(html: string): void {
	assert.ok(!/fonts\.googleapis|google fonts/i.test(html), "no Google Fonts reference");
}

function attributesOf(source: string): Record<string, string> {
	const pairs = [...source.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)];
	return Object.fromEntries(pairs.map(([, name, value]) => [name.toLowerCase(), value]));
}

function tagsNamed(html: string, name: string): Record<string, string>[] {
	return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, "gi"))].map(([, attrs]) => attributesOf(attrs));
}

function htmlLang(html: string): string | undefined {
	return tagsNamed(html, "html")[0]?.lang;
}

function headOf(html: string): string {
	return html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
}

function titleOf(html: string): string {
	return html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
}

/** Raw href values of the page, in document order. */
function hrefsOf(html: string): string[] {
	return [...html.matchAll(/\shref="([^"]*)"/g)].map(([, href]) => href.replaceAll("&amp;", "&"));
}

/** Pathnames of every http(s) link on the page, resolved against CMS_URL. */
function linkPaths(html: string): Set<string> {
	const paths = new Set<string>();
	for (const href of hrefsOf(html)) {
		try {
			const url = new URL(href, BASE);
			if (url.protocol === "http:" || url.protocol === "https:") paths.add(url.pathname);
		} catch {
			// Not a URL: not a link to check.
		}
	}
	return paths;
}

/** An absolute URL on the public origin (canonical, og:url, og:image, hreflang). */
function siteUrl(value: string, label: string): URL {
	expectMatch(value, /^https?:\/\//, `${label} is absolute`);
	const url = new URL(value);
	assert.equal(url.origin, SITE_ORIGIN, `${label} (${value}) is on ${SITE_ORIGIN}`);
	return url;
}

/** Content of the <meta> whose `attr` (name or property) equals `key`. */
function metaContent(html: string, attr: "name" | "property", key: string): string | undefined {
	return tagsNamed(html, "meta").find((meta) => meta[attr] === key)?.content;
}

/** hreflang alternates from the head: language (or x-default) -> pathname on the public origin. */
function hreflangs(html: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const link of tagsNamed(html, "link")) {
		if (link.hreflang && link.href) out[link.hreflang] = siteUrl(link.href, `hreflang ${link.hreflang}`).pathname;
	}
	return out;
}

/** The RSS alternate in the head: pathname, or undefined when there is none. */
function rssAlternate(html: string): string | undefined {
	const link = tagsNamed(html, "link").find((tag) => tag.type === "application/rss+xml");
	return link?.href ? new URL(link.href, BASE).pathname : undefined;
}

/**
 * Language, one <title>, a meta description, a canonical and og:url on the public origin with
 * this page's path, the site og:image, and no twitter:site naming replit.
 */
function assertSeoBasics(html: string, lang: "fi" | "en", path: string): void {
	assert.equal(htmlLang(html), lang, `<html lang> of ${path}`);
	const titleCount = (headOf(html).match(/<title[\s>]/gi) ?? []).length;
	assert.equal(titleCount, 1, `<title> count in <head> of ${path}`);
	const description = metaContent(html, "name", "description");
	assert.ok(description?.trim(), `meta description of ${path}`);

	const canonical = tagsNamed(html, "link").find((link) => link.rel === "canonical")?.href;
	assert.ok(canonical, `canonical link of ${path}`);
	assert.equal(siteUrl(canonical, "canonical").pathname, path, `canonical path of ${path}`);

	const ogUrl = metaContent(html, "property", "og:url");
	assert.ok(ogUrl, `og:url of ${path}`);
	assert.equal(siteUrl(ogUrl, "og:url").pathname, path, `og:url path of ${path}`);

	const ogImage = metaContent(html, "property", "og:image");
	assert.equal(ogImage, `${SITE_ORIGIN}/opengraph.jpg`, `og:image of ${path}`);

	for (const meta of tagsNamed(html, "meta")) {
		if ((meta.name ?? meta.property ?? "").toLowerCase() === "twitter:site") {
			assert.ok(!/replit/i.test(meta.content ?? ""), `twitter:site of ${path} must not name replit`);
		}
	}
}

/** Post paths listed on a blog index: "fi" gives /blog/<slug>, "en" gives /en/blog/<slug>. */
function listedPostPaths(html: string, lang: "fi" | "en"): string[] {
	const prefix = lang === "fi" ? "/blog/" : "/en/blog/";
	return [...linkPaths(html)].filter((path) => path.startsWith(prefix) && path.length > prefix.length);
}

/** An XML-ish body with no bare "&" (every ampersand must start an entity). */
function assertNoBareAmpersand(body: string, label: string): void {
	assert.ok(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(body), `${label} has an unescaped &`);
}

/** Pathnames of the <loc> entries of a sitemap. Each loc must be on CMS_URL's origin. */
function locPaths(xml: string): string[] {
	return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => {
		const url = new URL(loc.replaceAll("&amp;", "&"), BASE);
		assert.equal(url.origin, BASE.origin, `sitemap loc ${loc} is on CMS_URL's origin`);
		return url.pathname;
	});
}

/** Each <url> of a sitemap: loc pathname -> its xhtml:link alternates (hreflang -> pathname). */
function sitemapAlternates(xml: string): Map<string, Record<string, string>> {
	const entries = new Map<string, Record<string, string>>();
	for (const [, block] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
		const [loc] = locPaths(block);
		assert.ok(loc, "a <url> without a <loc>");
		const alternates: Record<string, string> = {};
		for (const link of tagsNamed(block, "xhtml:link")) {
			if (link.hreflang && link.href) {
				const url = new URL(link.href.replaceAll("&amp;", "&"), BASE);
				assert.equal(url.origin, BASE.origin, `sitemap alternate ${link.href} is on CMS_URL's origin`);
				alternates[link.hreflang] = url.pathname;
			}
		}
		entries.set(loc, alternates);
	}
	return entries;
}

// ---------------------------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------------------------
describe("home page", () => {
	for (const [path, lang] of [
		["/", "fi"],
		["/en/", "en"],
	] as const) {
		it(`${path} is the ${lang} home page with SEO basics and alternates`, async () => {
			const html = await htmlPage(path);
			assertSeoBasics(html, lang, path);
			const alternates = hreflangs(html);
			assert.equal(alternates.fi, "/", "hreflang fi");
			assert.equal(alternates.en, "/en/", "hreflang en");
			assert.equal(alternates["x-default"], "/", "hreflang x-default");
			assert.equal(rssAlternate(html), lang === "fi" ? "/rss.xml" : "/en/rss.xml", "RSS alternate");
		});

		it(`${path} has the contact section, no invented metric and no Google Fonts`, async () => {
			const html = await htmlPage(path);
			expectMatch(html, /id="lead-capture"/, "id=lead-capture");
			assert.ok(!html.includes("+40"), "no '+40' text on the page");
			assertNoGoogleFonts(html);
		});

		it(`${path} lists the services and case studies`, async () => {
			const text = visibleText(await htmlPage(path));
			for (const title of [...HOME_TITLES[lang].services, ...HOME_TITLES[lang].cases]) {
				assert.ok(text.includes(title), `"${title}" on ${path}`);
			}
		});

		it(`${path} navbar links to the blog, learn and the contact section`, async () => {
			const html = await htmlPage(path);
			const blog = lang === "fi" ? "/blog" : "/en/blog";
			const paths = linkPaths(html);
			assert.ok(paths.has(blog), `${blog} in the navbar`);
			assert.ok(paths.has("/learn/"), "/learn/ in the navbar");
			assert.ok(hrefsOf(html).some((href) => href.endsWith("#lead-capture")), "#lead-capture link");
		});
	}
});

// ---------------------------------------------------------------------------------------------
// Blog
// ---------------------------------------------------------------------------------------------
describe("blog", () => {
	it(`/blog lists the ${COUNTS.fiPosts} Finnish posts`, async () => {
		const posts = listedPostPaths(await htmlPage("/blog"), "fi");
		assert.equal(new Set(posts).size, COUNTS.fiPosts, `distinct post links: ${posts.join(", ")}`);
		assert.ok(posts.includes(`/blog/${SLUGS.fiOnly}`), "lists the Finnish-only post");
	});

	it(`/en/blog lists the ${COUNTS.enPosts} English posts`, async () => {
		const posts = listedPostPaths(await htmlPage("/en/blog"), "en");
		assert.equal(new Set(posts).size, COUNTS.enPosts, `distinct post links: ${posts.join(", ")}`);
		assert.ok(posts.includes(`/en/blog/${SLUGS.enOnly}`), "lists john-dee");
	});

	for (const [path, lang] of [
		["/blog", "fi"],
		["/en/blog", "en"],
	] as const) {
		it(`${path} has SEO basics, hreflang and the RSS alternate`, async () => {
			const html = await htmlPage(path);
			assertSeoBasics(html, lang, path);
			assert.deepEqual(hreflangs(html), { fi: "/blog", en: "/en/blog", "x-default": "/blog" }, "hreflang");
			assert.equal(rssAlternate(html), lang === "fi" ? "/rss.xml" : "/en/rss.xml", "RSS alternate");
		});
	}

	it("a Finnish post renders in Finnish with its own canonical", async () => {
		const path = `/blog/${SLUGS.fiOnly}`;
		assertSeoBasics(await htmlPage(path), "fi", path);
	});

	it("john-dee renders in English with the table and its images sized", async () => {
		const path = `/en/blog/${SLUGS.enOnly}`;
		const html = await htmlPage(path);
		assertSeoBasics(html, "en", path);
		assertNoGoogleFonts(html);
		const article = html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? "";
		assert.ok(article, "the post is in an <article>");
		expectMatch(article, /<table[\s>]/, "a <table> in the article");
		const images = tagsNamed(article, "img");
		assert.equal(images.length, COUNTS.johnDeeImages, "<img> count in the article");
		for (const image of images) {
			assert.ok(image.width && image.height, `width and height on ${image.src ?? "an image"}`);
		}
	});

	it("code blocks are highlighted with their language", async () => {
		const html = await htmlPage(`/en/blog/${SLUGS.enCode}`);
		expectMatch(html, /class="astro-code/, "shiki markup");
		expectMatch(html, /data-language="bash"/, "a bash code block");
	});

	for (const [fi, en] of SLUGS.pairs) {
		it(`translations link both ways: ${fi} <-> ${en}`, async () => {
			const fiHtml = await htmlPage(`/blog/${fi}`);
			const enHtml = await htmlPage(`/en/blog/${en}`);
			assert.equal(hreflangs(fiHtml).en, `/en/blog/${en}`, "fi post points to the en post");
			assert.equal(hreflangs(enHtml).fi, `/blog/${fi}`, "en post points to the fi post");
		});
	}

	describe("legacy URLs", () => {
		it(`/blog/${SLUGS.enOnly} -> /en/blog/${SLUGS.enOnly}, which is 200`, async () => {
			await assertRedirect(`/blog/${SLUGS.enOnly}`, `/en/blog/${SLUGS.enOnly}`);
			await htmlPage(`/en/blog/${SLUGS.enOnly}`);
		});

		it(`/blog/${SLUGS.enCode} -> /en/blog/${SLUGS.enCode}`, async () => {
			await assertRedirect(`/blog/${SLUGS.enCode}`, `/en/blog/${SLUGS.enCode}`);
		});

		for (const placeholder of ["example-post", "esimerkki-postaus"]) {
			it(`/blog/${placeholder} -> /blog`, async () => {
				await assertRedirect(`/blog/${placeholder}`, "/blog");
			});
		}

		it("unknown posts are 404 in both languages", async () => {
			await assertNotFound("/blog/nope", "fi");
			await assertNotFound("/en/blog/nope", "en");
		});

		it("the .html variant of a post is 404", async () => {
			await assertNotFound(`/blog/${SLUGS.fiOnly}.html`);
		});
	});
});

// ---------------------------------------------------------------------------------------------
// Privacy notice
// ---------------------------------------------------------------------------------------------
describe("privacy notice", () => {
	it("/tietosuoja is the Finnish notice: SEO basics, theme sentence, alternates and no Google Fonts", async () => {
		const html = await htmlPage("/tietosuoja");
		assertSeoBasics(html, "fi", "/tietosuoja");
		expectMatch(visibleText(html), THEME_SENTENCE.fi, "theme sentence");
		assert.equal(hreflangs(html).en, "/en/privacy", "hreflang en");
		assert.ok(
			tagsNamed(html, "a").some((a) => a.hreflang === "en" && new URL(a.href, BASE).pathname === "/en/privacy"),
			'navbar link <a hreflang="en" href="/en/privacy">',
		);
		assertNoGoogleFonts(html);
	});

	it("/en/privacy is the English notice: SEO basics, theme sentence, alternates and no Google Fonts", async () => {
		const html = await htmlPage("/en/privacy");
		assertSeoBasics(html, "en", "/en/privacy");
		expectMatch(visibleText(html), THEME_SENTENCE.en, "theme sentence");
		assert.equal(hreflangs(html).fi, "/tietosuoja", "hreflang fi");
		assert.ok(
			tagsNamed(html, "a").some((a) => a.hreflang === "fi" && new URL(a.href, BASE).pathname === "/tietosuoja"),
			'navbar link <a hreflang="fi" href="/tietosuoja">',
		);
		assertNoGoogleFonts(html);
	});

	it("/privacy -> /en/privacy", async () => {
		await assertRedirect("/privacy", "/en/privacy");
	});

	it("/privacy/ -> /en/privacy", async () => {
		await assertRedirect("/privacy/", "/en/privacy");
	});

	it("HEAD /privacy also redirects to /en/privacy", async () => {
		// Astro answers non-GET redirects with 308 and GET with 301. Both keep the same target.
		const res = await call("HEAD", "/privacy");
		assert.ok([301, 308].includes(res.status), `status ${res.status}`);
		assert.equal(locationPath(res), "/en/privacy", "Location");
	});
});

// ---------------------------------------------------------------------------------------------
// Learn (/learn/)
// ---------------------------------------------------------------------------------------------
describe("learn", () => {
	it("/learn/ is titled Oppimispolut, shows both group headings and one link per published track", async () => {
		const html = await htmlPage("/learn/");
		expectMatch(titleOf(html), /Oppimispolut/, "page title");
		assertNoGoogleFonts(html);
		for (const heading of LEARN.headings) {
			assert.ok(html.includes(heading), `heading "${heading}"`);
		}
		const tracks = [...linkPaths(html)].filter((path) => /^\/learn\/[^/]+\/$/.test(path));
		assert.equal(tracks.length, COUNTS.learnTracks, `track links: ${tracks.join(", ")}`);
		for (const draft of DRAFT_TRACKS) {
			assert.ok(!tracks.includes(`/learn/${draft}/`), `draft ${draft} is not linked`);
		}
	});

	it("a track index is served as HTML", async () => {
		await htmlPage(LEARN.track);
	});

	it("a lesson is served as HTML", async () => {
		const res = await call("GET", LEARN.lesson);
		assert.equal(res.status, 200);
		expectMatch(res.headers.get("content-type") ?? "", /^text\/html/, "content type");
	});

	it("a .wav reference file is served with ranges", async () => {
		const head = await call("HEAD", LEARN.wav);
		assert.equal(head.status, 200);
		expectMatch(head.headers.get("content-type") ?? "", /^audio\/wav/, "content type");
		assert.equal(head.headers.get("accept-ranges"), "bytes");

		const partial = await call("GET", LEARN.wav, { Range: "bytes=0-9" });
		assert.equal(partial.status, 206, "Range request answers 206");
		expectMatch(partial.headers.get("content-range") ?? "", /^bytes 0-9\//, "content-range");
	});

	it("a .png reference file has its image content type", async () => {
		const res = await call("HEAD", LEARN.png);
		assert.equal(res.status, 200);
		expectMatch(res.headers.get("content-type") ?? "", /^image\/png/, "content type");
	});

	it(`${LEARN.track.replace(/\/$/, "")} -> ${LEARN.track}`, async () => {
		await assertRedirect(LEARN.track.replace(/\/$/, ""), LEARN.track);
	});

	it("/learn/index.html -> /learn/", async () => {
		await assertRedirect("/learn/index.html", "/learn/");
	});

	it("a missing learn file is 404", async () => {
		await assertNotFound("/learn/nope.html");
	});

	for (const path of TRAVERSAL_PATHS) {
		it(`traversal ${path} is refused and leaks no package.json`, async () => {
			const res = await rawGet(path);
			assert.ok([400, 404].includes(res.status), `status ${res.status}`);
			assert.ok(!res.body.includes('"dependencies"'), "body has no package.json content");
		});
	}
});

// ---------------------------------------------------------------------------------------------
// Feeds, sitemaps, robots
// ---------------------------------------------------------------------------------------------
describe("feeds, sitemaps and robots", () => {
	for (const [path, count] of [
		["/rss.xml", COUNTS.fiPosts],
		["/en/rss.xml", COUNTS.enPosts],
	] as const) {
		it(`${path} is an RSS feed with ${count} items`, async () => {
			const res = await call("GET", path);
			assert.equal(res.status, 200);
			expectMatch(res.headers.get("content-type") ?? "", /^application\/rss\+xml/, "content type");
			expectMatch(res.body, /^\s*<\?xml/, "xml declaration");
			expectMatch(res.body, /<rss[\s>]/, "<rss>");
			expectMatch(res.body, /<\/rss>\s*$/, "closing </rss>");
			assert.equal((res.body.match(/<item>/g) ?? []).length, count, "item count");
			assertNoBareAmpersand(res.body, path);
		});
	}

	it("/sitemap.xml lists the four child sitemaps in order", async () => {
		const res = await call("GET", "/sitemap.xml");
		assert.equal(res.status, 200);
		expectMatch(res.headers.get("content-type") ?? "", /^application\/xml/, "content type");
		assertNoBareAmpersand(res.body, "/sitemap.xml");
		assert.deepEqual(locPaths(res.body), SITEMAP_CHILDREN.map((file) => `/${file}`));
	});

	for (const file of SITEMAP_CHILDREN) {
		it(`/${file} answers 200 with a urlset`, async () => {
			const res = await call("GET", `/${file}`);
			assert.equal(res.status, 200);
			expectMatch(res.headers.get("content-type") ?? "", /^application\/xml/, "content type");
			expectMatch(res.body, /<urlset[\s>]/, "<urlset>");
			assertNoBareAmpersand(res.body, `/${file}`);
		});
	}

	it("the static sitemap lists the home pages and blog indexes; the post sitemap lists every post", async () => {
		const staticPaths = locPaths((await call("GET", "/sitemap-static.xml")).body);
		for (const path of ["/", "/en/", "/blog", "/en/blog"]) {
			assert.ok(staticPaths.includes(path), `static sitemap lists ${path}`);
		}
		const postPaths = locPaths((await call("GET", "/sitemap-posts.xml")).body);
		assert.equal(postPaths.length, COUNTS.fiPosts + COUNTS.enPosts, "post URLs");
	});

	it("the pages sitemap lists both privacy notices with fi, en and x-default alternates", async () => {
		const entries = sitemapAlternates((await call("GET", "/sitemap-pages.xml")).body);
		const expected = { fi: "/tietosuoja", en: "/en/privacy", "x-default": "/tietosuoja" };
		assert.deepEqual(entries.get("/tietosuoja"), expected, "/tietosuoja alternates");
		assert.deepEqual(entries.get("/en/privacy"), expected, "/en/privacy alternates");
	});

	it("the post sitemap gives one translation pair fi, en and x-default alternates", async () => {
		const entries = sitemapAlternates((await call("GET", "/sitemap-posts.xml")).body);
		const [fi, en] = SLUGS.pairs[2];
		const expected = { fi: `/blog/${fi}`, en: `/en/blog/${en}`, "x-default": `/blog/${fi}` };
		assert.deepEqual(entries.get(`/blog/${fi}`), expected, "fi post alternates");
		assert.deepEqual(entries.get(`/en/blog/${en}`), expected, "en post alternates");
	});

	it("the learn sitemap lists /learn/, a track index and a lesson", async () => {
		const learnPaths = locPaths((await call("GET", "/sitemap-learn.xml")).body);
		assert.ok(learnPaths.includes("/learn/"), "/learn/ listed");
		assert.ok(learnPaths.includes(LEARN.track), `${LEARN.track} listed`);
		assert.ok(learnPaths.includes(LEARN.lesson), `${LEARN.lesson} listed`);
	});

	it("robots.txt names the sitemap and disallows /_emdash/", async () => {
		const res = await call("GET", "/robots.txt");
		assert.equal(res.status, 200);
		expectMatch(res.body, /^Sitemap:\s*\S+/m, "Sitemap line");
		expectMatch(res.body, /^Disallow: \/_emdash\/\s*$/m, "Disallow: /_emdash/ line");
	});
});

// ---------------------------------------------------------------------------------------------
// Misc: reports, static assets, 404 pages, admin
// ---------------------------------------------------------------------------------------------
describe("misc", () => {
	it("/reports/age-pressure-finland/ is served", async () => {
		await htmlPage("/reports/age-pressure-finland/");
	});

	for (const [path, type] of [
		["/favicon.png", "image/png"],
		["/apple-touch-icon.png", "image/png"],
		["/opengraph.jpg", "image/jpeg"],
	] as const) {
		it(`${path} is served as ${type}`, async () => {
			const res = await call("HEAD", path);
			assert.equal(res.status, 200);
			expectMatch(res.headers.get("content-type") ?? "", new RegExp(`^${type}`), "content type");
		});
	}

	it("unknown pages are 404 with the Finnish and the English 404 page", async () => {
		await assertNotFound("/no-such-page", "fi");
		await assertNotFound("/en/no-such-page", "en");
	});

	for (const [path, blog] of [
		["/no-such-page", "/blog"],
		["/en/no-such-page", "/en/blog"],
	] as const) {
		it(`${path} keeps the navigation and the styles`, async () => {
			const res = await call("GET", path);
			const paths = linkPaths(res.body);
			assert.ok(paths.has(blog), `${blog} in the navbar`);
			assert.ok(paths.has("/learn/"), "/learn/ in the navbar");
			expectMatch(res.body, /<style[\s>]|rel="stylesheet"/, "a stylesheet");
		});
	}

	it("/_emdash/admin/ answers with the admin or its login redirect", async () => {
		const res = await call("GET", "/_emdash/admin/");
		assert.ok([200, 302].includes(res.status), `status ${res.status}`);
	});
});
