# QA izvrsenje: Web Optimizacija

> Historijski izvjestaj ciklusa 03.10.2026. Dodatne popravke i provjere od
> 10.10.2026. su u [Funkcionalnom ciklusu](QA_FUNKCIONALNI_CIKLUS_2026_10.md).
> Stari brojevi i auth nalazi ispod nisu trenutni release dokaz.

Datum: 03.10.2026. Branch: `codex/Web-Optimizacija`.

## 1. Zakljucak i granice rezultata

Izveden je lokalni, izolovani QA ciklus i popravljeni su potvrdeni problemi
dozvola, konkurentnog preuzimanja jobova, paginacije, brisanja dijeljenih
fajlova, HLS aktivacije na Windowsu i responsive prikaza. Stack i verzije
aplikacijskih zavisnosti nisu promijenjeni. Sigurnosne nadogradnje odgodene
su prema izricitoj odluci korisnika.

Ovo nije potvrda da svaki feature i svaka moguca desktop rezolucija rade.
Inventar ima 644 UI kontrola i 136 API definicija; nisu sve pojedinacno
izvrsene. Fizicki mobilni uredjaji, druga mreza i Redis worker nisu dostupni
u ovom ciklusu. Acceptance kriteriji cijelog izvornog plana jos nisu u
potpunosti zatvoreni. Posebno ostaju jednosatni istek sesije bez refresh toka,
NVENC speed cilj i mobilni TBT cilj. Nema osnove za tvrdnju pune WCAG ili
sigurnosne certifikacije.

Detaljni nalazi: [NALAZI_I_POPRAVKE](../analysis/qa/NALAZI_I_POPRAVKE.md).
Pokrivenost i preostali posao:
[POKRIVENO_I_NEPOKRIVENO](../analysis/qa/POKRIVENO_I_NEPOKRIVENO.md).
Prvobitni kriteriji: [QA plan](QA_PLAN_FUNKCIONALNOST_RESPONSIVE_PERFORMANSE.md).

## 2. Izolacija i identitet

- Polazni HEAD je `e81a7658c0e4d02ba5b644f41ab71c08fa206d4e`, uz postojece
  nekomitane correction izmjene. One su sacuvane; QA promjene nisu poseban commit.
- Git ne dopusta razmake u branch imenu, pa je zahtjev "Web Optimizacija"
  realizovan kao `codex/Web-Optimizacija`.
- Svaki run pravi zasebnu kopiju backend koda, production builda i storagea
  u ignorisanom `.qa-runtime/`, novu lokalnu MongoDB bazu i testne korisnike.
- Nema ucitavanja stvarnog `.env`, produkcijskih tokena, baze niti storagea.
  QA portovi su 5110/27110; soak koristi 5111/27111. Runner odbija standardne
  produkcijske portove. Lighthouse koristi i vlastiti debugging port 9227.
- Queue mod je `local`, ne Redis. Testni podaci su disposable.
- `run-identity.json` biljezi HEAD, branch, hash backend izvora, builda,
  Node/platformu i hardver. Noviji runovi biljeze i frontend source hash.
  Runovi tokom popravki nisu ista byte-identicna revizija: soak i NVENC
  benchmark prethode posljednjim UI i Archive delete popravkama. Zavrsna
  media matrica je ponovljena nakon backend popravki.
- Runner zatvara samo svoje procese, provjerava QA portove i zapisuje
  `cleanup.json`. Korisnikovi procesi na 5000/5051 nisu predmet gasenja.

Okruzenje: Windows, Node 20.16.0, MongoDB 7.0, FFmpeg/FFprobe 7.1,
AMD Ryzen 7 5800X (16 logickih CPU), oko 32 GiB RAM-a, RTX 3060,
driver 617.14. Branded Chrome 154.0.8037.93, Edge i Playwright 1.62.1.
Lighthouse 12.8.2 je iskljucivo QA alat iz cachea, ne aplikacijska zavisnost.

## 3. Testovi i dokazi

