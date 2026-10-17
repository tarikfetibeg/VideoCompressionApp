# QA predaja: funkcionalna provjera i regresije

Zavrseno 11.10.2026. na branchu `codex/Web-Optimizacija`.
Status: **djelimicna pokrivenost sa otvorenim rizicima**, ne release odobrenje.
Nekomitani baseline je sacuvan; nema commita, dependency nadogradnje niti izmjene diplomskih fajlova.

## Konacni identitet

HEAD: `e81a7658c0e4d02ba5b644f41ab71c08fa206d4e`.
Svi dole navedeni kratki suiteovi imaju isti aplikacijski snapshot:

- backend: `fd25d1c67d78d9ee387bda9a02bc71fc77934ff71c16704f34cc19be1c9cc721`;
- frontend izvor: `11fa7afbb337de076f3c9b2761d18ef79883ffd112a3587842b63934c19b2c45`;
- production build: `57d491edfd7a11422dbd7d0c1fe797179f8786376c6d83f9bb1e0dacb9552722`.

Dokazi su rasporedjeni kroz tri releasea:11-56-22-751Z (frontend/build/UI),
12-01-01-117Z (checks/unit/inventory/API/edges/policy) i12-03-17-432Z (ostali kratki suiteovi).
12-01 runner je prekinut tokom browser faze nakon korisnikove nove odluke;
zavrsene faze ostaju dokazi, a browser je ponovljen do kraja.
Svaki folder ispod pocinje sa `2026-10-11T`.

## Zavrsne kratke provjere

| Provjera | Rezultat | Run / dokaz |
| --- | --- | --- |
| Backend sintaksa / unit | 136 / 12 prolaznih | 12-01-01-117Z-release logs |
| Frontend testovi / build | 50 testova,15suiteova; build prolazan | 11-56-22-751Z-release; main gzip173,617kB |
| Inventar | 684JSX deklaracije,136API definicija | inventory; nije runtime pokrivenost svih kontrola |
| API i povezani workflowi | 47 prolaznih | 12-01-09-271Z-68229c |
| Validacija / rubni slucajevi | 8 prolaznih | 12-01-34-099Z-a0c530 |
| Permission policy | 1 prolazan,2odgodjena | 12-01-43-569Z-ba2633; korisnicke odluke |
| Session recovery | 6 prolaznih | 12-05-39-889Z-faa741 |
| Browser / responsive | 39 prolaznih | 12-03-18-048Z-c83300 |
| UI / native zoom / scroll | 6 prolaznih | 11-56-49-891Z-57f7fb |
| Maintenance | 8 prolaznih | 12-05-55-554Z-fa23d8 |
| Media / encoder fallback | 32 prolazna | 12-06-08-329Z-5bb9fe |
| Kontrolisani network | 4 prolazna | 12-06-31-371Z-e17113 |
| Dugi transfer / kontrolisana TTL migracija | 2 prolazna | 12-07-01-254Z-fd070f; stvarni60s heartbeat |
| Liste / performance / explain | 21 prolazan | 12-08-10-837Z-bb9bed |
| Lighthouse | 6 snimanja;1mobile TBT target miss | 12-09-08-744Z-b81e33; capture PASS nije svi pragovi PASS |

## Header i sazetak popravki

Korisnik je odobrio ispravku headera koji je pri400% zoomu zauzimao oko75%
visine. AppShell pri visini do400CSSpx ima kompaktniji toolbar/chipove i
static poziciju:106CSSpx u201CSSpx viewportu,47,3% pocetnog prostora za
sadrzaj, svih7rola. Pri scrollu header potpuno izlazi iz viewporta.
Navigacija, notifikacije, odjava i svi transfer brojaci ostaju. Samo
sekundarni opis role i neinteraktivna tehnicka polling napomena tada nisu
prikazani. Na visem viewportu ostaje sticky. Nema promjene auth/poll/media logike.

50frontend testova ukljucuje novi test header akcija i aktivnih/neuspjelih
transfera. Native zoom ima28stanja, provjeru height budzeta, scrolla i
neodsijecenih PNG dimenzija. [Vizuelni pregled](VIZUELNI_PREGLED_2026_10.md)
razlikuje raniji screenshot artefakt od stvarnog layout nalaza.
Neuspjeli pokusaji i korekcije QA ocekivanja nisu obrisani.

Ostale popravke: same-account re-login bez gubitka nacrta, Reporter draft
refresh/double submit, notifikacije, download status/retry, validacija,
zatvaranje javnog uploads i siguran raw/OFF/manifest cleanup.
Detalji su u [QA mehanizmima](../../docs/QA_FUNKCIONALNI_CIKLUS_2026_10.md).

## Mjerenja na konacnom buildu

API p95 na10k: video168,52ms, archive180,74ms, prefix294,67ms, jobs214,70ms.
Na50k: video396,99ms, archive726,82ms, prefix890,91ms, jobs211,16ms.
Feedback1k66,11ms; audit100k179,42ms; cached storage1,99ms. Svi ovi ciljevi
su prolazni.100uzoraka uz10istovremenih zahtjeva istog racuna po endpointu;
istorijska oznaka `sessions:10` nije deset razlicitih identiteta.

