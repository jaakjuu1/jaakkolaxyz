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
	fonts: [
		{
			provider: fontProviders.google(),
			name: "Inter",
			cssVariable: "--font-body",
			weights: [400, 500, 600, 700],
			fallbacks: ["sans-serif"],
		},
		{
			provider: fontProviders.google(),
			name: "JetBrains Mono",
			cssVariable: "--font-mono",
			weights: [400, 500],
			fallbacks: ["monospace"],
		},
	],
	vite: {
		plugins: [tailwindcss()],
		server: {
			proxy: {
				"/api/contact": "http://localhost:5000",
			},
		},
	},
	devToolbar: { enabled: false },
});
