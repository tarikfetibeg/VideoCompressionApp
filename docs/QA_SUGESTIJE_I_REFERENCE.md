# QA sugestije i profesionalne reference

Zadnja izmjena: 2026-06-08

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
