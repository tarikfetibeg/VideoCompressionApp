# Aplikacija v2: stabilizacija i resursni budžet

## 1. Cilj ove faze

Ova faza uvodi poboljšanja 1-6 iz razvojnog prijedloga, bez AI indeksiranja i
analize sadržaja iz tačke 7. Prioritet je pouzdan svakodnevni rad na trenutno
ograničenom serveru i RTX 3060 računaru. Nijedna migracija u ovoj fazi ne briše
master, final, preview, HLS, thumbnail ili scrub fajlove.

Implementirano je:

1. ciljano razdvajanje velikih modula na servisne granice;
2. lagani Admin health i runtime monitoring;
3. kontrolisan desktop updater, release provjera i dijagnostički izvještaj;
4. resumable desktop upload sa trajnim lokalnim redom;
5. prioritetni `Moj rad`, rundown/correction događaji i jasnije notifikacije;
6. ručni tehnički QC i potvrda preuzimanja Storyboarda u montažu.

AI transkripcija, OCR, prepoznavanje lica/scena i semantička pretraga nisu
implementirani. Njihovo uvođenje zahtijeva zasebno mjerenje CPU/GPU, storage i
operativnih troškova.

## 2. Optimizacija koda bez rewritea

Nove domenske funkcije izdvojene su u male servise umjesto daljeg širenja
postojećih route fajlova:

- `runtimeMetricsService` prikuplja samo ograničene in-process agregate;
- `platformOverviewService` objedinjuje Admin health podatke;
- `desktopVersionService` centralno računa pilot/stable/minimum verziju;
- `directFinalTransferService` priprema i završava resumable final upload;
- `myWorkActionService` čisto i testabilno prioritizira sljedeće akcije;
- `technicalQcService` izoluje FFprobe/FFmpeg analizu od HTTP i queue sloja.

Admin uređaji koriste TanStack Query za server state i TanStack Virtual za
veliku desktop listu. Time se ne renderuje svaki računar odjednom i ne uvodi se
nova aplikacijska arhitektura na rizičan način.

## 3. Lagani monitoring

`GET /api/v2/admin/platform/health` vraća:

- MongoDB dostupnost i vrijeme pinga;
- slobodni media disk;
- RSS/heap memoriju Node procesa;
- event-loop p50/p95/p99;
- broj aktivnih API zahtjeva;
- do 12 najsporijih ruta i 20 zadnjih sporih/neuspjelih zahtjeva;
- online desktop/edge uređaje, transfere i EventOutbox backlog.

Monitoring nema vanjski collector ni novu bazu. Memorija je tvrdo ograničena na
200 route agregata i 40 internih sporih zapisa. Admin ekran polluje svakih 30
sekundi samo dok je tab vidljiv. Restart API procesa namjerno resetuje ove
kratkoročne metrike; Audit Log i poslovni događaji ostaju trajni.

## 4. Desktop release i dijagnostika

Server izračunava update policy za `pilot` ili `stable` kanal. Desktop ga
provjerava svakih šest sati, a Tauri updater se poziva samo kada je na serveru
konfigurisan HTTPS endpoint i javni ključ.

Komande:

```powershell
npm run desktop:release:check
npm run desktop:release:prepare
npm run desktop:build:release
```

Potrebne tajne/varijable:

- `TAURI_UPDATER_ENDPOINT` mora biti HTTPS;
- `TAURI_UPDATER_PUBLIC_KEY` je javni verifikacijski ključ;
- `TAURI_SIGNING_PRIVATE_KEY` i lozinka ostaju samo u CI/secret storeu;
- `WINDOWS_CERTIFICATE_THUMBPRINT` potpisuje Windows installer;
- `DESKTOP_STABLE_VERSION`, `DESKTOP_PILOT_VERSION` i
  `DESKTOP_MINIMUM_VERSION` kontrolišu rollout.

Generisani `tauri.release.conf.json` je ignorisan u Gitu. Release skripta
namjerno prekida build ako nedostaje ključ, HTTPS endpoint ili Authenticode
certifikat. Admin može iz modula `Desktop i Edge` izvesti JSON dijagnostiku u
Windows Downloads folder. Izvještaj ne sadrži access/refresh tokene ni tajne.

## 5. Resumable desktop upload

Desktop final upload sada koristi tus 1.0 u komadima od 8 MiB:

1. API validira rolu, kategoriju, program, datum, naziv i maksimalnu veličinu.
2. Kreira se idempotentni `TransferSession` i Video placeholder.
3. Kratkotrajni potpisani token je vezan za tačan transfer, korisnika i video.
4. Svaki TUS HEAD/PATCH ponovo provjerava token, aktivan status i upload ID.
5. Server prije upisa provjerava naziv i ukupnu veličinu fajla.
6. Nakon zadnjeg komada postojeći video processing queue preuzima obradu.

Desktop SQLite čuva transfer ID, server URL, potvrđeni offset i metadata. Zbog
browser sigurnosnog modela sadržaj lokalnog `File` objekta se ne smije trajno
čuvati; nakon restarta korisnik jednom ponovo izabere isti fajl. Naziv i veličina
moraju odgovarati, a upload se nastavlja od serverom potvrđenog offseta.

Defaulti su namjerno konzervativni:

- `MAX_UPLOAD_SIZE_GB=25` ako nije drugačije postavljeno;
- transfer token vrijedi 48 sati;
- server transfer zapis/temp recovery prozor vrijedi 7 dana;
- najviše 30 lokalnih recoverable upload zapisa po korisniku;
- jedan aktivni upload iz UI reda, bez paralelnog zagušenja diska.

Browser klijent zadržava postojeći multipart endpoint radi kompatibilnosti.

