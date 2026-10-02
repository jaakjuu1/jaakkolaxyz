/**
 * Deterministic body-practice library (training + recovery).
 * P0: no LLM — filter/rotate by week key only.
 */

export type BodyPracticeKind = "training" | "recovery" | "connection";

export type BodyLibraryItem = {
  id: string;
  kind: BodyPracticeKind;
  title: string;
  /** Short instruction shown in email + activity details */
  instructions: string;
  durationMin: number;
  energy: "low" | "medium" | "high";
  place: "home" | "outdoor" | "gym" | "any";
  tags: string[];
};

export const BODY_PRACTICE_LIBRARY: BodyLibraryItem[] = [
  // —— training ——
  {
    id: "train-strength-full-a",
    kind: "training",
    title: "Voima A — koko keho",
    instructions:
      "Kyykky tai lantionnosto 3×8, punnerrus tai penkki 3×8, soutu 3×10, lankku 3×30 s. Pidä 2 toistoa varastossa.",
    durationMin: 55,
    energy: "high",
    place: "home",
    tags: ["voima", "koti"],
  },
  {
    id: "train-strength-full-b",
    kind: "training",
    title: "Voima B — veto + jalat",
    instructions:
      "Askelkyykky 3×8/puoli, leuanveto/avustettu 3× max 6, romanialainen mave 3×8, farmarikävely 3×40 m tai 45 s.",
    durationMin: 55,
    energy: "high",
    place: "gym",
    tags: ["voima", "sali"],
  },
  {
    id: "train-zone2-walk",
    kind: "training",
    title: "Zone 2 — kävely/pyörä",
    instructions:
      "45–60 min keskustelutempoa. Syke sellainen että jaksat puhua. Ei intervallia.",
    durationMin: 55,
    energy: "medium",
    place: "outdoor",
    tags: ["kestävyys", "zone2"],
  },
  {
    id: "train-zone2-row",
    kind: "training",
    title: "Zone 2 — row/crosstrainer",
    instructions:
      "40–50 min tasaista tempoa. Hengitys nenän kautta mahdollisuuksien mukaan. Loppuun 3 min kevyt.",
    durationMin: 50,
    energy: "medium",
    place: "gym",
    tags: ["kestävyys", "zone2"],
  },
  {
    id: "train-mobility-strength",
    kind: "training",
    title: "Liikkuvuus + kevyt voima",
    instructions:
      "Lonkan avaukset 5 min, kyykky pidolla 3×5, lantionnosto 3×10, seinäenkelit 2×10, dead bug 2×8/puoli.",
    durationMin: 35,
    energy: "low",
    place: "home",
    tags: ["liikkuvuus", "kevyt"],
  },
  {
    id: "train-short-hiit",
    kind: "training",
    title: "Lyhyt HIIT (valinnainen)",
    instructions:
      "Lämmittely 5 min. 6× (40 s työ / 80 s palautus): burpee-kevyt, air squat, mountain climber. Jäähdyttely 5 min.",
    durationMin: 25,
    energy: "high",
    place: "home",
    tags: ["hiit", "lyhyt"],
  },
  {
    id: "train-core-walk",
    kind: "training",
    title: "Keskivartalo + kävely",
    instructions:
      "Lankku 3×30 s, side plank 2×20 s/puoli, bird-dog 2×8. Sitten 25–35 min reipas kävely.",
    durationMin: 45,
    energy: "medium",
    place: "any",
    tags: ["core", "kävely"],
  },

  // —— recovery ——
  {
    id: "rec-sauna-stretch",
    kind: "recovery",
    title: "Sauna + venyttely",
    instructions:
      "1–2 löylyä. Jälkeen: takareidet, lonkankoukistajat, rinta 45 s / liike. Vesi + magnesium jos käytät.",
    durationMin: 40,
    energy: "low",
    place: "home",
    tags: ["sauna", "palautus"],
  },
  {
    id: "rec-yoga-20",
    kind: "recovery",
    title: "Jooga 20 min",
    instructions:
      "Ohjattu gentle/yin 15–20 min (YouTube ok). Loppuun 2 min makaava hengitys, käsi vatsalla.",
    durationMin: 20,
    energy: "low",
    place: "home",
    tags: ["jooga", "hengitys"],
  },
  {
    id: "rec-breath-nsdr",
    kind: "recovery",
    title: "Hengitys / NSDR",
    instructions:
      "10–15 min body scan tai NSDR makuulla. Puhelin lentokonetilaan. Tavoite: hermosto alas, ei suoritus.",
    durationMin: 15,
    energy: "low",
    place: "home",
    tags: ["hengitys", "nsdr"],
  },
  {
    id: "rec-walk-easy",
    kind: "recovery",
    title: "Rauhallinen palautuskävely",
    instructions:
      "20–40 min hyvin kevyt kävely. Ei podcastia jos stressi korkealla — anna mielen tyhjentyä.",
    durationMin: 30,
    energy: "low",
    place: "outdoor",
    tags: ["kävely", "palautus"],
  },
  {
    id: "rec-foam-sleep",
    kind: "recovery",
    title: "Foam roll + unirutiini",
    instructions:
      "Pohkeet, reidet, yläselkä 8 min. Sitten dim lights, ei ruutua 30 min, sama nukkumaanmenoaika.",
    durationMin: 35,
    energy: "low",
    place: "home",
    tags: ["uni", "foam"],
  },
  {
    id: "rec-couple-stretch",
    kind: "recovery",
    title: "Yhteinen venyttely",
    instructions:
      "Selinmakuu, polvet rintaan, avoin kierre, lonkankoukistaja. 2 min / asento. Hiljaa tai hiljainen musiikki.",
    durationMin: 20,
    energy: "low",
    place: "home",
    tags: ["yhdessä", "venyttely"],
  },

  // —— connection (optional later; kept for library completeness) ——
  {
    id: "conn-three-breaths",
    kind: "connection",
    title: "Kolme yhteistä hengitystä",
    instructions:
      "Vierekkäin, silmät auki tai kiinni. Kolme yhteistä rauhallista hengitystä. Ei tarvitse puhua.",
    durationMin: 5,
    energy: "low",
    place: "home",
    tags: ["yhteys", "mikro"],
  },
  {
    id: "conn-ten-min",
    kind: "connection",
    title: "10 min yhteys ilman puhelinta",
    instructions:
      "Puhelimet pois. Istukaa vierekkäin. Kumpikin sanoo yhden asian päivästä — tai olkaa hiljaa.",
    durationMin: 10,
    energy: "low",
    place: "home",
    tags: ["yhteys", "läsnäolo"],
  },
];

