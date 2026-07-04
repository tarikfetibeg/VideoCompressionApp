# Zamjena klasicne distribucije video materijala u TV kuci

Ovaj dokument opisuje kako VideoCompressionApp pomaze TV kuci da predje sa klasicnog sistema distribucije preko mrezenih foldera, USB diskova, rucnog kopiranja i dogovora preko poruka na centralizovan workflow za ingest, produkciju, emitovanje i arhivu.

Dokument je pisan kao argumentacija za internu prezentaciju, projektni prijedlog ili uvodjenje aplikacije u dnevnu produkciju.

## Sta aplikacija zamjenjuje

Klasicni sistem u TV kuci obicno izgleda ovako:

- reporter ili snimatelj kopira fajlove u folder na serveru;
- montazer trazi materijal po folderima, datumima i imenima fajlova;
- urednik/producent pita gdje je final, koji je zadnji fajl i da li je spreman;
- realizator preuzima fajlove rucno iz foldera;
- arhiva kasnije pokusava rekonstruisati sta je emitovano, ko je autor i kojoj emisiji pripada;
- informacije o QC-u, kategoriji, autoru, emisiji i statusu cesto zive u imenima fajlova, Excel tabelama, porukama ili usmenom dogovoru.

VideoCompressionApp taj model mijenja u sistem gdje je video materijal centralni zapis sa metapodacima, statusima, pregledom, historijom i kontrolisanim akcijama.

## Glavni mehanizmi aplikacije

### 1. Centralni ingest i evidencija materijala

Aplikacija ne tretira video samo kao fajl u folderu, nego kao evidencijski zapis.

Mehanizmi:

- Reporter uploaduje sirovinu kroz Reporter Desk.
- Svaki upload dobija vlasnika/uploadera, event, datum i tehnicke podatke.
- Backend evidentira originalni fajl, radni/compressed fajl, preview fajl, thumbnail i scrub preview.
- Veliki batch upload ide sekvencijalno po fajlu, pa jedan neuspjeli fajl ne rusi cijeli batch.
- Raw recovery manifest pomaze da se orphan fajlovi iz `storage/raw` kasnije vrate u sistem ako DB zapis nije nastao.

Prednost:

- Materijal se vise ne gubi u folderima bez konteksta.
- Svaki fajl ima poznatog vlasnika, datum, event i processing status.
- Problematicni uploadi se mogu retryati i pratiti.

### 2. Automatska obrada, proxy i preview

Klasicno mrezenje daje samo fajl. Aplikacija pravi radne izvedenice koje pomazu brz pregled.

Mehanizmi:

- FFmpeg worker pravi compressed/master fajl.
- Pravi browser preview video.
- Pravi thumbnail sliku.
- Pravi scrub preview slicice za YouTube-like hover pregled.
- Admin moze naknadno izgraditi nedostajuce scrub preview slicice za stare klipove.
- Processing status pokazuje `queued`, `processing`, `completed` ili `failed`.

Prednost:

- Korisnik ne mora skidati veliki fajl samo da vidi sta je unutra.
- Producent, realizator, reporter i arhiver mogu brzo prepoznati klip kroz thumbnail/scrub preview.
- Neuspjela obrada je vidljiva i moze se ponovo pokrenuti.

### 3. Role-aware radni prostori

Umrezeni folder ne zna ko je reporter, montazer, producent, realizator ili arhiver. Aplikacija zna.

Mehanizmi:

- Reporter Desk: upload, event workspace, jobs, licna i TV arhiva.
- Production Desk: jobs, materijal, QC, direct final upload, retry processing.
- Producer Desk: izbor emisije, TV archive / ready material, rundown, replace material.
- Realizator Desk: pregled rundowna, download air paketa, potvrda emitovanja.
- Archive Desk: review queue, svi materijali, metadata, tagovi, kategorije, duplikati.
- Admin Dashboard: korisnici, video management, feedback, audit logs, storage maintenance, broadcast settings.
- Navigacija prikazuje samo radne prostore koje rola smije koristiti.

Prednost:

- Svaka uloga vidi svoj posao, a ne cijeli haoticni folder sistem.
- Manje je pogresnih akcija, brisanja i pristupa tudjem materijalu.
- Workflow je vodjen statusima, a ne usmenim dogovorom.

### 4. Reporter to Production workflow

