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
   - scrub preview slicice za hover pregled
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

TV Archive prikazuje final/QC odobrenu biblioteku: materijal mora biti montiran, obrada zavrsena, broadcast status mora biti approved/air/archive tok, a dodatno mora imati final approval, QC passed ili vec biti aired/archived. Zato reporter u arhivi vidi i spremne/finalizovane priloge koji jos nisu nuzno emitovani.

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

- pregledati materijal kroz Producer Desk, TV archive i Video Details
- koristiti rundown workflow za emisiju
- odobriti materijal za eter
- oznaciti da je materijal emitovan
- arhivirati materijal

Producer nema zaseban pristup Production Desk-u; produkcijski job board i material tab su namijenjeni Editor/VideoEditor/Admin rolama.

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
- izgraditi nedostajuce scrub preview slicice za stare klipove kroz Storage Maintenance
- pokrenuti backend performance runbook za `searchText` backfill, kreiranje indexa i explain provjere kada baza naraste
- brzo otvoriti Reporter Desk i Production Desk iz Admin Dashboarda

### Scrub preview u dnevnom radu

Producer, Realizator i Archivist na listama materijala vide malu preview slicicu klipa. Kada se kursor pomjera preko slicice, aplikacija mijenja frame previewa po poziciji kursora, slicno YouTube hover previewu.

Ako klip nema scrub preview, prikazuje se obicni thumbnail i workflow nastavlja normalno. Admin moze otvoriti Admin / Storage Maintenance / Preview slicice i pokrenuti `Build missing`, sto generise preview samo za klipove kojima nedostaje.

### Globalni download manager

Svi stvarni downloadi iz aplikacije idu kroz globalni Download manager: pojedinacni video, vise videa kao ZIP, edit package, OFF fajl i air package.

Tok rada:

1. Korisnik klikne `Skini`, `Skini paket`, `Skini air paket` ili slicnu akciju.
2. Aplikacija kreira kratkotrajni sigurni download ticket.
3. Desktop aplikacija dobija sigurni URL i pokreće native skidanje u pozadini; web izdanje predaje URL browseru.
4. Globalni panel prikazuje fazu, prenesene bajtove, ukupnu veličinu, procenat, brzinu i procijenjeno preostalo vrijeme kada ih server može odrediti.

Korisnik može nastaviti koristiti aplikaciju dok se veliki ZIP ili video skida. Kod native downloada transfer se može pauzirati, a `.part` fajl omogućava nastavak. Ako streamovani ZIP nema unaprijed poznatu ukupnu veličinu, panel prikazuje primljene bajtove i brzinu bez netačnog procenta. Klik na download status u vrhu aplikacije ponovo otvara panel.

Ako se aplikacija koristi sa drugog racunara, preporuceni pristup je backend-servirani URL, npr. `http://server-u-tv-kuci:5000`. U tom modu frontend koristi relativni `/api`, pa login, API i download ticketi idu preko istog hosta. Za instalirani desktop build ili odvojeni Vite dev server, `ALLOWED_ORIGINS` i `VITE_API_BASE_URL` moraju pokazivati na stvarni backend, ne na `localhost` drugog racunara.

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

Ako je edit job vec kreiran, reporter u Event Workspaceu moze promijeniti nacin slanja na `Dopuni postojeci job`, odabrati postojeci job i dodati nove klipove/inserte iz istog eventa. Ovo je korisno kada nakon inicijalnog uploada stignu dodatni inserti ili B-roll.

U Edit Job Details reporter ima dodatnu dopunu joba:

- `Iz materijala/arhive`: pretraga vlastitih materijala i TV Archive odobrenih klipova, zatim dodavanje u job kao novi segment.
- `Sa kompjutera`: direktni upload novih video fajlova u postojeci job. Aplikacija ih odmah evidentira kao nove segmente, a obrada ide u pozadini.

Montazer ce takve dopune vidjeti kao nove/nedostajuce fajlove u jobu i moze skinuti samo nove fajlove ili kompletan edit paket.

## 6. Editor / montazer workflow

1. Login kao Editor ili VideoEditor.
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
   - Kategorija
   - Material
   - Processing
   - QC
   - Broadcast