Prvi upotrebljivi ekran (10cold+10warm ponavljanja): Reporter p95
379,92/252,63ms, Editor598,13/453,95ms. HLS prvi dekodirani frame
652,92ms lokalno i3721,84ms na simuliranih10Mbps/80ms; Range206 pocinje
prije cijelog MP4. To nije mjerenje stvarne druge mreze.

Lighthouse Reporter mobile: TBT341/274,5/263,5ms, LCP1584,74/1537,03/1527,02ms,
CLS0. Prvi TBT prelazi cilj300ms: otvoren performance nalaz, nije sakriven
medijanom niti zamijenjen ponovljenim povoljnijim rezultatom. Editor desktop:
TBT71/72/71ms, LCP410,10/411,54/411,33ms, CLS0,000213.
Lab TBT nije stvarni INP; accessibility score100 nije WCAG certifikacija.
Main gzip je173,617kB,96B vise nego prije header CSS-a; feature chunkovi
nisu uklonjeni i ovaj broj nije ukupna velicina aplikacije.

## Prethodni dugotrajni dokazi i korisnicko preskakanje

Korisnik je izricito trazio preskakanje novih dugotrajnih testova nakon
header popravke. **Nije izvrsen novi30/75m soak na konacnom header buildu.**

Raniji30m: `2026-10-11T09-45-15-057Z-b22220`,1802,17s,3510API,
0neocekivanih gresaka,6prihvacenih uploada,60downloada,p95107,65ms.
Raniji75m: `2026-10-11T10-15-44-780Z-253f4d`,4501,01s,8770API,
0neocekivanih gresaka,15uploada,148downloada,p95105,01ms.
Oba su PRIJE header promjene, sa starim frontend/build hashom.

75m ima10eksplicitnih API prijava i6browser prijava nakon stvarnog JWT
isteka (bez pomjeranja sata/refresh toka). Reporterov nacrt je sacuvan.
Na kraju5playera:readyState4,paused=false,error=null; browserErrors prazan.
Server WorkingSet uzorci95,53-144,09MiB nisu heap/leak certifikacija.
Broj uploada znaci prihvacene zahtjeve, ne provjeru svake HLS izvedenice;
test koristi male sinteticke klipove, ne GB batch. Prekinuti runovi nisu PASS.
ZAVRSNI_REZULTATI je indeks razlicitih snapshotova; citati moraju navesti run/hash.

## Otvoreno i obavezna deploy provjera

- Produkcijska DownloadTicket TTL migracija **NIJE izvrsena**. URL ostaje15min,
  tracking24h sa60s heartbeatom. Stari expiresAt TTL treba namjerno zamijeniti
  nakon backupa prema [runbooku](../../docs/DOWNLOAD_TICKET_RETENCIJA_RUNBOOK.md).
  Schema ili indexes:create sami ne uklanjaju stari index.
- P1 linked video delete moze ostaviti neispravan rundown/job; korisnik je
  odabrao samo dokumentovanje. Ne brisati aktivno povezane videe.
- Stara JWT rola, trenutno opozivanje sesija/ticketa i dependency nadogradnje
  su odgodjeni. Node20 je EOL. npm audit: root24 (3critical/12high/7moderate/2low),
  frontend112 (4critical/84high/17moderate/7low), bez tvrdnje iskoristivosti svih nalaza.
- Xiaomi14 Android i LAN desktop, MozillaFirefox: user-reported uspjeh,
  verzije nisu date; snapshot prethodi posljednjim promjenama. Nije dokaz
  svih scenarija svih uloga na posljednjem buildu. Druga mreza/iPhone/Redis blocked.
- NVENC kvalitet prolazan, medijalno ubrzanje-6,6% umjesto cilja30%: CPU ostaje
  default. Benchmark nije ponavljan; HLS builder hash ostao je isti.
- P3: dupli QC prefiks u Video Details i preostale engleske labele su otvoreni
  u [nalazu](P3_VIDEO_DETAILS_LABELS.md). Header P2 je zatvoren; mobile cold TBT nije.
- Sve kontrole/filter kombinacije, velike upload korupcije, multi-process
  race/TOCTOU, Redis recovery i sigurnosna certifikacija nisu iscrpljeni.
  [Mapa pokrivenosti](POKRIVENOST_2026_10.md) ostaje izricito djelimicna.

## Gasenje i zavrsna kontrola

Svi vlastiti testni app/Mongo/browser/FFmpeg procesi su zatvoreni.
Portovi5110-5115,27110-27115 i9227 provjereni su slobodnim; scoped process
provjera nije nasla preostale QA procese.5000/5051 i stvarni podaci nisu
preuzimani niti gaseni. Public QA pattern secret scan:0kandidata; nije
potpuna security potvrda. Dependency verzije i lockfileovi nisu nadogradjeni.
