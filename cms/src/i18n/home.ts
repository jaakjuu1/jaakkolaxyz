/**
 * Home page content (both languages, one shape).
 *
 * `fi` is the Finnish text from client/src/data/content.ts. `en` is a translation of
 * that Finnish text, not the old English copy (the old English cases were placeholders
 * with invented metrics and are not used). The tuple types fix the item counts
 * (6 services, 5 cases, 3 steps), so `en` cannot drift from `fi` in shape.
 *
 * Tech names and tags are kept as written in Finnish. Do not add claims or numbers
 * that are not in the Finnish text.
 */

import type { Lang } from "./ui";

export interface ServiceItem {
	title: string;
	description: string;
	tags: string[];
}

export interface CaseItem {
	client: string;
	challenge: string;
	solution: string;
	result: string;
	stack: string[];
}

export interface ProcessStep {
	step: string;
	name: string;
	description: string;
}

export interface HomeContent {
	/** Hard-coded labels that used to live in the React components. */
	labels: {
		eyebrow: string;
		challenge: string;
		solution: string;
	};
	hero: {
		headline: string;
		subheadline: string;
		ctaPrimary: string;
		ctaSecondary: string;
		bookingUrl: string;
	};
	services: {
		title: string;
		items: [
			ServiceItem,
			ServiceItem,
			ServiceItem,
			ServiceItem,
			ServiceItem,
			ServiceItem,
		];
	};
	cases: {
		title: string;
		items: [CaseItem, CaseItem, CaseItem, CaseItem, CaseItem];
	};
	process: {
		title: string;
		steps: [ProcessStep, ProcessStep, ProcessStep];
	};
	about: {
		title: string;
		text: string;
		signature: string;
	};
	leadCapture: {
		title: string;
		subtitle: string;
	};
}

