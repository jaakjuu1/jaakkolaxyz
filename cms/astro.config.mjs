import { mkdirSync } from "node:fs";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, fontProviders } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

// SQLite and local storage do not create their directories; paths are relative to the cwd.
mkdirSync("data/uploads", { recursive: true });

const siteUrl = process.env.EMDASH_SITE_URL;

// Dev only: serve public/reports/<name>/ from its index.html, as the production
// server does. Without this, `astro dev` answers 404 for the directory URL.
const reportDirectoryIndex = {
	name: "report-directory-index",
	configureServer(server) {
		server.middlewares.use((req, _res, next) => {
			if (req.url) {
				req.url = req.url.replace(/^(\/reports\/[^/?]+)\/?(\?.*)?$/, "$1/index.html$2");
			}
			next();
		});
	},
};

// Dev only: the Vite dev server joins the raw request path onto the project root, so
// `..` segments (also %2e%2e) reach files outside the site. This guard refuses them
// before Vite serves anything; the production server does not serve files from the
// project tree at all. Malformed percent-encoding is not covered here: Astro's own
// dev trailing-slash middleware runs earlier and answers 500 (production answers 400).
// The decode check below only matters if that order ever changes.
function isUnsafeDevPath(url) {
	let decoded;
	try {
		decoded = decodeURIComponent(url.split(/[?#]/)[0]);
	} catch {
		return true;
	}
	return /(^|[\\/])\.\.?([\\/]|$)/.test(decoded) || decoded.includes("\0");
}

const devPathGuard = {
	name: "dev-path-guard",
	configureServer(server) {
		server.middlewares.use((req, res, next) => {
			if (isUnsafeDevPath(req.url ?? "")) {
				res.statusCode = 404;
				res.setHeader("Content-Type", "text/plain; charset=utf-8");
				res.end("Not found");
				return;
			}
			next();
		});
	},
};

export default defineConfig({
	site: "https://jaakkola.xyz",
	output: "server",
	adapter: node({
		mode: "standalone",
	}),
	i18n: {
		defaultLocale: "fi",
		locales: ["fi", "en"],
	},
	// Old English privacy URL (client/src/pages/privacy.tsx). Permanent, like the other legacy URLs.
	redirects: {
		"/privacy": { status: 301, destination: "/en/privacy" },
	},
	image: {
		layout: "constrained",
		responsiveStyles: true,
	},
	integrations: [
		react(),
		emdash({
			database: sqlite({ url: "file:./data/emdash.db" }),
			storage: local({
				directory: "./data/uploads",
				baseUrl: "/_emdash/api/media/file",
			}),
			...(siteUrl ? { siteUrl } : {}),
			trustedProxyHeaders: ["x-forwarded-for"],
		}),
	],
	// Fonts are downloaded at build time and self-hosted; no runtime request
	// to Google. Used by src/layouts/Base.astro via <Font cssVariable=... />.
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-inter",
			weights: [300, 400, 500, 600, 700],
			styles: ["normal", "italic"],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "Playfair Display",
			cssVariable: "--font-playfair",
			weights: [400, 500, 600, 700, 800, 900],
			styles: ["normal", "italic"],
			fallbacks: ["Georgia", "serif"],
		},
		{
			provider: fontProviders.google(),
			name: "Geist Mono",
			cssVariable: "--font-geist-mono",
			weights: [400, 500],
			styles: ["normal"],
			fallbacks: ["monospace"],
		},
	],
	vite: {
		plugins: [tailwindcss(), reportDirectoryIndex, devPathGuard],
		server: {
			proxy: {
				"/api/contact": "http://localhost:5000",
			},
		},
	},
	devToolbar: { enabled: false },
});