export function libraryById(id: string): BodyLibraryItem | undefined {
  return BODY_PRACTICE_LIBRARY.find((item) => item.id === id);
}

export function libraryByKind(kind: BodyPracticeKind): BodyLibraryItem[] {
  return BODY_PRACTICE_LIBRARY.filter((item) => item.kind === kind);
}

/** Stable 0..1-ish hash for week rotation */
export function weekHash(weekKey: string, salt = ""): number {
  const s = `${weekKey}:${salt}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export function pickRotated(
  items: BodyLibraryItem[],
  weekKey: string,
  salt: string,
  count: number,
): BodyLibraryItem[] {
  if (items.length === 0 || count <= 0) return [];
  const start = Math.floor(weekHash(weekKey, salt) * items.length) % items.length;
  const out: BodyLibraryItem[] = [  {
    id: "conn-synchronous-breath",
    kind: "connection",
    title: "Synkronoitu hengitys 3 min",
    instructions:
      "Istukaa vierekkäin selkä suorana. Toinen laskee kolmeen sisään, neljään ulos. Hengittäkää samaan rytmiin 3 min. Silmät kiinni.",
    durationMin: 5,
    energy: "low",
    place: "home",
    tags: ["yhteys", "hengitys", "läsnäolo"],
  },
  {
    id: "conn-silent-touch",
    kind: "connection",
    title: "Kosketus ilman puhetta 5 min",
    instructions:
      "Istukaa vastakkain. Toinen asettaa kätensä toisen hartioille. Mitään ei tarvitse sanoa. Vaihtakaa 2,5 min jälkeen.",
    durationMin: 5,
    energy: "low",
    place: "home",
    tags: ["yhteys", "kosketus", "hiljaisuus"],
  },
  {
    id: "conn-eye-gazing",
    kind: "connection",
    title: "Katsekontakti 2 min",
    instructions:
      "Istukaa 1 m päässä toisistanne. Katsokaa toisen vasenta silmää. Hengittäkää rauhallisesti. Ei tarvitse puhua tai hymyillä.",
    durationMin: 3,
    energy: "low",
    place: "home",
    tags: ["yhteys", "katse", "läsnäolo"],
  },
  {
    id: "conn-slow-movement",
    kind: "connection",
    title: "Hidas yhteinen liike 8 min",
    instructions:
      "Seisokaa vastakkain käsivarren päässä. Toinen aloittaa hitaan liikkeen (käsi, pää, hartia). Toinen seuraa viiveellä kuin peili. Vaihtakaa roolia 4 min jälkeen.",
    durationMin: 10,
    energy: "low",
    place: "home",
    tags: ["yhteys", "liike", "peilaus"],
  },
  {
    id: "conn-hand-to-heart",
    kind: "connection",
    title: "Käsi sydämellä 5 min",
    instructions:
      "Makaava selinmakuulla. Toinen laittaa kätensä kevyesti toisen rintakehälle sydämen kohdalle. Hengittäkää yhdessä 3 min. Vaihtakaa sitten.",
    durationMin: 7,
    energy: "low",
    place: "home",
    tags: ["yhteys", "kosketus", "sydän", "läsnäolo"],
  },
];
  for (let i = 0; i < Math.min(count, items.length); i++) {
    out.push(items[(start + i) % items.length]!);
  }
  return out;
}
