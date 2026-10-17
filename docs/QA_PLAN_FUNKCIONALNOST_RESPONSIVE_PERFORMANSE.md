# Plan QA: funkcionalnost, desktop/mobilni UI i performanse

Datum plana: 03.10.2026.

Status: lokalni automatizovani QA ciklus izveden na `codex/Web-Optimizacija`.
Potpuno zatvaranje svih acceptance kriterija jos nije postignuto; fizicki
uredjaji, druga mreza, Redis i dio rijetkih workflowa ostaju neprovjereni.
Rezultati i ogranicenja: [QA izvrsenje](QA_IZVRSENJE_WEB_OPTIMIZACIJA.md).

Osnova: worktree `a762/VideoCompressionApp`, HEAD `e81a765` i postojece
nekomitane izmjene correction workflowa. Prije izvrsenja zabiljeziti novi HEAD,
hash izvornog stabla relevantnog za aplikaciju, diff i hash production builda.
Sam commit nije dovoljan identifikator jer worktree ima nekomitane izmjene.

## 1. Cilj i granice

Potvrditi da svaki evidentirani feature radi za svoju ulogu, da korisnik moze
zavrsiti posao na desktopu i mobilnom browseru, da nema nefunkcionalnih ili
bespotrebno dupliciranih UI akcija i da aplikacija ostaje responzivna pri rastu
biblioteke i istovremenom radu korisnika.

Desktop pokrivenost znaci testiranu matricu CSS viewporta, pregled prijelaza
izmedju njih, zoom i DPI. Konacan broj testova ne dokazuje doslovno svaku
mogucu rezoluciju i kombinaciju uredjaja. Mobilni obuhvat je postojeca web
aplikacija na telefonu/tabletu. Fizicki uredjaj i stvarni Safari bit ce posebno
oznaceni ako nisu dostupni za potvrdu.

Izvrsenje vodi Codex. Korisnik daje poslovno pojasnjenje samo kada kod i
dokumentacija imaju konflikt ili kada popravka zahtijeva promjenu featurea,
ovlastenja ili workflowa. Uobicajene regresijske i layout popravke provode se
u okviru naknadno odobrenog izvrsenja ovog plana. Migracija stacka, uklanjanje
funkcije i velike nove runtime biblioteke traze zasebnu konsultaciju.

## 2. Sta je provjereno tokom pripreme plana

- `App.js` ima sedam uloga: Reporter, Editor, VideoEditor, Producer,
  Realizator, Archivist i Admin. Dozvole treba dokazati i preko API-ja.
- Frontend ima devet datoteka `*.test.js`; pokrivene su neke komponente,
  label mape, search parametri i globalni transfer/notifikacijski konteksti.
  Novi prolaz tih testova nije izveden tokom pisanja ovog plana.
- Manifest trenutno nema E2E suite, backend test komandu ili opterecenje.
- Postoje primarni video, HLS i preview maintenance queueovi u local/Redis modu.
- Backend pri startu moze pokrenuti recovery, correction sync, SLA scheduler,
  raw retention cleanup i storage scan. Zato izolacija mora prethoditi startu.
- `storagePaths.js` vezuje storage za root checkouta. QA checkout ne smije
  koristiti junction/symlink prema stvarnom media storageu.
- Liste/reporting, upload, edit jobovi, OFF/brief, markeri, QC, rundown,
  korekcije, ticketovani download/streaming, arhiva, feedback i Admin media
  alati ulaze u ovaj obuhvat.

Prvi ciljani rizici za provjeru, jos bez tvrdnje da su potvrdeni bugovi:

- Production Material zahtijeva `limit: 150`; provjeriti put do preostalih
  zapisa i da li se prikazani broj razlikuje od ukupnog broja.
- Producer biblioteka ucitava do 100 zapisa; Reporter aktivni jobovi i
  CorrectionQueue do 50. Provjeriti pagination/pretragu i pristup starijim
  rezultatima, posebno urgentnoj ispravci koja nije medju prvih 50.
- EditorDashboard ucitava/polluje materijal i kada je izabran drugi tab;
  izmjeriti stvarni broj nepotrebnih poziva.
- CorrectionQueue nema vlastiti periodicni refresh. Provjeriti vidljivost nove
  arhivske prijave na vec otvorenom produkcijskom ekranu i preko notifikacije.
- `Header.js` nema uocen import pri pocetnoj pretrazi; provjeriti cijeli graf
  importa prije klasifikacije kao mrtvog koda.
- `reportWebVitals.js` nije uvezan u ulaz aplikacije i referencira starije
  metrike. Postojanje datoteke nije dokaz da se performanse trenutno mjere.
- Korisnicka dokumentacija sadrzi starije opise Reporter tabova i razlika
  Editor/VideoEditor. Test oracle treba uskladiti sa stvarnim dozvolama.
- Posljednju arhivsku correction popravku treba potvrditi sa stvarnim
  Mongoose ObjectId vrijednostima, ne samo stringovima frontend mockova.

## 3. Izolovano QA okruzenje i testni podaci

Prije pokretanja aplikacije izvrsiti preflight koji provjerava:

1. Izdvojenu testnu MongoDB bazu sa eksplicitnim QA nazivom i markerom
   `qaRunId`; konfiguracija ne smije pasti na produkcijsku bazu iz `.env`.
2. QA storage unutar testnog checkouta, bez veza na korisnikov stvarni storage.
   Potvrditi apsolutne putanje i putanje iz testnih dokumenata.