Aktuelni run ID-evi i zbirni brojevi upisuju se u zavrsni indeks
`analysis/qa/ZAVRSNI_REZULTATI.json`. Pojedinacni runovi cuvaju
`results.json`, `IZVJESTAJ.md`, `run-identity.json` i `cleanup.json`.

- Frontend: svih 24 testa u 10 suiteova prolaze; production build prolazi.
- Backend i QA: zavrsni broj syntax provjera je u indeksu, uz cetiri
  prolazne `node:test` regresije.
- API integracija: stvarni login, Mongoose ObjectId, DB/fajl asercije,
  permission matrica, final/correction upload, review, rundown i pet tipova
  downloada. Nisu samo mock testovi.
- Browser: sedam dashboarda x 29 viewporta = 203 glavne provjere, osam
  Admin modula x tri viewporta = 24 dodatne; WebKit sedam uloga x dva
  viewporta = 14, te 53 width/DPR provjere Reportera.
- Matrica obuhvata CSS sirine od 320 do 3840 px i breakpoint granice.
  DPR 1.25/1.5/2 nije isto sto i browser zoom. Stvarni zoom 125-400% nije
  provjeren. Lokalni scroll kompleksnih tabela nije isto sto i overflow stranice.
- Browser dokazuje stvarni H.264/HLS frame canvas provjerom, seek,
  Auto/720p/480p, download handoff i nastavak SPA navigacije.
- Zavrsni browser run `2026-10-03T19-41-26-105Z-eb63d0` ima 39 prolaznih
  scenarija. Stvarna nova arhivska prijava pojavi se u otvorenom Editor
  Ispravke tabu kroz postojece osvjezavanje do 30 sekundi; mobilni red,
  action dugmad i notification Snackbar zatim su provjereni na 390 px.
  Ovo ne zamjenjuje sve comment-notification i hidden/visible scenarije.
- WebKit na Windowsu je layout smoke, ne dokaz iPhone Safari playbacka.
  Playwright Firefox ne moze se pokrenuti zbog Windows side-by-side
  konfiguracije; taj engine je blokiran, a ne prolazan.
- Media matrica: 24 stvarna kratka fixturea i 32 prolazna scenarija:
  H.264, HEVC/10-bit, MOV/PCM, ProRes, MXF/MPEG-2, tihi, vertikalni i 4:3
  klipovi, 25/30/50 fps, profili slika i preservation pri neuspjeloj obradi.
- 30-minutni soak je zavrsio sa 3510 uspjesnih API uzoraka, sest uploada,
  60 downloada i pet aktivnih playera; p95 API-a 115.9 ms. Zaseban
  60-minutni soak nije prosao zero-error kriterij: 7020 API uzoraka, od kojih
  posljednjih deset ima 403 zbog isteka jednosatnog JWT-a. Ostalih 7010
  poziva je uspjesno; p95 117.9 ms, 12 uploada i 118 downloada. Svih pet
  playera ostaje aktivno bez browser greske. To nije performance crash,
  ali jeste otvoreno pitanje kontinuiteta sesije tokom smjene. JWT trajanje
  i sigurnosni model nisu mijenjani da bi test postao zelen.

Frontend alat prijavljuje postojece `act` deprecation i jedan asinhroni
test warning u download contextu. Oni nisu sakriveni niti izjednaceni s
production runtime greskom. Browserslist baza je zastarjela; nije
nadogradena jer zavisnosti ostaju netaknute.

## 4. Performanse i tumacenje

### Biblioteka i API

Finalni run `2026-10-03T19-19-56-596Z-23c09f` koristi 10 aktivnih sesija,
pet warmup poziva i 100 mjernih uzoraka po endpointu. Veliki skup je
metapodatkovni: nije 50.000 zasebno transkodiranih velikih videa.

| Skup | Endpoint | p95 ms | Projektni cilj ms |
| --- | --- | ---: | ---: |
| 10k videa | Video / Archive / prefix / Jobs | 221 / 190 / 265 / 170 | 500 / 1000 / 1000 / 1000 |
| 50k videa | Video / Archive / prefix / Jobs | 383 / 742 / 977 / 241 | 1500 |
| 50k videa, 1000 feedbacka | Feedback | 81 | 1500 |
| 50k videa, 100k logova | Audit bez tekstualnog queryja | 183 | 1500 |

