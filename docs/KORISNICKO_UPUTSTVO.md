# Korisnicko uputstvo za VideoCompressionApp

Ova aplikacija sluzi za evidenciju, ingest, obradu, pregled i pripremu video materijala za TV produkciju. Osnovna ideja je da sirovi materijal udje u sistem, bude kompresovan i pripremljen za pregled, zatim prodje QC i tek onda dobije status da moze ici u eter.

## 1. Osnovni workflow

1. Reporter ili Admin uploaduje sirovi video materijal.
2. Aplikacija cuva originalni fajl u storage i kreira zapis u bazi.
3. Video obrada ide u queue.
4. Worker u pozadini pravi:
   - kompresovani/master fajl
   - browser preview fajl
   - thumbnail sliku
5. Montazer ili produkcija pregledaju materijal.
6. QC status se postavlja na pending, passed ili failed.
7. Producent ili Admin odobrava materijal za eter.
8. Materijal se moze oznaciti kao aired ili archived.

## 2. Role u sistemu

### Reporter

Reporter uploaduje sirovi materijal sa terena.

Reporter obavezno unosi:

- Event
- Date

Location je opcioni metadata i nije potreban za brzi dnevni ingest.

Reporter vidi uglavnom svoje uploadovane materijale.

U Archive tabu reporter ima dva pogleda. Archive prikazuje montirane/finalizovane klipove, ne raw ingest sirovinu:

- My Archive: licni montirani/finalizovani klipovi, sa akcijama nad vlastitim materijalom.
- TV Archive: read-only pregled dostupne TV arhive montiranih/finalizovanih klipova. Reporter moze pregledati tudje klipove, ali ne moze brisati, dodavati markere, retry processing, kreirati edit job ili skidati tudji materijal.

### Editor

Editor je montazer ili osoba koja radi sa materijalom u produkciji.

Editor moze:

- vidjeti materijale u produkcijskom dashboardu
- pretrazivati i filtrirati video materijale
- pregledati preview
- dodavati timecode oznake
- uploadovati finalne/montirane video fajlove
- raditi QC status
- skidati odabrane fajlove

### VideoEditor

VideoEditor ima produkcijski pregled materijala, ali nema sve upload/admin akcije kao Editor.

Tipicno se koristi za pregled, QC i rad sa postojecim materijalom.

### Producer

Producer pregleda materijal iz urednickog/produkcijskog ugla.

Producer moze:

- pregledati materijal
- raditi QC
- odobriti materijal za eter
- oznaciti da je materijal emitovan
- arhivirati materijal

### Admin

Admin upravlja sistemom.

Admin moze:

- kreirati korisnike
- mijenjati role
- resetovati lozinke
- podesavati FFmpeg/storage postavke
- pregledati audit logove
- brisati video materijale
- pokretati raw cleanup
- recoverovati orphan raw fajlove i dodijeliti im pravog ownera/uploadera
- promijeniti owner/uploader za postojeci video zapis
- brzo otvoriti Reporter Desk i Production Desk iz Admin Dashboarda

## 3. Pokretanje aplikacije

Za puni lokalni rad moraju biti dostupni:

- MongoDB
- FFmpeg

Redis je potreban u produkcijskom `redis` queue modu. Za privremeni QA/dev rad moze se koristiti `local` queue mod bez Redis-a.

U `.env` postoje dva nacina rada:

```bash
PROCESSING_QUEUE=local
```

Ovaj mod zaobilazi Redis. Web aplikacija sama obradjuje video fajlove u istom procesu. Dobar je za testiranje. Ako se aplikacija ugasi usred obrade, pri sljedecem startu pokusat ce ponovo ubaciti videe koji su ostali u `queued` ili `processing` statusu ako source fajl jos postoji.

```bash
PROCESSING_QUEUE=redis
```

Ovaj mod koristi Redis i odvojeni worker. To je preporuceni mod za produkciju jer je stabilniji za velike fajlove i dugotrajne FFmpeg poslove.

Kompletan sistem se pokrece jednom komandom:

```bash
npm run build --prefix frontend
npm run start:all
```

Ova komanda pokrece:

- web/API aplikaciju
- video worker za obradu fajlova

Ako je `PROCESSING_QUEUE=local`, worker se ne pokrece odvojeno jer web proces radi obradu. Ako je `PROCESSING_QUEUE=redis`, `npm run start:all` ce provjeriti Redis prije pokretanja i stati ako Redis nije reachable.

