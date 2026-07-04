# QA sugestije i profesionalne reference

Zadnja izmjena: 2026-06-17

Ovaj dokument je radni backlog za QA, buduce sugestije i reference koje se mogu koristiti u Word dokumentu/prezentaciji za VideoCompressionApp.

## Namjena

- Cuvati ideje koje nastanu tokom QA i daljeg razvoja.
- Povezati funkcije aplikacije sa profesionalnim broadcast praksama.
- Sluziti kao izvor za Word dokumentaciju, prezentaciju i eventualni projektni prijedlog.

## Profesionalni obrasci rada

### 1. File-based ingest, proxy i metadata

Profesionalni sistemi nakon ingest-a ne rade samo "upload fajla"; oni kreiraju asset, tehnicki metadata, proxy i thumbnail, te omogucavaju pretragu.

Reference:

- AWS Media2Cloud opisuje ingest workflow koji kreira asset ID, racuna i validira MD5 checksum, izvlaci tehnicki metadata i pravi proxy fajlove: https://docs.aws.amazon.com/solutions/latest/media2cloud-on-aws/ingestion-workflow.html
- Dalet Flex navodi da se pri ingest-u automatski kreira proxy verzija za preview u FlexMAM-u: https://support.dalet.com/hc/en-us/articles/5765507404829-Dalet-Flex-User-Guide
- Avid MediaCentral Production Management naglasava ingest, dijeljenje materijala i pretragu preko sistemskog i korisnickog metadata: https://www.avid.com/products/mediacentral/mediacentral-production-management

Veza sa aplikacijom:

- Postojeci upload + worker vec kreira compressed/master, preview i thumbnail.
- Sljedeci korak je checksum na ingest-u i jasniji tehnicki metadata profil.

### 2. Workflow automation i transcode queue

Broadcast kuce obicno koriste workflow engine koji automatizuje ingest, transcode, QC, export i delivery.

Reference:

- Telestream Vantage pozicionira workflow automation za transcode, ingest, QC, export, delivery i metadata enrichment: https://www.telestream.com/vantage/
- Telestream Vantage workflow design opisuje odvojene tokove za metadata, analysis data, media file flow i process flow: https://www.telestream.net/vantage/vantage-workflow.htm

Veza sa aplikacijom:

- `npm run start:all`, backend queue i video worker su lokalna verzija tog obrasca.
- Sljedeci korak je UI za detaljan job progress i retry.

### 3. Newsroom workflow, rundowns i prilozi

U newsroom okruzenju workflow je vezan za pricu/prilog, ne samo za pojedinacni fajl. Reporter, producent i montazer rade oko istog story/job konteksta.

Reference:

- AP ENPS opisuje NRCS kao sistem za planiranje, pisanje i vodjenje live broadcast-a, sa rundown managementom i story metadata preview-om: https://workflow.ap.org/ap-enps/
- Avid MediaCentral povezuje scripts, rundowns, media, automation i saradnju u newsroom workflowu: https://www.avid.com/products/mediacentral
- MOS Protocol je standardna veza izmedju newsroom sistema i media object servera, video servera, audio servera i grafike: https://mosprotocol.com/

Veza sa aplikacijom:

- Reporter Event Workspace + Edit Jobs idu u smjeru story-based workflowa.
- Sljedeci korak je "program/rundown" nivo iznad pojedinacnog edit joba.

### 4. Metadata standardi za MAM/arhivu

Profesionalni MAM sistemi koriste strukturiran metadata radi pretrage, razmjene i arhive.

Reference:

- EBUCore daje zajednicki set metadata za radio/TV media assets: https://github.com/ebu/ebucore
- PBCore je metadata standard za opis audiovizuelnog sadrzaja i koristi se u javnom broadcast/arhivskom okruzenju: https://pbcore.org/
- PBCore FAQ spominje MAM sisteme, playout servere, asset management sisteme i metadata razmjenu: https://pbcore.org/faqs
- DPP Metadata/Specs ukljucuju metadata exchange za programme i news: https://www.thedpp.com/metadata/

Veza sa aplikacijom:

- Trenutno postoje event, date, uploader, status, keywords i markers.
- Sljedeci korak je kontrolisana metadata sema: program, slug, story ID, reporter, rights, restrictions, language, location optional, persons, topics, archive policy.

### 5. QC i loudness

Profesionalni broadcast workflow ne pusta materijal u eter bez tehnickog i urednickog QC-a.

Reference:

- EBU R 128 preporucuje loudness normalizaciju sa targetom -23 LUFS i koristi loudness range i maximum true peak deskriptore: https://tech.ebu.ch/publications/r128
- EBU QC background objasnjava da file-based workflow ima razlicite QC zahtjeve po destinaciji i formatu: https://qc.ebu.io/help/background
- EBU Tech 3363 QC Criteria pokriva audio, video, format/bitstream i metadata/other checkove: https://www.ebu.ch/news/2013/09/ebu-unveils-qc-criteria

Veza sa aplikacijom:

- Postoje QC statusi i QC notes.
- Sljedeci korak je automatski tehnicki QC preko FFprobe/FFmpeg: loudness, true peak, duration, resolution, framerate, black/freeze detection, audio channel layout, codec/container validation.

### 6. Air-ready master delivery

Za finalni materijal profesionalne kuce cesto koriste definisane delivery profile i standardizovane master fajlove.

Reference:

- DPP specs opisuju AS-11 UK DPP kao format za "air-ready masters", baziran na MXF OP1A i definisanim video/audio/metadata zahtjevima: https://www.thedpp.com/specs/
- AMWA AS-11 opisuje familiju specifikacija za delivery finished media assets broadcasteru/publisheru: https://aafassociation.org/projects/AS-11.html
- SMPTE ST 2067 IMF opisuje Interoperable Master Format, ukljucujuci broadcast/UHD workflowe i efikasne kasne editorial promjene: https://www.smpte.org/standards/st2067

Veza sa aplikacijom:

- Trenutno final upload evidentira finalne fajlove i pravi preview/thumbnail.
- Sljedeci korak je station-specific export profile: npr. H.264 MP4 za interni eter, MXF/AS-11 opcija, audio layout, loudness i QC report.

## Mapiranje funkcija aplikacije na reference

| Funkcija aplikacije | Profesionalna referenca | Komentar |
| --- | --- | --- |
| Upload raw materijala | AWS Media2Cloud, Dalet Flex, Avid MediaCentral | Ingest treba praviti asset, proxy, thumbnail i metadata. |
| Worker queue | Telestream Vantage | Automatski workflow engine za transcode/QC/delivery. |
| Event Workspace | AP ENPS, Avid MediaCentral | Organizacija oko price/priloga, ne oko pojedinacnog fajla. |
| Edit Jobs | NRCS/MOS/Avid newsroom workflow | Job je lokalni story/task kontekst za reportera i montazera. |
| Download edit package | IMF package koncept, MAM/NLE workflow | Sortiran paket za montazu sa manifestom i segment uputama. |
| Metadata | EBUCore, PBCore, DPP Metadata | Treba standardizovati polja i eventualni export/import. |
| QC status | EBU QC, EBU R 128, DPP | Manual QC sada, automatski QC kasnije. |
| Final upload | DPP/AMWA AS-11, SMPTE IMF | Treba definisati output profile za eter i arhivu. |

## Backlog sugestija

## Globalni download manager i remote pristup - 2026-06-17

### Sta testirati

- `POST /api/downloads/tickets` mora kreirati ticket samo za autentifikovanog korisnika.
- `GET /api/downloads/tickets/:token` ne koristi bearer token, ali mora raditi permission provjere kao korisnik koji je kreirao ticket.
- `GET /api/downloads/tickets/:ticketId/status` smije vidjeti vlasnik ticketa ili Admin.
- Ticketi isticu preko TTL indexa na `expiresAt`; UI treba prikazati `expired` ako link nije iskoristen na vrijeme.
- AppShell mora jasno prikazati odvojene upload i download statuse.
- Download manager mora prikazati `Priprema`, `Otvaram`, `Skidanje`, `Zavrseno`, `Prekinuto`, `Greska` ili `Isteklo`.
- `beforeunload` upozorenje se ocekuje dok je ticket u pripremi/otvaranju; nakon browser handoff-a browser download manager preuzima fizicko skidanje.
- Thumbnail, scrub preview, video preview i OFF audio preview ostaju blob/inline preview requestovi i ne ulaze u download manager.

### Remote/druga mreza checklist

- Drugi racunar treba otvoriti backend-servirani URL, npr. `http://host:5000`, ne `http://localhost:3000` osim ako je frontend dev server namjerno izlozen.
- Ako se koristi produkcijski build serviran iz backend-a, frontend treba koristiti relativni `/api`.
- Ako se koristi odvojeni frontend, `REACT_APP_API_BASE_URL` mora biti npr. `http://host:5000/api`, a `ALLOWED_ORIGINS` mora sadrzati frontend origin.
- Firewall mora dozvoliti port `5000` prema racunaru/serveru na kojem radi backend.
- Za tunel/VPN/reverse proxy provjeriti da Origin host odgovara backend hostu ili da je origin eksplicitno u `ALLOWED_ORIGINS`.
- U browser konzoli razlikovati CORS/network gresku od sporog ZIP streama: kod sporog streama download manager treba pokazati da je ticket kreiran i da browser preuzima download.

## Download, TV Archive i dopuna joba - 2026-06-16

Implementirane stavke za QA:

- Edit package download mora raditi kada job title sadrzi BHS dijakriticke znakove, navodnike, zagrade ili duge nazive. Ocekivanje: nema `ERR_INVALID_CHAR`, browser dobija ZIP.
- Air package ZIP, bulk video ZIP, pojedinacni video download i OFF audio moraju imati siguran `Content-Disposition` header sa ASCII fallbackom i UTF-8 `filename*`.
- Production Desk / Materijal bulk download mora prikazati `Pripremam ZIP...`, indikator skidanja i primljene byteove dok se paket priprema.
- Reporter TV Archive pod filterom `Prilog` mora prikazati i `contentType` zapise i legacy `finalCategory` zapise koji zadovoljavaju Final/QC odobreni archive eligibility.
- Reporter TV Archive treba uporediti sa Producer TV archive / ready material prikazom za isti content type; odobreni final/QC materijal ne smije nestati samo zato sto jos nije emitovan.
- Reporter Event Workspace: kreirati job, zatim uploadovati ili pronaci dodatni klip za isti event i poslati ga kroz `Dopuni postojeci job`.
- Edit Job Details / `Iz materijala/arhive`: reporter dodaje postojeci vlastiti klip i TV Archive odobreni klip u job; editor ga vidi kao novi/missing segment.
- Edit Job Details / `Sa kompjutera`: reporter uploaduje novi video fajl direktno u job; backend kreira `Video`, queuea obradu i segment odmah postoji u jobu.
- Permission QA: reporter ne smije dodati tudji neodobreni raw/production klip u svoj job rucnim slanjem video ID-a; admin moze.
- Video Details: 16:9 preview treba popuniti 16:9 stage bez dodatnih UI black bars, uz ocuvane marker/timecode akcije.

Performance i rizici:

- Direktni job material upload odmah dodaje segment i kada processing jos traje; editor moze skinuti source/raw ako je potreban hitan rad.
- Kod velikih upload fajlova korisnik mora ostaviti tab otvoren dok upload ne zavrsi; background upload queue za ovaj specificni job-upload nije uvodjen u ovoj fazi.
- Archive eligibility je centralizovan helper; svaka buduca promjena definicije TV Archive vidljivosti treba se raditi na jednom mjestu i zatim testirati Reporter i Producer prikaz.

## UI/UX i performance odluke - 2026-06-15

Prva faza UI/UX redizajna je implementirana bez promjene osnovnog React + MUI stacka.

Implementirane stavke za QA:

- Provjeriti da nova role-aware navigacija prikazuje samo dozvoljene radne prostore po roli.
- Provjeriti globalni upload/status bar tokom direct final background upload-a.
- Provjeriti Production Desk `Jobs` tab: search, status filter, pagination i indikatore za izmjene/nove fajlove.
- Provjeriti Production Desk `Materijal` tab: server-side search/filter, summary metrike i retry failed processing akciju.
- Provjeriti Production Desk `Materijal` akciju za prijavu pogresne kategorije: finalizovan video dobija `needs_metadata`, editor vidi status chip, a arhiver ga vidi u Archive Desk review queue.
- Provjeriti da Production/Archive pregledi ne prikazuju isti filename dva puta kada su naslov i filename jednaki.
- Provjeriti category filter fallback: Reporter TV Archive/My Archive, Admin Video Management, Archivist Desk i Producer TV archive moraju pod `Prilog` prikazati i nove `contentType` zapise i legacy `finalCategory: video-report` zapise.
- Nakon deploya po potrebi pokrenuti `npm run contenttypes:backfill`; unknown `finalCategory` vrijednosti moraju ostati netaknute i prikazane u logu skripte.
- Provjeriti Reporter Desk tabove: `Priprema`, `Jobs`, `Arhiva`.
- Provjeriti Producer Desk biblioteku preko novog `/api/broadcast/library-search` endpointa.
- Provjeriti Realizator Desk header signale za izmjene poslije download-a i potvrdu etera.

Nove performance reference za dalji rad:

- Server-side pagination/search treba ostati default za liste koje mogu preci nekoliko stotina zapisa.
- Ako tabele postanu spore zbog broja redova u browseru, sljedeci kandidat je TanStack Virtual, ali samo nakon konsultacije i mjerenja.
- Ako vise ekrana pocne duplirati cache/polling logiku, sljedeci kandidat je TanStack Query, takodjer nakon konsultacije.
- Media preview jos koristi postojeci auth/axios model; prelazak na media-ticket streaming bi bio sigurnosno-funkcionalna promjena i treba poseban prijedlog.

### UI/UX i performance odluke - faza 2

Druga faza redizajna prosiruje isti React + MUI pristup na preostale dijelove aplikacije.

Novi endpointi za QA:

- `GET /api/archive/videos/workspace`
- `GET /api/archive/duplicates/workspace`
- `GET /api/feedback/workspace`
- `GET /api/admin/audit-logs/workspace`

Implementirane stavke za QA:

- Archivist Desk: review queue, svi materijali, metadata edit, tag edit, content type edit, review status, duplikati i delete duplicate flow.
- Admin Dashboard: kompaktan module switcher bez dodatnog bocnog menija.
- Admin Video Management: server-side video workspace, paginacija i lazy thumbnail loading.
- Admin Feedback Inbox: workspace pagination, debounce search, status/prioritet KPI i postojece seen/update/comment akcije.
- Admin Audit Logs: workspace pagination, debounce search, summary po severity statusu i CSV/JSON export trenutne stranice.
- Feedback Page: korisnicki tok "nova prijava + moje prijave" preko workspace endpointa.
- Video Details i Edit Job Details: shared header/status chipovi bez uklanjanja playera, markera, final upload-a ili package download akcija.