## 6. Moj rad i poslovne notifikacije

`Moj rad` sada vraća najviše 12 dedupliciranih prioritetnih akcija. Redoslijed je:

1. critical notifikacije i istekao rok;
2. action-required notifikacije i nove ispravke;
3. urgent/correction jobovi i rok unutar četiri sata;
4. informativni kontekst ostaje u postojećim sekcijama.

Rundown add/reorder/replace/remove/status događaji ulaze u EventOutbox. Promjena
nakon već preuzetog air paketa je `critical`; ostale relevantne izmjene su
`action_required`. Correction prijava obavještava Producenta, odgovornog
montažera i reportera prema postojećim pravilima, bez emaila ili dodatnog servisa.

## 7. Tehnički QC sa malim opterećenjem

Tehnički QC je pomoć za ljudski pregled, nije automatska odluka o emitovanju.
Analizira postojeći MP4 preview kad god postoji, pa tek onda compressed/master/raw.

FFmpeg detektuje:

- crne kadrove (`blackdetect`);
- zamrznutu sliku (`freezedetect`);
- dužu tišinu (`silencedetect`);
- približnu integrisanu glasnoću i true peak (`ebur128`).

Resursna pravila:

- `TECHNICAL_QC_AUTO=false` je produkcijski default;
- ručno pokretanje ide kroz zaseban queue sa concurrency 1;
- FFmpeg koristi jedan thread i jedan filter thread;
- `TECHNICAL_QC_MAX_SECONDS=300` ograničava analizu na prvih pet minuta;
- rezultat jasno označava kada je analiziran samo dio videa;
- QC greška ne obara ingest, HLS niti postojeći video.

Ako mjerenja pokažu dovoljno rezerve, `TECHNICAL_QC_AUTO=true` se može pilotirati
na malom broju novih klipova. Ne povećavati concurrency prije CPU/disk mjerenja.

## 8. Storyboard i Premiere handoff

Reporter i dalje verzionira i šalje Storyboard. Dodijeljeni montažer sada bira
`Preuzmi u montažu`, čime se verzija zaključava kao referenca i reporter dobija
notifikaciju. Producent/Admin mogu `Ponovo otvori` samo uz obrazloženje; reporter i
montažer tada dobijaju novi događaj. Obje akcije ulaze u Audit Log.

Preuzimanje ne pokreće render i ne kopira media fajlove. Premiere workspace ostaje
odvojena, eksplicitna korisnička akcija, pa ovaj workflow praktično ne povećava
CPU/GPU opterećenje.

## 9. Novi i prošireni interfejsi

- `GET /api/v2/admin/platform/health`
- `GET /api/v2/devices/update-policy/current`
- `POST /api/v2/uploads/direct-final`
- `POST /api/v2/uploads/transfers/:transferId/resume`
- `POST /api/v2/uploads/files` i `HEAD|PATCH /api/v2/uploads/files/:uploadId` (tus)
- `GET /api/v2/technical-qc/summary`
- `GET /api/v2/technical-qc/:videoId`
- `POST /api/v2/technical-qc/:videoId/run`
- `POST /api/v2/edit-jobs/:jobId/rough-cut/acknowledge`
- `POST /api/v2/edit-jobs/:jobId/rough-cut/reopen`

Postojeći API ugovori ostaju aktivni. `GET /api/v2/my-work` je samo aditivno
proširen sa `actionQueue` i `summary.actionRequired`.

## 10. Rollout

1. Napraviti backup MongoDB-a i potvrditi da media storage ostaje izvan bilo
   kakve migracijske skripte.
2. Deployati kod sa `TECHNICAL_QC_AUTO=false`.
3. Pokrenuti `npm run indexes:create` u kontrolisanom terminu.
4. Provjeriti Admin `Desktop i Edge > Health` bez aktiviranja QC-a.
5. Prekinuti testni upload na 30-70%, restartovati desktop, ponovo odabrati isti
   fajl i potvrditi nastavak.
6. Ručno pokrenuti tehnički QC na jednom kratkom previewu i jednom 5+ min klipu.
7. Testirati Storyboard submit, acknowledge, reporter notifikaciju i reopen.
8. Tek nakon pilot mjerenja pripremiti i potpisati desktop release.

## 11. Rollback

- Postaviti `TECHNICAL_QC_AUTO=false` i zaustaviti samo technical QC worker.
- Stari desktop klijent nastavlja koristiti legacy multipart upload.
- Nepotpuni tus fajlovi ostaju u `storage/temp/resumable-uploads` do kontrolisanog
  maintenance čišćenja; rollback ih ne briše automatski.
- Vratiti prethodni desktop `stable` endpoint/verziju; ne brisati Device ili
  TransferSession zapise.
- Novi Video metadata, health agregati i `lockedBy` su aditivni i stari kod ih
  može ignorisati.

## 12. Reference

- [tus resumable upload protocol](https://tus.io/protocols/resumable-upload)
- [Tauri updater](https://v2.tauri.app/plugin/updater/)
- [Tauri Windows code signing](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri SQL plugin](https://v2.tauri.app/plugin/sql/)
- [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/overview)
- [TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction)
- [Node.js monitorEventLoopDelay](https://nodejs.org/docs/latest-v20.x/api/perf_hooks.html#perf_hooksmonitoreventloopdelayoptions)
- [Node.js process memoryUsage](https://nodejs.org/docs/latest-v20.x/api/process.html#processmemoryusage)
- [FFmpeg video/audio filters](https://ffmpeg.org/ffmpeg-filters.html)
- [EBU R128 loudness recommendation](https://tech.ebu.ch/publications/r128)
- [MongoDB TTL indexes](https://www.mongodb.com/docs/manual/core/index-ttl/)
