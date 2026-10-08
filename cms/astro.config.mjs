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
			weights: [400, 500, 600, 700],
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
		plugins: [tailwindcss(), reportDirectoryIndex],
		server: {
			proxy: {
				"/api/contact": "http://localhost:5000",
			},
		},
	},
	devToolbar: { enabled: false },
});
