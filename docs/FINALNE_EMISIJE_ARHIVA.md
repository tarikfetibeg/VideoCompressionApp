# Finalne emisije: arhivski workflow

## 1. Svrha i granice domena

`ProgramFinal` predstavlja kompletno izdanje emisije koje je otislo u eter.
To nije prilog, insert, rundown klip niti montirani `Video` final.

Implementacija je namjerno odvojena:

- zasebne MongoDB kolekcije i indeksi;
- zasebni master, inbox, proxy i quarantine folderi;
- zaseban processing queue i media ticket;
- zasebna navigacija `Finali emisija`;
- nema pojavljivanja u TV arhivi priloga, Video Managementu ni ready-material
  biblioteci;
- nijedan Program Final endpoint ne nudi master download.

Postojeci `Video`, `storage/final`, HLS priloga i download endpointi ostaju
nepromijenjeni.

## 2. Poslovni objekti

### ProgramType

Grupise emisije po tipu, npr. informativni, jutarnji, magazinski ili sportski
program. Sadrzi preporuceni sablon funkcija ekipe.

### BroadcastProgram

Postojeca emisija sada moze imati `programType` i stabilan `slug`. Program
mora biti klasifikovan prije arhivske potvrde.

### ProductionPerson i ProductionRole

Imenik odvaja osobu od funkcije. Ista osoba moze imati vise funkcija i aliasa.
Admin upravlja aktivnoscu, redoslijedom i grupom funkcija.

### ProgramFinal

Logicko izdanje definisu program, datum, termin i edition label. Cuvaju se
status, ShowDay veza, credits snapshot, aktivna i pending verzija, potvrda
emitovanja i arhivska potvrda.

### ProgramFinalVersion

Svaki novi master dobija novi broj verzije. Verzija cuva SHA-256, velicinu,
codec metadata, Media Edge, izvor ingesta, proxy metadata, fixity rezultat i
zastitni lifecycle. Stari master se nikada ne prepisuje.

### FinalIngestCandidate

Evidencija fajla iz watched foldera: stabilnost, parsirani naziv, sidecar,
mapping status, import rezultat i checksum.

## 3. Statusi

| Status | Znacenje |
| --- | --- |
| `draft` | Zapis je u pripremi. |
| `waiting_for_file` | Metadata postoji, ali master nedostaje. |
| `ingesting` | Master se kopira i verificira. |
| `processing` | Generisu se HLS, access MP4, thumbnail i scrub proxyji. |
| `waiting_for_air` | Proxy je spreman, emitovanje jos nije potvrdeno. |
| `ready_for_archive_review` | Emitovanje je potvrdeno i final ceka Arhivistu. |
| `archived` | Aktivna verzija je potvrdena i read-only. |
| `quarantined` | Aktivna verzija je izolovana zbog Admin akcije ili fixity problema. |

Statusi verzije su odvojeni: `processing`, `ready`, `active`,
`superseded`, `failed`, `quarantined` i `purged`.

## 4. Rucni workflow Arhiviste

1. Otvoriti `Finali emisija > Radni red`.
2. Kreirati final i odabrati tip programa, emisiju, datum, termin, naslov i
   najmanje jednog clana ekipe.
3. Sistem automatski povezuje slobodan ShowDay istog programa i datuma samo
   kada termin odgovara defaultnom terminu emisije. Jedan ShowDay moze imati
   samo jedan final. Opcija `Historijski unos bez rundown veze` dozvoljava
   svjestan unos bez ShowDaya.
4. Odabrati master. Desktop pokrece resumable upload i prikazuje stvarni
   napredak; transfer se moze nastaviti nakon prekida.
5. Server racuna SHA-256 izvora, kopira master u zaseban storage i ponovo
   racuna checksum kopije.
6. Program Final queue generise samo proxy materijale za pregled.
7. Nakon `mark-aired` dogadjaja final prelazi u
   `ready_for_archive_review`. Ako nema fajla, ostaje
   `waiting_for_file` i Arhivista dobija notifikaciju.
   Historijski final bez ShowDaya dobija isti signal kroz akciju
   `Potvrdi emitovanje`, dostupnu Arhivisti, Adminu i Realizatoru.
8. Arhivista pregleda HLS, tehnicke podatke, trajanje, checksum i ekipu.
9. `Arhiviraj final` aktivira pending verziju. Prethodna aktivna verzija
   postaje `superseded`, ali se ne brise.

Arhiviranje je blokirano ako emitovanje nije potvrdeno, nema najmanje jednog
clana ekipe, nema checksum ili proxy nije spreman. Nedostajuce preporucene
funkcije su upozorenje: Arhivista moze nastaviti uz kratko obrazlozenje koje
ulazi u Audit Log.

## 5. Watched-folder workflow

Media Edge koristi:

- `FINAL_PROGRAM_WATCH_ROOT`, default
  `storage/program-finals-inbox`;
