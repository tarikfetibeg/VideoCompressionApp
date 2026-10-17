# Funkcionalni QA ciklus: oktobar 2026

Branch: `codex/Web-Optimizacija`. Rezultati od 03.10.2026. su historijski
baseline, ne dokaz aktuelnog koda. Ovaj dokument biljezi dodatni ciklus,
korisnicke odluke i tacne granice provjere. Izvorni diplomski dokumenti se ne mijenjaju.

## Izolacija i ponavljanje

`npm run qa:release` objedinjuje sintaksu, backend unit, frontend test/build,
inventar, API/workflow, validation edge, permission policy, session recovery,
browser/responsive, native zoom, maintenance/media, network, performanse,
Lighthouse, NVENC benchmark, 30-minutni smoke i 75-minutni soak.
`qa:all` namjerno zadrzava raniji API/browser/performance skup.
Selektivni retest: `npm run qa:release -- --phases=checks,unit,frontend,build,session`.

Svaki integracijski run kopira samo backend izvor i production build u
`.qa-runtime/<run-id>`, bez `.env`, produkcijskih fajlova ili symlinkova.
Koristi novu lokalnu MongoDB bazu, generisane H.264/AAC fajlove, testne
racune i lokalne redove obrade. Nema promjene produkcijskog MongoDB-a.
`run-identity.json` sadrzi Git HEAD, backend/frontend/build hash i hardver;
`release.json` biljezi faze i njihove zasebne run ID-eve. Nekomitani rad
ostaje baseline; sam HEAD zato nije dovoljan identitet testiranog koda.

### Nastavak11.10. i odobrena header popravka

Prvi run poslije limita dovrsio je stvarne30/75m testove. Nakon toga je
vizuelni native400% pregled pokazao da sticky header zauzima oko75% visine.
Korisnik je odobrio popravku: AppShell kompaktira toolbar/chipove i pomjera
header sa stranicom pri visini do400CSSpx. Sekundarni opis i tehnicka polling
napomena tada nisu prikazani; sve akcije i svi transfer brojaci ostaju.
Na visim ekranima izgled/pozicija ostaju isti. Nema auth/poll/media promjene.

`2026-10-11T11-56-49-891Z-57f7fb`: UI6PASS,28native zoom stanja i scroll
provjera svih7rola. Pri400% header106CSSpx,viewport201CSSpx,47,3% pocetnog
prostora za sadrzaj; pri scrollu header potpuno izlazi. PNG capture koristi
pun fizicki viewport, uz provjeru dimenzija, ne CSS clip koji je ranije
odsijecao slike. Session capture ceka Fade opacity1 samo aktivnog dialoga,
ne skriveni keepMounted navigacijski backdrop. Raniji neuspjeli QA capture
testovi ostaju sacuvani; njihovo pogresno cekanje nije aplikacijski bug.

Korisnik je zatim izricito trazio preskakanje novih dugotrajnih testova.
Prethodni30/75m PASS rezultati nisu bajt-identican header build i ne smiju
se predstavljati kao finalni novi soak. Kratki finalni prolaz i source/build
veze su u [QA predaji](../analysis/qa/PREDAJA_QA_2026_10.md).

Portovi 5110/27110 su za automatizaciju, 5112/27112 za session retest,
5113/27113 za UI acceptance, a
5114/27114 za uredjaje. Standardni
5000/5051/27017 se ne preuzimaju. Gasenje obuhvata samo PID stabla runnera;
`cleanup.json` zapisuje provjeru slobodnih QA portova.

## Odobrene promjene

Nova odobrena ispravka za dugi download: URL expiry ostaje 15 minuta, a
tracking purgeAt ima 24h retenciju i stvarni heartbeat. Dry-run/apply i
granice rollbacka su u [ticket runbooku](DOWNLOAD_TICKET_RETENCIJA_RUNBOOK.md).
Produkcijska migracija NIJE izvrsena. `indexes:create` sam ne uklanja stari TTL.

### Kontinuitet sesije bez automatskog produzenja

- JWT i dalje traje jedan sat. Nema refresh tokena niti automatske prijave.
- Auth middleware vraca postojece HTTP statuse i posebne kodove za missing,
  invalid i expired token. Permission 403 ne otvara re-login dijalog.
- Globalni dijalog cuva montiran ekran i nespremljeni unos. Prijava mora biti
  istim ID-em i rolom. Novi zasticeni read/poll zahtjevi cekaju prijavu;
  upload, submit, delete i ostali write zahtjevi se ne ponavljaju automatski.
