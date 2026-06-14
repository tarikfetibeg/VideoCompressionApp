# Kljucne izmjene

Ovaj dokument biljezi bitne promjene u workflowu aplikacije, posebno one koje uticu na svakodnevno koristenje u TV produkciji.

## 2026-06-09

### Raw recovery ownership

- Admin recovery vise ne mora dodijeliti recoverane raw fajlove admin korisniku.
- U Admin / Video Management dodat je izbor `Recovery owner`.
- Novi uploadi upisuju raw recovery manifest, pa recovery moze automatski vratiti ownera, event i datum kada DB zapis nije nastao.
- Raw retention cleanup brise i pripadajuci recovery manifest kada obrise raw fajl.
- U Admin / Video Management moguce je promijeniti owner/uploader vec postojeceg video zapisa.
- Ovo je bitno kada batch upload fizicki snimi fajlove u `storage/raw`, ali dio fajlova ostane bez DB zapisa zbog ranijeg queue problema.

### Admin navigacija

- Admin Dashboard dobija brze shortcut akcije prema:
  - Reporter Desk
  - Production Desk
  - Admin Dashboard
- Admin sada moze otvoriti Production/Editor dashboard radi punog uvida u produkcijski workflow.

### Reporter archive

- Reporter Archive je razdvojen na:
  - `My Archive`: reporterovi licni uploadovani klipovi, sa akcijama nad vlastitim materijalom.
  - `TV Archive`: pregled svih TV klipova u read-only modu.
- U TV Archive reporter moze pregledati tudje klipove, ali ne moze brisati, retry processing, dodavati markere, kreirati job iz tudjeg klipa ili skidati fajlove.

### Organizacija workflowa

- `Prep` ostaje mjesto za upload, event/date tagging i pripremu priloga.
- `Jobs` ostaje mjesto za edit jobove, briefove, segmente i komunikaciju sa montazom.
- `Archive` ostaje mjesto za pronalazak i pregled video klipova, ne za primarni unos tagova ili kreiranje jobova.

## 2026-06-10

### Large batch ingest

- Reporter upload sada salje fajlove sekvencijalno, jedan po jedan, umjesto jednog velikog multipart requesta za cijeli folder.
- Ako jedan fajl padne, ostali fajlovi nastavljaju upload, a neuspjeli fajlovi ostaju selektovani za retry.
- Backend upload limit je podesiv kroz `MAX_UPLOAD_SIZE_GB` i `MAX_UPLOAD_FILES`; default je 25 GB po fajlu i 50 fajlova.
- FFprobe metadata greska vise ne prekida upload zapis; video se i dalje evidentira, a processing/retry ostaju vidljivi.

### Archive filter

- Reporter Archive sada koristi arhivski filter i prikazuje samo video zapise sa `status: edited`.
- Raw ingest i kompresovana sirovina ostaju u Prep/Production workflowu, a ne u Archive prikazu.

### Live processing progress

- Frontend sada automatski osvjezava video liste svakih 3 sekunde dok postoji `queued` ili `processing` klip.
- Reporter Prep, Production Desk, Admin Video Management, Video List i Video Details prikazuju svjez progress bez rucnog refresh-a stranice.
- Backend sada koristi FFmpeg progress evente tokom master/proxy transkodiranja, pa `processingProgress` vise nije samo nekoliko statickih skokova.

### Admin event grouping

- Admin / Video Management vise ne prikazuje video kartice kao jedan razbacan grid.
- Video materijali su grupisani po eventu, a svaka event sekcija prikazuje broj klipova, completed/processing/failed stanje i raw/edited odnos.
- Klipovi unutar eventa su sortirani od najnovijih prema starijim.
- Event sekcije se mogu expandati/collapseati, pa admin moze brzo skenirati samo relevantne evente.
- Checkbox na eventu selektuje ili deselektuje sve klipove iz tog eventa.
- Traka za bulk akcije dobija `Clear selection`, kako bi se sva selekcija mogla ponistiti jednim klikom.

### Readable edit package files

- Edit job ZIP paket sada ima citljiviji `job_manifest.json` sa sekcijama `Prilog`, `Upute za montazu` i `Segmenti za montazu`.
- `segments.csv` sada koristi jasne kolone za montazere: redni broj, naziv segmenta, tip, vrijeme pocetka/kraja, fajl u paketu, status fajla, status obrade i napomenu reportera.
- `README_EDIT_PACKAGE.txt` i pojedinacni `segment_notes.txt` su preformulisani kao prakticne upute za montazu, a ne kao tehnicki manifest.

