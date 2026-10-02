(() => {
  const byId = id => document.getElementById(id);
  const dayNames = ["Sunnuntai", "Maanantai", "Tiistai", "Keskiviikko", "Torstai", "Perjantai", "Lauantai"];
  const operatingSystem = {
    1: { title: "Signaali: vahva näkemys", job: "Herätä oikean ostajan huomio — ei massaa.", ship: "Yksi terävä LinkedIn- tai X-näkemys, joka haastaa asiakkaan kalliin oletuksen.", distribute: "Kommentoi 3 ostajasi tai vertaisesi avainkeskustelua aidolla näkemyksellä." },
    2: { title: "Todiste: operaattorin auktoriteetti", job: "Näytä, että olet tehnyt työn — ilman myyntipuhetta.", ship: "Yksi framework, ennen–jälkeen-havainto tai anonymisoitu case-kuvaus.", distribute: "Lähetä se yhdelle relevantille keskustelulle tai lisää se jo käynnissä olevaan threadiin." },
    3: { title: "Tarina: miksi tämä näkemys maksaa", job: "Rakenna muistettavuutta ja luottamusta.", ship: "Lyhyt tarina: tilanne → virhearvio → oppi → toimintatapa nyt.", distribute: "Vastaa kolmeen DM:ään tai keskusteluun ihmisenä, ei liidirobottina." },
    4: { title: "Jakelu: mene ostajan huomion äärelle", job: "Hyvä sisältö ilman jakelua on päiväkirja.", ship: "Kaksi korkeasignaalista kommenttia tai quote-postia ja yksi lämmin yhteydenavaus.", distribute: "Tarkista Dream 20: missä ICP jo lukee, keskustelee tai ostaa?" },
    5: { title: "Konversio: tee seuraava askel helpoksi", job: "Muunna kertynyt luottamus keskusteluksi maltilla.", ship: "Case + pehmeä CTA: kenelle tämä on, mikä muuttuu, miten keskustelu alkaa.", distribute: "Tarkista vastaajat ja signaalit; tee vain relevantit follow-upit." },
    6: { title: "Uudelleenpaketointi: anna voittajalle toinen elämä", job: "Luo lisää pintaa todistetusta ideasta, älä lisää satunnaista tuotantoa.", ship: "Muuta yksi toimiva ajatus toiseen formaattiin: postaus → carousel, case → thread, thread → newsletter.", distribute: "Tallenna uusi esimerkki content vaultiin ja merkitse alkuperäinen asset." },
    0: { title: "Strategia: katso dataa, älä fiilistä", job: "Valitse ensi viikon hypoteesit oikeista signaaleista.", ship: "Viikkokatsaus: 3 voittajaa, 2 hävitettävää kulmaa, 3 ensi viikon testiä.", distribute: "Ei pakollista postausta. Päätä mitä lopetat, tuplaat ja testaat." }
  };
  const normalize = value => value.replace(/\r?\n/g, " ").replace(/[,;]/g, " ").trim();
  const escapeIcs = value => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const pad = n => String(n).padStart(2, "0");
  const localIcs = date => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}T${pad(date.getHours())}${pad(date.getMinutes())}00`;
  const download = (name, type, text) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const plan = () => {
    const dateValue = byId("plan-date").value;
    const start = byId("plan-start").value || "09:30";
    const minutes = Math.max(30, Number(byId("plan-minutes").value) || 90);
    const goal = normalize(byId("plan-goal").value) || "rakentaa kasvujärjestelmä, jonka ostaja ymmärtää";
    const evidence = normalize(byId("plan-evidence").value) || "yksi havainto asiakastyöstä, mittarista tai tuotannosta";
    const audience = normalize(byId("plan-audience").value) || "oma ICP";
    const date = dateValue ? new Date(`${dateValue}T12:00:00`) : new Date();
    const system = operatingSystem[date.getDay()];
    const capture = Math.round(minutes * .16 / 5) * 5;
    const create = Math.round(minutes * .48 / 5) * 5;
    const distribute = Math.round(minutes * .24 / 5) * 5;
    const review = Math.max(5, minutes - capture - create - distribute);
    const blocks = [
      [capture, "Poimi signaali", `Kirjaa ${evidence}. Muotoile yksi asia, jonka ${audience} jo tietää ongelmana mutta ei vielä näe syytä.`],
      [create, "Tee päivän asset", `${system.ship} Yhdistä se tavoitteeseen: ${goal}.`],
      [distribute, "Vie asset oikeaan huoneeseen", system.distribute],
      [review, "Kirjaa oppi", "Merkitse asset-id, formaatti, kulma, CTA ja ensimmäinen oikea signaali — tallennus, laadukas vastaus, DM tai varaus."]
    ];
    let clock = new Date(`${dateValue || date.toISOString().slice(0,10)}T${start}:00`);
    const rows = blocks.map(([duration, title, detail]) => {
      const label = `${pad(clock.getHours())}:${pad(clock.getMinutes())}`;
      const begin = new Date(clock); clock = new Date(clock.getTime() + duration * 60000);
      return { begin, duration, label, title, detail };
    });
    const html = `<p class="eyebrow">${dayNames[date.getDay()]} · ${system.title}</p><h2>${system.job}</h2><p><b>Päivän julkaisu:</b> ${system.ship}</p><ul class="schedule">${rows.map(row => `<li><time>${row.label}</time><span class="task"><b>${row.title}</b><span class="why">${row.detail} · ${row.duration} min</span></span></li>`).join("")}</ul><p class="small"><b>Laatuportti:</b> jos et voi nimetä konkreettista näyttöä tai näkökulmaa, älä tee postausta. Kerää ensin parempi havainto.</p>`;
    byId("plan-output").innerHTML = html;
    byId("download-md").onclick = () => {
      const markdown = `# ${system.title}\n\nPäivä: ${dayNames[date.getDay()]} ${date.toLocaleDateString("fi-FI")}\nTavoite: ${goal}\nYleisö: ${audience}\n\n## Päivän julkaisu\n${system.ship}\n\n## Aikataulu\n${rows.map(row => `- ${row.label}–${pad(new Date(row.begin.getTime() + row.duration * 60000).getHours())}:${pad(new Date(row.begin.getTime() + row.duration * 60000).getMinutes())} — **${row.title}**: ${row.detail}`).join("\n")}\n\n## Päivän oppi\n- Asset ID:\n- Formaatti / kulma:\n- Oikea signaali:\n- Jatka, lopeta vai testaa seuraavaksi:\n`;
      download(`mikroauktoriteetti-${dateValue || "tanaan"}.md`, "text/markdown;charset=utf-8", markdown);
    };
    byId("download-ics").onclick = () => {
      const startDate = rows[0].begin;
      const endDate = new Date(rows[rows.length - 1].begin.getTime() + rows[rows.length - 1].duration * 60000);
      const description = `Tavoite: ${goal}\\nYleisö: ${audience}\\nPäivän julkaisu: ${system.ship}\\n\\n${rows.map(row => `${row.label} ${row.title}: ${row.detail}`).join("\\n")}`;
      const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Jaakkola.xyz//Mikroauktoriteetti//FI", "CALSCALE:GREGORIAN", "BEGIN:VEVENT", `UID:microauthority-${Date.now()}@jaakkola.xyz`, `DTSTAMP:${localIcs(new Date())}`, `DTSTART;TZID=Europe/Helsinki:${localIcs(startDate)}`, `DTEND;TZID=Europe/Helsinki:${localIcs(endDate)}`, `SUMMARY:${escapeIcs(`Mikroauktoriteetti: ${system.title}`)}`, `DESCRIPTION:${escapeIcs(description)}`, "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
      download(`mikroauktoriteetti-${dateValue || "tanaan"}.ics`, "text/calendar;charset=utf-8", ics);
    };
    byId("plan-status").textContent = "Suunnitelma muodostettu. Lataa Markdown työmuistiin tai ICS kalenteriin.";
  };
  const today = new Date().toISOString().slice(0, 10);
  if (byId("plan-date")) byId("plan-date").value = today;
  byId("build-plan").addEventListener("click", plan);
  plan();
})();
