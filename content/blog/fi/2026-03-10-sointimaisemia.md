---
title: "Sointimaisemia — miksi rakensin sovelluksen joka kuuntelee mieltäsi"
date: "2026-03-10"
excerpt: "Serene Soundscapes alkoi viikonlopun kokeilusta ja muuttui päivittäiseksi työkaluksi. Tässä mitä se on, miksi se syntyi, ja miksi meditaation ja koodin risteyskohdassa tapahtuu nyt jotain mielenkiintoista."
---

En lähtenyt rakentamaan meditaatiosovellusta. Lähdin ymmärtämään ääntä.

Se alkoi binauraalisista beateista — tästä oudosta ilmiöstä jossa kaksi hieman eri taajuutta kummassakin korvassa luo kolmannen "fantomitaajuuden" jonka aivosi vain... valmistavat. Delta syvään uneen. Theta luovaan flowhun. Alpha rauhalliseen keskittymiseen. Päädyin uteliaisuudesta fysiikkaan, neuroscienceen, ja jossain vaiheessa aloin miettiä: entä jos voisin generoida näitä dynaamisesti? Selaimessa, Web Audio API:a käyttäen — tämä hädin tuskin dokumentoitu kulma webistä johon useimmat devaajat ei koskaan koske.

Uteliaisuudesta tuli **Serene Soundscapes**.

## Mitä Se Oikeasti On

Serene Soundscapes on web-sovellus joka generoi personoituja sointimaisemia meditaatioon ja keskittymiseen. Ei ennalta nauhoitettuja äänitiedostoja — *generoituja*. Reaaliaikainen synteesi Web Audio API:lla, kerrostettuna noisegeneraattoreilla (brown, pink, white noise), ja sekoitettuna klassiseen Solfeggio-taajuusasteikkoon (396 Hz:stä 852 Hz:iin, jokaisella omat väitetyt parantavat ominaisuutensa — en ole tässä todistamassa metafysiikkaa, mutta taajuudet kuulostavat oikeasti erilaisilta).

Keskeiset ominaisuudet:

- **Binauraalibeatti-moottori** — valitse aivotilasi (delta, theta, alpha, beta, gamma) ja sovellus generoi tarvittavat tarkat taajuudet, panoroimalla ne vasemmalle ja oikealle kirurgisella tarkkuudella.
- **Solfeggio-taajuus-miksaus** — kerrost päälle mitä tahansa taajuutta antiikin asteikolta ja sekoita ne omaan makuun.
- **Noisegeneraattorit** — brown, pink, white noise halutulla volyymilla, kerrostettuna kaiken päälle.
- **Trataka-tila** — kynttiläkatsekontemplaatio verkkokameralla ja TensorFlow.js Face Mesh:llä. Pidä katse vakaana, kynttilän liekki reagoi keskittymiseesi. Yksinkertainen temppu mutta oikeasti tehokas — *näet* meditaatiosi laadun, et vain tunne sitä.
- **Päiväkirja** — sessioiden jälkeen kirjoita reflektioita. Ei gamifioitua, ei sosiaalista, vain sinä ja ajatuksesi.
- **PWA** — toimii offline, asennetaan puhelimeen, ei sovelluskauppaa.

Autentikointi Clerkillä. Maksut Stripellä. Tietenkin.

## Tech Stack (Devaajille Jotka Mietivät)

Frontend: **Vite + React + TypeScript + Tailwind CSS + shadcn/ui**. Käytän tätä stackia jatkuvasti — osuu sopivaan tasapainoon rakenteen ja nopeuden välillä. shadcn/ui erityisesti on aliarvostettu; se ei ole komponenttikirjasto, se on *komponentit lähdekoodina jonka omistat*. Säädän juttuja taistelematta framework-konventioita vastaan.

Backend: kevyt Node.js-palvelin portissa 9124, hoitaen sessionhallintaa ja osaa äänenkäsittelystä jota ei järkevää tehdä client-sidella.

Ääni: **Web Audio API** — todellinen sankari. Tämä API on absoluuttinen peto. `OscillatorNode` puhtaille toneille, `BiquadFilterNode` noisen muotoiluun, `GainNode` miksaukseen, `ConvolverNode` reverbiin (koska kuiva binauraalibeatti kuulostaa kliiniseltä ja väärältä). Selain on syntetisaattori. Useimmat eivät tiedä.

Kasvojenseuranta: **TensorFlow.js Face Mesh**. Kokeilin ensin muutamia lähestymistapoja ja törmäsin viiveongelmiin — tarvitset reaaliaikaisen suorituskyvyn jotta kynttilä tuntuu responsiiviselta. Face Mesh antoi tarvitsemani 468-pisteen tarkkuuden hyväksyttävällä nopeudella modernilla raudalla.

Deployattu **Dokploylle** GitHub Actionsin hoitaessa CI/CD:n. Pidän siitä että on self-hostattava. Infrastruktuuri on tarpeeksi yksinkertainen että yksi henkilö voi omistaa sen kokonaan.

## Miksi Yhdistää Meditaatio ja Tech?