Performance QA za fazu 2:

- Admin Video Management i Reporter Archive ne smiju odmah skinuti thumbnail blobove za sve kartice; thumbnail se ucitava tek kada kartica ulazi u viewport.
- Archive, Feedback i Audit filteri moraju koristiti paginaciju i ne smiju blokirati UI kod velikog broja zapisa.
- Search polja u Feedback Inbox, Audit Logs, Admin Video Management i Reporter Archive imaju debounce prije slanja upita.

### Indexiranje i SearchText optimizacija - 2026-06-15

Implementirana je prva backend performance faza za vece baze:

- `Video`, `EditJob`, `Feedback` i `AuditLog` dobijaju ciljane MongoDB indexe za workspace filtere i sortove.
- `Video`, `EditJob` i `Feedback` dobijaju `searchText` tehnicko polje i MongoDB text index.
- Search preko workspace endpointa vise ne koristi siroki `$or` regex preko vise polja.
- Frontend ne salje search parametar za unos kraci od 2 karaktera, a Producer library search je debounceovan.
- Deployment i provjera su opisani u `docs/INDEXIRANJE_RUNBOOK.md`.

QA provjere:

- Pokrenuti `npm run searchtext:backfill`, zatim `npm run indexes:create`.
- Pokrenuti `npm run indexes:explain` i sacuvati rezultat u QA biljeske.
- Provjeriti da `searchText` nije vidljiv u API response-u.
- Provjeriti search na Production Desk, Archivist Desk, Producer TV archive, Edit Jobs, Feedback Inbox i Audit Logs.
- Na vecoj testnoj bazi provjeriti da primarni workspace queryji vise ne padaju na puni collection scan.

Nove reference za performance i media indexing:

- MongoDB Indexes: https://www.mongodb.com/docs/manual/indexes/
- MongoDB Equality, Sort, Range guideline: https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/
- MongoDB Text Indexes: https://www.mongodb.com/docs/manual/core/indexes/index-types/index-text/
- MongoDB explain executionStats: https://www.mongodb.com/docs/manual/reference/method/cursor.explain/
- Mongoose schema indexes: https://mongoosejs.com/docs/guide.html#indexes
- AWS Media2Cloud indeksira tehnicki metadata tokom ingest workflowa: https://docs.aws.amazon.com/solutions/latest/media2cloud-on-aws/ingestion-workflow.html
- Azure AI Video Indexer je roadmap referenca za kasnije transcript/OCR/object indexing: https://learn.microsoft.com/en-us/azure/azure-video-indexer/video-indexer-overview
- Stari endpointi ostaju dostupni, ali novi ekrani treba da koriste workspace endpoint gdje lista moze rasti.

### Dinamicni scrub preview - QA i performance

- Hover preview za Producer, Realizator i Archivist koristi generisane JPG frameove u `storage/scrub-previews/<videoId>/`, a ne video dekodiranje u svakoj kartici.
- Default profil je 12 frameova po klipu u 320x180, sto balansira storage i korisnost pregleda.
- Frontend lazy ucitava prvo thumbnail, zatim scrub manifest tek kada je preview komponenta u viewportu; frameovi se povlace samo na hover.
- Admin / Storage Maintenance / Preview slicice ima `Build missing` akciju koja procesira samo nedostajuce previewe, sekvencijalno i uz limit do 50 klipova po batchu.
- QA treba provjeriti da klip bez scrub previewa ostaje na obicnom thumbnailu, bez vidljive greske za korisnika.
- QA treba provjeriti da brisanje videa i brisanje arhivskog duplikata uklanja i pripadajuci `scrub-previews` folder.

### QA sada

- Testirati kompletan workflow po rolama: Reporter, Editor/VideoEditor, Producer, Admin.
- Testirati upload vise klipova sa istim eventom i danasnjim datumom.
- Testirati kreiranje edit joba iz Event Workspace-a.
- Testirati kreiranje preciznog edit joba iz Video Details markera.
- Testirati `Claim & Download Package` na jobu sa vise segmenata.
- Testirati paket kada jedan source fajl nedostaje na disku.
- Testirati permission: reporter ne smije skinuti edit package; editor smije tek nakon claim-a; producer/admin smiju radi supervizije.
- Testirati sta se desava kada token istekne tokom download-a.
- Testirati failed processing status i da li je jasan korisniku.
- Testirati remote QA pristup preko privatnog VPN/tailnet pristupa ili privremenog HTTPS tunela.

### Remote QA access

Preporuceni redoslijed za testiranje aplikacije sa uredjaja koji nije na istoj mrezi:

1. Za otvoren QA preko IP adrese koristiti backend port `5000`, jer backend servira i React build i API.
2. Za privatni QA koristiti Tailscale ili slican private mesh VPN. Aplikacija ostaje dostupna samo uredjajima koji su u istom privatnom tailnet-u.
3. Za brzu javnu demonstraciju koristiti Cloudflare Quick Tunnel ili ngrok prema backend portu `5000`.
4. Za produkcijski pristup ne koristiti lokalni laptop kao javni server; aplikaciju prebaciti na server/VPS/cloud, staviti HTTPS reverse proxy, backup, monitoring i firewall.

Prakticni QA tok:

```powershell
npm run build --prefix frontend
npm run start:all
```

Ako je uredjaj na istoj lokalnoj mrezi, otvoriti:

```text
http://LOCAL_IP_RACUNARA:5000
```

Ako treba pristup sa druge mreze preko javne IP adrese:

1. Dozvoliti inbound TCP `5000` u Windows Firewall-u.
2. Na routeru napraviti port forward: public/external TCP `5000` -> lokalni IP racunara, TCP `5000`.
3. Otvoriti:

```text
http://PUBLIC_IP:5000
```

Ako ISP koristi CGNAT, direktan public IP pristup vjerovatno nece raditi.

Brza CGNAT/double NAT provjera:

1. U router admin panelu pogledati WAN/Internet IP adresu.
2. Uporediti je sa javnom IP adresom koju prikazuje servis kao `https://api.ipify.org`.
3. Ako WAN IP nije isti kao javna IP adresa, port forwarding na tom routeru nece biti dovoljan.
4. Ako WAN IP pocinje sa `10.x`, `100.64.x - 100.127.x`, `172.16.x - 172.31.x` ili `192.168.x`, korisnik je iza privatnog NAT-a.
5. Ako `tracert -d 8.8.8.8` poslije lokalnog routera prikaze privatnu adresu kod ISP-a, to je dodatni znak CGNAT/double NAT-a.

Rjesenja ako je CGNAT:

- traziti od ISP-a javnu IPv4 adresu ili static public IP
- traziti da prebace modem/router u bridge mode ako postoji dodatni ISP router ispred korisnikovog routera
- koristiti Cloudflare Tunnel, ngrok ili Tailscale Funnel za QA/demo pristup
- hostovati aplikaciju na VPS/cloud serveru za stabilan produkcijski pristup

Napomena za SDMC NE1611B:

- NE1611B je cable modem/router i kod regionalnih operatera moze biti vezan za Connect/EON Connect upravljanje.
- U router admin panelu prvo provjeriti WAN/Internet IP. Ako WAN IP nije isti kao javni IP koji vidi racunar, port forwarding nece raditi bez ISP promjene.
- Port forwarding rule za ovu aplikaciju treba biti:
  - Protocol: TCP
  - External/Public port: 5000
  - Internal/LAN IP: lokalni IP racunara koji pokrece aplikaciju, npr. `192.168.0.6`
  - Internal/LAN port: 5000
  - Status: Enabled
- Ako postoji DHCP reservation/static lease, rezervisati `192.168.0.6` za taj racunar, da port forwarding ne pokazuje na pogresan uredjaj nakon restartovanja.
- Ako port forwarding ne radi, privremeno testirati DMZ host prema `192.168.0.6`; ako DMZ radi, problem je u port-forward pravilu. DMZ poslije testa odmah iskljuciti.

Windows Firewall komanda, pokrenuti u PowerShell-u kao Administrator:

```powershell
netsh advfirewall firewall add rule name="VideoCompressionApp TCP 5000" dir=in action=allow protocol=TCP localport=5000 profile=any
```

Za tunel prema backendu, jer backend vec servira React build iz `frontend/build`:

```powershell
cloudflared tunnel --url http://localhost:5000
```

Alternativa:

```powershell
ngrok http 5000
```

Sigurnosne napomene:

- `ALLOW_PUBLIC_REGISTRATION=false`
- koristiti jak `JWT_SECRET`
- koristiti jaku admin lozinku
- ne ostavljati javni tunel aktivan nakon QA
- ne ostavljati port forward aktivan nakon QA ako aplikacija sadrzi interni materijal
- ne slati produkcijski media materijal kroz javni privremeni tunel bez odobrenja
- za React dev server na portu `3000` treba dodatno paziti na CORS i `ALLOWED_ORIGINS`; za QA je jednostavnije tunelirati backend `5000`
- produkcijski frontend za javni/LAN pristup mora koristiti relativni API URL `/api`; ako se u `frontend/.env.production.local` unese `http://localhost:5000/api`, login radi samo na lokalnom racunaru, a na mobitelu/drugom kompjuteru pokusava pogoditi pogresan `localhost`
- nakon promjene `REACT_APP_API_BASE_URL` obavezno pokrenuti `npm run build --prefix frontend`, jer React tu vrijednost ugradi u produkcijski JavaScript bundle

### Prioritet P1

