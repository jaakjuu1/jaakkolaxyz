---
title: "Agentiton palvelinoperointi: miten ohjaan tuotantoa Telegramista SSH:n yli"
date: "2026-05-22"
excerpt: "Kuvaus käytännön mallista, jossa Hermes toimii paikallisena ohjaamona, palvelimille ei asenneta ylimääräistä agenttia, ja tuotantomuutokset tehdään diffin, validoinnin, backupin ja rollbackin kautta."
tags: ["Hermes", "SSH", "DevOps", "tuotanto", "agentit"]
---

# Agentiton palvelinoperointi: miten ohjaan tuotantoa Telegramista SSH:n yli

Viime aikoina olen rakentanut omaa tapaa käyttää AI-agentteja tuotantopalvelinten operointiin. Ei niin, että jokaiseen palvelimeen asennetaan uusi agentti, daemon, hallintapaneeli ja pieni digitaalinen tonttu vahtimaan lokia. Vaan yksinkertaisemmin:

```text
Telegram → paikallinen Hermes → SSH → palvelin
```

Hermes pyörii omalla koneellani WSL-ympäristössä. Kun pyydän sitä tarkistamaan tai valmistelemaan muutoksen palvelimelle, se ottaa SSH-yhteyden samaan tapaan kuin minäkin ottaisin. Palvelimella ei tarvitse olla erillistä Hermes-asennusta.

Tämä kuulostaa pieneltä arkkitehtuurivalinnalta, mutta käytännössä se muuttaa paljon.

## Miksi ei remote-agenttia jokaiselle palvelimelle?

Erillisen agentin asentaminen jokaiseen tuotantokoneeseen tuo nopeasti mukanaan kysymyksiä:

- miten agentti päivitetään?
- mitä oikeuksia sillä on?
- kuka valvoo sen lokit?
- mitä tapahtuu, jos se kaatuu?
- mitä tapahtuu, jos se ei kaadu vaan toimii liian innokkaasti?

Viimeinen on usein vaarallisin. Rikki oleva automaatio on helppo huomata. Liian itsevarma automaatio ehtii joskus tehdä töitä ennen kuin kukaan ehtii kysyä miksi.

Siksi nykyinen malli on agentiton: tuotantopalvelimilla riittää SSH, normaalit Unix-työkalut ja tarvittaessa `tmux` pitkäkestoisiin sessioihin.

## Read-only ensin

Ensimmäinen sääntö on yksinkertainen: katso ennen kuin kosket.

Kun palvelimella on ongelma, Hermes ei aloita korjaamalla. Se aloittaa lukemalla:

```bash
hostname
uptime
df -h
free -h
systemctl --failed
docker ps
docker service ls
journalctl --since '1 hour ago' -p warning
```

Näistä syntyy tilannekuva: mikä palvelin on kyseessä, mitä siellä pyörii, mikä näyttää poikkeavalta ja mikä on luultavasti normaalia kohinaa.

Tämä sama malli on myös päivittäisessä aamukatsauksessa. Ensin ajetaan deterministiset health checkit. Vasta jos jokin on `WARN` tai `CRITICAL`, tehdään syvempi SSH-diagnostiikka kyseiselle hostille.

## Tiedostojen muokkaus: diff ennen draamaa

Kun palvelimelle pitää tehdä muutos, suora live-editointi on viimeinen vaihtoehto, ei ensimmäinen refleksi.

Turvallinen muutosprosessi menee näin:

1. luetaan nykyinen tiedosto
2. tehdään paikallinen kopio
3. muokataan kopiota
4. näytetään diff
5. validoidaan muutos
6. tehdään backup remote hostilla
7. kirjoitetaan muutos atomisesti
8. reloadataan tai restartataan vain hyväksynnällä
9. varmistetaan toiminta
10. pidetään rollback-polku valmiina

Käytännössä esimerkiksi Caddy-konfiguraation muutos voisi näyttää tältä:

```bash
ssh teppo-server 'sudo cat /etc/caddy/Caddyfile' > Caddyfile.original
cp Caddyfile.original Caddyfile.edited
# muokataan Caddyfile.edited paikallisesti
diff -u Caddyfile.original Caddyfile.edited
```

