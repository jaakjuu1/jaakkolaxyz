# Keho & palautus — kirjastosta sähköpostiin (P0)

## Mitä tapahtuu

1. Joku partnereista kutsuu `POST /api/ateneum/body-practice/propose`
2. Palvelin valitsee kirjastosta **2 treeniä + 2 rentoutusta** (viikkokierto)
3. Luo niistä **mutual activities** (proposer hyväksyy automaattisesti)
4. Lähettää **lyhyen sähköpostin molemmille** (otsikko + aika + ohje ≤160 merkkiä)
5. Kun toinenkin hyväksyy → olemassa oleva kalenterikirjoitus

## API

```http
GET  /api/ateneum/body-practice/library
POST /api/ateneum/body-practice/propose
Body (optional):
  { "includeConnection": false, "sendEmail": true, "force": false }
```

## Tiedostot

- `server/ateneum-body-library.ts` — treeni/rentoutus/yhteys -kortit
- `server/ateneum-body-program.ts` — viikkoehdotus + activity-insert
- `server/ateneum-email.ts` → `sendBodyPracticeWeek`
- Testit: `tests/ateneum/body-practice.test.ts`

## Sähköposti

- Kind: `body_practice_week`
- Pref: `weeklySuggestion` **tai** `activityPlanned`
- Ilman AWS SES -avaimia lähetys skipataan (lokaali ok)

## Oletusaikataulu (Europe/Helsinki paikallinen)

| Päivä | Aika | Tyyppi |
|---|---|---|
| Ma | 17:30 | treeni |
| Ti | 20:00 | rentoutus |
| To | 17:30 | treeni |
| La | 10:00 | rentoutus |

## Ei vielä

- Kartoitus UI / preference filtering
- Cron automaattinen viikkolähetys
- Tuotantodeploy