const fi: HomeContent = {
	labels: {
		eyebrow: "Systeemiajattelija & kehittäjä",
		challenge: "Haaste",
		solution: "Ratkaisu",
	},
	hero: {
		headline: "Älykästä kasvua & automaatiota.",
		subheadline:
			"Autan suomalaisia pk-yrityksiä ja kasvuhakuisia tiimejä skaalautumaan ilman kaaosta. Tekoäly, automaatio ja data valjastettuna liiketoimintasi ytimeen.",
		ctaPrimary: "Varaa 20 min kartoitus",
		ctaSecondary: "Katso case-esimerkit",
		bookingUrl: "https://calendly.com/juuso-jaakkola/consultation",
	},
	services: {
		title: "Palvelut",
		items: [
			{
				title: "AI & Automaatio",
				description:
					"Poistan manuaaliset pullonkaulat myynnistä, markkinoinnista ja operatiivisesta työstä. Rakennan tuotantokelpoisia AI- ja automaatioratkaisuja, jotka joko säästävät rahaa tai tuottavat sitä – ei kokeellista leikkimistä.",
				tags: ["n8n", "Make", "AI Agents", "MCP", "OpenAI", "Anthropic"],
			},
			{
				title: "WordPress & WooCommerce",
				description:
					"Vaativiin WordPress- ja WooCommerce-ympäristöihin, joissa perusplugin-ratkaisut eivät enää riitä. Korjaan, optimoin ja laajennan monimutkaisia kokonaisuuksia ilman että liiketoiminta pysähtyy.",
				tags: ["ACF", "Multisite", "WooCommerce", "Performance", "Custom Data"],
			},
			{
				title: "Mittaus & Konversiot",
				description:
					"Korjaan rikkinäisen analytiikan ja rakennan mittauksen, johon voi oikeasti luottaa. Server-side tracking, GA4 ja CAPI-ratkaisut ilman arvailua tai harhaista dataa.",
				tags: ["GA4", "Server-side GTM", "CAPI", "BigQuery", "Consent Mode"],
			},
			{
				title: "Agentit & Botit",
				description:
					"Rakennan tekoälyagentteja, jotka hoitavat oikeita tehtäviä: asiakaspalvelua, tiedonhakua ja sisäisiä prosesseja. Ei pelkkiä chatboteja, vaan järjestelmiin integroituvia digitaalisia työntekijöitä.",
				tags: ["Telegram", "WhatsApp", "Slack", "Vercel AI SDK", "Claude Agent SDK"],
			},
			{
				title: "Tekniset & AI-auditit",
				description:
					"Riippumaton analyysi nykyisestä teknisestä pinostasi: suorituskyky, turvallisuus, mittaus ja AI-valmius. Saat konkreettisen toimenpidelistan – ei myyntipuhetta.",
				tags: ["Performance", "Security", "SEO", "Architecture", "AI Readiness"],
			},
			{
				title: "Jatkuva AI- & automaatiokumppanuus",
				description:
					"Pitkäjänteinen kumppanuus yrityksille, jotka haluavat kehittää järjestelmiään jatkuvasti. Toimin teknisenä ajattelukumppanina ja toteuttajana ilman jatkuvaa projektien käynnistämistä.",
				tags: ["Retainer", "AI Strategy", "Continuous Improvement", "Systems Thinking"],
			},
		],
	},
	cases: {
		title: "Valittuja projekteja",
		items: [
			{
				client: "Sisältö- ja verkkokauppavetoinen organisaatio",
				challenge:
					"Perinteinen WordPress/WooCommerce ei täyttänyt suorituskyky-, turvallisuus- ja jatkokehitysvaatimuksia.",
				solution:
					"Headless-arkkitehtuuri, jossa WordPress toimii sisällönhallintana ja Next.js liiketoimintakriittisenä frontendinä type-safe GraphQL -kerroksen kautta.",
				result:
					"Nopeampi sivusto, parempi kehityskokemus ja selkeä erotus sisällön, datan ja liiketoimintalogiikan välillä.",
				stack: [
					"Next.js 14 (App Router, RSC)",
					"WordPress + WPGraphQL",
					"WooCommerce (REST + GraphQL)",
					"GraphQL Codegen",
					"NextAuth",
					"TypeScript (strict)",
				],
			},
			{
				client: "Rakennusalan urakoitsija (saumaus / julkisivutyöt)",
				challenge:
					"Työmaamittaukset, tuntikirjaukset ja tarjoukset perustuivat hajanaisiin muistiinpanoihin ja manuaaliseen laskentaan.",
				solution:
					"Toimialakohtainen projektinhallintasovellus, jossa AI jäsentää mittausmuistiinpanot rakenteiseksi dataksi ja yhdistää ne tuntikirjauksiin, tarjouksiin ja palkkoihin.",
				result:
					"Vähemmän virheitä, nopeampi tarjouslaskenta ja selkeä näkymä projektien kannattavuuteen.",
				stack: [
					"React + TypeScript",
					"Gemini AI (structured output)",
					"Drizzle ORM",
					"Turso (SQLite)",
					"White-label theming",
				],
			},
			{
				client: "Tuotanto / laskenta (sisäinen työkalu)",
				challenge:
					"Laskenta- ja toteutuspiirustusten erot jäivät helposti huomaamatta ja tarkastus vei kohtuuttomasti aikaa.",
				solution:
					"ZIP-pohjainen diff-työkalu, joka parittaa dokumentit, analysoi erot Gemini 3 Prolla ja tuottaa suodatettavan raportin (reviewed + kommentit) sekä PDF-viennin.",
				result:
					"Nopeampi tarkastus, vähemmän virheitä ja selkeä yhteinen review-workflow.",
				stack: ["React", "Gemini 3 Pro", "JSZip", "PDF export", "Tailwind (CDN)"],
			},
			{
				client: "B2B-palveluyritys",
				challenge:
					"Uusien asiakkuuksien hankinta perustui manuaaliseen prospektointiin ja geneerisiin viesteihin.",
				solution:
					"AI-pohjainen outbound-järjestelmä, joka analysoi kohdeyritykset, muodostaa ICP:t, löytää relevantit prospektit ja tuottaa personoidut viestit hallitulla volyymilla.",
				result:
					"Parempi liidien laatu, vähemmän hukkatyötä ja selkeä näkyvyys myyntiputken toimintaan.",
				stack: [
					"AI-agentit (tool-based orchestration)",
					"Vercel AI SDK",
					"DeepSeek",
					"Node.js + BullMQ",
					"WebSockets",
					"React + Vite",
					"Zod (runtime validation)",
				],
			},
			{
				client: "Henkilökohtainen tutkimusprojekti",
				challenge:
					"Tutkia, miten teknologia ja tekoäly voivat tukea tietoisuutta, hengitystä ja kokemuksellista läsnäoloa.",
				solution:
					"Reaaliaikainen meditaatio- ja soundscape-sovellus, joka yhdistää Web Audio API:n, AI-generoidun musiikin ja hengitykseen reagoivan ääniympäristön.",
				result:
					"Kokeellinen mutta tuotantotason järjestelmä, joka tutkii ihmisen ja teknologian välistä vuorovaikutusta.",
				stack: [
					"Web Audio API",
					"Google Lyria (Realtime)",
					"Vite + React + TypeScript",
					"Docker + CI/CD",
					"PWA",
				],
			},
		],
	},
	process: {
		title: "Kuinka työskentelen",
		steps: [
			{
				step: "01",
				name: "Diagnose",
				description:
					"Ensin ymmärrämme ongelman juurisyyn. Ei arvauksia, vaan dataan ja prosesseihin pohjautuva analyysi.",
			},
			{
				step: "02",
				name: "Build",
				description:
					"Rakennan ratkaisun nopeilla iteraatioilla. MVP viikoissa, ei kuukausissa. Läpinäkyvä prosessi.",
			},
			{
				step: "03",
				name: "Iterate",
				description:
					"Maailma muuttuu, ja niin myös softa. Mittaamme tulokset ja optimoimme jatkuvasti.",
			},
		],
	},
	about: {
		title: "Tietoa minusta",
		text: "Olen yrittäjähenkinen kehittäjä ja automaatioarkkitehti. Uskon, että suurin osa 'kiireestä' on vain huonosti suunniteltuja prosesseja. Rakennan järjestelmiä, jotka taistelevat entropiaa vastaan ja tuottavat mitattavaa arvoa. En myy tunteja, vaan tuloksia.",
		signature: "JJ",
	},
	leadCapture: {
		title: "Aloitetaan keskustelu",
		subtitle: "Kerro lyhyesti tarpeestasi. Vastaan yleensä 24h sisällä.",
	},
};