Prethodni run `2026-10-03T18-17-31-954Z-5db54d` ostaje sacuvan za
varijaciju i identitet prethodne revizije. Finalni run nema konkurentni
soak, za razliku od ranijih mjerenja. Sesije dijele lokalni hardver; ne radi
se o izolovanom produkcijskom benchmark serveru niti tvrdnji SLA-a.

Sest selektivnih Video upita ima IXSCAN i `executionSuccess`. Neki prefix
upiti i dalje pregledaju mnogo kljuceva i imaju sort; IXSCAN sam nije dokaz
optimalnosti. Count/facets agregati nisu automatski besplatni. Audit search
po proizvoljnom nested JSON-u sada koristi cursor ogranicene memorije, ali
i dalje ima O(n) cijenu prolaska kroz logove.

MongoDB `explain` ima lokalni Windows problem enkodiranja `serverInfo.host`.
Samo dijagnosticki helper ponavlja komandu bez UTF-8 validacije i provjerava
da zamjenski znak postoji iskljucivo u tom polju. Produkcijska BSON validacija
nije iskljucena i problem nije pogresno pripisan korisnickim dokumentima.

### Browser i bundle

Gzip pocetni `main` JS smanjen je sa 442.18 na oko 169.78 kB, odnosno oko
61.6%. To je glavni chunk, ne ukupno smanjenje svih JS asseta. Stranice
ucitavaju dodatne chunkove po potrebi; ukupni feature-i ostaju dostupni.

Reporter i Editor mjere po deset cold i deset warm prvih upotrebljivih
lista. Vrijednosti su lokalni lab rezultat, ne field INP. Lighthouse ima
tri ponavljanja po ekranu. Reporter koristi 4x CPU/slow-4G simulaciju;
finalni Editor koristi stvarni Lighthouse desktop preset (1x CPU).
Raniji runovi oznaceni desktopom imali su zadrzan mobilni throttling, pa
se njihove Editor ocjene ne smiju direktno porediti s finalnim desktopom.

Finalni Lighthouse run `2026-10-03T19-47-15-514Z-525219`:
Reporter mobile performance 93-95, LCP 1.53-1.57 s, TBT 264-324 ms i
CLS 0. Medijana TBT-a je 287.5 ms, ali jedan od tri uzorka prelazi 300 ms;
cilj nije stabilno zatvoren. Prethodni run `19-17-33-083Z-d1dc7c` imao je
332.5-354 ms, pa se zadrzava kao dokaz varijacije. Editor desktop ima
performance 100, LCP 404-421 ms, TBT 63-71 ms i CLS 0.00021; njegovi lab
pragovi prolaze. Oba ekrana imaju accessibility 100 u ta tri testirana
stanja, sto ne dokazuje punu WCAG uskladjenost. Raniji Reporter run
`2026-10-03T18-45-03-592Z-790d19` imao je TBT 858.5 ms u prvom uzorku;
svi uzorci i razlike workload-a ostaju u JSON-u, ne bira se samo najbolji.

### NVENC

Run `2026-10-03T18-24-23-701Z-3f8a87`: pet sintetickih 12-sekundnih
klipova, tri CPU i tri NVENC ponavljanja po klipu, naizmjenican redoslijed.
VMAF 720p izlaza je 93.69-98.74 za NVENC, a poredenje kvaliteta prolazi.
Medijalna promjena vremena je oko 48.2% sporije od CPU-a; cilj najmanje
30% ubrzanja nije ispunjen. NVENC izlazi su i oko 16-24% veci.

Benchmark je radio istovremeno sa soakom i na kratkim sintetickim izvorima.
Nije dokaz da NVENC nikada ne ubrzava duge broadcast klipove. Ne opravdava
automatsko ukljucivanje: potreban je zaseban test duzih stvarnih izvora bez
konkurentnog benchmark opterecenja. Encoder defaulti nisu promijenjeni.

## 5. Promjene bez gubitka funkcija

