# HLS streaming, partial search i Edit Job SLA

## 1. Cilj

Ova faza rjesava cetiri problema koji postaju vidljivi sa vecim brojem klipova:

- archive search mora nalaziti rijec i kada korisnik unese samo njen pocetak;
- aktivna produkcija ne smije biti zatrpana starim jobovima;
- prijava greske realizatora mora postati pratljiv correction workflow;
- Video Details ne smije prvo preuzeti cijeli MP4 kao Blob.

Postojeci MP4 preview, endpointi i workflowi ostaju kompatibilni. HLS je dodatni,
sekundarni format, a MP4 sa HTTP Range podrskom je fallback.

## 2. Prefix search

`Video.searchPrefixes` je skriveni niz normalizovanih prefiksa. Za rijec `insert`
upisuju se `in`, `ins`, `inse`, `inser` i `insert`. Dijakritika se savija za
pretragu, pa `sp`, `spica` i `špica` mogu pogoditi naslov `Špica`.

Vise rijeci koristi MongoDB `$all`: svaki uneseni prefiks mora postojati u
dokumentu. Regex fallback se koristi samo za stare dokumente koji jos nemaju
`searchPrefixes`.

Operativne komande:

```powershell
npm run searchprefixes:backfill
npm run indexes:create
npm run indexes:explain
```

Backfill radi u batch paketima i ne zahtijeva gasenje aplikacije. Za vecu bazu
prvo pokrenuti nad staging kopijom i pratiti opterecenje MongoDB servera.

## 3. Edit Job lifecycle i SLA

`status` i `workspaceState` imaju razlicite odgovornosti:

- `status` opisuje tok montaze: submitted, claimed, in_edit, ready_for_qc itd.;
- `workspaceState` odredjuje da li je job aktivan, istekao, zatvoren ili otkazan.

Kategorije imaju `jobSlaHours`, `jobGraceHours` i `autoExpireJobs`. Pocetni
preseti su:

| Kategorija | SLA | Grace |
| --- | ---: | ---: |
| Insert | 4h | 4h |
| Prilog | 8h | 4h |
| Promo | 48h | 4h |
| Ostalo | 72h | 4h |

Eksplicitni rok koji postavi reporter ili Admin ima prednost. Scheduler pri
startu aplikacije i svakih pet minuta prebacuje dospjele aktivne jobove u
`expired`; dokument, materijal i audit trag se ne brisu.

Migracija starih jobova:

```powershell
npm run jobs:lifecycle-backfill
```

Ova skripta samo dodaje lifecycle polja. Admin nakon pregleda koristi
`Primijeni SLA`, zato se postojeci jobovi ne sklanjaju neocekivano.

## 4. Correction workflow

1. Realizator otvara pregled rundown stavke.
2. Player salje trenutni playhead uz prijavu greske.
3. Kreira se ili azurira otvoreni `CorrectionRequest`.
4. Producent uvijek vidi zahtjev u correction queueu.
5. Ako postoji izvorni job i montazer, aplikacija automatski kreira urgentni
   correction job i dodjeljuje ga istom montazeru.
6. Ako montazer nije poznat, Producent koristi `Posalji u montazu`.
7. Montazer oznacava ispravku kao spremnu za pregled.
8. Producent zamjenjuje klip u rundownu; zahtjev i correction job se zatvaraju.

Ponovljena prijava za isti otvoreni rundown item ne stvara duplikat, nego
azurira napomenu i timestamp.

## 5. HLS arhitektura

FFmpeg nakon osnovnog video processinga dobija sekundarni queue task. Task
generise:

```text
storage/hls-previews/<videoId>/
  master.m3u8
  720p/index.m3u8
  720p/segment_00000.ts
  480p/index.m3u8
  480p/segment_00000.ts
```

Rendicije su H.264/AAC, 720p i 480p, sa segmentima od cetiri sekunde. Ako HLS
generisanje padne, osnovni video ostaje zavrsen i dostupan preko MP4 Range
fallbacka.

Player prvo kreira media ticket sa rokom od dva sata. Token je u URL putanji,
u bazi se cuva samo SHA-256 hash. Svaki manifest, segment i fallback ponovo
provjerava ticket, korisnika, rolu, rok i trazeni path.

Safari koristi native HLS. Ostali podrzani browseri koriste lokalni `hls.js`.
Ako HLS nije spreman, browser dobija MP4 endpoint koji podrzava `Range` i
odgovara sa `206 Partial Content`. Video se vise ne ucitava kroz Axios Blob.