3. Zasebnu Redis instancu ili bazu kroz `REDIS_URL`. Nazivi Bull queueova su
   fiksni, pa sam drugi aplikacijski port ne izoluje Redis poslove.
4. Slobodan QA port, pocetni kandidat 5110. Postojeci korisnikov port 5000 i
   procese ne zaustavljati; test runner pamti samo vlastite PID-ove.
5. Stvarne Node/FFmpeg/FFprobe/browser verzije i raspolozivi CPU, RAM, GPU,
   disk. NVENC ostaje uslovan dok stvarni capability probe ne prodje.
6. Startup cron/retention/recovery efekti rade samo nad testnim zapisima i
   fajlovima. Nepotvrdjena izolacija prekida start, a ne prelazi na default.

Testne korisnike kreirati programatski za svih sedam uloga, ukljucujuci dva
montazera, dva reportera i dva admina. Sesije odvojiti u browser contextima.
Za dozvole koristiti prave prijave i tokene testnih korisnika. Lozinke, tokeni,
ticket putanje, MongoDB/Redis adrese s akreditivima i storageState nisu dio
javnog QA izvjestaja; HAR/trace/log artefakte ocistiti prije dijeljenja.

Podaci se mogu deterministicki ponovo kreirati iz seeda:

- Mali skup: 100 videa, 30 jobova i razliciti statusi za razumljive E2E testove.
- Osnovni veliki skup: 10.000 video zapisa, 1.000 jobova, 1.000 feedbacka,
  100.000 audit zapisa i vise od 100 otvorenih correction zahtjeva.
- Stress skup: 50.000 video zapisa, 5.000 jobova i najmanje 100 aktivnih
  jobova jednog reportera za otkrivanje limit/pagination problema.
- Svaki skup ima unaprijed poznate brojeve po vlasniku, kategoriji, statusu,
  archive eligibilityju i tekstualnim/prefix queryjima. KPI i filter rezultate
  uporediti s tim ocekivanjima, ne samo s drugim ekranom koji moze imati isti bug.
- Poznati legacy zapisi: bez `contentType`, `finalCategory: video-report`, bez
  `searchPrefixes`, bez profile versiona i tagovana ispravka bez requesta.
- Rubni tekstovi: BHS dijakritika, navodnici, duge rijeci/nazivi, prazni opisi,
  veoma duge biljeske, vise komentara i nepoznata kategorija.

Velike kolekcije su metapodaci, a ne 50.000 transkodiranih velikih fajlova.
Za pravi media QA pripremiti 20-30 zasebnih malih lokalnih/sintetickih klipova:
H.264/AAC MP4, H.264/PCM, HEVC/10-bit, MOV, MXF kada FFmpeg build podrzava,
bez audija, 4:3, 16:9, vertikalni, 25/30/50 fps, ostecen i nedostajuci izvor.
Jedan duzi klip i kontrolisani veci fajl koriste se za seeking/transfer.
Testovi brisanja/retencije koriste zasebne disposable kopije; dijeljeni fajl
namjerno se koristi samo u testu zastite od brisanja zajednickog izvora.

## 4. Testni alati i organizacija

- Postojeci Jest/React Testing Library: fokusirani frontend regresijski testovi.
- Node `node:test` i realna testna baza/API: backend integracija, state
  tranzicije, ticketi, permissioni i invarianti na bazi/disku.
- Playwright kao development-only alat: autentifikovane browser sesije,
  vise uloga istovremeno, resize, touch, screenshots, download dogadjaji,
  konzola, network i trace pri gresci. Ne mijenja runtime stack aplikacije.
- Chrome/Edge performance alati, PerformanceObserver i React profiling:
  interakcije, main thread, renderi, JS/payload i memorija.
- Lighthouse na autentifikovanom production buildu: pomocni ponovljivi lab
  mjerni alat; ukupan Lighthouse score nije jedini acceptance kriterij.
- MongoDB `explain("executionStats")` i postojece index skripte: plan upita,
  keys/docs examined, sort i cijena paginacije.
- FFprobe, FFmpeg i postojeci `hls:benchmark`: validnost, dimenzije, codec,
  segment alignment i CPU/NVENC vrijeme; VMAF samo ako ga build stvarno podrzava.
- AST analiza preko dostupnog parsera, import graf i browser JS/CSS coverage:
  kandidati za mrtvi kod. Coverage jedne sesije ne dokazuje neupotrebu.

Planirane datoteke pri implementaciji harnessa:

```text
qa/
  playwright.config.js
  fixtures/                 # seed, media definicije i ocekivani rezultati
  helpers/                  # role sesije, preflight, capture i cleanup
  specs/                    # funkcionalni i responsive E2E scenariji
  performance/              # query, transfer i load probeovi
tests/backend/              # integracijski testovi nad QA bazom
scripts/qa/                 # start, stop, seed i izvjestaj
analysis/qa/<run-id>/        # izvjestaji bez tajni i sanitizovani dokazi
```

Testni credentials i privatni trace/HAR artefakti idu u ignorisan lokalni
folder. Prije snimanja dokaza definisati redaction pravila, a ne uklanjati
samo Authorization header i ostaviti media/download tokene u URL-u.

Komande koje vec postoje:

```powershell
npm run build --prefix frontend
npm test --prefix frontend -- --watchAll=false --testMatch=**/*.test.js
npm run indexes:create
npm run indexes:explain
npm run hls:benchmark -- --input=<qa-klip>
```

Posljednje tri komande pokretati samo uz eksplicitno postavljenu QA
konfiguraciju. Relativni `testMatch` zaobilazi prethodno uocen CRA/Jest
problem Windows putanje sa `.codex`. Backend syntax proci za sve izmijenjene
JS datoteke preko `node --check`. Novi QA runneri dobijaju kratke komande
tek kada njihove skripte stvarno budu implementirane.

## 5. Funkcionalna matrica

Za svaki sljedeci ID izvedeni slucajevi imaju preduslov, akcije, ocekivani
UI/API/DB/fajl rezultat i dokaz. Inventar dopuniti za svaku kontrolu ili
endpoint koji nije pokriven ovom pocetnom matricom.

| ID / oblast | Obavezni scenariji i kriterij prolaza |
| --- | --- |
| F01 Auth / role | Login/logout, pogresna lozinka, istek/nevalidan token, refresh/deep link i neprijavljen pristup. Svaka rola vidi dozvoljene radne prostore; rucni API poziv ne zaobilazi zabrane. Simulirani nedostupan MongoDB ne smije izgledati kao pogresna lozinka niti beskrajni spinner. |
| F02 Reporter | Aktivni jobovi, Novi prilog, event/date/location, raw upload, oznacavanje materijala i kreiranje joba. Job bez obaveznih polja ne nastaje. Dopuna sa servera, vlastite arhive, TV arhive i kompjutera radi bez gubitka job konteksta. |
| F03 Brief / OFF | Postojeci podrzani import briefa, pregled uvezenog teksta, upload/prikaz/download OFF audio, prazni/osteceni/nepodrzani fajlovi. UI objasnjava gresku i ostaje upotrebljiv. |
| F04 Upload / processing | Jedan i batch upload, napredak, navigacija tokom transfera, queue/processing/completed/failed, ponovni pokusaj, prekid i recovery. Thumbnail, scrub i HLS greska ne smiju pogresno proglasiti master neuspjesnim. |
| F05 Editor / VideoEditor | Jobs, Materijal, pretraga/filter kategorije, claim, sirovine sa previewom/markerom, missing/novi segment, ZIP/OFF download, final upload i direct final. Svaku razliku dozvola zasebno provjeriti; status i naziv fajla nisu nepotrebno duplirani. |
| F06 Job lifecycle | SLA kategorije, eksplicitni rok, grace period, active/expired/closed/cancelled, Historija, reaktivacija i legacy job. Istek ne brise materijal; Admin batch SLA ne dira neodabrane jobove. |
| F07 Komentari / notifikacije | Editor -> Reporter, Reporter -> Editor, Producer/Admin -> oba, bez slanja autoru. Zvono, Snackbar, link na job/ispravku, read-job/read-all, tab hidden/visible i 30s refresh. Pravi ObjectId i job bez montazera su obavezni. |
| F08 Video Details / QC | Player, metadata po roli, markeri/timecode, link na pocetni marker, segmenti, status pipeline, QC pass/fail, approval/reject, download. Realizator read-only granice i Reporter tudji arhivski materijal provjeriti i preko API-ja. |
| F09 Streaming | HLS master/720p/480p, Auto/promjena kvaliteta, seeking, buffering, ticket renewal na istom playheadu i MP4 Range fallback. Odbiti istekao/nevalidan ticket, nedozvoljen video i traversal. Nema punog Axios MP4 Blob requesta za player. |
| F10 Preview | Lazy thumbnail, scrub hover, viewport ulazak/izlazak, fallback bez slike/manifest/framea, ponovna upotreba frameova i object URL cleanup. Touch korisnik moze otvoriti pregled bez hovera. |
| F11 Search / biblioteke | Prefix in/ins/inse/insert, sp/spi sa dijakritikom, vise rijeci, minimum 2 znaka, 300ms debounce, clear, status/kategorija/owner/date/sort kombinacije. `prilog` i `video-report` fallback, first/middle/last page, stale odgovor i bez duplikata/gubitka. |
| F12 Producer | Program/datum, join, rundown add/reorder/remove/replace, kategorije, biblioteka, correction dodjela/pregled. Producer nema Production/Realizator privilegije. Mobilni reorder mora imati funkcionalan touch ili alternativu. |
| F13 Realizator | Rundown, detaljni bocni preview, puni pregled, prijava na timestampu, air paket, promjena poslije download-a i confirm aired. Stari paket ne smije pogresno prikazati aktuelni rundown kao preuzet. |
| F14 Arhivista | Review, metadata, kategorija, tagovi, filteri/sort, preview, duplicate pregled/delete i link na detalje. Razlikovati needs_metadata od video correction prijave. |
| F15 Ispravke | Arhivska i realizatorska prijava -> request/job -> montaža -> novi final -> ready_for_review -> potvrda/rundown replace. Poznati montazer automatski dobija posao; bez njega prijava ostaje vidljiva producentu i montazi. Legacy tag sync, duplicate prijava, claim dva montazera, route, dismiss i audit ko je ispravio/potvrdio. |
| F16 Download | Svih pet kindova: video-single, video-bulk, edit-package, edit-off-file, air-package. UI priprema/start/transfer/greska/prekid/expiry/retry, rad tokom downloada, beforeunload u pripremi, Unicode headeri, validan ZIP/manifest i checksum fajla. Server completion nije dokaz fizickog spremanja na klijentov disk. |
| F17 Feedback | Nova prijava, moje prijave, admini vide sve otvorene do zatvaranja, status/prioritet/assignee, odgovor, interne biljeske, comment/seen i pagination. Korisnik ne vidi interne admin-only podatke. |
| F18 Admin korisnici / video | Kreiranje/rola/reset lozinke, video delete/requeue/owner/contentType i bulk akcije. Unauthorized API zahtjev odbijen; brisanje dijeljenog fajla ne unistava drugi zapis. |
| F19 Admin jobovi / programi | Svi filteri, status/lifecycle, montazer, rok, prioritet, kategorija, batch SLA, siguran delete; job sa finalom/rundown vezom ne moze hard-delete. Programi/content types/aktivnost/SLA validacija i utjecaj na zavisne ekrane. |
| F20 Audit | Search/filter/sort/page/export i kontrolisano brisanje testnih logova. UTF-8 export, ko/sta/kada i istorija correction/media/job akcija se pravilno evidentiraju. |
| F21 Storage / profili | Disk/dbStats/breakdown, cache/refresh/single-flight, nepristupacan folder, symlink i vise volumena gdje okruzenje dopusta. Warning/critical informacija ne blokira ingest. Master/MP4/HLS/slike validacija, verzije samo promijenjene grupe i confirmation. |
| F22 Admin maintenance | Scrub/HLS missing build, failed retry, missing/outdated/selected rebuild, stari validni asset pri kvaru, preview-retention scan/cleanup, raw retention/recovery/orphans/manifests i OFF cleanup. Dry-run ne mijenja DB/disk; master i shared fajlovi zasticeni. |
| F23 NVENC / workers | Stvarni probe, zabrana ukljucivanja prije probea, NVENC output i CPU fallback, encoder/size/time metadata. Odvojeni ingest/HLS/maintenance redovi, restart, Redis nedostupan i local recovery. |
| F24 Shell / osnovni UI | Sidebar/nav, sticky header, job drawer iznad headera, notification menu, transfer panel, Login/NotFound, loading/empty/error/disabled stanja, BHS tekst i bez preklapanja. Back/forward i obnovljena sesija rade. |