### Reporter brief and OFF audio

- Edit job sada podrzava `scriptText`, odnosno puni reporterski brief/tekst priloga.
- Reporter moze dodati jedan ili vise OFF audio fajlova prilikom kreiranja joba iz Event Workspacea ili iz Video Details / marker workflowa.
- Brief se moze pisati direktno u aplikaciji ili importovati iz `DOCX`, `TXT`, `MD` ili `RTF` dokumenta.
- Montazer u Edit Job Details vidi brief, listu OFF fajlova, audio player i download za svaki OFF.
- Edit job ZIP paket sada ukljucuje `BRIEF_REPORTER.txt` i folder `OFF/` sa svim dostupnim OFF audio fajlovima.
- `job_manifest.json` i `README_EDIT_PACKAGE.txt` sada prikazuju i informacije o briefu i OFF fajlovima.

### Dynamic edit job updates

- Reporter moze naknadno otvoriti postojeci edit job i poslati izmjenu briefa, dodatne klipove/inserte, dodatne OFF fajlove i napomenu za montazu.
- Backend biljezi `changeLog` za edit job, ukljucujuci tip izmjene, autora, vrijeme i kratak opis.
- Production/Editor dashboard prikazuje broj jobova sa neprocitanim izmjenama i badge `update(s)` na konkretnom jobu.
- Kada editor otvori job, aplikacija zna da je taj editor pregledao najnovije izmjene.
- Edit job detalji prikazuju timeline izmjena u sekciji `Job updates`.
- Edit job ZIP paket sada sadrzi `CHANGELOG_JOB.txt`, a `job_manifest.json` ukljucuje sekciju `Naknadne izmjene`.

## 2026-06-11

### Broadcast programs and producer workflow

- Admin sada moze upravljati listom emisija/programa i kategorijama emitovanog sadrzaja iz Admin / Programs taba.
- Kategorije sadrzaja imaju default set: `Prilog`, `Insert`, `Spica`, `Promo`, `Marketing`, `Grafika`, `Ostalo`.
- Dodan je Producer Desk za dnevnu pripremu emisije po programu i datumu.
- Producer se moze prikljuciti jednoj ili vise emisija za taj dan, a aplikacija biljezi ko se kada prikljucio.
- U vandrednim situacijama producer moze uci u emisiju kolege kroz `Join show`, poslije cega moze dodavati i mijenjati materijal.
- Svaka emisija po danu ima rundown/listu materijala i activity log koji biljezi ko je dodao, spremio, emitovao ili uklonio stavku.
- Aplikacija sprjecava dupli unos istog finalnog videa ili istog naslova/kategorije u istu emisiju.
- Producer Desk sada prikazuje TV biblioteku/arhivu svih montiranih ne-sirovih video fajlova koji su zavrsili processing i imaju status spreman/odobren/emitovan/arhiviran.
- Producer moze pretrazivati tu biblioteku po naslovu, fajlu, eventu, kategoriji i keywordima, te dodati pronadjeni materijal u odabranu emisiju za odabrani dan.
- Datum i program u Producer Desku sada predstavljaju emisiju u koju se materijal dodaje, a ne ogranicavaju biblioteku samo na materijal uploadovan za taj datum.

### Final delivery and approval

- Editor/VideoEditor sada iz Edit Job Details moze uploadovati zavrseni montirani prilog za konkretan job.
- Finalni upload trazi emisiju, datum emitovanja, kategoriju sadrzaja, naslov i napomenu.
- Finalni video se obradjuje kao poseban `finalize` processing job: pravi se preview, thumbnail i cuva originalni final fajl kao master.
- Ako queue/worker trenutno ne prihvati obradu, finalni video ipak ostaje evidentiran u aplikaciji i moze se naknadno retryati.
- Reporter koji je kreirao job moze odobriti final; Producer i Admin mogu odobriti ili odbiti final u vandrednim/operativnim situacijama.
- Final se ne moze odobriti dok processing nije zavrsen, tako da odobrenje znaci da je fajl spreman za pregled i emitovanje.
- Odluka o odobrenju/odbijanju biljezi ko je odobrio/odbio, rolu, vrijeme i napomenu.
- Status edit joba se automatski pomjera na `ready_for_qc` nakon final upload-a, zatim na `approved` ili `needs_info` nakon odluke.
- Production Desk sada ima i `Direct Final Upload` za finalne materijale koji ne dolaze iz edit joba: priloge, inserte, spice, prome, marketing, grafiku i ostalo.
- Direktni final upload trazi emisiju, datum, kategoriju, naslov, opcionalni reporter/autor tag, keyworde i QA napomenu.
- Kod direktnog final uploada montazer/editor koji uploaduje materijal automatski je QA odgovorna osoba; materijal je self-approved od editora i poslije processinga ulazi u Producer Desk kao odobren final.
- Kod finala koji dolazi iz joba video zapis pamti reportera iz joba i editora koji je uploadovao final; QA odgovornost se upisuje na osobu koja je odobrila final.
- Svaki finalni video sada ima produkcijske tagove `reporter`, `editor`, `qaResponsible` i `qaResponsibilityType`, vidljive u Production listi, Producer Desku i Video Details prikazu.