const en: HomeContent = {
	labels: {
		eyebrow: "System Thinker & Developer",
		challenge: "Challenge",
		solution: "Solution",
	},
	hero: {
		headline: "Intelligent Growth & Automation.",
		subheadline:
			"I help Finnish SMEs and growth-minded teams scale without chaos. AI, automation and data harnessed at the core of your business.",
		ctaPrimary: "Book a 20-min discovery call",
		ctaSecondary: "See case studies",
		bookingUrl: "https://calendly.com/juuso-jaakkola/consultation",
	},
	services: {
		title: "Services",
		items: [
			{
				title: "AI & Automation",
				description:
					"I remove the manual bottlenecks in sales, marketing and operational work. I build production-ready AI and automation solutions that either save money or make it – no experimental tinkering.",
				tags: ["n8n", "Make", "AI Agents", "MCP", "OpenAI", "Anthropic"],
			},
			{
				title: "WordPress & WooCommerce",
				description:
					"For demanding WordPress and WooCommerce environments where basic plugin solutions are no longer enough. I fix, optimize and extend complex setups without the business coming to a halt.",
				tags: ["ACF", "Multisite", "WooCommerce", "Performance", "Custom Data"],
			},
			{
				title: "Measurement & Conversions",
				description:
					"I fix broken analytics and build measurement you can actually trust. Server-side tracking, GA4 and CAPI solutions without guesswork or misleading data.",
				tags: ["GA4", "Server-side GTM", "CAPI", "BigQuery", "Consent Mode"],
			},
			{
				title: "Agents & Bots",
				description:
					"I build AI agents that handle real tasks: customer service, information retrieval and internal processes. Not just chatbots, but digital workers that integrate into systems.",
				tags: ["Telegram", "WhatsApp", "Slack", "Vercel AI SDK", "Claude Agent SDK"],
			},
			{
				title: "Technical & AI Audits",
				description:
					"An independent analysis of your current technical stack: performance, security, measurement and AI readiness. You get a concrete action list, not a sales pitch.",
				tags: ["Performance", "Security", "SEO", "Architecture", "AI Readiness"],
			},
			{
				title: "Ongoing AI & Automation Partnership",
				description:
					"A long-term partnership for companies that want to keep developing their systems. I act as a technical thinking partner and implementer, without having to start a new project every time.",
				tags: ["Retainer", "AI Strategy", "Continuous Improvement", "Systems Thinking"],
			},
		],
	},
	cases: {
		title: "Selected Projects",
		items: [
			{
				client: "Content- and e-commerce-driven organization",
				challenge:
					"A traditional WordPress/WooCommerce setup did not meet the requirements for performance, security and further development.",
				solution:
					"A headless architecture: WordPress serves as the content management system and Next.js as the business-critical frontend, connected through a type-safe GraphQL layer.",
				result:
					"A faster site, a better developer experience and a clear separation between content, data and business logic.",
				stack: [
					"Next.js 14 (App Router, RSC)",
					"WordPress + WPGraphQL",
					"WooCommerce (REST + GraphQL)",
					"GraphQL Codegen",
					"NextAuth",
					"TypeScript (strict)",
				],
			},
			{
				client: "Construction contractor (joint sealing / façade work)",
				challenge:
					"Site measurements, time logging and quotes were based on scattered notes and manual calculation.",
				solution:
					"An industry-specific project management application in which AI turns measurement notes into structured data and links them to time logs, quotes and payroll.",
				result:
					"Fewer errors, faster quote calculation and a clear view of project profitability.",
				stack: [
					"React + TypeScript",
					"Gemini AI (structured output)",
					"Drizzle ORM",
					"Turso (SQLite)",
					"White-label theming",
				],
			},
			{
				client: "Production / estimating (internal tool)",
				challenge:
					"Differences between estimating and execution drawings were easy to miss, and checking them took an unreasonable amount of time.",
				solution:
					"A ZIP-based diff tool that pairs documents, analyzes the differences with Gemini 3 Pro and produces a filterable report (reviewed + comments) with PDF export.",
				result:
					"Faster checking, fewer errors and a clear shared review workflow.",
				stack: ["React", "Gemini 3 Pro", "JSZip", "PDF export", "Tailwind (CDN)"],
			},
			{
				client: "B2B services company",
				challenge:
					"Winning new clients relied on manual prospecting and generic messages.",
				solution:
					"An AI-based outbound system that analyzes target companies, defines ICPs, finds relevant prospects and writes personalized messages at a controlled volume.",
				result:
					"Better lead quality, less wasted effort and clear visibility into how the sales pipeline works.",
				stack: [
					"AI agents (tool-based orchestration)",
					"Vercel AI SDK",
					"DeepSeek",
					"Node.js + BullMQ",
					"WebSockets",
					"React + Vite",
					"Zod (runtime validation)",
				],
			},
			{
				client: "Personal research project",
				challenge:
					"Exploring how technology and AI can support awareness, breathing and experiential presence.",
				solution:
					"A real-time meditation and soundscape app that combines the Web Audio API, AI-generated music and a sound environment that responds to breathing.",
				result:
					"An experimental yet production-grade system that explores the interaction between people and technology.",
				stack: [
					"Web Audio API",
					"Google Lyria (Realtime)",
					"Vite + React + TypeScript",
					"Docker + CI/CD",
					"PWA",
				],
			},
		],
	},
	process: {
		title: "How I Work",
		steps: [
			{
				step: "01",
				name: "Diagnose",
				description:
					"First we understand the root cause of the problem. No guesswork, just analysis grounded in data and processes.",
			},
			{
				step: "02",
				name: "Build",
				description:
					"I build the solution in quick iterations. An MVP in weeks, not months. A transparent process.",
			},
			{
				step: "03",
				name: "Iterate",
				description:
					"The world changes, and so does software. We measure results and keep optimizing.",
			},
		],
	},
	about: {
		title: "About Me",
		text: "I am an entrepreneurial developer and automation architect. I believe most 'busyness' is just poorly designed processes. I build systems that fight entropy and deliver measurable value. I don't sell hours, I sell results.",
		signature: "JJ",
	},
	leadCapture: {
		title: "Let's start a conversation",
		subtitle: "Briefly describe your needs. I usually respond within 24 hours.",
	},
};

export const home: Record<Lang, HomeContent> = { fi, en };