- Dodati checksum na ingest-u, npr. MD5 ili SHA-256.
- Dodati automatski FFprobe technical metadata extract: codec, container, audio channels, duration, field order, color space.
- Za MXF i ostale broadcast sirovine pratiti razliku izmedju containera i codeca: `.mxf` moze sadrzati XDCAM, AVC-Intra, DNxHD/DNxHR, ProRes, IMX ili druge varijante, a uspjeh zavisi od instaliranog FFmpeg builda.
- Redis/worker/FFmpeg health treba biti vidljiv u Admin/Production UI-ju prije velikog upload-a; `start:all` sada radi Redis preflight, ali aplikaciji treba dashboard indikator.
- Za lokalni QA moze se koristiti `PROCESSING_QUEUE=local`, gdje web proces sam obradjuje video bez Redis-a. Ovo nije produkcijski mod jer queue ne prezivljava restart aplikacije.
- Failed processing treba tretirati kao retryable dok god raw/source fajl postoji; korisnik ne treba ponovo uploadovati veliku sirovinu ako je pao samo queue ili worker.
- Batch upload mora biti otporan na djelimican queue failure: svi fajlovi koji su vec snimljeni u `storage/raw` moraju dobiti DB zapis ili biti dostupni kroz Admin orphan recovery.
- Veliki batch ingest ne smije zavisiti od jednog ogromnog multipart requesta. Upload sada ide sekvencijalno po fajlu, uz parcijalni uspjeh i retry samo za fajlove koji nisu prosli.
- Raw orphan recovery mora imati owner/uploader kontrolu. Novi uploadi sada upisuju recovery manifest u `storage/raw-manifests`, a Admin UI i dalje ima Recovery owner izbor i owner reassignment po klipu za stare ili nejasne fajlove.
- Reporter TV-wide arhiva treba ostati read-only: preview i pregled su dozvoljeni, ali delete, retry, markers, edit job kreiranje i download tudjeg materijala nisu.
- Archive prikaz treba ostati samo za montiran/finalizovan materijal (`status: edited`); raw ingest i kompresovana sirovina pripadaju Prep/Production workflowu.
- Dodati EBU R128 loudness check i QC report.
- Dodati optional FFmpeg subclip export u edit package, da paket moze sadrzati fizicki izrezane In/Out segmente.
- Dodati drag-and-drop redoslijed klipova u Reporter Event Workspace-u.
- Dodati job templates po programu/emisiji.
- Dodati server-side pagination i search za velike arhive.
- Live processing progress sada radi preko kratkog pollinga dok ima aktivnih obrada; kasnije ga vrijedi zamijeniti SSE ili WebSocket push modelom.
- Dodati retry za failed processing jobove iz admin/production UI-ja.

### Prioritet P2

- Uvesti strukturisanu metadata semu inspirisanu EBUCore/PBCore: story slug, program, episode/show, language, rights, restrictions, people, topics, archive category.
- Dodati export `job_manifest.json` u formatu koji se kasnije moze mapirati u EDL/XML/AAF workflow.
- Dodati station-specific broadcast output profile.
- Dodati QC dashboard za sve materijale koji cekaju provjeru.
- Dodati audit report po danu, reporteru, jobu i statusu.
- Dodati MOS/NRCS integracionu pripremu ako se aplikacija bude povezivala sa newsroom sistemom.

### Prioritet P3

- Razmotriti AS-11/MXF output za finalne master fajlove ako je potreban formalni exchange prema drugim broadcasterima.
- Razmotriti IMF-like package za dugorocnu arhivu i verzionisanje.
- Dodati AI-assisted metadata: speech-to-text, osobe, lokacije, teme, automatski summary.
- Dodati rights/restrictions workflow za arhivski materijal.

## Predlozena struktura Word dokumenta

1. Naslovna strana: VideoCompressionApp za TV produkciju.
2. Problem koji aplikacija rjesava: ingest, evidencija, kompresija, priprema za eter.
3. Role: Reporter, Editor/VideoEditor, Producer, Admin.
4. Dnevni workflow: upload, event workspace, edit job, package download, QC, final upload, broadcast approval.
5. Tehnicka arhitektura: React, Express, MongoDB, Redis/Bull, FFmpeg, storage folderi.
6. Profesionalne reference: EBU, DPP/AMWA, SMPTE, Avid, Dalet, Telestream, AWS, AP ENPS.
7. Mapiranje referenci na funkcije aplikacije.
8. QA checklist.
9. Roadmap i prioriteti.
10. Zakljucak: gdje je aplikacija sada i sta treba da postane za profesionalni broadcast rad.

## Napomena o referencama

Reference treba koristiti kao orijentaciju i dokaz da aplikacija ide u pravom broadcast smjeru. Aplikacija ne treba tvrditi formalnu uskladjenost sa EBU/DPP/SMPTE standardima dok se ne implementiraju tacni profili, mjerenja, tolerancije i validacijski izvjestaji.

## HLS, partial search i lifecycle QA

Obavezna mrežna provjera u browser DevTools:

- HLS reprodukcija trazi `master.m3u8`, variant playlistu i samo potrebne `.ts`
  segmente.
