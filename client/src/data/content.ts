export const content = {
  fi: {
    hero: {
      headline: "Älykästä kasvua & automaatiota.",
      subheadline:
        "Autan suomalaisia pk-yrityksiä ja kasvuhakuisia tiimejä skaalautumaan ilman kaaosta. Tekoäly, automaatio ja data valjastettuna liiketoimintasi ytimeen.",
      cta_primary: "Varaa 20 min kartoitus",
      cta_secondary: "Katso case-esimerkit",
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
          tags: [
            "ACF",
            "Multisite",
            "WooCommerce",
            "Performance",
            "Custom Data",
          ],
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
          tags: [
            "Telegram",
            "WhatsApp",
            "Slack",
            "Vercel AI SDK",
            "Claude Agent SDK",
          ],
        },
        {
          title: "Tekniset & AI-auditit",
          description:
            "Riippumaton analyysi nykyisestä teknisestä pinostasi: suorituskyky, turvallisuus, mittaus ja AI-valmius. Saat konkreettisen toimenpidelistan – ei myyntipuhetta.",
          tags: [
            "Performance",
            "Security",
            "SEO",
            "Architecture",
            "AI Readiness",
          ],
        },
        {
          title: "Jatkuva AI- & automaatiokumppanuus",
          description:
            "Pitkäjänteinen kumppanuus yrityksille, jotka haluavat kehittää järjestelmiään jatkuvasti. Toimin teknisenä ajattelukumppanina ja toteuttajana ilman jatkuvaa projektien käynnistämistä.",
          tags: [
            "Retainer",
            "AI Strategy",
            "Continuous Improvement",
            "Systems Thinking",
          ],
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
          stack: [
            "React",
            "Gemini 3 Pro",
            "JSZip",
            "PDF export",
            "Tailwind (CDN)",
          ],
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
      form: {
        name: "Nimi",
        email: "Sähköposti",
        company: "Yritys",
        message: "Mitä haluat saavuttaa?",
        budget: "Budjettiluokka",
        submit: "Lähetä",
        success: "Kiitos viestistäsi! Olen pian yhteydessä.",
      },
      quiz: {
        title: "Project Fit -kartoitus",
        start: "Aloita kartoitus",
        questions: [
          {
            q: "Mikä kuvaa tilannettasi parhaiten?",
            options: [
              "Haluan automatisoida manuaalista työtä",
              "Tarvitsen verkkokaupan/sivuston kehitystä",
              "Haluan parempaa dataa/analytiikkaa",
              "Muu / En osaa sanoa",
            ],
          },
          {
            q: "Mikä on projektin aikataulu?",
            options: [
              "Heti / ASAP",
              "1-2 kuukauden sisällä",
              "Puolen vuoden sisällä",
              "Vain alustava selvitys",
            ],
          },
          {
            q: "Onko budjetti jo mietitty?",
            options: ["< 2000€", "2000€ - 5000€", "5000€ - 10000€", "10000€+"],
          },
        ],
        results: {
          book_call: "Varaa 20min puhelu, niin katsotaan tarkemmin.",
          audit: "Suosittelen teknistä auditointia nykytilan selvittämiseksi.",
          quote: "Vaikuttaa selkeältä projektilta. Pyydä tarjous.",
          cta: "Jatka tästä",
        },
      },
    },
    footer: {
      copyright: "© 2024 JJ. All rights reserved.",
      links: ["LinkedIn", "Twitter", "GitHub"],
    },
  },
  en: {
    hero: {
      headline: "Intelligent Growth & Automation.",
      subheadline:
        "Helping Finnish SMEs and growth teams scale without chaos. AI, automation, and data at the core of your business.",
      cta_primary: "Book a 20min Discovery",
      cta_secondary: "View Case Studies",
    },
    services: {
      title: "Services",
      items: [
        {
          title: "AI & Automation",
          description:
            "Free up time from routines. n8n, Make, and custom integrations that make work smoother.",
          tags: ["n8n", "Make", "OpenAI", "Anthropic"],
        },
        {
          title: "WordPress & WooCommerce",
          description:
            "High-performance ecommerce and websites. Custom solutions for demanding use cases.",
          tags: ["ACF", "Multisite", "Performance", "React"],
        },
        {
          title: "Measurement & Conversions",
          description:
            "Know, don't guess. Server-side tracking (GTM), GA4, and CAPI solutions that provide reliable data.",
          tags: ["GA4", "Server-side GTM", "CAPI", "BigQuery"],
        },
        {
          title: "Agents & Bots",
          description:
            "Intelligent customer service agents and internal assistants for Telegram, WhatsApp, or Slack.",
          tags: ["Telegram", "WhatsApp", "LangChain", "Vercel AI SDK"],
        },
        {
          title: "Technical Audits",
          description:
            "Deep dive into your current stack. Identifying bottlenecks and proposing fixes.",
          tags: ["Performance", "Security", "SEO", "Architecture"],
        },
      ],
    },
    cases: {
      title: "Selected Projects",
      items: [
        {
          client: "Ecommerce X",
          challenge: "Slow load times and manual order processing.",
          solution:
            "Headless architecture and n8n automation for inventory management.",
          result: "+40% conversion, 20h saved per week.",
          stack: ["Next.js", "WooCommerce", "n8n"],
        },
        {
          client: "Marketing Agency Y",
          challenge: "Lead quality variation and slow follow-up.",
          solution: "AI-based lead scoring and automatic CRM entry.",
          result: "Sales hit-rate +25%.",
          stack: ["OpenAI API", "Pipedrive", "Make"],
        },
        {
          client: "Consultant Z",
          challenge: "Laborious client reporting.",
          solution: "Automated data pipeline from BigQuery to Looker Studio.",
          result: "Real-time view, 0h manual work.",
          stack: ["GTM Server-side", "BigQuery", "Looker"],
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
            "First, we understand the root cause. No guessing, but analysis based on data and processes.",
        },
        {
          step: "02",
          name: "Build",
          description:
            "I build the solution with fast iterations. MVP in weeks, not months. Transparent process.",
        },
        {
          step: "03",
          name: "Iterate",
          description:
            "The world changes, and so does software. We measure results and optimize continuously.",
        },
      ],
    },
    about: {
      title: "About Me",
      text: "I am an entrepreneurial developer and automation architect. I believe that most 'busyness' is just poorly designed processes. I build systems that fight entropy and produce measurable value. I don't sell hours, I sell results.",
      signature: "JJ",
    },
    leadCapture: {
      title: "Let's Talk",
      subtitle:
        "Briefly tell me about your needs. I usually respond within 24h.",
      form: {
        name: "Name",
        email: "Email",
        company: "Company",
        message: "What do you want to achieve?",
        budget: "Budget Range",
        submit: "Send",
        success: "Thanks for your message! I'll be in touch soon.",
      },
      quiz: {
        title: "Project Fit Quiz",
        start: "Start Quiz",
        questions: [
          {
            q: "What describes your situation best?",
            options: [
              "I want to automate manual work",
              "I need ecommerce/website development",
              "I want better data/analytics",
              "Other / Not sure",
            ],
          },
          {
            q: "What is the project timeline?",
            options: [
              "Immediate / ASAP",
              "Within 1-2 months",
              "Within 6 months",
              "Just preliminary research",
            ],
          },
          {
            q: "Is there a budget in mind?",
            options: ["< 2000€", "2000€ - 5000€", "5000€ - 10000€", "10000€+"],
          },
        ],
        results: {
          book_call: "Book a 20min call, let's look closer.",
          audit: "I recommend a technical audit to clarify current state.",
          quote: "Seems like a clear project. Request a quote.",
          cta: "Continue",
        },
      },
    },
    footer: {
      copyright: "© 2024 JJ. All rights reserved.",
      links: ["LinkedIn", "Twitter", "GitHub"],
    },
  },
};