12. Otvoriti detalje videa preko ikone u tabeli.
13. Pregledati preview.
14. Dodati markere ako su potrebni.
15. Ako je finalizovan materijal pogresno kategorisan, koristiti akciju `Prijavi pogresnu kategoriju` u Material tabu i upisati kratku napomenu za arhivu. Materijal tada ide arhiveru kao `Treba metadata`.
16. Postaviti QC status:
   - pending
   - passed
   - failed
17. Po potrebi skinuti jedan ili vise fajlova.

Kada se u Material tabu skida vise odabranih materijala, aplikacija prikazuje da se ZIP priprema i da je skidanje u toku. Kod velikih fajlova treba ostaviti tab otvoren dok browser ne pokrene download.

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

Video Management sada koristi paginirani workspace prikaz. To znaci da filteri i pretraga ne ucitavaju kompletnu video bazu odjednom, a thumbnail slike se povlace tek kada su kartice vidljive na ekranu.

Preporuceni admin tok:

1. Prvo filtrirati po Workflowu: sirovina, smontirano, final, arhiva ili bez kategorije.
2. Zatim suziti po Processing statusu ako se traze greske.
3. Po potrebi filtrirati po kategoriji ili uploaderu.
4. Za vece liste koristiti paginaciju, ne pokusavati selektovati materijal preko vise stranica odjednom.

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

Audit Logs sada ima paginirani workspace prikaz. Search polje je debounceovano i salje pretragu tek od 2 karaktera, pa se logovi ne osvjezavaju za svako pojedinacno slovo dok korisnik kuca.

Za vece baze koristi se backend runbook `docs/INDEXIRANJE_RUNBOOK.md`, koji opisuje `searchText` backfill, kreiranje indexa i explain provjeru queryja.

### Feedback Inbox

Admin Feedback Inbox je mjesto za triage korisnickih prijava.

Admin moze:

- oznaciti prijavu kao pregledanu
- promijeniti status i prioritet
- dodijeliti assignee korisnika
- pisati internu admin biljesku
- poslati javni odgovor korisniku
- dodati interne komentare

`adminComment` je interna biljeska za admin tim. `adminResponse` vidi korisnik koji je poslao prijavu.

### Archivist Desk

Archivist Desk sluzi za rad na TV arhivi nakon sto je materijal finalizovan ili emitovan.

Glavni pogledi:

- Review queue: materijali koji jos nisu arhivski pregledani.
- Svi materijali: paginirani pregled sa search, workflow, content type i sort filterima.
- Duplikati: kandidati za duplikate grupisani po slicnom naslovu, trajanju i velicini.

Arhivist moze:

- urediti metadata: finalni naslov, event, datum, kategoriju, tagove i review biljesku
- brzo urediti samo tagove
- postaviti review status
- oznaciti materijal kao pregledan
- otvoriti Video Details za detaljan pregled i marker workflow
- obrisati duplikat uz izbor keeper zapisa i razlog brisanja

Brisanje duplikata brise fajlove samo kada ih ne referencira drugi video zapis.

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

## 14a. Novi operativni UI

Aplikacija sada koristi zajednicki operativni okvir za sve uloge.

Lijeva/kompaktna navigacija prikazuje samo radne prostore koje korisnik moze koristiti prema roli:

- Reporter
- Produkcija
- Producent
- Realizator
- Arhiva
- Admin
- Feedback

Na vrhu ekrana prikazuje se trenutni radni prostor, opis radnog konteksta, korisnik/rola i globalni upload/status bar.

Globalni upload/status bar pokazuje:

- da li je upload aktivan
- broj aktivnih uploadova
- broj zavrsenih uploadova
- broj upload gresaka
- napomenu da se polling za video obradu koristi samo kada postoji aktivna obrada

### Production Desk

Production Desk je organizovan kao komandni centar:

- `Jobs` je primarni tab za briefove, OFF fajlove, izmjene i status montaze.
- `Materijal` je tab za siri pregled sirovine, finala, QC i air statusa.
- Materijal tab prikazuje thumbnail/scrub preview direktno u listi, pa se klip moze prepoznati bez otvaranja detalja.
- Materijal tab ima i `Kategorija` filter za content type, npr. `Prilog`, `Promo` ili `Insert`.
- Finalizovan materijal sa pogresnom kategorijom moze se poslati arhiveru na provjeru; arhiver ga vidi u Archive Desk review queue kao `Treba metadata`.
- Jobs tab ima search i status filter.
- Material tab koristi server-side workspace pretragu i summary metrike, tako da se veci broj video zapisa ne mora ucitavati kao jedna velika lista.

### Reporter Desk

Reporter Desk je fokusiran na dnevni ingest:

- `Priprema` sluzi za upload sirovine, event/date tagging i kreiranje edit joba.
- `Jobs` sluzi za pregled i komunikaciju oko edit jobova.
- `Arhiva` prikazuje finalizovane/montirane materijale.

Reporter arhiva koristi paginirani workspace prikaz. `My Archive` prikazuje vlastite finalizovane materijale, dok je `TV Archive` read-only pregled sire TV arhive. Oba prikaza imaju thumbnail/scrub preview na karticama.

### Feedback

Feedback ekran je dostupan svim ulogama.

Lijevi dio ekrana sluzi za novu prijavu, a desni dio prikazuje `Moje prijave`.

Korisnik vidi:

- status prijave
- prioritet
- tip prijave
- da li je admin vidio prijavu
- javni admin odgovor, ako postoji

Korisnik ne vidi interne admin biljeske i interne komentare.

### Producer Desk

Producer Desk koristi rundown header sa signalima:

- broj stavki u emisiji
- broj producenata na emisiji
- da li je aktivan replace mode

TV biblioteka u Producer Desku koristi paginirani search endpoint, preview slicice i scrub preview, sto je priprema za rad sa vecom arhivom.

### Realizator Desk

Realizator Desk prikazuje:

- broj aktivnih stavki
- da li postoje izmjene poslije zadnjeg download-a
- da li je emisija vec potvrđena kao emitovana

Akcije za download air paketa i potvrdu etera ostaju na vrhu ekrana.

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

1. Otvoriti Producer Dashboard.
2. Izabrati program i datum emisije.
3. Pretraziti TV archive / ready material uz preview slicice.
4. Dodati, zamijeniti ili urediti materijal u rundownu.
5. Otvoriti Video Details kada treba detaljan preview ili approval akcija.

### Admin

1. Provjeriti failed processing.
2. Provjeriti disk/storage.
3. Po potrebi pokrenuti raw cleanup.
4. Upravljati korisnicima i rolama.

## 16. Partial search, rokovi i correction workflow

### Pretraga arhive

Unesite najmanje dva znaka. Nije potrebno zavrsiti rijec: `ins` nalazi
`insert`, a pretraga radi i bez tacnog unosa BHS dijakritike.

### Montazer

- Production Desk po defaultu prikazuje aktivne jobove.
- `Historija` prikazuje istekle, zatvorene i otkazane jobove.
- Correction job je oznacen kao hitan i sadrzi napomenu i timestamp prijave.
- Nakon zavrsene ispravke postaviti correction zahtjev na `Spremno za pregled`.

### Producent

- Correction queue prikazuje sve otvorene prijave realizatora.
- Ako montazer nije poznat, izabrati montazera i koristiti `Posalji`.
- Nakon novog finala zamijeniti klip u rundownu; zahtjev se tada zatvara.

### Realizator

- Akcija `Pregled` otvara bocni 16:9 player sa statusima i detaljima klipa.
- Pokrenuti video do mjesta greske i koristiti prijavu na trenutnom playheadu.
- `Otvori puni pregled` vodi na read-only Video Details.

### Admin

- `Jobs` modul upravlja svim jobovima i njihovim lifecycle stanjem.
- `Primijeni SLA` je kontrolisana batch akcija za stare jobove.
- SLA i grace period se podesavaju uz Broadcast Content Type.
- `Storage Maintenance > HLS streaming` prikazuje spremne, nedostajuce,
  aktivne i neuspjele streamove.
- HLS Build missing radi u pozadini. Za velike arhive koristiti batch 5-10.

Player automatski bira kvalitet. `Auto` se preporucuje za udaljene ili
nestabilne mreze; 720p/480p se mogu izabrati rucno. Ako HLS nije spreman,
aplikacija bez prekida koristi MP4 Range streaming.