Najvazniji povezani E2E tokovi:

1. Reporter ingest -> job -> Editor claim/komentar -> Reporter notifikacija/
   dopuna -> final -> QC/odobrenje -> Producer rundown -> Realizator air paket/
   aired -> Arhiva.
2. Arhiva prijavi gresku sa timestampom -> poznati ili naknadno dodijeljeni
   montazer -> correction final -> pregled -> potvrda -> trajni audit trag.
3. Realizator greska na rundown stavci -> correction -> Producer zamjena ->
   changed-since-download -> novi air paket.
4. Admin profil izmjena -> kontrolisani rebuild -> simulirani kvar -> stari
   preview ostaje -> uspjesni retry -> dry-run/retencija bez gubitka mastera.
5. Velika arhiva -> kategorija/prefix/owner -> paginacija -> preview -> job
   dopuna -> download dok korisnik nastavlja druge akcije.

API/DB invarianti i race testovi:

- Dva montažera istovremeno claimaju isti posao: jedan vlasnik, drugi jasan
  konflikt; isti zahtjev testirati i za correction claim/route.
- Dvije prijave istog otvorenog video problema: jedan aktivni request/job i
  najvise jedna odgovarajuca notifikacija po primaocu/dedupe kljucu.
- Repeated submit/retry ne pravi dupli segment, final ili aired potvrdu bez
  jasnog poslovnog razloga; eventualno razlicito postojanje pravila dokumentovati.
- Istekla korekcijska job lifecycle vrijednost ne sakriva nerijesen correction.
- Nedozvoljena uloga ne moze zaobici frontend slanjem ID-a tudjeg zapisa,
  promjenom statusa, ticket kind/payload ili pozivom starog endpointa.
- Naslovi sa č/ć/ž/š/đ i CR/LF ne lome Content-Disposition i ne kreiraju
  nedozvoljene headere/putanje.

## 6. Desktop i mobilna matrica

Brojevi ispod oznacavaju CSS viewport, ne fizicku rezoluciju monitora.
Zabiljeziti stvarni `innerWidth/innerHeight`, DPR, browser zoom i OS scaling.

| Grupa | Viewporti / varijacije | Nacin pokrivanja |
| --- | --- | --- |
| Desktop mali | 1024x768, 1280x720, 1280x800, 1366x768 | Svi dozvoljeni ekrani, najduzi tekstovi, dialog/drawer i duga tabela. |
| Desktop standard | 1440x900, 1536x864, 1600x900, 1920x1080 | Puni kljucni E2E workflowi, desktop navigacija i media/transferi. |
| Desktop veliki | 2560x1440, 3440x1440, 3840x2160 | Sirina sadrzaja, gustoća, player i dostupnost akcija bez pretjeranog rastezanja. |
| Mobilni portrait | 320x568, 360x800, 375x812, 390x844, 412x915, 430x932 | Sve uloge: glavne akcije, touch, upload, pretraga, komentar, video i rundown. |
| Mobilni landscape | 844x390, 915x412 | Toolbar/player, dialog footer, mali raspolozivi height. |
| Tablet / split screen | 768x1024, 820x1180, 1024x1366; uski desktop 960x700 | Sidebar prijelaz, dvopanelni rundown i tabele. |
| Granice layouta | Stvarni theme breakpoint -1/0/+1 px; width sweep 320-1920 u koraku 40 px | Automatizovan overflow/overlap check; svaki nadjeni lom dobija screenshot/regresiju. |
| Zoom / DPI | Browser 100/125/150/200%; 400% reflow provjera; DPR 1/1.25/1.5/2 | Posebno razlikovati browser zoom od DPR-a; DPR sam ne simulira reflow. |

