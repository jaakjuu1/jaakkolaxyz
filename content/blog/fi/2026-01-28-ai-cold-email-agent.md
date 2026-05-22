---
title: "Rakensin AI-pohjaisen cold email -järjestelmän"
date: "2026-01-28"
excerpt: "Kolme kuukautta rakentamista, joka automatisoi leadien löytämisen, sähköpostien kirjoittamisen ja vastausten seurannan. Tässä miksi ja miten."
---

Inhottavaa. Nimenomaan kylmäviestejä — ei niiden vastaanottamista, vaan lähettämistä. Vastaanottamisen voi suodattaa Gmail-säännöillä, mutta lähettäminen... se on kuin liukuhihnatyötä ilman palautetta. Uppoutit tunteja täydellisen templaten rakentamiseen, löysit listan potentiaalisista asiakkaista, lähetit 200 sähköpostia — ja sitten vain odotit. Viikkoja. Tietämättä avasiko kukaan yhtään niistä.

Joten mä rakensin jotain parempaa.

## Mitä se tekee

Cold-email-agentti on täysiverinen B2B-reachout-kone. Se tekee neljä asiaa:

1. **Analysoi asiakkaan** — Anna sille verkkosivusto ja AI analysoi bisneksen, tunnistaa ideaaliprofiilin (ICP), kipupisteet ja viestinnän.
2. **Löytää leadit** — Käyttää Google Mapsia, Firecrawlia ja Perplexitya löytääkseen potentiaaliset asiakkaat, jotka vastaavat ICP:tä. Oikealla toimialalla, oikealla alueella, oikean kokoisia.
3. **Generoi personoidut sähköpostisekvenssit** — Ei vain "Hei {{etunimi}}" -personointia. Oikeaa personointia. Viittauksia heidän erityiseen bisnekseen, viimeisimpiin uutisiin, todellisiin kipupisteisiin.
4. **Seurantaa kaikkea reaaliajassa** — Näet heti kun vastauksia tulee. Mitkä sähköpostit saivat vastauksia, mitkä pomppasivat takaisin, kuka on kiinnostunut.

Workflow on yksinkertainen: kirjaudu sisään, liimaa oman yrityksesi verkkosivuston URL, odota viitisen minuuttia kun AI analysoi bisneksesi ja rakentaa ICP:n, hyväksy tai hienosäädä, anna systeemin etsiä leadit, käy läpi sähköpostisekvenssit, paina lähetä.

## Miksi Rakensin Tämän

Cold email -työkalut on yleensä joko:

- **Liian yksinkertaisia** — Sinä kirjoitat sähköpostit, valitset listan, lähetät. Työkalu hoitaa vain putkiston.
- **Liian musta laatikko** — AI kirjoittaa kaiken, sinulla ei ole hajuakaan mitä tapahtuu, ja tulokset on keskinkertaisia.

Mä halusin jotain, jossa AI tekee raskaan työn mutta sinulla on silti kontrolli. ICP ei ole taikuutta — näet sen, voit hioa sitä. Sähköpostisekvenssit eivät ole AI:n roskaa — ne perustuvat oikeaan analyysiin potentiaalisen asiakkaan sivustosta ja bisneskontekstista.

Ja myös: mä kyllästyin siihen, että palautekierto kesti viikkoja. Reaaliaikaisen IMAP-seurannan ansiosta tiedät minuuteissa kun joku vastaa. Se muuttaa tavan jolla iteroidaan.

## Kenelle Tämä On?

Tällä hetkellä systeemiä käyttää pari B2B-palveluyritystä Suomessa. Toinen tekee teollisuuspesulaa, toinen markkinointipalveluita. Molemmat tavoittavat sillä pieniä ja keskikokoisia yrityksiä omalla toimialallaan.

Esimerkki: teollisuuspesula halusi tavoittaa sopivan kokoisia tehtaita pääkaupunkiseudulla. Systeemi löysi 47 potentiaalista kohdetta, generoi jokaiselle räätälöidyn viestin, lähetti ensimmäisen yhteydenoton — ja muutama yritys vastasi. Ei mikään maailmanvalloitus, mutta ei huonoimmillaankaan.

Tämä ei ole kaikille. Jos haluat lähettää 10 000 sähköpostia ostetulle listalle satunnaisilla osoitteilla, tämä ei ole sulla. Jos haluat oikeasti ymmärtää kehen olet yhteydessä ja lähettää kohdennettua, personoitua outreachia skaalassa — toimii.

## Mitä tuloksia?

Rehellisesti: ei vielä valtavia numeroita. Mutta muutama havainto:

- Personointi toimii. Kun viesti viittaa oikeasti vastaanottajan bisnekseen, vastauksen todennäköisyys on korkeampi kuin geneerisellä templatella.
- Reaaliaikainen seuranta muuttaa käyttäytymistä. Kun näet että joku vastasi tunnin sisällä, alat reagoida eri tavalla.
- Queue-hallinta on kriittinen. Liian nopea lähetystahti johtaa spam-filttteröitymisiin.

## Mitä Seuraavaksi?

Core-systeemi on valmis. Seuraavaksi: parempaa analytiikkaa, A/B-testausta sähköpostivariaatioille, ja mahdollisesti multi-channel (LinkedIn DM:t sähköpostin rinnalle).

---

**Kiinnostaako kokeilla?**

Jos haluat tavoitella B2B-asiakkaita nykyistä tehokkaammin — tai ylipäätään mietit onko tällainen työkalu sulle järkevä — laita viestiä.

Telegram: [@jnej89](https://t.me/jnej89)
Sähköposti: juuso@jaakkola.xyz

Ei sitoutumista. Ei myyntipuhetta. Kerron mitä tämä oikeesti vaatii ja onko siitä sua varten.

---

*Juuso Jaakkola on suomalainen devaaja joka rakentaa työkaluja automatisoidakseen liiketoiminnan tylsät osat. Tämä postaus syntyi koska joku kysyi "miksi sä rakensit tuon" ja hän tajusi ettei ollut koskaan selittänyt sitä kunnolla.*