- MP4 fallback salje `Range` i dobija `206 Partial Content`.
- Video preview ne smije praviti veliki Axios `blob` request za cijeli MP4.
- Seek ne smije vratiti player na nulu nakon obnove media ticketa.
- Nevalidan ili istekao ticket mora dati 403/410 bez otkrivanja storage putanje.

Performance QA:

- search sa najmanje dva znaka koristi `video_search_prefixes_idx`;
- nakon backfilla glavni archive search ne smije zavisiti od regex fallbacka;
- SLA scheduler radi u batch updateu i ne brise job ni media fajlove;
- HLS build koristi queue, a web proces ostaje responzivan;
- Admin gradi stare HLS previewe u malim batch paketima zbog CPU-a i diska.

Reference:

- https://github.com/video-dev/hls.js
- https://ffmpeg.org/ffmpeg-formats.html#hls-2
- https://datatracker.ietf.org/doc/html/rfc8216
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests
- https://www.mongodb.com/docs/manual/reference/operator/query/all/
- https://www.mongodb.com/docs/manual/core/indexes/index-types/index-text/text-index-properties/

Detaljni runbook: `docs/HLS_STREAMING_I_JOB_SLA.md`.

### Rezultat automatizovane provjere 27.06.2026.

- Backend `node --check`: 39/39 izmijenjenih i novih JS fajlova prolazi.
- Frontend production build prolazi sa lokalnim `hls.js@^1.6.16`.
- Frontend testovi: 5/5 suiteova i 12/12 testova prolazi.
- `git diff --check` prolazi.
- BHS prefix i HTTP Range deterministic assertions prolaze.
- Lokalni production-build smoke test prikazuje `/login` bez browser console
  gresaka; MongoDB konekcija prolazi u lokalnom queue modu.
- React testovi imaju neblokirajuce `act()` deprecation upozorenje.
- CRA dependency tree ima npm audit dug; ne koristiti `npm audit fix --force`
  bez posebne regresijske faze i odobrenja stack promjene.

Primarne reference dodatno koriscene za sigurnost i runtime:

- MongoDB TTL: https://www.mongodb.com/docs/manual/core/index-ttl/
- Mongoose indexi: https://mongoosejs.com/docs/guide.html#indexes
- Node.js streams: https://nodejs.org/api/stream.html
- Express response API: https://expressjs.com/en/4x/api.html#res
- Media Source Extensions:
  https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API

## NVENC i MP4 preview retention QA

- Capability ekran mora prikazati stvarnu FFmpeg verziju, GPU, driver,
  NVENC encodere i rezultat test encodea.
- NVENC se ne smije moci snimiti kao aktivan HLS encoder prije uspjesnog
  probea.
- Testirati H.264/AAC MP4, H.264/PCM MP4, HEVC MP4, MOV, MXF, video bez
  audija, 10-bit, 4:3, vertikalni i 25/30/50 fps.
- H.264/yuv420p MP4 sa AAC/MP3 ili bez audija ne treba zaseban preview.
- Nevalidan HLS, shared preview, nekompatibilan master ili putanja izvan
  `storage/previews` moraju blokirati cleanup.
- Dry-run ne smije mijenjati DB ni disk; cleanup mora ostaviti Audit Log.
- Rebuild koji padne ne smije ukloniti prethodni validni HLS.
- Simulirani GPU/session kvar mora dati jedan `libx264 veryfast` fallback.
- Source/decode greska ne smije se pogresno tretirati kao GPU kvar.
- Sa HLS backlogom ingest queue mora nastaviti rad.
- Benchmark raditi na najmanje pet stvarnih klipova. Mikro-klipovi nisu
  relevantni zbog NVENC inicijalizacijskog overheada.
- Trenutni FFmpeg 7.1 Gyan essentials nema `libvmaf`; za VMAF acceptance
  koristiti build sa tim filterom.

Reference:

- https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html
- https://developer.nvidia.com/video-encode-decode-support-matrix
- https://ffmpeg.org/ffmpeg-codecs.html#nvenc
- https://ffmpeg.org/ffmpeg-filters.html
- https://ffmpeg.org/ffmpeg-formats.html#hls-2
- https://datatracker.ietf.org/doc/html/rfc8216
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests
- https://nodejs.org/api/child_process.html#child_processspawncommand-args-options

Detaljni as-built runbook:
`docs/NVENC_I_PREVIEW_RETENCIJA.md`.

## Storage i media profile QA

- Cached storage overview treba odgovoriti ispod 200 ms; puni scan radi u
  pozadini i ne blokira ingest/API.
- Zbir kategorija ne smije duplo brojati `storage`, dependencies, build ili
  `.git`.
- Symlink se preskace i evidentira.
- MongoDB statistika mora ostati odvojena od lokalnog disk total/free prikaza.
- Warning i critical prag moraju davati status bez blokiranja uploada.
- Promjena MP4 polja povecava samo MP4 profile version; isto pravilo vrijedi
  za HLS, thumbnail, scrub i master.