Browser strategija:

- Chromium i instalirani Chrome/Edge: puna desktop matrica u jednom kanalu,
  kljucni tokovi i stvarni H.264/HLS/download u branded Chrome/Edge.
- Playwright Firefox i WebKit: kljucni tokovi na 1366x768, 1920x1080 i
  mobilnom reprezentativnom viewportu gdje engine podrzava emulaciju.
- Instalirani Firefox: stvarni playback/download dodatni smoke preko
  dostupnog browser/computer alata. Playwrightov Firefox nije isto sto i
  instalirani branded Firefox.
- Android Chrome i iOS Safari: emulacija layouta/toucha, pa stvarni uredjaj
  kada postoji dostupan pristup. WebKit na Windowsu ne dokazuje Safari codec,
  file picker, download ili pozadinsko ponasanje na iPhoneu.

Ne izvrsavati svaki dugacki transcode scenario na svakoj kombinaciji. Puni
functional suite radi na referentnom desktop Chromeu i kljucnom mobilnom
viewportu; layout/state sweep pokriva ostale kombinacije, a medijski tokovi
posebno sve dostupne relevantne browsere.

Kriteriji upotrebljivosti/layouta:

- Nema horizontalnog scrolla cijele stranice ni odsijecenih bitnih akcija.
  Kompleksna tabela moze imati lokalni scroll ako joj struktura to trazi, ali
  mobilni osnovni posao ostaje moguc i jasno su dostupne row akcije/detalji.
  Arhivska osnovna tabela na podrzanom desktopu ne smije zahtijevati lijevo-
  desno scrollanje samo da bi se vidjele redovne akcije.
- Drawer/backdrop/modal pravilno prekriva header, scroll ostaje u panelu,
  close i submit ostaju dostupni na kratkom viewportu i uz virtualnu tastaturu.
- Dugi naziv/opis, BHS label, status i KPI ne preklapaju susjedni element.
  Nema layout skoka pri ucitavanju thumbnaila, hovera ili loadinga.
- Touch nema obavezni hover; video detalji dostupni tapom. Drag/reorder ne
  smije biti jedini neupotrebljiv put na touchu ili tastaturi.
- Primarne touch akcije ciljaju 44x44 CSS px; provjeriti WCAG minimum
  24x24 sa definisanim izuzecima/razmakom. Velicina ne zamjenjuje focus/label.
- Tab/Shift+Tab/Enter/Escape, vidljiv focus, redoslijed, focus trap i povratak
  fokusa rade; icon-only akcije imaju pristupacno ime i tooltip gdje treba.
- Kontrast, form label/error i status koji nije objasnjen samo bojom se
  provjeravaju automatski i pregledom. To nije tvrdnja pune WCAG certifikacije.
- Na mobilnom provjeriti stvarni file picker, fullscreen video, keyboard,
  portrait/landscape, browser Back i prekid veze. Ako uredjaj nije dostupan,
  te stavke imaju `blocked`, ne `passed`.

Vizuelne baseline snimke kreirati tek nakon pregleda da je pocetni izgled
ispravan. Izolovati dinamicne satove/progress, ali ne maskirati problematične
UI dijelove. Screenshot slicnost ne zamjenjuje klik/keyboard provjeru.

## 7. Neiskoristeni elementi i kontrola UI-a

Izraditi inventar svih nav linkova, tabova, filtera, buttona, icon akcija,
menija, dialoga i media kontrola. Za svaku stavku povezati:

```text
UI-ID -> komponenta -> dozvoljene uloge -> uslov prikaza -> handler
      -> API/local efekat -> testni scenario -> korisnicka svrha
```

Provjeriti da svaka dostupna akcija ima rezultat, loading/error/disabled
ponasanje i jasan tekst. Posebno traziti handler koji nista ne radi,
duplirani naziv/oznaku, nepovezan filter, pogresan link, placeholder control,
duplo slanje, stalni spinner i UI tvrdnju koja ne odgovara backend stanju.

Za source/dependencies uraditi AST/import graf od `index.js`/`App.js`, dynamic
import i role/feature grane, pa pretragu referenci i runtime coverage kroz
cijeli role suite. Kandidati ukljucuju `Header.js`, stari CSS/assets,
`reportWebVitals.js` i manifest dependencyje bez importa; ovo nije odluka da
su svi oni beskorisni. CLI/config/transitive i side-effect importi se moraju
razlikovati od mrtvog koda.

Svaki nalaz klasifikovati kao: nefunkcionalna akcija, redundantni prikaz,
potvrdjeni mrtvi kod, uslovno koristen feature ili nerazjasnjen legacy dio.
Prije eventualnog uklanjanja zapisati dokaz dostupnosti i plan regresije.
Feature/legacy ugovor ne brisati zato sto nije pokriven jednim klik-testom.
Mjerljive duplikate/prave UI bugove popravljati, a poslovno ukidanje ili
spajanje funkcije dati korisniku na odluku.