1. Reporter job prihvata vlastiti materijal ili odobrenu stanicnu arhivu,
   a ne proizvoljni privatni raw klip drugog reportera.
2. Claim joba/ispravke je atomican: jedan montazer dobija posao, drugi 409.
   Producer moze pratiti/komentarisati tok, ali ne dobija montazerski claim.
3. Istovremena arhivska prijava koja izgubi optimistic-concurrency race
   dobija razumljiv 409 i moze ponoviti zahtjev umjesto internog 500.
4. Sve stranice lista ostaju dostupne: Production Material po 50,
   Producer biblioteka po 30, Reporter jobovi i Ispravke po 50, server
   materijal u dopuni po 30 iz svakog izvora.
5. Neaktivni Material tab ne polluje. Reporter jobovi/Ispravke osvjezavaju
   se u vidljivom tabu; brzi odgovori ne prepisuju noviju pretragu/stranicu.
6. Klik za dopunu iz quick sidebara zatvara taj panel prije otvaranja
   dijaloga. Mobilna navigacija i preview panel prekrivaju sticky header.
7. Arhivska tabela, Ispravke i izbor materijala imaju kompaktan mobilni
   red; desktop arhivske kolone vise ne zahtijevaju 102% sirine. Vizuelno
   skriveni `thead` ostaje u DOM-u, ali je sada pozicioniran unutar tabele;
   prethodno je mogao prosiriti stranicu na 423 px u viewportu od 390 px.
8. Producer/Realizator imaju dostupne gore/dolje akcije za touch/tastaturu;
   postojeci drag nacin i backend reorder ugovor ostaju.
9. Thumbnail komponenta cuva lazy/fallback i object URL cleanup i pri
   recikliranju komponente za drugi video; stari odgovor ne vraca staru sliku.
10. HLS rename ponavlja samo privremene Windows handle greske; referencirani
    segmenti se validiraju prije aktivacije/retencije.
11. Admin, owner i Archive duplicate brisanje koriste zajednicku provjeru
    media root-a, realpath/junctiona i referenci drugog Video zapisa.
12. Audit workspace vise ne gubi historiju poslije prvih 5000 zapisa.
    Stari export i kompatibilni endpointi ostaju.
13. Pocetni route bundle i skrivena Reporter priprema ucitavaju se po potrebi.
    Nacrt se cuva pri sklapanju pripreme; bez jobova ona se automatski otvara.
14. Poboljsani su kontrast, naslovi, struktura navigacijske liste i label veze
    za job filtere i player kvalitet. Ne mijenja se font velicina ekrana.
15. Uklonjeno je sest dokazano neimportovanih legacy fajlova:
    `Header.js`, `App.css`, `index.css`, `config.js`, `logo.svg`,
    `reportWebVitals.js`. `setupTests.js` ostaje jer ga Jest implicitno koristi.
    Kandidati za zavisnosti nisu uklonjeni samo na osnovu statickog coveragea.

## 6. Sigurnosni rizici: dokumentovani, ne nadogradeni

`npm audit --json` je sacuvan u `analysis/qa/dependencies/`:
backend/root 20 prijavljenih zavisnosti (2 critical, 12 high, 4 moderate,
2 low); frontend 108 (3 critical, 82 high, 14 moderate, 9 low).
To nisu 128 jedinstvenih exploita: zavisnosti i advisoryji se preklapaju,
a dio pripada build/dev lancu. Instalirani Mongoose ima critical advisory;
Express, Axios i React Router imaju high nalaze. bcrypt/Bull i njihove
tranzitivne zavisnosti takodjer zahtijevaju odvojenu procjenu.

Korisnik je odabrao "Samo dokumentuj rizike, nadogradnje kasnije".
Nije izvrsen `npm audit fix`, promjena lockfilea, bcrypt major ili CRA migracija.
Prije javne produkcijske izlozenosti potrebna je zasebna prioritizovana
sigurnosna nadogradnja i regresija; prolaz ovih functional testova nije
odobrenje da se audit rizici ignorisu.

## 7. Ponovljivo izvrsenje i rollout