## 6. Storage procjena

Tacna velicina zavisi od trajanja i dinamike slike. Konfigurirani zbirni video
bitrate je priblizno 3.1 Mbit/s, plus audio i container overhead.

Prakticna gruba procjena:

```text
HLS GB ~= ukupno sati videa * 1.5 do 1.8 GB
```

Primjer: 1.000 klipova prosjecnog trajanja pet minuta je oko 83 sata, odnosno
otprilike 125-150 GB dodatnog HLS storagea. Prije velikog backfilla provjeriti
slobodan prostor i graditi u malim batch paketima.

## 7. Rollout

1. Napraviti backup MongoDB baze i `storage/`.
2. Instalirati frontend dependency i napraviti build:

```powershell
npm install --prefix frontend
npm run build --prefix frontend
```

3. Deployati kod sa novim modelima i rutama.
4. Pokrenuti:

```powershell
npm run searchprefixes:backfill
npm run jobs:lifecycle-backfill
npm run indexes:create
npm run indexes:explain
```

5. U Admin > Storage Maintenance > HLS streaming graditi stare klipove u batch
   paketima od 5-10.
6. U browser Network panelu potvrditi `.m3u8` i `.ts` zahtjeve. Za fallback
   potvrditi `Range` request i `206 Partial Content`.
7. Tek nakon pregleda starih jobova koristiti Admin akciju `Primijeni SLA`.

## 8. Rollback

- HLS obrada se moze zaustaviti bez uklanjanja MP4 previewa.
- Player automatski koristi MP4 fallback ako `hlsPreview.status` nije `ready`.
- HLS folderi se mogu arhivirati ili ukloniti kontrolisano nakon gasenja queuea;
  Video zapise postaviti na `hlsPreview.status=missing` prije novog builda.
- Scheduler ne brise jobove. Admin moze vratiti `expired` job u `active`.
- Prefix polje je dodatno; postojeci `searchText` ostaje sacuvan.

Ne brisati stare indexe automatski tokom rollbacka. Promjene indexa prvo
provjeriti preko `getIndexes()` i staging baze.

## 9. QA checklist

- `in`, `ins`, `inse` i `insert` nalaze isti insert.
- Viserjecni search zahtijeva sve rijeci.
- Admin moze promijeniti job status, montazera, kategoriju i rok.
- Hard delete je blokiran kada job ima finalni video ili rundown vezu.
- Istekli job nestaje iz aktivne produkcije i ostaje u Historiji.
- Realizatorova prijava sadrzi playhead i vidljiva je Producentu.
- Poznati montazer automatski dobija correction job.
- HLS kvalitet se moze ostaviti na Auto ili izabrati 720p/480p.
- Istek ticketa obnavlja stream i vraca isti timestamp.
- MP4 fallback pocinje bez preuzimanja cijelog fajla.
- Brisanje videa uklanja njegov HLS folder samo unutar storage root-a.

## 10. Reference