### Archive after air

- Producer u rundownu moze oznaciti stavku kao `ready`, `aired` ili je ukloniti iz emisije.
- Kada je finalni materijal oznacen kao `aired`, video dobija `airedAt` i `archivedAt`, te ulazi u TV arhivu.
- Reporter/TV Archive vise ne prikazuje sirovu ili samo kompresovanu ingest sirovinu kao arhivski materijal; arhiva je vezana za emitovan/finalizovan sadrzaj.

### Realizator workflow

- Dodana je nova korisnicka rola `Realizator`.
- Realizator ima poseban `Realizator Desk` za izbor emisije i datuma, pregled rundowna i download kompletnog air paketa.
- Air paket je ZIP koji sadrzi `RUNDOWN.txt`, `show_manifest.json` i sve dostupne video fajlove aktivnih stavki emisije.
- Aplikacija pamti kada je svaki realizator zadnji put skinuo air paket za emisiju.
- Stavke koje su dodane ili izmijenjene poslije zadnjeg downloada dobijaju istaknut `Changed since download` indikator.
- Realizator vidi activity listu promjena od zadnjeg downloada, ukljucujuci posljednominutna dodavanja, zamjene i uklanjanja materijala.
- Producer sada ima `Replace material` akciju u rundownu: odabere stavku koju mijenja, zatim iz TV biblioteke izabere novi materijal.
- Svaka zamjena materijala upisuje activity log i audit log, pa realizator odmah vidi da air paket vise nije isti kao zadnji download.

## 2026-06-13

### Admin observability and feedback

- Dodan je globalni `Feedback` ekran za sve uloge: korisnik moze poslati bug, sugestiju, workflow problem ili hitan produkcijski problem.
- Feedback cuva tip, prioritet, dio aplikacije, status, korisnika, rolu, URL stranice i admin komentare.
- Admin Dashboard dobija `Feedback Inbox` za triage prijava: promjena statusa, prioriteta, assignee korisnika, admin komentara i internih komentara.
- Feedback triage sada ima eksplicitan `adminSeenAt` indikator: admin moze oznaciti prijavu kao pregledanu, a korisnik vidi da je prijava dosla do admina.
- `adminComment` je interna admin biljeska, a `adminResponse` je javni odgovor koji vidi korisnik koji je poslao prijavu.
- Slanje, azuriranje i komentarisanje feedbacka ulazi u audit log.
- Admin `Audit Logs` tab sada ima filtere po akciji, korisniku, roli, severity oznaci, datumskom rasponu i tekstualnoj pretrazi.
- Audit log UI dobija export u CSV i JSON radi lakseg slanja ili arhiviranja izvjestaja.
- Audit log `Details` prikaz je kompaktiran: tabela prikazuje kratak sazetak, a puni JSON se otvara po potrebi za konkretan red.
- Backend audit endpoint sada vraca i izvedeni `severity` i `entity` kontekst za brze razumijevanje osjetljivih akcija.
- Admin Overview sada prikazuje operativne metrike: failed processing, open feedback, critical logs, raw orphans, raw manifest orphans, korisnike, jobove sa izmjenama i emisije sa download state promjenama.

### Admin storage maintenance

