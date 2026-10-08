/**
 * UI strings and locale helpers.
 *
 * Finnish is the default locale and lives at unprefixed paths (`/`, `/blog`);
 * English lives under `/en/` (`/en/`, `/en/blog`). The language comes from the
 * URL, never from storage.
 *
 * Source of the copy: client/src/data/content.ts (hero, footer) and the old
 * Navbar/404 components. Finnish text uses proper ä/ö.
 */

export type Lang = "fi" | "en";

export const DEFAULT_LANG: Lang = "fi";
export const LANGS: readonly Lang[] = ["fi", "en"];

export const SITE_NAME = "Juuso Jaakkola";
export const SITE_FALLBACK_URL = "https://jaakkola.xyz";
export const OG_IMAGE_PATH = "/opengraph.jpg";

/** Locale tag used for Intl date formatting. */
export const DATE_LOCALE: Record<Lang, string> = {
	fi: "fi-FI",
	en: "en-US",
};

const fi = {
	"site.tagline": "Älykästä kasvua & automaatiota.",
	"site.description":
		"Autan suomalaisia pk-yrityksiä ja kasvuhakuisia tiimejä skaalautumaan ilman kaaosta. Tekoäly, automaatio ja data valjastettuna liiketoimintasi ytimeen.",

	"nav.main": "Päävalikko",
	"nav.blog": "Blogi",
	"nav.learn": "Oppimispolut",
	"nav.contact": "Ota yhteyttä",
	"nav.switchLang": "Vaihda kieli",

	"lang.fi": "suomeksi",
	"lang.en": "englanniksi",

	"theme.toggle": "Vaihda teema",

	"footer.privacy": "Tietosuoja",
	"footer.nav": "Alatunnisteen linkit",

	"skip.content": "Siirry sisältöön",

	"blog.title": "Blogi",
	"blog.intro": "Ajatuksia web-kehityksestä, automaatiosta ja teknologiasta.",
	"blog.feedTitle": "Juuso Jaakkola: Blogi",
	"blog.back": "Takaisin blogiin",
	"blog.empty": "Ei vielä kirjoituksia.",
	"translation.toEn": "Lue englanniksi",
	"translation.toFi": "Lue suomeksi",

	"notFound.title": "Sivua ei löytynyt",
	"notFound.body": "Etsimääsi sivua ei ole olemassa tai se on siirretty.",
	"notFound.home": "Etusivulle",
} as const;

export type UIKey = keyof typeof fi;

/* Every key must exist in English too (the type forces it). */
const en: Record<UIKey, string> = {
	"site.tagline": "Intelligent Growth & Automation.",
	"site.description":
		"Helping Finnish SMEs and growth teams scale without chaos. AI, automation, and data at the core of your business.",

	"nav.main": "Main navigation",
	"nav.blog": "Blog",
	"nav.learn": "Learn",
	"nav.contact": "Contact",
	"nav.switchLang": "Switch language",

	"lang.fi": "Finnish",
	"lang.en": "English",

	"theme.toggle": "Switch theme",

	"footer.privacy": "Privacy",
	"footer.nav": "Footer links",

	"skip.content": "Skip to content",

	"blog.title": "Blog",
	"blog.intro": "Thoughts on web development, automation, and technology.",
	"blog.feedTitle": "Juuso Jaakkola: Blog",
	"blog.back": "Back to blog",
	"blog.empty": "No posts yet.",
	"translation.toEn": "Read in English",
	"translation.toFi": "Read in Finnish",

	"notFound.title": "Page not found",
	"notFound.body": "The page you are looking for does not exist or has moved.",
	"notFound.home": "Back to home",
};

export const ui: Record<Lang, Record<UIKey, string>> = { fi, en };

/** Translate a UI key. */
export function t(lang: Lang, key: UIKey): string {
	return ui[lang][key];
}

/**
 * Language of the current request. Uses Astro's `currentLocale`, and falls
 * back to the URL prefix (the 404 route may not carry a locale).
 */
export function getLang(astro: { currentLocale?: string; url: URL }): Lang {
	if (astro.currentLocale === "en") return "en";
	const path = astro.url.pathname;
	return path === "/en" || path.startsWith("/en/") ? "en" : DEFAULT_LANG;
}

/** Strip a leading `/en` locale prefix, returning a path starting with `/`. */
function stripLocale(path: string): string {
	if (path === "/en" || path === "/en/") return "/";
	if (path.startsWith("/en/")) return path.slice(3);
	return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Localized URL path for a locale-neutral path.
 * fi: `/blog` -> `/blog`; en: `/blog` -> `/en/blog`; home en: `/en/`.
 */
export function localizePath(path: string, lang: Lang): string {
	const clean = stripLocale(path);
	if (lang === DEFAULT_LANG) return clean;
	return clean === "/" ? "/en/" : `/en${clean}`;
}

/** Other language, for the language switch. */
export function otherLang(lang: Lang): Lang {
	return lang === "fi" ? "en" : "fi";
}