Aplikacija omogucava da reporter ne salje samo "folder klipova", nego pripremljen zadatak za montazu.

Mehanizmi:

- Reporter Event Workspace grupise klipove po eventu i datumu.
- Reporter moze kreirati edit job za produkciju.
- Edit job nosi brief, program, deadline, priority, komentare i trazene segmente.
- Precizni marker workflow omogucava In/Out/Cut/Note oznake.
- Montazer moze otvoriti job i preuzeti package.

Prednost:

- Montazer dobija kontekst price/priloga, a ne samo listu fajlova.
- Smanjuje se broj poruka tipa "koji klip ide", "gdje pocinje dio", "koji je rok".
- Job historija ostaje u sistemu.

### 5. Production Desk i kontrola materijala

Production Desk zamjenjuje rucno trazenje materijala po folderima.

Mehanizmi:

- Materijal tab ima server-side search/filter.
- Filteri pokrivaju event, lokaciju, reportera, datum, kategoriju, material status, processing, QC i air status.
- Kategorije koriste content type sistem: Prilog, Insert, Spica, Promo, Marketing, Grafika, Ostalo.
- Legacy kategorije kao `video-report` mapiraju se na `Prilog`.
- Materijal tabela prikazuje preview, status, kategoriju, velicinu, processing i QC/Air signale.
- Editor moze oznaciti da je kategorija pogresna i poslati video arhiveru na pregled.

Prednost:

- Montazer brze nalazi tacan materijal.
- Vidljivo je sta je sirovina, sta je final, sta je spremno, sta je failed.
- Kategorije nisu samo dio imena fajla, nego kontrolisani podatak.

### 6. QC i status pipeline

U folder sistemu je tesko znati da li je fajl pregledan, odobren ili ima problem. Aplikacija status koristi kao dio workflowa.

Mehanizmi:

- QC statusi: `pending`, `passed`, `failed`.
- Broadcast statusi: `not_ready`, `qc_pending`, `qc_failed`, `ready_for_approval`, `approved_for_air`, `aired`, `archived`.
- QC notes opisuju problem.
- Producer/Admin odobravaju materijal za eter.
- Realizator ili Producer mogu oznaciti materijal kao aired/arhiviran kroz broadcast workflow.
- Potrebna ispravka se vidi u Producer, Realizator, Video Details, Archive i Admin prikazima.

Prednost:

- Nema nagadjanja da li je fajl finalna verzija.
- QC problem ostaje vezan za video zapis.
- Eter se ne oslanja samo na ime fajla tipa `FINAL_FINAL_2.mp4`.

### 7. Producer i rundown workflow

Aplikacija uvodi nivo emisije/rundowna, sto klasicni folder sistem nema.

Mehanizmi:

- Producer bira program i datum emisije.
- TV archive / ready material prikazuje odobrene/finalizovane klipove.
- Materijal se dodaje u rundown emisije.
- Producer moze zamijeniti materijal kroz replace mode.
- Rundown podrzava drag-and-drop redoslijed.
- Activity log biljezi promjene u emisiji.
- Sistem prati da li je materijal promijenjen nakon download-a.

Prednost:

- Emisija ima strukturisanu listu materijala.
- Producent vidi sta je u emisiji i sta je spremno.
- Zamjena materijala je kontrolisana akcija, ne rucno prepisivanje fajla u folderu.

### 8. Realizator workflow i air package

Kod obicnog mrezenja realizator mora rucno traziti fajlove i paziti da uzme pravu verziju. Aplikacija pravi paket iz rundowna.

Mehanizmi:

- Realizator bira program i datum.
- Vidi aktivne stavke u rundownu.
- Skida air paket za emisiju.
- Sistem signalizira izmjene poslije zadnjeg download-a.
- Realizator moze potvrditi da je emisija emitovana.
- Potvrda airanja prebacuje aktivne stavke u `aired`/archive tok.

Prednost:

- Manja sansa da realizator pusti staru ili pogresnu verziju.
- Air paket je vezan za emisiju i datum.
- Promjene nakon downloada su vidljive.

### 9. TV arhiva i arhivski QA

Obican folder server nije prava arhiva. Aplikacija uvodi arhivski workflow i pregled.

Mehanizmi:

- Reporter ima My Archive i TV Archive.
- TV Archive je read-only za reportera: moze pregledati, ali ne moze dirati tudji materijal.
- Archive Desk ima Review Queue, All Videos i Duplicates.
- Arhiver moze urediti metadata, content type, tagove i review status.
- Arhiver vidi `needs_metadata`, `duplicate`, `needs_correction` i pregledane/nepregledane klipove.
- Duplikati se grupisu po normalizovanom naslovu, trajanju i velicini.
- Brisanje duplikata cisti fajlove samo kada nisu referencirani drugdje.

Prednost:

- Arhiva nije samo "folder finala", nego kontrolisan katalog.
- Materijal se moze pretrazivati po kategoriji, eventu, reporteru, editoru, statusu i tagovima.
- Arhiver radi bez punih admin ovlasti.

### 10. Search, indexi i performanse za velike biblioteke

Mrezeni folderi postaju spori i neorganizovani kad se nakupi hiljade klipova. Aplikacija koristi bazu, indexe i paginaciju.

Mehanizmi:

- Workspace endpointi koriste server-side pagination.
- Search koristi normalizovani `searchText`.
- MongoDB indexi pokrivaju video liste, edit jobove, feedback i audit logove.
- Frontend ne salje search dok unos nema najmanje 2 karaktera.
- Thumbnail i preview se ucitavaju lazy, tek kada element ulazi u viewport.
- Producer biblioteka i archive liste ne ucitavaju kompletan media blob odjednom.

Prednost:

- Hiljade klipova ne znace automatski hiljade fajlova u jednom folderu.
- Liste ostaju responzivne.
- Pretraga radi preko metapodataka, a ne samo preko imena fajla.

### 11. Audit log, feedback i odgovornost

Folder sistem obicno ne govori ko je sta uradio i zasto. Aplikacija biljezi kriticne akcije.

Mehanizmi:

- Audit log biljezi brisanje videa, QC promjene, broadcast promjene, arhivske promjene, user/admin akcije.
- Audit Logs imaju filtere i export.
- Feedback sistem omogucava korisnicima da prijave bug, sugestiju, workflow problem ili hitan produkcijski problem.
- Admin Feedback Inbox sluzi za triage, status, prioritet, interne biljeske i odgovor korisniku.

Prednost:

- Laksa je odgovornost i analiza incidenta.
- Korisnicki problemi ne ostaju u privatnim porukama.
- Admin moze vidjeti trendove problema u aplikaciji.

### 12. Admin i maintenance alati

Aplikacija ne zavisi samo od toga da neko rucno cisti foldere.

Mehanizmi:

- User Management za role i lozinke.
- Video Management za pregled svih video zapisa, vlasnika, kategorije, workflowa i storage stanja.
- Raw cleanup i raw recovery za orphan fajlove.
- Storage Maintenance za servisne operacije.
- Preview slicice / Build missing za scrub preview generisanje.
- Audit i feedback alati za administraciju sistema.
- Skripte za `searchText` backfill, indexe i content type backfill.

Prednost:

- Odrzavanje je sistemsko, ne rucno.
- Admin ima pregled stanja baze i storage-a.
- Postoje alati za oporavak i korekciju historijskih podataka.

## Prednosti naspram obicnog umrezavanja servera i racunara

| Obicno mrezenje foldera | VideoCompressionApp |
| --- | --- |
| Fajl je samo fajl u folderu. | Video je asset sa metapodacima, statusima i historijom. |
| Pretraga zavisi od imena fajla i strukture foldera. | Pretraga koristi bazu, `searchText`, kategorije, evente, datume i role. |
| Korisnik mora skinuti/otvoriti fajl da zna sta je unutra. | Thumbnail, video preview i scrub preview omogucavaju brz pregled u browseru. |
| Nije jasno ko je uploadovao, montirao ili odobrio fajl. | Uploader, reporter, editor, QC, approval i audit log su vezani za zapis. |
| Verzije se razlikuju imenima tipa `final_2`, `novo_final`. | Status pipeline odvaja sirovinu, final, QC, approval, aired i archive. |
| Producent/realizator moraju rucno znati sta je za emisiju. | Rundown i air package strukturisu materijal po programu i datumu. |
| Nema role-based ogranicenja osim NTFS/share permisija. | UI i API akcije su vezane za role: Reporter, Editor, Producer, Realizator, Archivist, Admin. |
| Arhiva je folder ili Excel tabela. | Archive Desk ima metadata, review queue, tagove, kategorije i duplicate workflow. |
| Nema centralnog QC signala. | QC status, QC notes i broadcast status su dio svakog videa. |
| Brisanje ili zamjena fajla moze biti nevidljiva. | Kriticne akcije idu u audit log. |
| Veliki folderi postaju teski za pregled. | Liste koriste paginaciju, indexe, debounce i lazy media loading. |
| Feedback ide kroz poruke i razgovore. | Feedback ima status, prioritet, admin odgovor i internu evidenciju. |