- Promjena/odjava racuna u drugom tabu zakljucava stari radni prostor. Nacrt
  se ne prenosi novom korisniku. Kontrolisani izlaz ima upozorenje.
- Re-login dijalog je iznad globalnih transfer panela, tako da aktivni
  download/upload panel ne moze pokriti polja i dugme za prijavu na mobilnom ekranu.
- Native download predat browseru i vec izdat media ticket ne prekidaju se
  zbog isteka JWT-a. To ne garantuje nastavak prekinutog uploada.
- Aktivni polling je pauziran kada je tab skriven ili prijava blokirana.
- Login bez povezane baze ima 503 `DATABASE_UNAVAILABLE`, umjesto cekanja
  Mongoose buffer timeouta i neodredjenog login errora.

### Privatnost i integritet fajlova

- Javni legacy `/uploads` URL zatvoren je uz izricito odobrenje. Fajlovi nisu
  obrisani; zasticeni thumbnail, preview, HLS i download API-ji ostaju.
- Reporter vidi vlastiti upload/autorski materijal i odobrenu TV arhivu.
  `scope=station` vise nije zaobilaznica za tudji neodobreni raw klip.
  Ista provjera je u detaljima, marker read-u, thumbnail/scrub-u, legacy
  preview/stream endpointima i izdavanju/koristenju media ticketa.
- Odobrena arhiva zahtijeva edited/completed, approved_for_air/aired/archived
  i final approved ili QC passed ili vec aired/archived. Cijeli kriterij je
  `$and` uslov koji query parametri ne mogu prepisati.
- Raw retention preskace queued/processing/failed, aktivni master/fallback,
  dijeljeni fajl i nesigurnu putanju. Admin vidi broj preskocenih i razloge.
  Nezavisni istekli original nakon uspjesne obrade zadrzava redovno brisanje.
- OFF delete i job cleanup cuvaju reference drugih jobova/videa i odbijaju
  junction izlaz iz OFF storagea. Manifest delete prihvata samo basename.
- Ove provjere nisu formalna file-lock/DB transakcija: svi aliasi, konkurentne
  promjene referenci i TOCTOU situacije nisu iscrpljeni.

### Potvrdjene UX/validation regresije

- Kasno ucitan broj jobova ne zatvara reporterski Novi prilog koji je korisnik
  vec otvorio. Osvjezavanje iste event grupe ne brise naziv, brief, OFF izbor
  ili selekciju; namjerna promjena eventa i dalje inicijalizuje novi nacrt.
- Dupli klik na slanje joba pravi jedan POST i jedan job.
- Download server `created` se prikazuje kao cekanje pocetka, a `started` kao
  aktivno slanje. Beforeunload zastita traje do potvrde starta. `completed`
  znaci kraj slanja servera, ne potvrdu da je korisnik sacuvao fajl na disk.
- Neuspjeli klik na `Ponovi` zadrzava prikazanu gresku u panelu, bez
  neobradjene Promise greske. Nije sakrivena mreza/server failure poruka.
- Ponovni klik na procitanu notifikaciju ne smanjuje broj drugih neprocitanih.
  Neuspjeli read write ne vodi korisnika sa trenutnog nacrta na drugi ekran.
- Nevalidan audit actor/datum/opseg i rebuild scope daju 400. Eksplicitno
  prazan/nevalidan SLA izbor ne pretvara se u batch nad svim jobovima.

## Odluke koje ostaju rizici

Korisnik je odabrao samo dokumentovanje sljedecih nalaza:

1. Admin/owner video delete moze obrisati zapis koji je u aktivnom rundownu.
   Filesystem shared-file zastita nije zastita poslovnih referenci. Moguce je
   ostaviti neispravnu rundown/job vezu. Ne brisati aktivno povezane videe dok
   se ne odobri i implementira eksplicitna politika; ovo je otvoren P1 rizik.
2. Promjena role ne opoziva postojece JWT ovlastenje odmah. Stari JWT moze
   koristiti izdatu rolu do isteka od jednog sata. Media/download ticketi imaju
   odvojene TTL-ove i provjere; media cache moze zadrzati prethodno stanje
   do 15 sekundi. Nije uveden `authVersion`, refresh ili trenutno globalno opozivanje.
3. Nadogradnje Mongoose/Express/Axios/Router i ostalih zavisnosti su odgodjene.
   `qa:dependencies` osvjezava audit bez `audit fix`, instalacija ili lock churna.