- Admin Dashboard dobija poseban `Maintenance` tab za servisne fajlove koji nisu sama TV arhiva.
- Admin moze pregledati i brisati OFF audio fajlove vezane za edit jobove.
- Admin moze pregledati raw recovery manifest fajlove i vidjeti da li je raw fajl prisutan i da li postoji DB zapis.
- Admin moze obrisati pojedinacni raw manifest ili pokrenuti cleanup orphan manifesta.
- Admin moze u Maintenance tabu pregledati i obrisati stare feedback/prijave zapise, uz filter po statusu i tipu.
- Brisanje OFF audio fajla, brisanje raw manifesta i cleanup orphan manifesta se biljeze u audit log.
- Brisanje feedback/prijave se takodjer biljezi u audit log, dok Feedback Inbox ostaje primarno mjesto za rad na aktivnim prijavama.

### QA workflow refinements

- Event Workspace i Video Details job composer sada koriste `Program` select iz admin/program liste, umjesto rucnog upisa programa.
- Jobs tab dobija brisanje edit joba uz confirmation dialog; brisanje je dozvoljeno reporteru-vlasniku joba i adminu, dok se emitovani/arhivirani jobovi i jobovi sa finalnim videima ne brisu.
- Edit package za montazera je pojednostavljen: video fajlovi idu direktno u `VIDEO/`, OFF fajlovi u `OFF/`, a reporterski brief se isporucuje kao `BRIEF_REPORTER.docx`.
- Iz edit package-a su uklonjeni pomocni metadata fajlovi koji nisu potrebni montazeru: manifest, changelog, readme, CSV i segment notes.
- Producer vise ne moze ponovo oznaciti materijal kao `ready` ako je vec ready/airan, a backend odbija ponavljanje istog statusa.
- Activity log za promjenu statusa materijala sada navodi konkretan naslov materijala i prethodni/novi status.
- Realizator air package download sada koristi kompletna video path polja (`compressedPath`, `filepath`, `rawPath`, `previewPath`) i frontend prikazuje stvarnu backend poruku greske kada ZIP ne moze biti napravljen.

### Air confirmation and ingest-only final upload

- Realizator Desk dobija akciju `Confirm aired` za potvrdu da je odabrana emisija emitovana.
- Kada realizator potvrdi airanje emisije, sve aktivne stavke rundowna prelaze u status `aired`, a njihovi video zapisi se arhiviraju.
- Materijal tipa `Prilog` i `Insert` se u arhivi normalizuje na content type `Prilog`, jer se prilozi i inserti u TV praksi cesto ponovo koriste kao arhivski prilog u drugim emisijama i danima.
- Ostali tipovi emitovanog materijala, kao marketing, grafika, promo i spica, ostaju pod svojim content type tagom.
- Potvrda airanja zapisuje `airedAt`, `airedBy`, `archiveConfirmedAt`, `archiveConfirmedBy`, activity log i audit log.
- Realizator moze ponovo potvrditi airanje ako je materijal naknadno promijenjen, cime se novo/izmijenjeno stanje opet arhivira.
- Direct Final Upload za montazera/editor sada moze biti bez emisije kroz opciju `Nema emisije / ingest`.
- Kod direct upload-a bez emisije `Content type` ostaje obavezan, jer taj tag odredjuje kako ce materijal zivjeti u TV arhivi.
- Direct upload bez emisije se koristi za arhivske inserte, marketing, grafiku, spice, prome i drugi finalizovani materijal koji se samo unosi u sistem.
- TV Archive/My Archive prikaz sada ima `Video category` filter po content type-u, npr. `Prilog`, `Insert`, `Promo`, `Marketing`, `Grafika`, tako da se arhiva moze brzo suziti po vrsti materijala.

### Admin video archive QA

- Admin `Video Management` sada jasnije razdvaja workflow faze videa: `Sirovina / ingest`, `Smontiran materijal`, `Smontiran final` i `Arhiva / aired`.
- Admin video pregled dobija operativne metrike za sirovinu, smontirani materijal, arhivu, nekategorisane videe i processing/failed stanje.
- Filteri su razdvojeni na `Workflow`, `Processing`, `Category` i `Uploader`, tako da se problemi u arhivi lakse pronalaze.
- Video kartice prikazuju workflow chip, broadcast status, kategoriju, reportera/editora, ownera, storage velicine, raw retention i processing progres.
- Admin sada moze direktno iz `Video Management` promijeniti video kategoriju/content type (`Prilog`, `Insert`, `Promo`, `Marketing`, `Grafika`, itd.).
- Promjena video kategorije azurira `contentType`, `finalCategory`, dodaje kategoriju u keyworde i ulazi u audit log kao `Update Video Content Type`.
- Ove admin funkcije su pripremljene kao buduci temelj za rolu `Arhiver`, koja ce kasnije moci preuzeti QA arhive bez punih admin ovlasti.