- interval `FINAL_PROGRAM_WATCH_INTERVAL_SECONDS=30`;
- stabilnost `FINAL_PROGRAM_STABLE_SECONDS=60`;
- prekid skeniranja sa `FINAL_PROGRAM_WATCH_ENABLED=false`.

Rucni resumable upload koristi `PROGRAM_FINAL_UPLOAD_TARGET`:

- `auto` bira Media Edge ciji je heartbeat mladji od 90 sekundi, a ako ga nema
  koristi API storage;
- `edge` zahtijeva dostupan Edge i nikada tiho ne salje master u cloud/API;
- `api` je single-host fallback za razvoj i postojecu instalaciju.

Edge URL mora biti LAN adresa dostupna desktop klijentima, npr.
`http://media-edge.lan:5100`, a ne `127.0.0.1` kada upload dolazi sa drugog
racunara. TUS token je vezan za korisnika, transfer, izdanje i konkretni Edge.

Standard naziva:

`program-slug__YYYY-MM-DD__HH-mm__naslov.ext`

Primjer:

`dnevnik__2026-07-21__18-30__vecernje-izdanje.mxf`

Opcionalni istoimeni JSON sidecar:

```json
{
  "programSlug": "dnevnik",
  "airDate": "2026-07-21",
  "airTime": "18:30",
  "title": "Vecernje izdanje",
  "editionLabel": "18:30",
  "replacementReason": "",
  "credits": [
    { "name": "Ime Prezime", "roleSlug": "voditelj" },
    { "name": "Ime Prezime", "roleSlug": "realizator" }
  ]
}
```

Scanner prihvata video tek kada se velicina i mtime ne mijenjaju kroz cijeli
stability prozor. Neispravan sidecar ili nepoznat program daje
`needs_mapping`; Arhivista ga povezuje u tabu `Watched folder`.

Prekinuti kandidat u statusu `importing` vraca se u red nakon deset minuta.
Ako se kasnije pojavi novi fajl sa istim nazivom kao ranije obradjeni kandidat,
scanner ga tretira kao novu isporuku i ponavlja checksum provjeru.

Izvor i sidecar prelaze u `.processed/YYYY-MM-DD` tek nakon uspjesnog
kopiranja i provjere checksum-a. Isti checksum za isto izdanje ne stvara novu
verziju. Isti fizicki sadrzaj u drugom izdanju dobija zaseban zapis verzije,
ali moze sigurno dijeliti iste nepromjenjive master bajtove.

## 6. Credits i historijski zapis

Credits cuvaju reference na imenik i snapshot imena/funkcije. Promjena imena,
aliasa ili naziva funkcije u Admin katalogu ne mijenja vec arhivirani zapis.

- Arhivista i Admin uredjuju sve pending zapise.
- Realizator moze dopunjavati pending izdanje.
- Producent moze dopunjavati izdanje samo kada je vezan za njegov ShowDay.
- Arhivirani final je read-only.

Preporucene funkcije su Adminom podesive po tipu programa. Pocetni katalog
ukljucuje voditelja, producenta, realizatora, reziju, kameru, ton, rasvjetu,
grafiku i montazu.

## 7. Pregled i dozvole

Sve prijavljene role mogu:

- pretraziti `archived` finale;
- otvoriti aktivnu arhiviranu verziju;
- gledati HLS 720p/480p ili access MP4 Range fallback;
- vidjeti program, datum, termin, aktivnu verziju i credits.

Arhivista/Admin te operativno ovlasteni Producent/Realizator mogu gledati
pending proxy. Samo Arhivista/Admin mogu kreirati final, uploadovati master i
potvrditi arhivu. Samo Admin upravlja karantinom i purgeom.

Nijedna rola nema Program Final download. HTML `nodownload` je samo UX
signal; stvarna zabrana je to sto master download endpoint ne postoji, a
media ticket dozvoljava samo proxy putanje.

## 8. UI

`Finali emisija` ima:

- `Arhiva`: server-paginirana pretraga finala;
- `Radni red`: missing, processing, waiting-for-air, review i integrity
  statusi za Arhivistu/Admina;
- `Moje emisije`: pending izdanja vezana za ShowDay Producenta ili Realizatora;
- `Watched folder`: kandidati i rucno povezivanje;
- dvopanelni browser: lista lijevo, samo selektovani HLS desno;
- detalje aktivne i pending verzije, credits, codec podatke i historiju;
- Admin katalog tipova programa, osoba i funkcija.

Search podrzava prefix tokene i filtere po tipu, programu, datumu, terminu,
osobi i funkciji. Liste ostaju paginirane; samo selektovani final kreira media
ticket i pokrece HLS. Lijeva lista je grupisana kao
`Tip programa > Emisija > godina/mjesec`.

## 9. API

Glavni endpointi:

- `GET /api/program-finals/workspace`
- `GET /api/program-finals/:id`
- `POST /api/program-finals`
- `PATCH /api/program-finals/:id/metadata`
- `PUT /api/program-finals/:id/credits`
- `POST /api/program-finals/:id/media-ticket`
- `POST /api/program-finals/:id/air-confirmation`
- `POST /api/program-finals/:id/archive-confirmation`
- `GET /api/program-finals/ingest-candidates`
- `POST /api/program-finals/ingest-candidates/:candidateId/import`
- `POST /api/v2/program-finals/:id/upload-session`
- Admin `quarantine`, `restore`, `purge` i fixity endpointi
- katalog `/api/program-types`, `/api/production-people` i
  `/api/production-roles`

Media ticket token je hashiran u bazi, default traje 120 minuta i nalazi se u
URL putanji. Player obnavlja ticket prije isteka i nastavlja na istom
timestampu.
Svaki HLS segment ponovo provjerava ticket, korisnika, status finala, verziju i
sigurnu relativnu putanju.

## 10. Storage i queue

```text
storage/program-finals/masters/
storage/program-finals-inbox/
storage/program-final-previews/
storage/program-finals-quarantine/
```

Program Final processing ima odvojeni queue i default concurrency 1:
`PROGRAM_FINAL_QUEUE_CONCURRENCY=1`. Time veliki final ne blokira primarni
video ingest. U production okruzenju queue treba koristiti Redis; lokalni mode
je razvojni fallback.

U hybrid produkciji control API koristi `PROGRAM_FINAL_WORKER_EXTERNAL=true`,
a Media Edge `EDGE_RUN_LOCAL_WORKERS=true`. Time worker koji ima lokalni pristup
masteru generise proxy. `PROGRAM_FINAL_FIXITY_OWNER=edge` osigurava da rolling
checksum provjeru radi isti cvor. Rucni HLS ticket tada upucuje direktno na
potpisani Edge proxy; master nema HTTP rutu.

Proxy koristi postojece Admin media profile, ali ima vlastiti folder i
metadata verzije. Master se ne koristi kao javni stream.

Rucni upload ima zaseban limit `MAX_PROGRAM_FINAL_SIZE_GB` (default 100 GB),
odvojen od limita obicnog finalnog priloga. Potpuno prenesena sesija kojoj je
finalizacija privremeno pala moze ponoviti finalizaciju bez ponovnog slanja
svih bajtova.

Edge upload koristi imenovani TUS resurs po `transferId`. Ako je prijenos
zavrsen, ali kopiranje/checksum privremeno padne, retry se salje Edge task redu
i koristi vec preneseni privremeni fajl. Control API ne pokusava citati lokalnu
Edge putanju.

## 11. Rollout bez promjene postojecih videa

1. Napraviti backup MongoDB baze i storage konfiguracije.
2. Pokrenuti `npm run program-finals:migrate:dry-run`.
3. Pregledati broj programa bez sluga i tipa.
4. Pokrenuti `npm run program-finals:migrate`.
5. Pokrenuti `npm run indexes:create`.
6. Provjeriti Admin katalog i klasifikovati emisije koje su privremeno
   `Nekategorisano`.
7. Testirati jedan mali MP4, zatim jedan reprezentativni MXF/MOV.
8. Tek tada ukljuciti produkcijski watched folder.

Migracija ne cita, premjesta, brise niti Program Finalom proglasava postojeci
`Video` materijal.

## 12. QA checklist

- Dva termina istog programa istog dana imaju odvojena izdanja.
- Prekid uploada nastavlja se sa server potvrdenog offseta.
- Neispravan sidecar ostaje za mapping i ne nestaje iz inboxa.
- Kopirani master i izvor imaju isti SHA-256.
- Zamjena stvara novu verziju, a stara ostaje dostupna Admin historiji.
- `mark-aired` bez fajla stvara missing-final signal.
- Arhiviranje prije emitovanja ili bez spremnog proxyja daje HTTP 409.
- Sve role gledaju archived proxy; nijedna ne dobija master download.
- Obicna rola ne moze status queryjem otvoriti pending red.
- Ticket nakon karantina vise ne servira verziju.
- Path traversal izvan proxy foldera je odbijen.
- Na 100k zapisa search/filter koriste pagination i definisane indekse.

## 13. Reference i mapiranje

- [PBCore Instantiation](https://pbcore.org/elements/pbcoreinstantiation.html):
  odvajanje intelektualnog izdanja od konkretne media instancije/verzije.
- [PBCore Instantiation Essence Track](https://pbcore.org/elements/instantiationessencetrack.html):
  codec, frame rate, dimenzije, trajanje i audio/video track metadata.
- [EBUCore 1.8](https://tech.ebu.ch/docs/tech/tech3293v1_8.pdf):
  program, datum, contributor/role i broadcast metadata koncepti.
- [tus resumable upload protocol](https://tus.io/protocols/resumable-upload):
  idempotentna sesija, offset provjera i nastavak velikog uploada.
- [RFC 8216: HTTP Live Streaming](https://datatracker.ietf.org/doc/html/rfc8216):
  playlist i segmentni proxy pregled.
- [MongoDB compound indexes](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/):
  status/date, program/date i credits upiti.