- [HLS.js](https://github.com/video-dev/hls.js) - MSE HLS playback, adaptive
  quality switching, seeking i error recovery.
- [FFmpeg HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-2) - VOD
  playlist i segment generation opcije.
- [RFC 8216](https://datatracker.ietf.org/doc/html/rfc8216) - HLS playlist i
  segment format.
- [MDN HTTP Range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)
  - `Range`, `Accept-Ranges`, `Content-Range` i `206 Partial Content`.
- [MongoDB `$all`](https://www.mongodb.com/docs/manual/reference/operator/query/all/)
  - zahtjev da niz sadrzi sve trazene prefikse.
- [MongoDB text index properties](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-text/text-index-properties/)
  - ogranicenja i ponasanje postojece `searchText` strategije.
- [MongoDB TTL indexes](https://www.mongodb.com/docs/manual/core/index-ttl/) -
  automatsko uklanjanje kratkotrajnih media ticketa nakon `expiresAt`.
- [Mongoose schema indexes](https://mongoosejs.com/docs/guide.html#indexes) -
  deklaracija indexa uz model; produkcijsko kreiranje u ovoj aplikaciji ipak
  ide kontrolisano kroz `npm run indexes:create`.
- [Node.js streams](https://nodejs.org/api/stream.html) - file stream i
  backpressure model koji backend koristi umjesto ucitavanja cijelog media
  fajla u RAM.
- [Express 4 response API](https://expressjs.com/en/4x/api.html#res) - response
  headeri i streaming ponasanje na postojecem Express stacku.
- [MDN Media Source Extensions](https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API)
  - browser API na kojem HLS.js zasniva segmentiranu reprodukciju.

## 11. As-built mapa implementacije

### Backend

- `backend/models/Video.js`: `searchPrefixes`, `hlsPreview` i correction
  metadata.
- `backend/models/EditJob.js`: kategorija, `workspaceState`, `expiresAt`,
  `jobKind` i correction veze.
- `backend/models/CorrectionRequest.js`: prijava, playhead, dodjela, status i
  per-producer `seenBy` signal.
- `backend/models/MediaTicket.js`: SHA-256 token hash i TTL `expiresAt` index.
- `backend/utils/searchText.js`: BHS normalizacija, prefix generator i `$all`
  query helper.
- `backend/utils/mediaStreaming.js`: `Range` parser i odgovori 200/206/416.
- `backend/services/hlsPreviewService.js`: FFmpeg 720p/480p VOD rendicije.
- `backend/services/editJobLifecycleService.js`: SLA racunanje i expiry batch.
- `backend/services/correctionWorkflowService.js`: deduplikacija prijave i
  automatsko kreiranje correction joba.
- `backend/routes/media.js`: ticket, HLS manifest/segment i MP4 fallback.
- `backend/routes/corrections.js`: producer/editor correction queue.
- `backend/routes/admin.js`: HLS inventory/build i content-type SLA postavke.

### Frontend

- `frontend/src/components/VideoPlayer.js`: lokalni HLS.js, native Safari HLS,
  MP4 Range fallback, Auto/720p/480p i obnova ticketa.
- `frontend/src/components/jobs/CorrectionQueue.js`: producer/editor queue,
  unread, dodjela i status.
- `frontend/src/components/admin/EditJobManagement.js`: Admin Jobs modul.
- `frontend/src/components/admin/StorageMaintenance.js`: HLS summary,
  Build missing i retry failed.
- `frontend/src/pages/RealizatorDashboard.js`: detaljni rundown pregled i
  prijava greske sa trenutnim playheadom.

### API ugovori

```text
POST  /api/media/tickets
GET   /api/media/:token/master.m3u8
GET   /api/media/:token/*
GET   /api/media/:token/fallback.mp4
GET   /api/admin/hls-previews/summary
POST  /api/admin/hls-previews/build-missing
GET   /api/corrections/workspace
PATCH /api/corrections/:requestId/route
PATCH /api/corrections/:requestId/status
PATCH /api/edit-jobs/:jobId/admin
POST  /api/edit-jobs/admin/apply-sla
```

## 12. Zavrsna verifikacija

Verifikovano 27.06.2026:

```text
node --check: 39 izmijenjenih/novih backend JS fajlova - PASS
npm run build --prefix frontend                         - PASS
npm test --prefix frontend -- --watchAll=false          - PASS
Frontend test suites                                    - 5/5
Frontend tests                                          - 12/12
git diff --check                                        - PASS
Prefix/BHS + HTTP Range deterministic assertions        - PASS
Local production-build smoke test /login                - PASS
Browser console errors on /login                        - 0
```

Build izlaz je generisan u `frontend/build`. Test runner prijavljuje
deprecation upozorenje iz trenutne React Testing Library/React 18 `act`
integracije i namjerni `console.error` iz negativnog network testa download
managera; testovi ipak prolaze.

`npm install` audit trenutno prijavljuje 64 nalaza u postojecem CRA dependency
stablu (14 low, 18 moderate, 30 high, 2 critical). `npm audit fix --force` nije
automatski pokrenut jer moze promijeniti `react-scripts`/webpack/Babel verzije
i napraviti breaking promjenu. Audit treba obraditi kao zasebnu, kontrolisanu
stack maintenance fazu.

Ova automatizovana provjera ne zamjenjuje media QA sa stvarnim FFmpeg fajlom,
MongoDB podacima i udaljenim browserom. Prije produkcije ostaju obavezni
manualni HLS/Range, SLA scheduler i correction replace scenariji iz sekcije 9.

Lokalni smoke test je pokrenut sa `PROCESSING_QUEUE=local`: MongoDB veza je
uspjela, web aplikacija je servirana na portu 5000, a zaseban Redis worker je
namjerno zaobidjen. Ovo je QA mod i queue ne prezivljava restart; produkcija
treba koristiti `PROCESSING_QUEUE=redis`.