## 8. Performance metod i acceptance ciljevi

Mjerenja izvrsavati nad production buildom. Zabiljeziti dataset, hardver,
OS/browser, FFmpeg encoder, queue mod, verzije indeksa, host/DB lokaciju,
mrezni profil i cold/warm cache. Prije poredjenja optimizacije fiksirati te
parametre i workload; istorijski brojevi iz docs-a nisu novi rezultat.

Osnovni benchmark: 5 zagrijavanja i najmanje 100 API uzoraka po vaznom upitu
za p50/p95; 10 cold i 10 warm UI prolaza; transcode pet reprezentativnih
klipova, najmanje tri ponavljanja ako trajanje i resursi dopustaju. Za mali
uzorak izricito navesti slabiju pouzdanost percentila.

Sljedeci pragovi su predlozeni projektni acceptance ciljevi, ne vec izmjereni
rezultati ili univerzalna garancija. Okruzenje i pragovi fiksiraju se prije
optimizacionog mjerenja; svaki nerealizovan cilj dobija konkretan nalaz.

| Metrika | Cilj / nacin provjere |
| --- | --- |
| Metadata list API na 10k | p95 <= 500ms warm, <= 1000ms za search/filter uz 10 istovremenih sesija na referentnoj LAN/QA DB konfiguraciji. Ukljuciti count/summary/facets cijelog endpointa, ne samo `find`. |
| Metadata list API na 50k | p95 <= 1500ms za primarne queryje pod istim normalnim opterecenjem; odvojeno mjeriti posljednju/deep stranicu i nepokrivene sorte. |
| Prvi upotrebljivi ekran | Glavna lista i akcije <= 2.5s u referentnom LAN desktop cold scenariju; slow-mobile rezultat posebno, bez oslanjanja na prazni shell. |
| Interakcije / stabilnost | Ciljati LCP <= 2.5s, INP <= 200ms, CLS <= 0.1. Lab TBT cilj <= 200ms desktop / <= 300ms throttled mobile. INP nije isto sto i TBT; field 75. percentil se ne proglasava prolaznim iz par lab testova. |
| UI tokom transfera | Filter, komentar i navigacija i dalje rade; lokalne reakcije uglavnom <= 100ms, bez ponovljivih >200ms zastajkivanja. API cekanje se razlikuje od zamrznutog main threada. |
| Storage overview | Warm cached API p95 <= 200ms u lokalnom QA okruzenju; refresh brzo prihvata background posao. Full scan/dbStats vrijeme i greske odvojeno. |
| HLS start | Cilj <= 3s do prvog prikazanog framea na LAN-u; <= 6s na kontrolisanom 10Mbps/80ms profilu. Mjeriti klik Play -> prvi frame, a ne samo response manifest-a. |
| Preview promet | Lista ne preuzima pune videe, thumbnail samo za vidljive/bliske stavke, scrub frameovi po potrebi. Player koristi segmente/Range; mali MP4 moze stati u jedan range pa velicina sama nije dokaz Blob buga. |
| Paging / DOM | Dosegljivi su svi dozvoljeni rezultati uz ogranicen page size; broj prikazanih redova/media zahtjeva ne raste sa ukupnom bibliotekom. |
| Search | 300ms debounce i minimum dva znaka; race prethodnih odgovora ne pregazi nov query. Nema poziva po svakom karakteru/duplih identicnih fetchova. |
| Polling | Pozivi imaju aktivan UI razlog; hidden tab i neaktivne povrsine miruju gdje workflow dopusta. Notifikacije po povratku tab-a odmah osvjeze, u vidljivom tabu u okviru 30s intervala plus latencija. |
| Query plan | Primarni selektivni filter/sort/prefix queryji koriste prikladan indeks, bez nepotrebnog COLLSCAN/unbounded sort-a. Agregati koji namjerno prolaze biblioteku moraju biti ograniceni/kesirani i zasebno ocijenjeni. |
| Resursi / stabilnost | Poslije warmup-a nema ponovljivog monotonog rasta memorije, object URL-ova, listenera, HLS instanci ili pollera kroz 20 ciklusa. Rast >15% stabilne memorije istraziti, a ne automatski nazvati curenjem zbog GC varijacija. |
| Optimizaciona regresija | Za isti workload nema pogorsanja p95/TTFF >10% izvan dokumentovane varijacije. Svaka optimizacija ima prije/poslije dokaz i ponovljen relevantni feature test. |

Load profil:

1. 1, 5 i 10 aktivnih sesija kao osnovni nivoi; 20 kao stress nivo. Izabrati
   realan mix Reporter/Editor/Producer/Realizator/Arhiva/Admin aktivnosti.
2. Istovremeni filter/search, pet video playera, dva downloada i batch upload.
   Mjeriti API brzinu i browser upotrebljivost dok tri queuea rade.
3. HLS backlog od 20 poslova i maintenance rebuild uz novi ingest. Odvojeni
   queue ne garantuje slobodan CPU/GPU/disk; izmjeriti stvarni utjecaj.
4. 30-minutni kombinovani smoke, zatim 60-minutni soak ako prvi ne otkrije
   blocker. Pratiti errore, retry, memoriju, event loop delay, FFmpeg procese,
   DB pool, storage rast i queue wait/processing time.
5. Normalno LAN i ogranicena mreza; offline/reconnect, delayed/out-of-order
   odgovori, download abort i restart samo QA servisa.