4. Testirani Node 20.16.0 ostaje nepromijenjen. Node 20 je EOL od 30.04.2026;
   prolazan build nije potvrda sigurnog runtimea. Prelazak na podrzani LTS
   zahtijeva odvojenu odluku i native bcrypt/FFmpeg/queue retest.

Izvrsavanje suitea ne znaci odobren release: runner razlikuje failed,
partial/blocked i passed, a puna pokrivenost zahtijeva preostale dokaze.

## Mjerenja i tumacenje

Aktuelne brojeve i pojedinacne rezultate cuva
`analysis/qa/ZAVRSNI_REZULTATI.json`. Sirovi rezultati se ne brisu niti se
neuspjeli raniji runovi proglasavaju prolaznim.

Workspace performance harness mjeri 100 uzoraka uz deset istovremenih
zahtjeva, ali koristi isti role/account po endpointu. Historijska oznaka
`sessions: 10` u tom JSON/CSV-u znaci concurrency, ne deset razlicitih
identiteta. Soak zasebno koristi deset stvarnih razlicitih racuna.
Verzije Node/Mongo/FFmpeg/browsera i biblioteka su u
`analysis/qa/TOOLCHAIN_2026_10.json`; root i backend dependency resolution
su posebno provjereni i podudaraju se.

HLS/Range provjera koristi 120s klip: biljezi prvi dekodirani frame,
bufferedEnd, HLS manifest/segmente, seeking i kvalitet. Profil 10 Mbps/80 ms
je kontrolisana CDP simulacija, ne dokaz javne internet/LAN mreze. MP4
fallback mora koristiti 206 i poceti prije ucitavanja kompletnog fajla.
Download abort/retry znaci novi puni transfer, ne obecanje ZIP resumea.

Native zoom 125/150/200/400% postavlja se u Chrome Settings u privremenom
profilu. Provjeravaju se stvarni CSS viewport i DPR, ne samo emulirani DPI.
Automatska geometrija dopunjuje se odabranim vizuelnim snimcima; nije dokaz
svih 684 aktivnih kontrola niti puna WCAG provjera.

75-minutni soak mora stvarno preci jednosatni JWT istek. Testni korisnik se
ponovo prijavljuje eksplicitnim login zahtjevom ili globalnim browser
dijalogom; ocekivani expiry se posebno biljezi. Nema promjene trajanja JWT-a
niti laznog prolaza premjestanjem sistemskog sata.

## Stvarni uredjaji i blokade

`npm run qa:assist` pokrece zaseban snapshot na 5114/27114, privatni fajl
testnih racuna i ceka `stop` na stdin-u. Za launcher sa zatvorenim stdin-om
koristiti `npm run qa:assist:stop -- --run=<run-id>`; marker i device run
moraju odgovarati prije kreiranja privatnog stop signala. QA port nije zamjena za produkcijski
URL. Rezultati Androida/LAN racunara su zasebno zabiljezeni kao user-reported
ili instrumentovani, prema stvarno dostupnom dokazu.

- Druga mreza je blokirana: postoji samo pristup 5000 i nije preusmjeren.
- iPhone/Safari nije dostupan; WebKit na Windowsu je layout smoke.
- Lokalni Firefox/CFT proces nije pokrenut; uspjeh Chromea nije Firefox pass.
- Izolovani Redis nije dostupan; Bull/worker restart/recovery nije testiran.
- Detaljna mapa svih UI kontrola i sve F01-F24 edge grane ostaju potrebne;
  inventar i prolazan shared handler nisu dokaz svakog poslovnog slucaja.

## Pregledane tehnicke reference

Datum provjere: 10.10.2026. Reference objasnjavaju mehanizme, ne potvrdu
rezultata ove aplikacije; rezultati dolaze iz navedenih QA zapisa.

- [Node.js Release Working Group: release schedule](https://github.com/nodejs/Release#release-schedule):
  runtime EOL i plan odvojene nadogradnje.
- [Playwright: Emulation](https://playwright.dev/docs/emulation): viewport,
  touch/locale/timezone testovi i njihovo razlikovanje od stvarnog uredjaja.
- [ChromeDriver: Mobile emulation](https://developer.chrome.com/docs/chromedriver/mobile-emulation):
  granice emulacije; nije dokaz mobilnog file pickera i OS downloada.
- [MDN: beforeunload](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event):
  uslovno upozorenje, browser ogranicenja i razlog da nije garancija transfera.
- [MDN: Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API):
  hidden/visible polling u `sessionRecovery` i notification/workspace ekranima.
