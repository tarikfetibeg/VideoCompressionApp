# Download ticket: URL i retencija statusa

## Zasto su dva roka

`expiresAt` ostaje sigurnosni rok URL-a: default 15 minuta. Nakon njega novi
HTTP zahtjev dobija 410, ali vec otvoreni stream se ne prekida niti proglasava
isteklim samo zbog roka linka. JWT i dalje traje jedan sat, bez refresh toka.

`purgeAt` je zaseban rok brisanja dokumenta za pracenje. Novi ticket ima
retenciju 24 sata; aktivni stream svakih 60 sekundi osvjezava `lastUsedAt`
i `purgeAt`. Finish/abort/failure pomjera purgeAt na 24 sata nakon zavrsetka.
Heartbeat ne produzava URL niti JWT. Ako server dugo ne potvrdi aktivnost,
UI upozorava da treba provjeriti browser download manager; ne pretpostavlja
da je fajl fizicki sacuvan. Timer se uklanja pri finish/close i ne drzi sam
proces aktivnim. Prekinuti transfer se namjerno ponavlja, bez obecanja ZIP resumea.

## Potvrdjen bug i QA dokaz

Run `2026-10-10T21-08-42-880Z-f9fea7` drzi otvoren disposable 64MiB transfer,
zatim mijenja URL rok u proslost. Stari status endpoint vraca `expired` i
pogresnu poruku da link nije koristen, dok je fizicki stream jos otvoren.
Stari TTL na expiresAt mogao je potom ukloniti i sam tracking dokument.

Popravka je odobrena od korisnika. Novi test provjerava 410 za novi zahtjev,
started za vec otvoreni stream, stvarni 60-sekundni heartbeat, 24h retenciju
nakon aborta i zasebno dry-run/apply migraciju. Nema stvarnih korisnickih fajlova.

## Obavezna kontrolisana migracija

Promjena schema indexa NE uklanja postojeci MongoDB TTL. `indexes:create`
takodjer ne uklanja stare indexe. Ako stari expiresAt TTL ostane, long-transfer
pracenje i dalje nije pouzdano. App startup ispisuje upozorenje, ali ne
pokrece migraciju i ne mijenja produkcijsku bazu automatski.

1. Dogovoriti maintenance termin bez aktivnih produkcijskih downloada.
2. Napraviti i provjeriti backup baze i popis trenutnih indexa.
3. Deploy novog koda sa autoIndex iskljucenim.
4. U odgovarajucem okruzenju izvrsiti dry-run:

   `npm run downloads:retention-migrate`

5. Provjeriti prijavljene legacy TTL indexe i broj dokumenata bez purgeAt.
6. Tek nakon stvarnog backupa namjerno primijeniti:

   `npm run downloads:retention-migrate -- --apply --backup-confirmed`

7. Potvrditi da nema single-field TTL na expiresAt, da postoji
   `download_ticket_retention_idx` na purgeAt sa `expireAfterSeconds: 0`, i
   da tokenHash unique i user/status indexi nisu promijenjeni.
8. Restartovati aplikaciju i testirati single/ZIP/OFF/edit/air download,
   expiry prije starta, expiry tokom streama, prekid i namjerni retry.

`--backup-confirmed` je potvrda operatera, ne komanda koja pravi backup.
Skripta mijenja samo DownloadTicket kolekciju/indexe, ne Video/job/media
fajlove. Legacy zapisi bez purgeAt dobijaju jednokratnu grace retenciju
24 sata od migracije. URL rok i dozvole ostaju netaknuti. Ponovni apply je
idempotentan. Dry-run nema data/index write. Ako apply djelimicno padne,
popraviti uzrok i ponoviti nakon pregleda; nema slijepog `syncIndexes()`.

## Rollback i granice

Frontend rollback je kompatibilan s dodatnim status poljima. Backend/index
rollback planirati posebno: ne vracati expiresAt TTL dok postoje aktivni
transferi. On ponovo uvodi originalni bug. Stari backend bez purgeAt polja
za nove zapise moze ostaviti tracking dokumente bez retencije; potrebno je
uskladiti kod i indexe, ne samo vratiti jednu schema datoteku.

24h metadata retencija nije backup niti oporavak samog fajla. Browser je
izvor istine za fizicki save. Server restart, DB outage, paralelni zahtjevi
istim tokenom i remote mreza imaju dodatne scenarije; ovaj test ne tvrdi
njihovu potpunu pokrivenost. Produkcijska migracija u ovom QA ciklusu nije izvrsena.

## Pregledane reference

Provjera: 10.10.2026.

- [MongoDB TTL indexes](https://www.mongodb.com/docs/manual/core/index-ttl/):
  single-field datum, brisanje u pozadini i moguce kasnjenje. Primjena:
  DownloadTicket.purgeAt i kontrolisana zamjena starog URL-expiry TTL-a.
- [Node.js 20.16.0 timers](https://nodejs.org/download/release/v20.16.0/docs/api/timers.html#timeoutunref):
  `unref()`/`clearInterval` u downloads route heartbeat-u; timer nije zamjena
  za finish/close obradu. Koristi se pregledana verzijska adresa, ne neispravni latest-v20 link.