## 17. Admin: NVENC i MP4 preview cleanup

1. Otvoriti `Admin > FFmpeg Settings`.
2. Pokrenuti `NVENC probe`. Probe mora zavrsiti sa `PASS`.
3. Nakon benchmarka izabrati `NVIDIA NVENC / H.264`, preset `p5` i ostaviti
   ukljucen CPU fallback.
4. U `Storage Maintenance > HLS streaming` pratiti NVENC/CPU buildove,
   fallbackove, prosjecno vrijeme i greske.
5. U `Storage Maintenance > MP4 preview cleanup` prvo pokrenuti dry-run.
6. Pregledati listu `Moze se obrisati` i `Zadrzati`.
7. Cleanup potvrditi prvo za mali batch.

Dry-run ne brise nista. Cleanup ponovo provjerava HLS, alternativni MP4,
shared putanju i storage root. Nikada ne brise master/final fajl.

NVENC se ne ukljucuje sam pri deployu. Ako GPU ili driver privremeno nisu
dostupni, aplikacija koristi CPU fallback, a osnovni ingest ostaje u zasebnom
queueu.

Detaljni rollout, rollback i benchmark:
`docs/NVENC_I_PREVIEW_RETENCIJA.md`.

## 18. Admin storage i media profili

### Kapacitet

1. Otvoriti `Admin > Maintenance > Kapacitet`.
2. Provjeriti slobodan prostor i status volumena.
3. Pregledati najvece media, operativne i aplikacijske kategorije.
4. Po potrebi podesiti warning i critical prag.
5. Koristiti `Novi scan` kada treba svjeza detaljna raspodjela.

Critical status je upozorenje i ne zaustavlja upload.

### Media profili

1. Otvoriti `Admin > FFmpeg`.
2. Izabrati Master, MP4 preview, HLS ili Slike tab.
3. Za NVENC prvo pokrenuti capability probe.
4. Sacuvati profil i provjeriti novi version chip.
5. Otvoriti `Maintenance > Media rebuild`.
6. Izabrati `Zastarjeli` ili `Nedostajuci`, asset tipove i batch limit.
7. Prvo rebuildati mali batch i provjeriti Video Details.

Za tacno odabrane klipove koristiti Video Management selekciju i akciju
`Rebuild previewa`.

Promjena profila ne mijenja stare klipove dok Admin ne potvrdi rebuild.

## 19. Reporter radni prostor i komentari

### Aktivni jobovi

Nakon prijave Reporter prvo vidi aktivne jobove. Job sa novim komentarom,
zahtjevom za dopunu ili bliskim rokom automatski je podignut na vrh.

- `Dodaj klipove` otvara dopunu bez ponovnog biranja eventa.
- `Komentari` otvara brzi bocni panel sa cijelim razgovorom.
- `Puni pregled` otvara sve detalje, brief, OFF i finalni workflow.
- Zvono u gornjoj traci prikazuje komentare montazera koji jos nisu otvoreni.

Otvaranje joba ili notifikacije oznacava poruku kao procitanu. Akcija sa
ikonom dvostruke kvacice oznacava sve notifikacije kao procitane.

### Naknadni inserti i klipovi

1. Na aktivnom jobu izabrati `Dodaj klipove`.
2. Za postojeci materijal otvoriti `Sa servera`.
3. Pretraziti reporterove materijale i TV arhivu, po potrebi izabrati
   kategoriju.
4. Preko sličice provjeriti thumbnail/scrub ili otvoriti Video Details.
5. Oznaciti klipove, upisati napomenu i izabrati `Dodaj odabrano`.

Za novi fajl otvoriti `Sa kompjutera`, odabrati jedan ili vise video fajlova
i pokrenuti upload. Event, datum i lokacija podrazumijevano se preuzimaju iz
joba. Nakon zavrsetka job kartica odmah prikazuje novi broj klipova.

### Novi prilog

Sekcija `Novi prilog` je ispod aktivnih jobova. Ako nema aktivnih jobova,
otvara se automatski. Osnovni tok je:

1. Upload sirovine.
2. Izbor eventa i klipova.
3. Naziv i kategorija joba.
4. `Posalji produkciji`.