### Video details compact layout

- `Video Details` stranica je prepakovana u kompaktniji radni layout: header sa status chipovima, player/markeri lijevo i metadata/QC panel desno.
- Video preview sada koristi compact mod sa ogranicenom visinom, tako da ne zauzima skoro cijeli ekran.
- Metadata su grupisana u jasne sekcije: osnovni opis, program/kategorija, reporter/editor/QA, source/output tehnicki podaci i storage velicine.
- QC i broadcast kontrole su premjestene u desni panel, blize statusima koje mijenjaju.
- `VideoPlayer` komponenta dobija `compact` opciju, pa se isti player moze koristiti i u velikom i u kompaktnom prikazu.

### Direct ingest archive visibility

- Razlog zasto direct-final `Prilog` i `Insert` uploadi nisu bili vidljivi u TV arhivi: nakon processinga su imali `broadcastStatus: approved_for_air`, dok TV Archive prikazuje samo arhivski/emitovani materijal.
- TV Archive filter sada prikazuje i zavrsene direct-ingest materijale bez emisije kada su kategorije `Prilog` ili `Insert`, imaju `finalApprovalStatus: approved` i processing je zavrsen.
- Novi direct-final upload bez emisije za kategorije `Prilog` i `Insert` automatski dobija arhivski status, jer nema realizatorski/airing korak koji bi ga kasnije poslao u arhivu.
- Video worker vise ne prepisuje `aired` ili `archived` status nazad na `approved_for_air` nakon processinga.

### Realizator correction reporting

- Realizator Desk sada omogucava prijavu greske za pojedinacni klip iz rundowna emisije.
- Prijava greske oznacava video zapis statusom `needs_correction` i u UI se prikazuje kao `Potrebna ispravka`.
- Realizator moze dodati opis greske, npr. pogresna verzija, los ton, fali grafika ili krivi kadar.
- Video pamti ko je prijavio gresku, kada, napomenu, emisiju/show-day i item iz kojeg je prijava nastala.
- Prijava ulazi u show activity log i audit log kao `Report Clip Correction Needed`.
- Oznaka `Potrebna ispravka` se prikazuje u Realizator Desku, Producer Desku, Video Details, TV Archive/My Archive listi i Admin Video Managementu.
- Ova funkcija je pripremljena kao buduci workflow za rolu `Arhiver`, koja ce kasnije moci raditi QA arhive i rjesavati oznake ispravke.

### Direct Final background bulk upload

- Direct Final Upload za montazere sada koristi background upload queue: fajlovi se dodaju u red i uploaduju jedan po jedan, pa korisnik moze nastaviti koristiti aplikaciju dok upload traje.
- Dok postoje aktivni ili pending uploadi, browser tab dobija `beforeunload` zastitu kako bi korisnik dobio upozorenje prije slucajnog zatvaranja/refresha taba.
- Globalni upload panel prikazuje aktivne, zavrsene i failed uploade, progres trenutnog fajla i retry za failed upload.
- Bulk upload vise ne salje sve fajlove u jednom velikom multipart requestu; time je smanjen rizik pucanja velikih dnevnih upload serija.
- Default backend limit za Direct Final request je povecan sa 20 na 100 fajlova, ali novi UI koristi jedan fajl po requestu.

### Filename metadata rules

- Kod bulk Direct Final uploada svaki video automatski dobija `finalTitle` iz svog filename-a, bez ekstenzije.
- Ako se uploaduje samo jedan fajl, rucno uneseni `Final title` ima prednost; ako je prazno, koristi se filename.
- Aplikacija iz filename-a pokusava izvuci datum u formatima `YYYY-MM-DD`, `YYYYMMDD`, `DD-MM-YYYY`, `DD.MM.YYYY`, `DD_MM_YYYY` i slicnim varijantama sa razmakom, tackom, crticom ili donjom crtom.
- Datum iz filename-a ima prednost nad rucno unesenim `Air / reference date`; ako datum nije pronadjen, koristi se rucni datum, a za `Nema emisije / ingest` fallback je danasnji datum kao referenca.
- Keywords se automatski izvode iz filename-a tako sto se ukloni datum, a ostatak naziva se rastavi na rijeci/brojeve. Rucno uneseni keywordi se dodaju na taj automatski set.
- Marketing bulk upload se uploaduje prirodnim redoslijedom filename-a, pa nazivi poput `Marketing Blok 1`, `Marketing Blok 2`, `Marketing Blok 10` ostaju u ocekivanom redoslijedu.