## Prakticna mapa zamjene starog toka

### Stari tok: reporter kopira fajlove u folder

Novi tok:

1. Reporter uploaduje kroz Reporter Desk.
2. Aplikacija evidentira event, datum, vlasnika i tehnicki metadata.
3. Worker pravi preview/thumbnail/scrub preview.
4. Materijal postaje vidljiv u produkcijskom workflowu.

### Stari tok: montazer trazi materijal po folderima

Novi tok:

1. Montazer otvara Production Desk.
2. Koristi search/filter po eventu, datumu, reporteru, kategoriji i statusu.
3. Preuzima edit package iz joba ili otvara detalje videa.
4. Uploaduje final kroz kontrolisani final upload.

### Stari tok: producent pita gdje je final

Novi tok:

1. Producer otvara Producer Desk.
2. Vidi TV archive / ready material.
3. Dodaje klipove u rundown emisije.
4. Po potrebi mijenja materijal kroz replace mode.

### Stari tok: realizator rucno kopira fajlove za emisiju

Novi tok:

1. Realizator otvara emisiju i datum.
2. Vidi rundown.
3. Skida air package.
4. Sistem pokazuje da li ima izmjena nakon zadnjeg download-a.
5. Realizator potvrdi emitovanje.

### Stari tok: arhiva naknadno trazi sta je emitovano

Novi tok:

1. Emitovani/finalizovani materijal ulazi u TV Archive.
2. Arhiver koristi Review Queue.
3. Uredjuje metadata, tagove i kategorije.
4. Oznacava pregledano, treba metadata ili duplikat.

## Sta aplikacija jos ne zamjenjuje

Aplikacija nije kompletna zamjena za sve broadcast sisteme u TV kuci. Ona ne zamjenjuje:

- NLE aplikacije za montazu, kao Premiere, DaVinci Resolve, Edius ili Avid;
- pravi playout/automation server;
- pravni rights management sistem;
- enterprise MAM sa AI transcript/OCR indeksiranjem;
- backup strategiju za bazu i storage;
- mrezu, server storage, firewall i sistemsko odrzavanje.

Ona zamjenjuje najkriticniji dio svakodnevne neformalne distribucije: pronalazak, pripremu, pregled, status, preuzimanje, odobravanje i arhivsku evidenciju video materijala.

## Preporuceni nacin uvodjenja u TV kuci

1. Postaviti aplikaciju na stabilan lokalni server ili VPS/cloud server.
2. Definisati role korisnika: Reporter, Editor/VideoEditor, Producer, Realizator, Archivist, Admin.
3. Uvesti Reporter Desk za novi dnevni ingest.
4. Uvesti Production Desk kao primarno mjesto za materijal i edit jobove.
5. Uvesti Producer/Realizator rundown za emisije.
6. Uvesti Archive Desk za finalizovani/emitovani materijal.
7. Pokrenuti backfill skripte za stare podatke: `searchtext:backfill`, `indexes:create`, `contenttypes:backfill`.
8. Definisati backup baze i `storage` foldera.
9. Odrzavati kratku QA rutinu: failed processing, missing preview, category review, duplicates, audit i feedback.

## Veza sa profesionalnim referencama

Ovaj sistem prati obrasce koji postoje u profesionalnim broadcast/MAM okruzenjima:

- file-based ingest sa proxy/thumbnail generisanjem;
- workflow automation za transcode, QC, delivery i retry;
- newsroom workflow oko price/priloga i rundowna;
- metadata-driven arhiva;
- auditabilan QC i approval proces;
- server-side search/pagination za velike biblioteke.

Detaljnije reference su vec dokumentovane u:

- `docs/QA_SUGESTIJE_I_REFERENCE.md`
- `docs/ARCHIVIST_REFERENCE_DOKUMENTACIJA.md`
- `docs/INDEXIRANJE_I_PERFORMANSE.md`
- `docs/INDEXIRANJE_RUNBOOK.md`