Backend slusa na portu `5000` i servira React build. Ako treba pristup preko IP adrese, drugi uredjaj otvara:

```text
http://IP_ADRESA_RACUNARA:5000
```

Za pristup sa druge mreze potrebno je otvoriti Windows Firewall za TCP `5000` i podesiti port forwarding na routeru prema lokalnom IP-u ovog racunara.

Ako se procesi pokrecu odvojeno:

```bash
npm start
npm run worker:video
```

## 4. Prvi Admin korisnik

U `.env` fajlu postaviti:

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=neka_sigurna_lozinka
```

Zatim pokrenuti:

```bash
npm run admin:create
```

Ako admin vec postoji i treba reset lozinke:

```bash
ADMIN_RESET_PASSWORD=true
```

pa ponovo pokrenuti:

```bash
npm run admin:create
```

## 5. Reporter workflow

1. Login kao Reporter.
2. Otvoriti Reporter Dashboard.
3. U Prep tabu kliknuti Select.
4. Odabrati jedan ili vise video fajlova.
5. Unijeti Event.
6. Date je po defaultu danasnji datum, ali ga je moguce promijeniti.
7. Po potrebi otvoriti Technical profile i promijeniti FFmpeg postavke.
8. Kliknuti Upload.

Kod velikih foldera aplikacija salje fajlove jedan po jedan. Ako jedan fajl ne prodje, ostali nastavljaju upload, a neuspjeli fajlovi ostaju selektovani za retry.

Nakon uploada, aplikacija vraca poruku da je upload prihvacen i da je video obrada stavljena u queue.

Reporter ne treba cekati da se kompletan video odmah kompresuje. Obrada ide u pozadini.

Podrzani ingest containeri ukljucuju: MP4, MOV/QuickTime, MXF, AVI, MKV, WebM, MPEG-TS/MTS/M2TS, MPEG/MPG, DV, WMV/ASF, VOB, OGV, FLV i 3GP. Kod MXF fajlova uspjeh zavisi od codeca unutar MXF-a i FFmpeg builda koji je instaliran na racunaru.

Za pripremu priloga reporter u Event Workspace dijelu bira datum i event. Aplikacija grupise sve klipove za taj event, selektuje ih kao jednu cjelinu i omogucava kreiranje edit joba bez otvaranja svakog klipa posebno.

## 6. Editor / montazer workflow

1. Login kao Editor, VideoEditor ili Producer.
2. Otvoriti Production Dashboard.
3. Prvo otvoriti Jobs tab.
4. Pregledati nove edit jobove koje su reporteri poslali.
5. Otvoriti job, pregledati brief i selektovane segmente.
6. Kliknuti Claim Job ako montazer preuzima zadatak.
7. Koristiti linkove iz segment liste za skok direktno na trazeni dio klipa.
8. Po potrebi promijeniti status:
   - claimed
   - in_edit
   - needs_info
   - ready_for_qc
9. Koristiti komentare unutar joba za komunikaciju sa reporterom/producentom.
10. Material tab koristiti za siri pregled svih video materijala.

U Material tabu pratiti statusne kartice na vrhu:

   - Total
   - Raw
   - Processing
   - QC Pending
   - Approved
   - Issues
11. Koristiti filtere za pronalazak materijala:
   - Search
   - Event
   - Location
   - Reporter
   - Date
   - Material
   - Processing
   - QC
   - Broadcast
12. Otvoriti detalje videa preko ikone u tabeli.
13. Pregledati preview.
14. Dodati markere ako su potrebni.
15. Postaviti QC status:
   - pending
   - passed
   - failed
16. Po potrebi skinuti jedan ili vise fajlova.

Production Dashboard se automatski osvjezava svakih 30 sekundi.

## 7. Final upload workflow

Editor moze uploadovati finalni montirani materijal.

1. U Production Dashboard kliknuti Final Upload.
2. Odabrati finalne video fajlove.
3. Unijeti Event.
4. Date je po defaultu danasnji datum.
5. Unijeti Location i Keywords ako su potrebni.
6. Kliknuti Upload.

Final upload se takodje evidentira u sistemu i dobija preview/thumbnail obradu.

## 8. QC workflow

QC sluzi da se materijal ne pusti u eter bez provjere.

QC statusi:

- pending: materijal jos nije pregledan
- passed: materijal je prosao kontrolu
- failed: materijal ima problem

QC se radi na Video Details stranici.

## 8a. Edit job workflow

Edit job je produkcijski zadatak za montazera. Reporter ga najbrze kreira iz Reporter Dashboard / Prep taba, gdje su klipovi grupisani po eventu i datumu. Precizni marker workflow na Video Details stranici ostaje za situacije kada treba oznaciti tacne In/Out dijelove.

Reporter workflow:

1. Otvoriti Reporter Dashboard.
2. U Prep tabu provjeriti Event Workspace.
3. Izabrati datum i event.
4. Provjeriti listu klipova i po potrebi iskljuciti klipove koji ne idu u prilog.
5. Unijeti job title, program, deadline, priority, brief i instruction.
6. Kliknuti Send to Production.

Precizni marker workflow:

1. Otvoriti video.
2. Na playeru zaustaviti video na bitnim mjestima.
3. Dodati markere:
   - In
   - Out
   - Cut
   - Note
4. In i Out marker zajedno formiraju segment.
5. U Create Edit Job panelu unijeti:
   - job title
   - program
   - deadline
   - priority
   - reporter brief
   - initial comment / editing instruction
6. Odabrati segmente koji trebaju montazeru.
7. Kliknuti Send to Production.

Montazer workflow:

1. Otvoriti Production Dashboard.
2. Otvoriti Jobs tab.
3. Kliknuti Open na jobu.
4. Procitati brief.
5. Kliknuti Claim & Download Package.
6. Browser skida ZIP paket na lokalni montazni kompjuter.
7. Raspakovati ZIP u folder projekta.
8. Otvarati segmente iz Requested segments tabele ako treba dodatni preview u browseru.
9. Svaki segment vodi direktno na video i start time.
10. Promijeniti status na in_edit kada pocne montaza.
11. Ako nesto fali, status prebaciti na needs_info i dodati komentar.
12. Kada je montaza spremna, status prebaciti na ready_for_qc.

Edit package sadrzi:

- numerisane foldere po redoslijedu segmenata
- dostupni master/source video fajl za svaki segment
- segment_notes.txt u svakom folderu
- README_EDIT_PACKAGE.txt
- job_manifest.json
- segments.csv

Napomena: ZIP ne reze fizicki klipove na In/Out tačke. Montazer dobija cijeli dostupni source/master fajl i tacne start/end upute u manifestu.

Pravila:

- Video mora zavrsiti processing prije nego sto QC moze biti passed.
- Ako je QC failed, materijal ne treba ici u eter.
- QC notes treba koristiti za konkretan opis problema.

Primjeri QC napomena:

- Audio je prenizak.
- Pogresan framerate.
- Nedostaje kraj priloga.
- Slika ima freeze na 00:01:12.
- Materijal nije za eter bez dodatne montaze.

## 9. Broadcast workflow

Broadcast status pokazuje gdje se materijal nalazi u putu prema eteru.

Moguci statusi:

- not_ready
- qc_pending
- qc_failed
- ready_for_approval
- approved_for_air
- aired
- archived

Tipican put:

```text
processing completed -> qc_pending -> QC passed -> ready_for_approval -> approved_for_air -> aired -> archived
```

Producent ili Admin moze:

- approve for air
- mark aired
- archive

Materijal ne moze biti approved_for_air ako processing nije completed i QC nije passed.

## 10. Admin workflow

Admin Dashboard ima vise sekcija.

### User Management

Admin moze:

- kreirati korisnika
- dodijeliti rolu
- promijeniti rolu
- resetovati lozinku

Javna registracija je ugasena po defaultu. Novi korisnici se kreiraju kroz Admin panel.

### Video Management

Admin moze:

- pregledati sve video materijale
- filtrirati
- skinuti fajlove
- brisati materijal
- vidjeti storage i processing statuse
- skenirati `storage/raw` za orphan fajlove
- uvesti orphan raw fajlove nazad u aplikaciju preko Recover Raw akcije

Orphan raw fajl je fajl koji postoji lokalno u `storage/raw`, ali nema zapis u bazi. Ovo se moze desiti ako je batch upload fizicki snimio vise fajlova, a aplikacija je ranije pala na queue koraku prije nego sto su svi zapisi kreirani.

Recovery:

1. Otvoriti Admin Dashboard.
2. Otvoriti Video Management.
3. U polju Recovery owner ostaviti Auto / current admin ako zelis da aplikacija prvo procita upload manifest, ili rucno izabrati korisnika kojem recoverani fajlovi trebaju pripasti.
4. Kliknuti Scan Raw.
5. Ako Recover Raw pokazuje broj veci od nule, kliknuti Recover Raw.
6. Aplikacija kreira video zapise i pokrece processing za pronadjene raw fajlove.

Novi uploadi upisuju recovery manifest u `storage/raw-manifests`, pa aplikacija moze automatski vratiti ownera, event i datum ako DB zapis nije nastao. Ako je fajl vec recoveran pod pogresnim korisnikom, Admin moze u Video Management kartici promijeniti Owner.

### FFmpeg & Storage

Admin podesava:

- codec
- rezoluciju
- bitrate
- framerate
- raw retention policy

Raw retention odredjuje koliko dugo se cuva sirovina nakon obrade.

### Audit Logs

Audit logovi pokazuju bitne aktivnosti:

- upload
- brisanje
- promjena FFmpeg postavki
- kreiranje korisnika
- reset lozinke
- QC promjene
- broadcast status promjene

## 11. Processing statusi

Processing status govori sta se desava sa video obradom.

- uploaded: fajl je uploadovan
- queued: posao ceka worker
- processing: worker obradjuje fajl
- completed: obrada je zavrsena
- failed: obrada je pala

Ako je status failed, pogledati error poruku u listi ili detaljima.

Ako raw/source fajl jos postoji lokalno, kliknuti Retry Processing nakon sto je problem rijesen. Ovo je korisno kada je upload vec zavrsen, ali Redis, worker ili FFmpeg nisu bili spremni.

Najcesci uzroci:

- FFmpeg nije instaliran ili nije na PATH-u
- Redis nije pokrenut, ako je aplikacija u `PROCESSING_QUEUE=redis` modu
- worker nije pokrenut, ako je aplikacija u `PROCESSING_QUEUE=redis` modu
- fajl je ostecen
- nema dovoljno disk prostora

## 12. Storage folderi

Aplikacija koristi `storage` direktorij:

- `storage/raw`: sirovi uploadovani fajlovi
- `storage/compressed`: kompresovani/master output
- `storage/previews`: browser preview fajlovi
- `storage/thumbnails`: thumbnail slike
- `storage/final`: finalni materijali
- `storage/temp`: privremeni fajlovi

## 13. Dobre prakse u produkciji

- Ne koristiti javnu registraciju u produkciji.
- Svaki korisnik treba imati svoju licnu lozinku.
- Role dodjeljivati prema stvarnom poslu.
- Ne brisati raw materijal prije nego sto je politika retencije jasna.
- Ne odobravati za eter bez QC passed statusa.
- QC notes pisati jasno i konkretno.
- Worker mora biti stalno pokrenut.
- Pratiti disk prostor.
- Redovno praviti backup baze i storage foldera.

## 14. Preporuceni dnevni rad

### Reporter

1. Upload sirovine.
2. Provjera da je materijal evidentiran.
3. Po potrebi dopuna tagova kroz dogovor sa montazom/produkcijom.

### Montazer

1. Otvoriti Production Dashboard.
2. Filter: Raw ili QC pending.
3. Pregledati preview i metadata.
4. Montirati materijal van sistema ako je potrebno.
5. Uploadovati final.
6. Dodati timecode ili QC napomene.

### Producent

1. Filter: ready_for_approval ili QC passed.
2. Pregledati finalni materijal.
3. Approve for air.
4. Nakon emitovanja oznaciti aired.
5. Arhivirati kada vise nije aktivno.

### Admin

1. Provjeriti failed processing.
2. Provjeriti disk/storage.
3. Po potrebi pokrenuti raw cleanup.
4. Upravljati korisnicima i rolama.

## 15. Sta jos treba poboljsati

Preporucene sljedece funkcije:

- automatski tehnicki QC preko FFprobe
- loudness provjera po EBU R128
- direktne QC akcije iz Production Dashboard tabele
- live status update preko WebSocket ili SSE
- server-side pagination za velike arhive
- definisani broadcast output profili prema playout sistemu televizije
- export izvjestaja po danu, emisiji ili reporteru
