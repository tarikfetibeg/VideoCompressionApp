# Objedinjavanje Web optimizacija na main

Datum: 17.10.2026.

## Sta se prenosi

Rad iz `codex/Web-Optimizacija` objedinjuje se na `main`, koji ostaje glavna
grana repozitorija. Obuhvat je aplikacijski kod, regresijski testovi,
izolovani QA alati, zavrsni QA sazeci/inventar, runbookovi i Windows launcher.
Osnovni commit prije ovog prijenosa je `e81a765`.

`codex/UXpoboljsanja` je na osnovnom commitu i nema jedinstvenih commitova
koji bi se izgubili brisanjem nakon prijenosa. Njena historija ostaje u
precima grane `main`. Stara grana uklanja se lokalno i na `origin`, prema
izricitom zahtjevu korisnika. Ostale grane i Heroku remote se ne mijenjaju.

## Lokalne datoteke ostaju lokalne

- `.env` i njegove varijante, tajne, storage i video materijal ne ulaze u commit.
- Node dependencies i generisani frontend build ne ulaze u commit.
- Novi diplomski DOCX/PDF fajlovi, renderi, browser profili i scratch fajlovi
  ostaju u worktreeju, bez brisanja i bez objave na GitHubu. Ranije praceni
  akademski artefakti ostaju nepromijenjeni; ne prepisuje se historija.
- Generisani QA run folderi, traceovi, screen captureovi i privatna QA
  konfiguracija ostaju lokalni. Objavljuju se zavrsni tekstualni/JSON/CSV
  sazeci i inventar. Putanje ka sirovim dokazima u izvjestajima oznacavaju
  lokalne artefakte, ne obecanje da su svi ti fajlovi u Git repozitoriju.
- Nepraceni `apps/`, `packages/` i `frontend/dist/` u glavnom folderu nisu
  dio ovog prijenosa i ne uklanjaju se.

## Glavni folder aplikacije

Glavni checkout je `C:\Users\tarik\Desktop\v2\VideoCompressionApp`.
Nakon commita i fast-forward prijenosa na `main` taj checkout treba koristiti
`main`, a ne staru UX granu. `frontend/build` treba ponovo izgraditi u tom
folderu, jer Git ne prenosi build iz Codex worktreeja.

Postojeca lokalna konfiguracija i storage ostaju na svom mjestu. Aplikacija
se ne pokrece automatski. Prilikom sljedeceg starta koristi se root
`Pokreni aplikaciju.cmd` ili `npm run start:all`. Ako je neki server vec bio
pokrenut, njegov proces treba kontrolisano ponovo pokrenuti nakon zavrsetka
aktivnih obrada i transfera da bi ucitao novi backend kod.

## Provjere i operativne granice

- Frontend build i svih 50 frontend testova prolaze u launcher ciklusu.
- Prolaze 12 backend i osam launcher regresijskih testova.
- QA izvjestaji jasno razlikuju ranije dugotrajne prolaze, kratke retestove,
  prihvacene rizike i blokirane scenarije. Novi dugotrajni testovi se ne
  pokrecu u ovom prijenosu, prema ranijoj korisnickoj odluci.
- Git prijenos i build ne izvrsavaju produkcijske migracije, backfill,
  cleanup ili dependency nadogradnje. Posebno ostaje odvojena kontrolisana
  [DownloadTicket TTL migracija](DOWNLOAD_TICKET_RETENCIJA_RUNBOOK.md).
- Nova Git historija ne znaci sigurnosnu certifikaciju; prihvaceni rizici
  i preostale QA granice ostaju u [QA izvjestaju](QA_FUNKCIONALNI_CIKLUS_2026_10.md).