- NVENC profil bez uspjesnog probea mora biti odbijen.
- HEVC nije dozvoljen za MP4/HLS browser preview.
- Testirati H.264 MP4, HEVC, MOV, MXF, bez audija, 4:3, vertikalni i
  25/30/50 fps.
- Neuspjeli rebuild mora ostaviti prethodni validni preview.
- Preview maintenance backlog ne smije zaustaviti novi ingest.
- Reference i rollout: `docs/STORAGE_I_MEDIA_PROFILI.md`.

## Reporter workflow i job notification QA

Funkcionalni QA:

- Reporter pocetna mora prikazati aktivne jobove prije upload forme.
- Bez aktivnih jobova sekcija `Novi prilog` mora biti automatski otvorena.
- Job sa komentarom, `needs_info` statusom ili bliskim rokom mora biti
  sortiran ispred obicnog aktivnog joba.
- `Dodaj klipove > Sa servera` mora spojiti vlastiti materijal i odobrenu TV
  arhivu, bez duplikata i bez klipova koji su vec u jobu.
- Pretraga i kategorija moraju raditi server-side, uz debounce od 300 ms.
- `Sa kompjutera` mora prikazati upload progress i nakon obrade dodati novi
  segment u isti job.
- Sirovine u Edit Job Details moraju imati lazy thumbnail, scrub fallback i
  stabilnu 96x54 dimenziju.
- Klip bez thumbnaila ne smije slomiti tabelu niti prikazati error toast.

Notification QA:

- Komentar Reportera obavjestava samo dodijeljenog Editora/VideoEditora.
- Komentar Editora/VideoEditora obavjestava samo reportera joba.
- Producent/Admin komentar obavjestava reportera i dodijeljenog montazera.
- Autor nikada ne dobija vlastitu notifikaciju.
- Job bez dodijeljenog montazera ne smije kreirati neispravnog primaoca.
- Otvaranje joba i `Oznaci sve kao procitano` moraju azurirati badge bez
  refreshanja cijele aplikacije.
- Polling mora stati dok je tab skriven i nastaviti se pri povratku.
- Notification greska ne smije ponistiti vec sacuvan komentar.
- TTL nakon 180 dana uklanja samo `Notification`, ne `EditJob.comments`.

Performance i sigurnost:

- Notification workspace je paginiran, limitiran na najvise 50 stavki i
  filtriran iskljucivo po autenticiranom primaocu.
- Indeksi pokrivaju `recipient/readAt/createdAt`, `recipient/job/readAt`,
  jedinstveni `recipient/commentId` i TTL `expiresAt`.
- Thumbnail i scrub zahtjevi se pokrecu tek ulaskom elementa u viewport.
- Direktni append koristi postojece permission provjere: reporter moze dodati
  vlastiti klip ili odobreni TV Archive materijal.

Reference:

- MongoDB TTL index:
  https://www.mongodb.com/docs/manual/core/index-ttl/
- MongoDB compound index:
  https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/
- Page Visibility API:
  https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
- Intersection Observer:
  https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API
- MUI Badge:
  https://mui.com/material-ui/react-badge/
- MUI Drawer:
  https://mui.com/material-ui/react-drawer/

## Correction status i Archive/Production QA

- Video sa `correctionStatus=needs_correction`, ali bez requesta, mora nakon
  backfilla/startup synca dobiti otvoren `CorrectionRequest`.
- Correction request bez show daya mora biti validan za arhivski workflow.
- Production > Ispravke mora svim montazerima prikazati sve otvorene
  zahtjeve; filter `Dodijeljene meni` smije suziti listu.
- Nedodijeljenu ispravku moze preuzeti jedan montazer. Drugi montazer mora
  dobiti `409` ako pokusa preuzeti vec dodijeljenu ispravku.
- Arhivista moze poslati legacy oznaku u produkciju bez dupliranja requesta
  ili correction joba.
- Povlacenje oznake zahtijeva razlog i mora biti blokirano za `in_edit` i
  `ready_for_review`, osim za Admina.
- Final upload iz correction joba mora postaviti `correctedBy`,
  `correctedAt`, `correctedVideo` i status `ready_for_review`.
- Potvrda ispravke mora postaviti `resolvedBy`, `resolvedAt`, ukloniti
  `activeCorrectionRequest` i zatvoriti correction job.
- Video se ne smije ukloniti iz aktivnog queuea samo promjenom UI taga;
  status zahtjeva i Video status moraju se promijeniti u istoj backend akciji.
- Audit Log provjeriti za: slanje, route/claim, final upload, status,
  potvrdu i dismiss.
- Backfill pokrenuti poslije backupa:
  `npm run corrections:backfill -- --batch=100`.
- Kontrolisano kreiranje novih indexa:
  `npm run indexes:create`.

Reference:

- MongoDB compound indexes:
  https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/
- MongoDB idempotent updates:
  https://www.mongodb.com/docs/manual/reference/method/db.collection.updateOne/
- Mongoose populate:
  https://mongoosejs.com/docs/populate.html