### Dynamic edit jobs and partial editor downloads

- Reporter moze naknadno dopuniti postojeci edit job novim insertima/klipovima kroz `Update job` dio na job details stranici.
- Reporter moze obrisati pogresan klip iz joba ili ga zamijeniti drugim klipom bez kreiranja novog joba.
- Brisanje i zamjena klipova ulaze u job change log i audit log, tako da produkcija vidi ko je i kada mijenjao materijal.
- Edit job pamti po montazeru koje segmente i OFF fajlove je vec uspjesno preuzeo.
- Montazer sada moze skinuti samo nove ili ranije propustene fajlove iz joba kroz `Download new / missed`.
- Montazer i dalje moze, po potrebi, skinuti puni paket kroz `Download full package`.
- Ako fajl nije bio dostupan na disku u trenutku downloada, ne oznacava se kao preuzet i ostaje u listi za naredni pokusaj.
- Kod zamjene klipa aplikacija namjerno resetuje download oznaku za taj segment, pa montazer vidi zamjenu kao novi materijal za preuzimanje.
- Parcijalni paket i dalje sadrzi aktuelni `BRIEF_REPORTER.docx`, tako da montazer uz nove inserte dobija i zadnju verziju reporterskog teksta.

### Producer and Realizator rundown ordering

- Producer Dashboard dobija `My shows` precice za emisije u kojima je producent vec prikljucen u narednih 14 dana.
- Klik na producer show precicu automatski postavlja program i datum emisije, bez rucnog biranja oba polja.
- Ako producent vec ima dodijeljenu emisiju, dashboard automatski bira danasnju/prvu dostupnu emisiju iz tih precica.
- Producer i Realizator sada mogu mijenjati redoslijed aktivnih klipova u emisiji kroz drag-and-drop handle direktno u rundown tabeli.
- Tokom dragovanja lista se preslaguje odmah u preview modu, pa korisnik vidi novi redoslijed prije nego sto pusti item.
- Drag/drop zona u rundown tabeli je prosirena na cijeli table body, a drop ostaje validan i kada se item tokom live previewa nadje ispod kursora.
- Nakon dropa UI optimisticki zadrzava novi redoslijed dok backend potvrdi promjenu; ako backend odbije izmjenu, rundown se ponovo ucitava.
- Producer mora biti prikljucen emisiji da bi mijenjao redoslijed, dok Realizator moze mijenjati redoslijed kao dio kontrole pred eter.
- Svaka promjena redoslijeda ulazi u activity log emisije i audit log kao `Reorder Show Rundown`.
- Promjena redoslijeda je globalna rundown promjena i vise ne oznacava svaki pojedinacni item kao izmijenjen, tako da se cijela lista ne boji zuto samo zbog reorder-a.
- Tip klipa u Producer i Realizator tabelama prikazuje se kao zaseban obojeni chip: `Prilog`, `Insert`, `Marketing`, `Promo`, `Grafika`, `Spica` i `Ostalo` imaju blage, neintruzivne tonove.
- Realizator sada vidi modal/progress dok aplikacija priprema i salje air ZIP paket, kako interfejs ne bi izgledao zamrznuto tokom velikih emisija.

### Archivist role / Archive Desk