Query benchmark prosiriti izvan trenutne `indexes:explain` skripte: stvarni
role/owner/archive eligibility/category fallback filteri, vise prefiksa,
ispravke/notifikacije, audit date/action/actor, duplicate grupisanje, summary
i facet agregati, first/deep/last page. Zabiljeziti keys/docs examined i
plan/latenciju; IXSCAN sam po sebi ne dokazuje efikasnost.

## 9. Redoslijed izvrsenja

### Faza A: baseline i inventory

Prikupiti verzije, diff/build identitet, feature/UI/API inventar i test oracle
iz koda/docs-a. Pokrenuti postojeci build/test/syntax i zabiljeziti pocetne
greske. Rezultat je coverage mapa F01-F24 sa svim nedostajucim slucajevima.

### Faza B: testno okruzenje i harness

Postaviti izolaciju, preflight, seed, testne role sesije, media fixtures,
API/DB assertions, screenshots/network capture i pouzdano gasenje. Pokrenuti
jedan mali smoke prije punog suitea. Cleanup radi i pri exceptionu/SIGINT;
testni podaci sa dokazima ostaju ako test padne dok ih ne pregledamo.

### Faza C: funkcionalnost i dozvole

Izvesti F01-F24 i povezane E2E tokove nad malim datasetom, pa legacy,
concurrency i negative scenarije. Najprije stabilizovati P0/P1 probleme koji
sprecavaju ostale testove. Svaka popravljena greska dobija relevantan
regresijski test; ne pretvarati sve klikove u beskorisne unit testove.

### Faza D: responsive i mobilna upotrebljivost

Izvesti viewport/state/browser matricu, zoom, touch i keyboard. Automatizovan
overflow/geometrijski pregled dopuniti vizuelnim pregledom svakog kljucnog
ekrana i otvorenih panela. Popraviti layout u manjim grupama i ponoviti
samo zahvacene matrice, zatim sve glavne povrsine.

### Faza E: UI inventar i neiskoristeni kod

Povezati sve UI akcije s testom i efektom, dokazati import/runtime dostupnost
kandidata. Popraviti no-op/duplicirane kontrole, klasifikovati mrtvi kod i
pripremiti konkretan pregled svakog predlozenog feature uklanjanja.

### Faza F: performance i ciljane optimizacije

Seed 10k/50k, izmjeriti baseline i load/soak. Prioritet dati uskim grlima sa
dokazom: nepotpun paging, query/count/facets, duplicate polling, eager media,
ponovljeni renderi, blokirajuci disk I/O, ticket DB pozivi, queue contention
i bundle. Primijeniti male scoped promjene i mjeriti isti workload ponovo.
Bolje korisnicko vrijeme ima prednost nad kozmetickim Lighthouse scoreom.

### Faza G: zavrsna regresija i predaja

Na finalnom kodu ponoviti obavezne testove, sve kriticne E2E tokove,
reprezentativni desktop/mobile smoke i relevantne performance probeove.
Zabiljeziti sta je pass/fail/blocked/untested. Ugasiti samo vlastite
app/workere/FFmpeg/test procese, ukloniti privremena mapiranja i provjeriti
da su QA portovi slobodni.

## 10. Nalazi, prioritizacija i izlazni kriteriji

Svaki nalaz sadrzi ID, severity, rolu, ekran/API, viewport/browser, qaRunId,
korake i preduslov, ocekivano/stvarno, dokaz, uzrok ako je dokazan, promjenu
i rezultat retesta. Razlikovati application bug, test bug i ogranicenje
okruzenja. Retry koji naknadno prodje biljezi se kao flaky, ne tiho kao pass.

- P0: gubitak/povreda integriteta podataka, nedozvoljen pristup ili kriticna
  sistemska greska. Odmah zaustaviti zavisne/destruktivne testove.
- P1: blokiran osnovni posao, nedostajuci dozvoljeni materijali, nevidljiva
  ispravka, pokvaren download/player ili bitna mobilna akcija.
- P2: znacajan layout/usability/performance problem sa obilaznim putem.
- P3: lokalizacija, kozmetika ili dokumentacija bez blokade rada.

QA je zavrsen kada:

1. Svaki feature/UI ID ima scenario i zabiljezen rezultat; neinventarisana
   funkcija ili neizveden obavezni scenario nije automatski pokriven.
2. Nema otvorenih P0/P1; preostali P2/P3 imaju konkretan razlog i korisnicku
   odluku o prihvatanju, a ne neprovjerenu tvrdnju da sve radi.
3. Obavezni desktop/mobile viewporti i role zadaci imaju dokaz bez layout
   blockera; stvarni nedostupni uredjaji jasno su izdvojeni.
4. Production build, syntax, unit/integration/E2E prolaze; nema neobjasnjenih
   application console errora, failed requestova ili React warninga koji
   pokazuju stvarni bug. Postojeca tool deprecation upozorenja navesti odvojeno.
5. Primarni 10k performance ciljevi prolaze, 50k/load rezultat je zabiljezen,
   a unmet prag ne nestaje iz izvjestaja nakon optimizacije.
6. Download/player ne rade masovni media preload; svi zapisi su dosegljivi,
   permissioni i materijal ostaju ocuvani, UI inventar nema neobjasnjene no-op.
