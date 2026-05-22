---
title: "Miksi rakensin Lähituottajatorin — markkinapaikan suomalaisille tuottajille"
date: "2026-02-18"
excerpt: "Suomalaisen ruoan pitäisi päätyä suomalaisen pöytään ilman kolmea välikättä. Lähituottajatori.fi yrittää tehdä siitä totta."
---

# Miksi rakensin Lähituottajatorin

Tiedostan, että tämä on tuttu tarina. _"Joku kehitti alustan, joka yhdistää tuottajat ja kuluttajat."_ Mutta se on tuttu tarina syystä. Koska se toimii. Ja koska Suomessa se on edelleen yllättävän vaikeaa.

## Missä mättää?

Käyt vaikka toreilla. Hyvä juttu. Mutta miten löydät sen yhden luomutilan Tuusulasta, joka myy parhaita porkkanoita ikinä? Entä jos haluat tilata hapankaalin suoraan tuottajalta — ilman että joku keskellä nappaa oman siivunsa?

Perinteisesti ruokaketju näyttää tältä:

```
Tuottaja → Tukku → Kauppa → Kuluttaja
```

Jokainen nuoli on komissio. Jokainen komissio on rahaa, joka ei mene tuottajalle.

**Lähituottajatori lyhentää ketjua:**

```
Tuottaja → Lähituottajatori → Kuluttaja
```

Yksi alusta. Läpinäkyvä. Reilu.

## Mitä mä rakensin

[Lähituottajatori.fi](https://lahituottajatori.fi) on markkinapaikka suomalaisille lähiruuantuottajille. Idea on yksinkertainen:

- **Tuottajat** luovat omat profiilit ja listaavat tuotteensa — hunajaa, juustoa, vihanneksia, lihaa, mitä vain
- **Kuluttajat** löytävät tuottajia sijainnin, kategorian tai haun perusteella — ja näkevät kartalla kuka on lähellä
- **Maksut** hoituu Stripellä — ei käteisrumba, ei välivaiheita

Kaikki pyörii PostgreSQL:n päällä Drizzle ORM:lla. Frontend on React + Vite + Tailwind, backend Express + TypeScript. Kartta React-Leafletillä. Hostaus Hetznerillä — VPS, PM2, Caddy. Edullinen, luotettava, omissa käsissä.

## Miksi mä tämän tein?

Turhautuminen. Ihan puhdas turhautuminen.

"Lähiruoka" on usein markkinointitermi, ei todellisuus. Kaupan hyllyllä lukee "lähituottaja" mutta tuote on kulkenut tukun kautta kolme maakuntaa. Pienet tuottajat painivat isojen kauppaketjujen ehdoilla ja menettävät marginaalinsa välikäsille.

Mä olen devaaja. Kun näen ongelman, rakennan siihen työkalun. Joku muu rakentaa traktorin — mä rakennan alustan.

Visio on selkeä: suomalaisen ruoan pitäisi päätyä suomalaisen pöytään mahdollisimman suoraan. Ja sen pitäisi olla helpompaa kuin nyt.

## Missä mennään rehellisesti?

Projekti on varhaisessa vaiheessa. Alusta toimii teknisesti — voit rekisteröityä tuottajaksi, listata tuotteita, löytää tuottajia kartalta ja ostaa Stripellä. Mutta käyttäjiä ei vielä ole tuhansia. Tämä on marketplace, ja marketplace-ongelma on tunnettu: tarvitset sekä tuottajia että kuluttajia, ja kumpikaan ei tule ensin ilman toista.

Ratkaisen sitä yksi alue kerrallaan. Ei tarvitse olla koko Suomi päivässä.

## Mitä opin (devaajille)

Jos mietit marketplace-rakentamista, tässä muutama oppi:

**Älä yliarvioi monimutkaisuutta alussa.** Drizzle + PostgreSQL + Express skaalautuu pitkälle. Älä lähde Kubernetesiin ensimmäisellä viikolla.

**Stripe-webhookit on helppo saada pieleen.** Testaa paikallisesti Stripe CLI:llä. Aina.

**Sijaintidata on tärkeämpää kuin uskot.** Kun näet kartalla että lähin hunajantuottaja on 12 km päässä — se konkretisoituu ihan eri tavalla kuin tekstilista.

**Marketplace on kaksi tuotetta samassa.** Tuottaja-työkalu JA kuluttaja-kokemus. Molemmat pitää olla kunnossa tai kumpikaan puoli ei toimi.

## Kokeile itse

[Lähituottajatori.fi](https://lahituottajatori.fi) on vapaa käyttää. Ei tilausmaksuja, ei piilokuluja.

Jos olet suomalainen tuottaja ja haluat suoran kanavan kuluttajiin — käy katsomassa sopiiko tämä sulle. Jos olet kuluttaja joka haluaa tietää mistä ruokasi tulee — sama juttu.

Ja jos haluat jutella lisää, olen [Telegramissa](https://t.me/jnej89).

---

*P.S. Jos sä luet tämän ja sä olet se tuusulalainen porkkanatilallinen — laita viestiä. Haluan tietää miltä tämä näyttää ruudun toiselta puolelta.*