- Dodana je nova korisnicka rola `Archivist`, koju admin moze kreirati i dodijeliti kroz `User Management`.
- `Archivist` ima poseban `Archive Desk` u header navigaciji i defaultno se preusmjerava na `/archivist-dashboard`.
- Arhivist ima read-only pristup video detaljima i downloadu videa, ali ne dobija pune admin ovlasti nad sistemom.
- Video model sada pamti arhivski review status: `unreviewed`, `reviewed`, `needs_metadata` i `duplicate`.
- Video model sada pamti ko je i kada pregledao klip, napomenu arhivskog pregleda, ko je mijenjao arhivske tagove i ako je klip oznacen kao duplikat kojeg master klipa.
- Dodane su `/api/archive` rute za arhivski summary, listu videa, duplicate candidates, tag update, category/content-type update, review status i sigurno brisanje duplikata.
- `Archive Desk` ima tri glavna pogleda: `Review Queue`, `All Videos` i `Duplicates`.
- `Review Queue` defaultno prikazuje materijal koji arhivist jos nije pregledao, sto rjesava dnevni pregled novog materijala.
- `All Videos` omogucava pretragu, filtriranje po workflowu, filter po kategoriji i promjenu content type-a bez ulaska u admin video management.
- Tag editor omogucava arhivisti da brzo zamijeni/doda/ukloni keywords/tagove na klipu.
- `Duplicates` prikazuje potencijalne duplikate na osnovu uporedivog naslova, trajanja i storage velicine.
- Brisanje duplikata trazi master/keeper klip i brise samo fajlove koji nisu referencirani od drugog video zapisa; sve preskocene i obrisane putanje ulaze u audit log.
- Sve arhivske promjene ulaze u audit log kao `Archive Update Video Tags`, `Archive Update Video Content Type`, `Archive Review Video` ili `Archive Delete Duplicate Video`.
- Admin `Audit Logs` filter sada poznaje rolu `Archivist`.

### Archivist reference notes

- Sve reference za arhivsku rolu su izdvojene u poseban dokument: `docs/ARCHIVIST_REFERENCE_DOKUMENTACIJA.md`.

### Suggested next archive improvements

- Dodati checksum/hash (`SHA-256` ili slicno) pri ingestu/final uploadu, pa duplikate nalaziti precizno po sadrzaju, ne samo po nazivu/trajanju/velicini.
- Dodati kontrolisani vocabulary manager za tagove, gdje admin/arhivist odobrava standardne termine, sinonime i zabranjene duplikatne termine.
- Dodati `rights/usage` polja za arhivu: interni materijal, agencijski materijal, ograniceno koristenje, embargo i slicno.
- Dodati batch akcije za arhivistu: oznaci vise klipova kao reviewed, dodaj tag na vise klipova, promijeni kategoriju za vise klipova.
- Dodati export arhivskog zapisa u CSV/PBCore-like format za Word prezentaciju, izvjestaje ili migraciju u pravi MAM sistem.

### Archivist metadata editing in Video Details

- `Video Details` sada za `Archivist` i `Admin` prikazuje dugme `Edit metadata` u metadata panelu.
- Arhivist moze iz video detalja mijenjati opisne/arhivske metapodatke: archive title, event, datum, program, content type, reporter, editor, tags/keywords i archive note.
- Tehnicki/system podaci kao codec, duration, bitrate, storage path, processing status i original filename ostaju read-only i ne mijenjaju se kroz arhivski metadata editor.
- Dodan je endpoint `/api/archive/metadata-options` koji vraca dozvoljene opcije iz sistema: aktivne programe, content types, reportere, editore i postojece evente.
- Dodan je endpoint `/api/archive/videos/:id/metadata` koji validira da program, content type, reporter i editor postoje u sistemu prije snimanja izmjena.
- `Program / show`, `Reporter / author` i `Editor / montage` koriste autocomplete iz sistemskih podataka; `Event` koristi postojece evente kao prijedloge, ali dozvoljava novi unos.
- Svaka promjena metadata ulazi u audit log kao `Archive Update Video Metadata` sa listom promijenjenih polja, starom vrijednoscu i novom vrijednoscu.

### Archivist archive scope and sorting

- `Archive Desk` vise ne prikazuje kompresovane sirovine/raw ingest materijal, jer taj prolazni materijal nije posao arhiviste i ionako se brise kroz retention workflow.
- `/api/archive` listanje, summary metrika, event opcije i duplicate scan sada rade nad zavrsenim/smontiranim materijalom (`status: edited`, `processingStatus: completed`).
- Workflow filter u `Archive Desk` vise nema `Raw ingest`; fokus je na finalnom materijalu, archive-ready materijalu, aired/archived materijalu i klipovima sa potrebnom ispravkom.
- Dodano je sortiranje arhivskog materijala po upload datumu, imenu, kategoriji, tagovima, reporteru ili editoru, uz izbor smjera sortiranja.
- Zbunjujuce `Metadata` dugme u Actions koloni je preimenovano u `Needs metadata`; njegova uloga je oznacavanje klipa kojem trebaju bolji metapodaci, dok se stvarno editovanje metapodataka radi kroz `Video Details -> Edit metadata`.
