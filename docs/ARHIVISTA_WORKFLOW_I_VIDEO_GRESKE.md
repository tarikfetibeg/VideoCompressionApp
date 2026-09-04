# Arhivistički workflow i prijavljivanje video grešaka

## 1. Cilj

Ova promjena pretvara Archive Desk iz široke administrativne tabele u radni
prostor za svakodnevni pregled finalnih materijala. Uvedeni su:

- lični i zajednički arhivistički red;
- vremenski ograničen claim nad jednim videom;
- dvopanelni pregled sa jednim aktivnim HLS playerom;
- server-side upozorenja za nepotpunu metadata;
- više vremenskih grešaka u jednom correction zahtjevu i jednom jobu;
- direktan izbor montažera;
- jasna historija odgovornosti kroz notifikacije i Audit Log.

Promjena je aditivna. Ne premješta, ne prekodira i ne briše master, final,
MP4 preview, HLS, thumbnail ili scrub fajlove.

## 2. Dnevni rad Arhiviste

### 2.1. Radni red

Archive Desk ima tri glavna pogleda:

1. `Radni red` za aktivni dnevni posao.
2. `Pretraga arhive` za server-paginiranu pretragu svih finalnih materijala.
3. `Duplikati` za poređenje i kontrolisano uklanjanje duplikata.

Scope u Radnom redu:

- `Moj red`: aktivni claimovi prijavljenog Arhiviste;
- `Nepreuzeto`: video nema claim ili mu je claim istekao;
- `Sve aktivno`: zajednički pregled aktivnih arhivističkih zadataka.

Attention filteri:

- `Za pregled`;
- `Treba metadata`;
- `U montaži`;
- `Spremno za potvrdu`;
- `Sve`.

KPI polja su akcijska: klik mijenja odgovarajući scope/attention filter.

### 2.2. Dvopanelni prikaz

Na desktopu lijevi panel prikazuje paginiranu listu sa lazy thumbnail/scrub
previewom. Desni sticky panel prikazuje samo selektovani video:

- HLS/MP4 Range player;
- metadata kompletnost;
- arhivistički i broadcast status;
- trenutnog vlasnika claim-a;
- aktivnu correction prijavu i sve issue stavke;
- glavne radne akcije.

Samo selektovani video dobija media ticket i pokreće HLS. Lista nikada ne
učitava video blobove. Na užem ekranu detalji se otvaraju u full-width Draweru.

Strelice gore/dolje mijenjaju selekciju, a Enter otvara mobilni detaljni
panel. Upute za shortcut se namjerno ne prikazuju u operativnom UI-u.

## 3. Claim lease

Video dokument ima opcionalna polja:

```text
archiveAssignedTo
archiveAssignedAt
archiveAssignmentExpiresAt
```

Default lease traje 120 minuta. Može se podesiti varijablom
`ARCHIVE_CLAIM_MINUTES`; backend vrijednost ograničava na 15-480 minuta.

Claim koristi jedan atomski `findOneAndUpdate`. Video je moguće preuzeti kada:

- nema vlasnika;
- nema datum isteka;
- claim je istekao;
- isti korisnik samo produžava svoj claim.

Ako dva Arhivista pokušaju preuzeti isti video, samo jedan update može
zadovoljiti filter. Drugi dobija HTTP `409 ARCHIVE_ALREADY_CLAIMED`, ime
vlasnika i vrijeme isteka. Dodatni scheduler nije potreban: istekao datum se
u queryju tretira kao nepreuzet materijal.

Metadata, tag, kategorija i review izmjene Arhiviste zahtijevaju aktivan
vlastiti claim. Svaka uspješna izmjena produžava lease. Admin ima kontrolisani
bypass i može preraspodijeliti ili osloboditi materijal.

Claim se uklanja kada Arhivista:

- završi pregled;
- pošalje media grešku u montažu;
- potvrdi ili odbaci završenu ispravku;
- ručno izabere `Oslobodi`.

## 4. Završetak pregleda i warning režim

Backend pri statusu `reviewed` provjerava:

- finalni naslov;
- datum materijala;
- kategoriju;
- event;
- autora/reportera ili uploadera;
- najmanje jedan tag;
- otvorenu correction prijavu.

Prvi pokušaj završetka sa problemima vraća:

```json
{
  "code": "ARCHIVE_REVIEW_WARNINGS",
  "warnings": [
    { "code": "missing_category", "label": "Nedostaje kategorija" }
  ]
}
```

UI prikazuje upozorenja. Arhivista može popraviti podatke ili izabrati
`Završi ipak`. Override zahtijeva kratko obrazloženje. Warning režim ne blokira
produkciju, ali Audit Log čuva upozorenja, razlog i korisnika.

Metadata/kategorija/tag problem postavlja `archiveReviewStatus=needs_metadata`
i ostaje arhivistički zadatak. Ne kreira correction job.

## 5. Grupisane video greške

`CorrectionRequest` zadržava legacy `note` i `timestamp`, a dobija:

```text
issues[] = {
  type,
  severity,
  startSeconds,
  endSeconds,
  note,
  reportedBy,
  reportedAt
}
highestSeverity
```

Tipovi su `picture`, `audio`, `edit`, `graphics`, `wrong_version`,
`technical` i `other`. Ozbiljnost je `minor`, `major` ili `blocking`.

Jedno slanje može sadržavati 1-20 grešaka. Jedan otvoreni zahtjev podržava do
100 issue stavki tokom svog životnog ciklusa. Vremenska oznaka mora biti
unutar trajanja videa, a opcionalni kraj ne smije biti prije početka.

Za jedan video koristi se postojeći otvoreni correction zahtjev i postojeći
correction job. Nova greška:

- dodaje issue u isti zahtjev;
- regeneriše opis, script i segment napomenu joba iz svih issue stavki;
- ne pravi dupli job;
- vraća `ready_for_review` zahtjev u aktivni tok;
- ponovo obavještava montažera i Producenta.

Legacy zahtjev bez `issues[]` API prikazuje kao virtualni `other/major` issue.
Backfill nije obavezan. Kada se legacy zahtjevu doda nova greška, stara prijava
se materijalizuje u grupi i ne gubi se.

## 6. Rutiranje montažeru

Predloženi montažer određuje se redom:

1. već dodijeljeni montažer otvorenog zahtjeva;
2. `assignedEditor` izvornog edit joba;
3. `video.editor`;
4. nedodijeljeno.

Arhivista može prije početka montaže izabrati drugi Editor/VideoEditor nalog.
Tokom `in_edit` statusa promjenu radi Producent ili Admin. Ako nema montažera,
prijava se sačuva, correction job ostaje nedodijeljen, a Producent dobija
action-required notifikaciju.

Correction job je `urgent`, dobija rok do četiri sata ili raniji preostali rok
izvornog joba. Editor u `Production > Ispravke` vidi svaku issue stavku i link
na tačan timestamp.

## 7. Video Details

Video Details zadržava 16:9 HLS player, marker funkcije, metadata, QC,
broadcast akcije i download. Dodano je:

- `Kontrola i ispravke` pored playera;
- claim status i akcije za Arhivistu;
- tabovi `Metadata`, `QC i greške` i `Historija`;
- composer koji početni timestamp uzima iz trenutnog playheada;
- klik na issue timestamp koji seeka player na tačan kadar;
- direktan izbor montažera i slanje bez napuštanja ekrana;
- BHS operativni tekstovi.

Reporter i Realizator imaju read-only pregled i ne dobijaju arhivističke/QC
privilegije. Producer može prijaviti media grešku, a Admin ima kontrolisani
bypass claim-a.

## 8. Notifikacije i Audit Log

Nova ili dopunjena prijava obavještava:

- odabranog montažera;
- Producent rolu;
- reportera izvornog videa/joba kada postoji.

`ready_for_review` obavještava Arhiviste i Producenta. `resolved` obavještava
montažera i reportera. Rerouting obavještava prethodnog i novog montažera.
Deep link vodi na correction job ili video i pripadajući timestamp.

