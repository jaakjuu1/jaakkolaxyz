// Seed data for the Ateneum app
// Curated shared idea catalogue only. User identity and personal preferences
// are runtime configuration and never live in source control.

export interface SeedIdea {
  title: string;
  description: string;
  category: string;
  tags: string[];
  energyCost: "low" | "medium" | "high";
  budgetCost: "free" | "cheap" | "moderate" | "splurge";
  socialMode: "solo" | "together" | "with-friends";
  durationMin: number;
}

export const SEED_IDEAS: SeedIdea[] = [
  // indoor / cozy
  { title: "Saunailta kynttilöiden kanssa", description: "Hiljainen löyly, jälkeenpäin teetä ja puhetta pimeässä. Ei puhelimia.", category: "wellness", tags: ["sauna", "yhdessä", "arki-ilta", "rauha"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 90 },
  { title: "Yhteinen kokkailu-uusi resepti", description: "Valitaan yhdessä resepti jota emme ole kokeilleet, jaetaan tehtävät.", category: "culinary", tags: ["ruoka", "yhdessä", "viikonloppu", "kokeilu"], energyCost: "medium", budgetCost: "moderate", socialMode: "together", durationMin: 120 },
  { title: "Elokuva-ilta kotonateatterilla", description: "Pohditaan yhdessä genre, katsotaan molemmat uutta katsomatta spoilereita.", category: "indoor", tags: ["elokuva", "arki-ilta", "yhdessä"], energyCost: "low", budgetCost: "cheap", socialMode: "together", durationMin: 150 },
  { title: "Kirja yhteiseen lukuun", description: "Valitaan kirja, luetaan vuoroluvun omina jaksoina, keskustellaan luvun jälkeen.", category: "culture", tags: ["lukeminen", "yhdessä", "arki-ilta", "keskustelu"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 45 },
  { title: "Palapeli yhdessä", description: "1000 palan palapeli pöydälle, hiljaista puuhaa ja radiota taustalle.", category: "indoor", tags: ["arki-ilta", "yhdessä", "pieni haaste"], energyCost: "low", budgetCost: "cheap", socialMode: "together", durationMin: 90 },

  // outdoor
  { title: "Metsäkävely kahden kesken", description: "Lähdetään ilman määränpäätä, kävellään kunnes tulee nälkä.", category: "outdoor", tags: ["luonto", "yhdessä", "arki-ilta", "liikunta"], energyCost: "medium", budgetCost: "free", socialMode: "together", durationMin: 90 },
  { title: "Pyöräretki uuteen kahvilaan", description: "Pyöräillään jonnekin emmekä ole käyneet, juodaan kahvit ja palataan.", category: "outdoor", tags: ["pyöräily", "uusi paikka", "viikonloppu", "kahvi"], energyCost: "medium", budgetCost: "cheap", socialMode: "together", durationMin: 180 },
  { title: "Auringonnousu mökillä", description: "Lähdetään ennen aamua, katsotaan auringonnousu, syödään aamupala ulkona.", category: "outdoor", tags: ["aamu", "luonto", "yhdessä", "erityinen"], energyCost: "medium", budgetCost: "free", socialMode: "together", durationMin: 240 },
  { title: "Talviuinti avannossa", description: "Sauna ja avanto yhdessä, kuuma mehu jälkeenpäin.", category: "wellness", tags: ["avanto", "talvi", "yhdessä", "rohkeus"], energyCost: "high", budgetCost: "moderate", socialMode: "together", durationMin: 120 },
  { title: "Marjastusretki kesällä", description: "Valitaan yksi marja, etsitään hyvä paikka, syödään eväät metsässä.", category: "outdoor", tags: ["kesä", "luonto", "yhdessä", "perinne"], energyCost: "medium", budgetCost: "free", socialMode: "together", durationMin: 180 },

  // culinary
  { title: "Sushikurssi kotona", description: "Tehdään yhdessä sushia alusta asti, syödään mitä tuli.", category: "culinary", tags: ["ruoka", "yhdessä", "kokeilu", "viikonloppu"], energyCost: "high", budgetCost: "moderate", socialMode: "together", durationMin: 180 },
  { title: "Pizzaperjantai", description: "Tehdään pitsaa joka perjantai, kokeillaan uusia täytteitä.", category: "culinary", tags: ["ruoka", "perinne", "yhdessä"], energyCost: "medium", budgetCost: "cheap", socialMode: "together", durationMin: 120 },
  { title: "Leivontapäivä", description: "Leivotaan pullaa, sämpylöitä tai kakku — viedään naapurillekin.", category: "culinary", tags: "leivonta,arki-ilta,yhdessä".split(",") as string[], energyCost: "medium", budgetCost: "cheap", socialMode: "together", durationMin: 150 },
  { title: "Viininmaistelu kotona", description: "Valitaan 3-4 erilaista viiniä, maistellaan sokkona, arvellaan.", category: "culinary", tags: ["viini", "yhdessä", "arki-ilta", "hauska"], energyCost: "low", budgetCost: "moderate", socialMode: "together", durationMin: 90 },
  { title: "Uusi ravintola kokeiluun", description: "Varataan pöytä ravintolasta jossa emme ole käyneet.", category: "culinary", tags: ["ravintola", "uusi paikka", "yhdessä", "viikonloppu"], energyCost: "low", budgetCost: "splurge", socialMode: "together", durationMin: 150 },

  // culture
  { title: "Museokäynti", description: "Valitaan pieni museo, käydään rauhassa, jutellaan taidenäkemystä.", category: "culture", tags: ["museo", "yhdessä", "viikonloppu", "taide"], energyCost: "medium", budgetCost: "moderate", socialMode: "together", durationMin: 150 },
  { title: "Konsertti tai keikka", description: "Mennään katsomaan mieluista artistia, vaikka kauemmas.", category: "culture", tags: ["musiikki", "yhdessä", "erityinen", "ilta"], energyCost: "high", budgetCost: "moderate", socialMode: "together", durationMin: 180 },
  { title: "Teatteri-ilta", description: "Valitaan esitys, käydään syömässä ennen, keskustellaan jälkeen.", category: "culture", tags: ["teatteri", "yhdessä", "ilta", "erityinen"], energyCost: "medium", budgetCost: "moderate", socialMode: "together", durationMin: 180 },
  { title: "Näyttely avajaisissa", description: "Mennään taidenäyttelyn avajaisiin, nautitaan tunnelmasta.", category: "culture", tags: ["taide", "yhdessä", "erityinen", "tapahtuma"], energyCost: "medium", budgetCost: "moderate", socialMode: "together", durationMin: 120 },
  { title: "Kirjastopäivä", description: "Käydään kirjastossa, valitaan kirja toisillemme yllätyksenä.", category: "culture", tags: ["kirjasto", "lukeminen", "yhdessä", "edullinen"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 60 },

  // wellness
  { title: "Yhteinen jooga/hengitysharjoitus", description: "YouTube-ohjattu 20 min jooga tai hengitys, rauhoittuminen yhdessä.", category: "wellness", tags: ["jooga", "arki-aamu", "yhdessä", "rauha"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 30 },
  { title: "Hieronta yhdessä", description: "Varataan kahden hengen hieronta, hemmottelupäivä.", category: "wellness", tags: ["hemmottelu", "yhdessä", "erityinen"], energyCost: "low", budgetCost: "splurge", socialMode: "together", durationMin: 90 },
  { title: "Meditaatiohetki", description: "Ohjattu 10 min meditaatio, jaetaan miltä tuntui.", category: "wellness", tags: ["mindfulness", "yhdessä", "arki-aamu", "rauha"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 20 },
  { title: "Kylpyläpäivä", description: "Varataan kylpylä, ollaan koko päivä ilman kiirettä.", category: "wellness", tags: ["kylpylä", "hemmottelu", "yhdessä", "viikonloppu"], energyCost: "low", budgetCost: "splurge", socialMode: "together", durationMin: 300 },
  { title: "Pitkä kävely saunan jälkeen", description: "Saunan jälkeen hidas kävely, ei puhuta mitään tärkeää.", category: "wellness", tags: ["kävely", "yhdessä", "rauha", "arki-ilta"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 45 },

  // creative
  { title: "Yhteinen piirustushetki", description: "Piirretään toisiamme tai samaa kohdetta, naurua varmasti.", category: "creative", tags: ["piirtäminen", "yhdessä", "hauska", "arki-ilta"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 60 },
  { title: "Valokuvauskävely", description: "Lähdetään kameroitten kanssa, etsitään kauniita yksityiskohtia.", category: "creative", tags: ["valokuvaus", "yhdessä", "viikonloppu", "luova"], energyCost: "medium", budgetCost: "free", socialMode: "together", durationMin: 120 },
  { title: "Käsityöprojekti", description: "Aloitetaan yhteinen neule-, ompelu- tai puutyöprojekti.", category: "creative", tags: ["käsityö", "yhdessä", "pitkä projekti"], energyCost: "medium", budgetCost: "cheap", socialMode: "together", durationMin: 120 },
  { title: "Musiikin tekeminen", description: "Valitaan biisi, soitetaan tai lauletaan yhdessä, ei tarvitse olla hyvä.", category: "creative", tags: ["musiikki", "yhdessä", "hauska"], energyCost: "medium", budgetCost: "free", socialMode: "together", durationMin: 60 },
  { title: "Runon tai tekstin kirjoittaminen yhdessä", description: "Kirjoitetaan vuorotellen lause kerrallaan, luetaan lopputulos ääneen.", category: "creative", tags: ["kirjoittaminen", "yhdessä", "hauska", "luova"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 30 },

  // social / with-friends
  { title: "Ystäväparin illalliskutsu", description: "Kutsutaan ystäväpari kylään, kokataan yhdessä.", category: "social", tags: ["ystävät", "yhdessä", "illallinen", "ilta"], energyCost: "high", budgetCost: "moderate", socialMode: "with-friends", durationMin: 240 },
  { title: "Peli-ilta ystävien kanssa", description: "Lautapelejä tai korttipelejä, rentoa seurustelua.", category: "social", tags: ["ystävät", "pelit", "ilta", "hauska"], energyCost: "medium", budgetCost: "cheap", socialMode: "with-friends", durationMin: 180 },
  { title: "Saunailta ystäville", description: "Sauna, vilvoittelu, makkaraa ja juotavaa.", category: "social", tags: ["sauna", "ystävät", "ilta"], energyCost: "medium", budgetCost: "moderate", socialMode: "with-friends", durationMin: 240 },
  { title: "Yhteinen brunssi ystävien kanssa", description: "Brunssi kotona tai ravintolassa, rauhallinen sunnuntai.", category: "social", tags: ["ystävät", "brunssi", "sunnuntai"], energyCost: "medium", budgetCost: "moderate", socialMode: "with-friends", durationMin: 180 },
  { title: "Retki ystävien kanssa", description: "Yhteinen päiväretki luontoon tai kaupunkiin.", category: "social", tags: ["ystävät", "retki", "viikonloppu"], energyCost: "high", budgetCost: "moderate", socialMode: "with-friends", durationMin: 360 },

  // solo but supportive
  { title: "Oma-aika lukemiseen", description: "Kumpikin lukee omaa kirjaa eri huoneissa, mutta tiedetään toinen lähellä.", category: "indoor", tags: ["oma-aika", "lukeminen", "rauha"], energyCost: "low", budgetCost: "free", socialMode: "solo", durationMin: 90 },
  { title: "Oma-aika liikuntaan", description: "Kumpikin tekee oman liikuntasuorituksen, saunotaan yhdessä jälkeen.", category: "wellness", tags: ["oma-aika", "liikunta", "yhdessä-myöhemmin"], energyCost: "medium", budgetCost: "free", socialMode: "solo", durationMin: 90 },
  { title: "Oma-aika harrastukseen", description: "Kumpikin saa tunnin omaa harrastusaikaa ilman keskeytyksiä.", category: "indoor", tags: ["oma-aika", "harrastus", "tuki"], energyCost: "low", budgetCost: "free", socialMode: "solo", durationMin: 60 },

  // travel / getaway
  { title: "Päiväretki lähikaupunkiin", description: "Junalla tai autolla lähimpään isompaan kaupunkiin, kahvilla ja kävelyllä.", category: "outdoor", tags: ["matkailu", "yhdessä", "päiväretki"], energyCost: "medium", budgetCost: "moderate", socialMode: "together", durationMin: 360 },
  { title: "Viikonloppureissu yllätyskohteeseen", description: "Toinen valitsee kohteen, toinen lähtee mukaan sokkona.", category: "outdoor", tags: ["matkailu", "yllätys", "yhdessä", "erityinen"], energyCost: "high", budgetCost: "splurge", socialMode: "together", durationMin: 2880 },
  { title: "Mökki-viikonloppu", description: "Mökille ilman suunnitelmia, saunotaan ja ollaan.", category: "outdoor", tags: ["mökki", "yhdessä", "viikonloppu", "rauha"], energyCost: "medium", budgetCost: "cheap", socialMode: "together", durationMin: 2880 },
  { title: "Hotelliyö kaupungissa", description: "Varataan yö hotellissa, käydään syömässä, nukutaan pitkään.", category: "culture", tags: ["hotelli", "yhdessä", "erityinen", "hemmottelu"], energyCost: "low", budgetCost: "splurge", socialMode: "together", durationMin: 1440 },
  { title: "Retki saaristoon", description: "Laivalla tai veneellä saaristoon, retkieväät mukana.", category: "outdoor", tags: ["meri", "yhdessä", "kesä", "retki"], energyCost: "medium", budgetCost: "moderate", socialMode: "together", durationMin: 360 },

  // low-effort together
  { title: "Kymmenen minuutin yhteys", description: "Istukaa hetkeksi vierekkäin ilman puhelimia. Kumpikin saa sanoa yhden asian päivästä — tai olla vain hiljaa.", category: "wellness", tags: ["yhdessä", "läsnäolo", "arki-ilta", "rauha"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 10 },
  { title: "Yhdessä pelaaminen", description: "Korttipeli, lautapeli tai yhteinen videopeli hetki.", category: "indoor", tags: ["pelit", "yhdessä", "arki-ilta"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 60 },
  { title: "Kahvit terassilla", description: "Heti aamusta tai iltapäivästä, kahvit ja sanomalehti yhdessä.", category: "culinary", tags: ["kahvi", "yhdessä", "arki-aamu", "arki-ilta"], energyCost: "low", budgetCost: "cheap", socialMode: "together", durationMin: 45 },
  { title: "Aamiainen sänkyyn", description: "Toinen yllättää aamiaisella sänkyyn — kahvit, leipä, hedelmät.", category: "culinary", tags: ["aamiainen", "yllätys", "yhdessä", "arki-aamu"], energyCost: "low", budgetCost: "cheap", socialMode: "together", durationMin: 30 },
  { title: "Kynttiläillallinen kotona", description: "Tavallinen arki-illallinen mutta kynttilät, pöytäliina ja kattaus.", category: "culinary", tags: ["illallinen", "yhdessä", "romanttinen", "arki-ilta"], energyCost: "medium", budgetCost: "moderate", socialMode: "together", durationMin: 90 },
  { title: "Auringonlaskun katselu", description: "Lähdetään paikkaan missä on hyvä nähdä auringonlasku, vain katsotaan.", category: "outdoor", tags: "auringonlasku,yhdessä,arki-ilta,romanttinen".split(",") as string[], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 60 },
  { title: "Yhteinen suunnittelu", description: "Istutaan alas ja suunnitellaan yhteistä tulevaisuutta — unelmat, matkat, projektit.", category: "indoor", tags: ["suunnittelu", "yhdessä", "keskustelu", "tärkeä"], energyCost: "medium", budgetCost: "free", socialMode: "together", durationMin: 60 },
  { title: "Puhelin pois koko illaksi", description: "Molemmat jättävät puhelimen kaappiin koko illaksi, huomio vain toisissa.", category: "indoor", tags: ["läsnäolo", "yhdessä", "arki-ilta", "tärkeä"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 180 },
  { title: "Käsi kädessä -kävely", description: "Lyhyt kävely, ei tarvitse puhua, vain käsi kädessä oleminen.", category: "outdoor", tags: ["yhdessä", "arki-ilta", "läheisyys", "romanttinen"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 20 },
  { title: "Musiikin kuuntelu yhdessä", description: "Valitaan albumi, kuunnellaan alusta loppuun, jutellaan.", category: "culture", tags: ["musiikki", "yhdessä", "arki-ilta"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 60 },
  { title: "Yhteinen siivous + palkinto", description: "Siivotaan koti yhdessä tehokkaasti, palkinnoksi jäätelöä tai elokuva.", category: "indoor", tags: ["arki", "yhdessä", "tuottava"], energyCost: "medium", budgetCost: "cheap", socialMode: "together", durationMin: 120 },
  { title: "Kasvien hoito yhdessä", description: "Istutetaan yrttejä tai kukkia parvekkeelle, hoidetaan yhdessä.", category: "creative", tags: ["kasvit", "yhdessä", "arki", "luova"], energyCost: "low", budgetCost: "cheap", socialMode: "together", durationMin: 60 },
  { title: "Tähtien katselu", description: "Lämmin yö, viltti, kuuma kaakao ja tähtitaivaan katselu.", category: "outdoor", tags: ["yö", "yhdessä", "romanttinen", "rauha"], energyCost: "low", budgetCost: "free", socialMode: "together", durationMin: 45 },
];