Sitten validoidaan:

```bash
caddy validate --config Caddyfile.edited
```

Ja vasta sen jälkeen tehdään tuotantoon kirjoitus:

```bash
scp Caddyfile.edited teppo-server:/tmp/Caddyfile.new
ssh teppo-server 'sudo cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.20260522-120000'
ssh teppo-server 'sudo install -o root -g root -m 0644 /tmp/Caddyfile.new /etc/caddy/Caddyfile'
ssh teppo-server 'sudo systemctl reload caddy'
```

Jos jokin menee pieleen, rollback ei ole mielentila vaan komento:

```bash
ssh teppo-server 'sudo install -o root -g root -m 0644 /etc/caddy/Caddyfile.bak.20260522-120000 /etc/caddy/Caddyfile && sudo systemctl reload caddy'
```

## AI-agentin rooli ei ole olla root-humppaaja

Tässä mallissa AI-agentti ei ole maaginen pääkäyttäjä, joka saa tehdä mitä huvittaa. Sen rooli on pikemminkin:

- kerätä faktat
- ehdottaa muutosta
- valmistella diff
- listata riskit
- kertoa validointi
- kirjoittaa rollback-komento
- pyytää hyväksyntä ennen tuotantovaikutusta

Tämä on arkisempi visio AI-agenteista kuin moni demo antaa ymmärtää. Mutta juuri siksi se on käyttökelpoisempi. Tuotantoympäristössä tylsä on usein kaunis sana.

## Dev-tiimi mukaan portteihin

Olen rakentanut Hermekseen myös erillisiä dev-profiileja. Niiden kanssa tuotantomuutos voidaan jakaa selkeisiin rooleihin:

- `dev-devops` tekee read-only discoveryn ja muutossuunnitelman
- `dev-reviewer` tarkistaa diffin, riskin ja rollbackin
- pääagentti ajaa hyväksytyn muutoksen vasta luvan jälkeen

Tämä tekee agenttityöstä vähemmän “yksi botti teki jotain” ja enemmän pienen tiimin prosessin:

```text
havainto → suunnitelma → review → hyväksyntä → apply → verify → rollback-valmius
```

## Miksi Telegram?

Telegram ei ole tässä komentorivi. Se on ohjauspinta.

Voin kirjoittaa:

```text
Tarkista hostingerin tila ja tee read-only deep dive jos jokin näyttää oudolta.
```

Tai:

```text
Valmistele Caddy-muutos ja näytä diff ennen kuin kosket tuotantoon.
```

Hermes tulkitsee pyynnön, ajaa tarvittavat SSH-komennot paikalliselta koneelta, ja palauttaa yhteenvedon takaisin keskusteluun.

Tärkeä ero on tämä: luonnollinen kieli ei poista tuotantoprosessia. Se tekee prosessin käynnistämisestä helpompaa.

## Hyvä automaatio hidastaa oikeassa kohdassa

Tämän setupin tavoite ei ole tehdä tuotantomuutoksista holtittoman nopeita. Tavoite on tehdä niistä toistettavia.

Nopea pitää olla havainnoinnissa:

- mikä on rikki?
- missä se on rikki?
- mitä muuttui?
- mikä on seuraava turvallinen askel?

Hidas pitää olla vaikutuksessa:

- kirjoitetaanko tiedostoon?
- reloadataanko palvelu?
- restartataanko kontti?
- ajetaanko migraatio?

Agentti saa auttaa ensimmäisessä paljon. Toisessa sen pitää osata pysähtyä.

## Yhteenveto

Tämä malli on tarkoituksella yksinkertainen:

- ei ylimääräistä agenttia tuotantopalvelimille
- SSH riittää
- read-only ensin
- diff ennen muutosta
- backup ennen kirjoitusta
- validointi ennen reloadia
- rollback ennen rohkeutta
- dev-tiimi review-portiksi, kun muutos on isompi

Se ei ole näyttävin mahdollinen agenttiarkkitehtuuri. Mutta se on sellainen, jonka kanssa uskaltaa elää maanantaiaamuna.

Se on usein parempi mittari kuin demo perjantaina.
