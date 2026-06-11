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