Audit Log pokriva:

- claim i release;
- Admin preraspodjelu;
- warning override;
- sve poslano issues sa tipom, ozbiljnošću i vremenom;
- odabranog montažera i correction job;
- rerouting i status;
- konačnu potvrdu ili odbacivanje.

## 9. API ugovori

Novi/prošireni endpointi:

```text
GET   /api/archive/videos/workspace?assignment=mine&attention=review
PATCH /api/archive/videos/:videoId/claim
PATCH /api/archive/videos/:videoId/release
PATCH /api/archive/videos/:videoId/assignment
PATCH /api/archive/videos/:videoId/review

GET   /api/corrections/video/:videoId/context
POST  /api/corrections/video/:videoId/issues
GET   /api/corrections/editors
```

Legacy correction `/ensure`, `/route`, `/claim`, `/status` i `/dismiss`
endpointi ostaju podržani. Postojeći archive response shape je proširen, a
postojeća polja nisu uklonjena.

## 10. Indeksi i rollout

Novi indeksi su deklarisani u Mongoose modelima:

```text
Video: archiveReviewStatus + archiveAssignedTo + archiveAssignmentExpiresAt + uploadDate
CorrectionRequest: status + highestSeverity + updatedAt
```

Produkcijsko kreiranje ide kontrolisano:

1. Napraviti backup MongoDB baze.
2. Deployati kod; nova polja su opcionalna.
3. Pokrenuti `npm run indexes:create`.
4. Provjeriti Archive Desk sa dva testna Arhivista.
5. Provjeriti correction tok sa jednim testnim Editorom i Producentom.

Stari videi bez assignment polja automatski su `Nepreuzeto`. Stari correction
zahtjevi ne zahtijevaju migraciju. Rollback koda ostavlja dodatna polja u bazi;
stara verzija ih ignoriše. Nijedna rollback radnja ne smije brisati media
foldere.

## 11. QA matrica

- Dva Arhivista istovremeno claimaju video: jedan `200`, drugi `409`.
- Aktivni claim se produžava nakon metadata/tag/review izmjene.
- Istekli claim može preuzeti drugi Arhivista.
- `Moj red`, `Nepreuzeto`, attention, search, sort i pagination rade zajedno.
- Završetak sa warningom traži razlog, ali nakon potvrde uspijeva.
- Metadata problem ne kreira `CorrectionRequest` ni `EditJob`.
- Dvadeset media problema u jednom slanju pravi jedan request i jedan job.
- Nova greška postojećeg zahtjeva ne duplira correction job.
- Arhivista ne može promijeniti montažera tokom `in_edit`.
- Editor vidi svaki issue i otvara tačan timestamp.
- `ready_for_review` obavještava Arhiviste i Producenta.
- Reporter/Realizator ne vide mutacijske arhivističke akcije.
- Na 1366x768 nema horizontalnog scrolla Archive liste.
- Samo selektovani video pravi media ticket; thumbnaili ostaju lazy.
- `npm run indexes:create` ne briše postojeće indekse.

## 12. Tehničke reference

- [MongoDB atomicnost pojedinačnog dokumenta](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/)
- [MongoDB `findOneAndUpdate`](https://www.mongodb.com/docs/manual/reference/method/db.collection.findOneAndUpdate/)
- [MongoDB compound indeksi](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/)
- [MongoDB Equality, Sort, Range smjernica](https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/)
- [Mongoose `findOneAndUpdate`](https://mongoosejs.com/docs/tutorials/findoneandupdate.html)
- [Mongoose subdocuments](https://mongoosejs.com/docs/subdocs.html)
- [Mongoose populate](https://mongoosejs.com/docs/populate.html)
- [MUI responsive Grid](https://mui.com/material-ui/react-grid/)
- [MUI Drawer](https://mui.com/material-ui/react-drawer/)
- [MUI Tabs](https://mui.com/material-ui/react-tabs/)
- [MDN Intersection Observer](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API)
- [WAI-ARIA Authoring Practices: Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)