Program, rok, prioritet, detaljni brief, OFF i instrukcija ostaju dostupni
pod `Dodatne opcije`.

### Montazer

U `Edit Job Details > Sirovine za montazu` svaki klip ima lazy sličicu.
Pomjeranje kursora po sličici koristi scrub preview kada postoji. Ikona za
otvaranje vodi na Video Details i zadrzava pocetni marker segmenta.

Komentar upisan u sekciji `Komentari` obavjestava reportera kroz globalno
zvono. Reporterov odgovor na isti nacin obavjestava dodijeljenog montazera.

## 20. Potrebna ispravka: Arhiva i Produkcija

### Arhivista

Klip sa crvenom oznakom `Potrebna ispravka` nudi sljedece akcije:

- `Posalji u montazu` kreira ili povezuje correction zahtjev i correction
  job. Ako je poznat odgovorni montazer, zahtjev mu se automatski dodjeljuje.
- `Povuci oznaku` koristi se samo kada je oznaka pogresno postavljena.
  Obrazlozenje je obavezno i ostaje u Audit Logu.
- `Potvrdi ispravku` pojavljuje se kada montazer zavrsi rad i zahtjev je
  spreman za pregled.

Aktivna ispravka u montazi ne moze se povuci preko Arhive. Admin moze
intervenisati kada postoji opravdan operativni razlog.

### Montazer

`Production Desk > Ispravke` po defaultu prikazuje sve otvorene ispravke:

- `Sve otvorene` je zajednicki produkcijski queue.
- `Dodijeljene meni` prikazuje licni rad.
- `Nedodijeljene` prikazuje zahtjeve koje montazer moze preuzeti.
- `Preuzmi` dodjeljuje zahtjev i correction job trenutnom montazeru.
- `Zapocni` mijenja status u `U montazi`.
- `Spremno` predaje ispravku Producentu/Arhivi na potvrdu.

Klip ostaje u ovom tabu dok Producent, Arhivista ili Admin ne potvrdi
ispravku ili kontrolisano odbaci pogresnu prijavu.

### Trag odgovornosti

- `Ispravio` oznacava montazera koji je napravio correction final.
- `Potvrdio/zatvorio` oznacava korisnika koji je pregledao rezultat i
  zatvorio zahtjev.
- Correction zahtjev, correction job i Audit Log ostaju sacuvani nakon
  uklanjanja aktivne oznake sa videa.

## 15. Sta jos treba poboljsati

Preporucene sljedece funkcije:

- automatski tehnicki QC preko FFprobe
- loudness provjera po EBU R128
- direktne QC akcije iz Production Dashboard tabele
- live status update preko WebSocket ili SSE
- server-side pagination za velike arhive
- definisani broadcast output profili prema playout sistemu televizije
- export izvjestaja po danu, emisiji ili reporteru

## 16. Aplikacija v2 na Windowsu

- Nakon prijave početni ekran `Moj rad` prikazuje samo zadatke i sljedeće akcije relevantne tvojoj roli.
- Zatvaranje prozora skriva aplikaciju u Windows tray; `Izlaz` potpuno gasi aplikaciju i upozorava na aktivne transfere.
- Klik na Windows notifikaciju otvara odgovarajući job, video, Storyboard ili emisiju.
- Download se nastavlja u pozadini; status i stvarni broj bajtova vidljivi su u globalnom panelu. Pauzirani `.part` fajl nastavlja se nakon ponovne prijave.
- Reporter otvara `Storyboard` iz aktivnog joba. Lijevo bira i pomjera klipove, a desno na velikom scrub previewu podešava IN/OUT i napomenu. Gornja traka prikazuje fazu rada, autosave status, verziju i ukupno trajanje. `Pošalji montaži` potvrđuje i šalje posljednju sačuvanu verziju.
- Montažer u jobu bira `Otvori u Premiere`; desktop priprema `Media`, `OFF`, `Brief` i `Exports` folder. UXP panel učitava `manifest.json`.
- Admin u modulu `Desktop i Edge` vidi računare, verziju, heartbeat, dozvolu za notifikacije, update kanal i Media Edge stanje.