Tässä on osa jota on mielenkiintoisinta ajatella.

Meditaatiosovellukset on yleensä suunniteltu ihmisiltä jotka on huonoja sekä meditaatiossa *että* softassa. Niissä on gamifioidut sarjat ja ilmoitukset ja sosiaaliset ominaisuudet ja kaikki tämä kohina (ironista, meditaatiosovellukselle) kerrostettuna geneeristen ambient-äänien päälle. Ne tuntuu tuottavuustyökaluilta zen-maalilla.

Mä rakensin tämän koska halusin jotain mitä itseasiassa käyttäisin. Olen devaaja — elän terminalissa, selaimessa, koodieditorissa. Erillinen "wellness"-sovellus eri laitteella eri kontekstissa ei sovi workflowhoni. Mutta web-sovellus jonka voin avata välilehdessä työskennellessäni, tai vetäistä puhelimelle ennen nukkumaanmenoa, tai castata kaiuttimelle — se sopii.

Enemmän kuin se: pidän että selaimen ääniympäristönä on oikeasti alihyödynnetty. Web Audio API on tarpeeksi voimakas tekemään asioita jotka olisivat vaatineet hardware-syntetisaattorin tai Pro Tools -rigin viisitoista vuotta sitten. Useimmat devaajat ei tiedä sen olemassaoloa. Useimmat wellness tech on rakennettu ei-teknisten ihmisten toimesta valmiista assetsista. Päällekkäisyys — ihmiset jotka ymmärtävät sekä taidetta että insinööritieteitä — on pieni.

Siksi haluan olla siellä. En rakentamassa meditaansofty *devaajille*, vaan rakentamassa samalla käsityötaidolla ja intentionaalisuudella jota soveltaisin mihin tahansa vakavaan projektiin, sovellettuna johonkin joka oikeasti vaikuttaa siihen miten voin.

## Kynttiläjuttu

Trataka on epätavallisin ominaisuus ja haluan puolustaa ideaa.

Kynttilän katselu on muinainen käytäntö. Tuijota liekkiä, anna silmiesi rentoutua, huomaa kun mielesi harhailee. Yksinkertaista. Ongelma: et tiedä teetkö sitä "oikein". Mielesi harhailee etkä edes huomaa koska olet, no, meditatiivisessa tilassa. Palautekierto on heikko.

Silmienseuranta korjaa tämän. TensorFlow.js Face Mesh antaa sinulle 468 kasvokohtaa noin 30 fps:llä. Käytän silmäkohtia tunnistamaan katseen vakauden. Kun silmäsi on vakaa, liekki palaa kirkkaammin. Kun ne harhailevat, liekki lepattaa. *Näet* harjoituksesi. Se on visuaalista.

Olen käyttänyt sitä viikkoja ja se on ominaisuus joka sai minut oikeasti ylläpitämään päivittäistä rutiinia, enemmän kuin yhtään mitä muuta mitä olen kokeillut.

## Mitä Opin

Serene Soundscapesin rakentaminen opetti asioita joita en odottanut oppivani:

**Web Audio API on syvä.** Löydän jatkuvasti uusia kulmia. Stereo-pan, Doppler-effektit, akustisten tilojen fysikaalinen mallintaminen. On koko maailma audio-ohjelmointia jota desktop-softa ennen omisti ja jota selain nyt hiljaisesti imee.

**Reaaliaikainen kasvojenseuranta selaimessa on nyt oikeasti hyvää.** TensorFlow.js modernilla läppärillä pyörittää Face Mesh:tä ilman hikoilua. Latenssi on tarpeeksi alhainen interaktiivisiin sovelluksiin. Tämä ei pitänyt paikkaansa kolme vuotta sitten.

**Yksinkertainen voittaa monimutkaisen.** Tehokkaimmat sointimaisemat on usein vain binauraalibeatti ja brown noise. Uppotin viikkoja monimutkaisten miksausjärjestelmien rakentamiseen ja käyttäjät jotka jäivät halusivat enimmäkseen vain puhtaan delta-presetin ja hellän noise-pohjaisen. Ominaisuuksien rajoittaminen on vaikeeta kun rakastaa rakentamista.

## Mitä Seuraavaksi?

En tiedä vielä. En jahtaa lanseerausta, en optimoi latausten perään. Käytän sitä. Se ratkaisee oikean ongelman minulle — parempaa unta, helpompaa keskittymistä, vähän vähemmän hektistä suhdetta omiin ajatuksiin.

Jos se resonoi sua, sovellus osoitteessa **o.valuebit.net**. Ilmainen taso on täysi kokemus — kaikki generaattorit, Trataka-tila, päiväkirja. Maksullinen taso avaa pidemmät sessiot, offline-tilan, ja premium-presetit joita rakennan.

Jos olet devaaja joka on kiinnostunut äänen, ML:n ja selaimen risteyskohdasta — ota yhteyttä. Pidän että tässä on paljon tutkimatonta aluetta ja haluaisin nähdä mitä muut rakentavat näillä työkaluilla.

Liekki on vakaa. Katsotaan mihin tämä menee.