Preduslovi: Node 20, instalirane postojece zavisnosti, lokalni `mongod`,
FFmpeg/FFprobe, dovoljno slobodnog diska i Playwright browseri. Test-only
module putanje mogu se zadati sa `QA_PLAYWRIGHT_MODULE` i
`QA_LIGHTHOUSE_MODULE`; time se ne mijenja aplikacijski manifest.

```powershell
npm run build --prefix frontend
npm test --prefix frontend -- --watchAll=false --runInBand
npm run qa:checks
node --test tests/backend/atomicRename.test.js tests/backend/auditLogHelpers.test.js
npm run qa:inventory
npm run qa:dependencies
npm run qa:api
npm run qa:browser
npm run qa:performance
npm run qa:media
npm run qa:benchmark
npm run qa:lighthouse
npm run qa:report
$env:QA_PORT='5111'
$env:QA_MONGO_PORT='27111'
$env:QA_SOAK_MINUTES='60'
npm run qa:soak
```

`qa:all` izvrsava samo API/workflows, browser i workspace performance.
Ne obuhvata media, benchmark, Lighthouse ni soak; oni se pokrecu posebno.
`qa:report` treba ponoviti nakon zavrsetka svih runova; bira posljednji
zavrseni run svakog tipa, ukljucujuci neuspjeh, bez tihog odabira samo zelenih.
Necuvane tajne i privatni runtime logovi nisu za commit ili dijeljenje.

Prije rollouta pregledati diff na ovom branchu, backup baze/storagea,
ponoviti kriticni workflow nad staging kopijom, rijesiti ili izricito
prihvatiti preostale rizike i tek tada deployati. Nema automatske DB
migracije, index/drop operacije nad stvarnom bazom niti cleanup-a mastera.
Vracanje prethodnog koda i builda je rollback; novi QA harness nije servis
koji mora ostati pokrenut uz aplikaciju.

## 8. Reference i konkretna primjena

Izvori pregledani 03.10.2026. Nasi latency pragovi nisu univerzalne garancije
ovih organizacija.

- [Playwright Emulation](https://playwright.dev/docs/emulation):
  `qa/specs/browser.js`, viewport/touch/DPR; ne zamjenjuje fizicki telefon.
- [Playwright Assertions](https://playwright.dev/docs/test-assertions):
  cekanje vidljivog UI/response/DB rezultata, ne uspjeh na osnovu samog klika.
- [Chrome Lighthouse overview](https://developer.chrome.com/docs/lighthouse/overview)
  i [performance scoring](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring):
  `qa/performance/lighthouse.js`, autentifikovani lab, tri ponavljanja,
  stvarni configSettings profili i odvajanje od field INP.
- [W3C Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html):
  `frontend/src/theme.js`, tamniji sekundarni tekst na postojoj pozadini.
- [MUI Select](https://mui.com/material-ui/react-select/):
  `EditJobBoard.js` i `VideoPlayer.js`, `InputLabel.id`/`Select.labelId`.
  Koristi se postojeci MUI API, ne nova major verzija biblioteke.
- [MDN Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API):
  aktivan polling vidljivih Reporter/Correction/Material povrsina.
- [MongoDB explain](https://www.mongodb.com/docs/manual/reference/method/db.collection.explain/):
  `qa/helpers/explain.js`, keys/docs examined i winningPlan za velike liste.
- [MongoDB Node driver UTF-8 validation](https://www.mongodb.com/docs/drivers/node/v6.x/data-formats/bson/utf8-validation/):
  ogranicena dijagnosticka iznimka samo za neispravan server hostname u explainu.
- [npm audit](https://docs.npmjs.com/cli/v10/commands/npm-audit/):
  `scripts/qa/dependencies.js`, dokumentovanje severity/direct/transitive nalaza
  bez automatskog `fix` i bez promjene stacka.
- FFmpeg/NVIDIA referentni mehanizmi i raniji rollout ostaju dokumentovani u
  [NVENC i retenciji](NVENC_I_PREVIEW_RETENCIJA.md); ovaj QA daje vlastita
  mjerenja, ne pripisuje svojim kratkim fixtureima rezultate iz tih izvora.