7. Procesi i testni resursi su kontrolisano zatvoreni, korisnikovi portovi i
   njegov pokrenuti checkout nisu dirani.

## 11. Artefakti i dokumentacija

Pri izvrsenju sacuvati u `analysis/qa/<run-id>/`:

- `IZVJESTAJ.md`: obuhvat, identitet koda/builda, okruzenje, rezultat po fazi,
  preostali rizici i ogranicenja.
- `FEATURE_UI_MATRICA.csv`: inventar, scenario, rola, handler/API i pass/fail/
  blocked status; `RESPONSIVE_MATRICA.csv` sa viewport/browser/state dokazom.
- `NALAZI_I_POPRAVKE.md`: reproducibilni bugovi, izmjene i retest; vaznije
  promjene upisati i u `docs/KLJUCNE_IZMJENE.md`.
- `PERFORMANCE_PRIJE_POSLIJE.csv` i sanitizovani query explain JSON: workload,
  percentile/median, broj uzoraka, varijacija, resursi i poredenje.
- Screenshots za sve glavne role/ekrane i problematicne/revidirane panele,
  izabrani traces i sanitizovani network dokazi.
- `POKRIVENO_I_NEPOKRIVENO.md`: stvarni uredjaji, remote mreza, NVENC,
  rijetki codeci i funkcije koje dostupno okruzenje nije dozvolilo provjeriti.
- Ponovljivi QA runneri/fixturei i kratki runbook za sljedeci release.

Workflow promjene uskladiti sa `docs/KORISNICKO_UPUTSTVO.md`. Dnevnik izvrsenja
i performance odluke povezati iz `docs/QA_SUGESTIJE_I_REFERENCE.md`.

## 12. Reference i njihova primjena

Svi naredni izvori pregledani su 03.10.2026. Sluzbene stranice su osnova za
testni metod; projektni latency/load pragovi u odjeljku 8 su nasi ciljevi.

1. [Playwright: Emulation](https://playwright.dev/docs/emulation) - viewport,
   touch, locale/timezone i DPR konfiguracija. Stvarna visina/keyboard/media
   ogranicenja fizickog uredjaja provjeravaju se dodatno.
2. [Playwright: Browsers](https://playwright.dev/docs/browsers) - browser engine
   matrica i branded Chrome/Edge za media codec provjeru. Playwright Firefox/
   WebKit ne predstavlja automatski instalirani Firefox/Safari na telefonu.
3. [Playwright: Assertions](https://playwright.dev/docs/test-assertions) -
   provjera korisniku vidljivog rezultata uz cekanje uslova umjesto fiksnih
   dugih sleepova.
4. [Playwright: Visual comparisons](https://playwright.dev/docs/test-snapshots)
   - pregledani screenshots i stabilni baselinei po okruzenju; vizuelni test
   dopunjava functional assertions.
5. [W3C: WCAG 2.2 Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html)
   - viewport 320 CSS px, reflow i objasnjivi izuzeci za dvodimenzionalni
   sadrzaj poput tabela.
6. [W3C: Target Size Minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
   - minimum 24x24 i izuzeci/razmak; 44x44 za glavne touch akcije je strozi
   projektni usability cilj.
7. [Google: Web Vitals](https://web.dev/articles/vitals) - LCP, INP, CLS i
   razlika izmedju lab mjerenja i 75. percentila stvarnih korisnickih sesija.
8. [Chrome: Lighthouse performance scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring)
   - tumacenje lab scorea i varijacije; glavni acceptance ostaje konkretni
   workflow/latencija, a ne samo agregatni score.
9. [MongoDB: db.collection.explain](https://www.mongodb.com/docs/manual/reference/method/db.collection.explain/)
   - executionStats i analiza planova primarnih queryja.

Projektna dokumentacija za traceability:

- `docs/KORISNICKO_UPUTSTVO.md` i `docs/KLJUCNE_IZMJENE.md` - feature inventory.
- `docs/INDEXIRANJE_I_PERFORMANSE.md`, `docs/INDEXIRANJE_RUNBOOK.md` - query,
  legacy/backfill i kontrolisani indeksi.
- `docs/HLS_STREAMING_I_JOB_SLA.md` - playback, SLA i correction workflow.
- `docs/NVENC_I_PREVIEW_RETENCIJA.md` - encoder, fallback, rebuild i retencija.
- `docs/STORAGE_I_MEDIA_PROFILI.md` - scanner, cache, profili i verzije.
- `docs/TV_DISTRIBUCIJA_I_PREDNOSTI.md` - poslovni tok kao povezani E2E scenario.

## 13. Preduslovi za potpuno izvrsenje

Potreban je dostupan izolovani MongoDB, FFmpeg/FFprobe, prostor za QA media,
browser binariji i odvojeni Redis za Redis-mode provjeru. Ako servis nije
dostupan, prvo izvrsiti nezavisne static/unit/layout dijelove i pripremiti
reproducibilne preostale testove; nedostupne integracije oznaciti blokiranim.

Remote mreza, pravi Android/iPhone i NVENC test zahtijevaju dostupno
okruzenje. To ne odgadja pripremu/izvrsenje ostalih faza, ali se ne zamjenjuje
neprovjerenom tvrdnjom da pravi uredjaj ili GPU radi. Formalna procjena
upotrebljivosti za tehnicki manje iskusne reportere dodatno trazi stvarne
predstavnike tih korisnika; Codexov scenario pregled sam nije korisnicka studija.
