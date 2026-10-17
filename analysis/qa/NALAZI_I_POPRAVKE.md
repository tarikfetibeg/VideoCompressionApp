# QA nalazi i popravke

> Historijski nalazi od 03.10.2026. Aktuelni ciklus i odobrene/odgodjene
> odluke: [QA oktobar](../../docs/QA_FUNKCIONALNI_CIKLUS_2026_10.md).
> Istek sesije, audit validation, raw/OFF sigurnost, UI create i native zoom
> imaju nove dokaze; ranije nepotpune ili failed rezultate ne brisati.

03.10.2026, `codex/Web-Optimizacija`. Prethodne korisnicke nekomitane izmjene
ostaju baseline. Finalni dokazi su indeksirani u `ZAVRSNI_REZULTATI.json`.

| Nalaz | Prioritet / dokaz | Uzrok i promjena | Regresija |
| --- | --- | --- | --- |
| Reporter koristi tudji privatni raw u novom jobu | P1, prvi API run `16-49-39-990Z-4cb26e`, F02-owner | Create route nije ogranicavao segment izbor kao append. Provjera own/odobrene TV arhive prije kreiranja. | 403 za privatni klip, kreiranje own/station dopune i final tok prolaze. |
| Dva editora preuzmu isti job | P1, isti prvi run F05-claim-race | Read-then-save nije atomican. Uslovni update statusa/vlasnika, 409 gubitniku. Producer claim odbijen. | Paralelni stvarni API pozivi daju 200/409. |
| Konkurentni correction claim ne cuva vlasnika | P1 | Atomic update requesta sa ocekivanim statusom i vlasnikom; correction job prati rezultat. | F15-claim-race, jedan odgovorni editor. Ostale cross-route race kombinacije nisu iscrpljene. |
| Istovremena Archive prijava zavrsi internim 500 | P2 | Optimistic-concurrency VersionError se ne prevodi korisniku. Route vraca jasan 409; ponovljeni ensure deduplicira request/job. | F15-report-race, retry i jedan otvoreni request/job. Nije uvodjenje potpune multi-process transakcije. |
| Nedostupne stranice i nepotreban polling | P1/P2 | Limit nije pracen dostupnom pagination kontrolom. Dodata paginacija i stale-response guard; Material polling samo u aktivnom tabu. | Reporter >100 jobova, Material page2, server dopuna, Correction component paging. |
| Materijal dialog je skriven iza quick drawera | P1 mobile | Dva otvorena overlay sloja. Sidebar se zatvara prije dopune, mobilna nav/Real preview imaju modal z-index. | Otvaranje preko Komentari, touch i Escape. |
| Arhivska tabela izlazi iz sirine | P2 | Desktop kolone traze 102%; sada 100%. Archive/Correction/material picker na uskom viewportu zadrzavaju tabele uz stacked redove. | 203 role viewporta, Admin matrica i mobilni dijalozi. Lokalni scroll drugih kompleksnih tabela ostaje. |
| Popunjena mobilna Ispravke tabela prosiri stranicu | P2, zavrsna live-poll provjera | Skriveni apsolutni `thead` nije imao pozicioniranu tabelu kao containing block. Table dobija `position: relative`, a skriveno zaglavlje ogranicene koordinate i dimenzije; semantika ostaje u DOM-u. Snackbar poruka dodatno ima width/wrap zastitu. | Prethodnih 423 px na viewportu 390 vise nema; Editor live correction, Archive mobilni red i Producer WebKit prolaze u runu `19-41-26-105Z-eb63d0`. Nije rijeseno prikrivanjem overflowa cijele stranice. |
| Rundown zavisi od drag akcije | P2 | Touch/tastatura nemaju pouzdan alternativni put. Dodata imenovana gore/dolje dugmad preko istog API-ja. | Producer i Realizator reorder, DB potvrda i keyboard akcija. |
| Stari thumbnail odgovor pregazi novi video | P2 | Reciklirani prop i object URL lifecycle. Mounted/request guard i cleanup, uz StrictMode reset. | Frontend thumbnail testovi i lazy browser provjera. |
| HLS rename povremeno pada na Windows handleu | P2 | Kratkotrajni EPERM/EBUSY pri atomskoj aktivaciji. Ograniceni async retry; trajne i druge greske se ne skrivaju. | Dva node:test slucaja i stvarni HLS rebuild. |
| Retencija prihvati djelimicno ostecen HLS | P1 integrity | Jedan postojeci segment nije dovoljan. Provjera svih referenciranih segmenata, dozvoljenog root-a i ne-praznih izlaza. | Uklonjen referencirani segment, scan odbija cleanup, stari asset ostaje. |
| Video delete ukloni fajl drugog zapisa | P1 integrity | Samo putanje trenutnog zapisa, bez cross-field reference provjere. Shared deletion service za Admin/owner/Archive; realpath i media root granice. | Sva tri delete toka, shared thumbnail/master, external sentinel i Windows junction. DB video zapis se brise kao ranije; linked rundown/job delete politika nije promijenjena. |
| Audit workspace gubi stare logove i netacan total | P1 | Scan prvih 5000 redova pa UI pagination. Serverska page/count agregacija; proizvoljni legacy JSON search cursorom bez truncationa. | 12k logova, last page i match najstarijeg zapisa; 100k no-q benchmark. Tekstualni search ostaje O(n). |
| Tezak pocetni bundle / skrivena Reporter priprema | P2 performance | Svi page moduli i zatvoreni Event Workspace eager ucitani. Route chunks i priprema nakon prvog otvaranja; nacrt se ne unmounta pri collapse. | Production build, Reporter unit/browser draft, cold/warm i Lighthouse. |
| Kontrast i semanticka pristupacnost | P2 | Sekundarni tekst 4.44:1 na sivoj pozadini, skip naslova, direktni linkovi u ul, Select bez labelId. Tamniji tekst, heading/component i list item struktura, povezane oznake. | Finalni Lighthouse i role browser suite; nije potpuna WCAG revizija. |
| Mrtvi legacy source/assets | P3 | Nema import puta/reference za sest legacy fajlova. Uklonjeni nakon import/rg/build provjere. | Sve role route smoke i build. Implicitni setupTests ostaje. |

## Nerijeseno ili potrebna odvojena odluka

- P1 UX rizik duge smjene: `auth.js` izdaje jednosatni JWT, a `UserContext`
  i Axios nemaju refresh/relogin tok. Posljednjih deset poziva u 60-minutnom
  soaku ima 403; 7010/7020 ostalih je uspjesno i playeri nastavljaju preko
  media ticketa. Beforeunload/download zastita nije zamjena za obnovu sesije.
  Potrebna je konsultacija o sigurnom refresh modelu ili eksplicitnom reloginu;
  nije samostalno produzavan token ili uveden novi auth ugovor.
- Dependency audit: Mongoose critical i ostali runtime/build nalaz. Korisnik
  je izricito odgodio nadogradnje; vidi `dependencies/summary.json`.
- NVENC speed acceptance nije prosao na 12s sintetickim klipovima. Ne
  mijenjati default prije duzeg reprezentativnog benchmarka.
- Mobilni TBT <=300 ms nije stabilno prosao; lokalan brz ekran nije zamjena
  za kontrolisani sporiji uredjaj i field mjerenje.
- P3 lokalizacija: pojedine legacy Producer/Realizator oznake ostaju na
  engleskom (npr. My shows, Last download, Not confirmed aired). Vizuelni
  pregled ih je evidentirao, ali ovaj ciklus ne tvrdi da je sav UI BHS.
- Legacy Audit JSON pretraga prolazi cijeli filtrirani skup; posebno
  evaluirati sigurnu search projekciju/index bez gubitka postojece semantike.
- Job summary globalni total/status/SLA/correction brojevi koriste puni
  filtrirani skup. Samo unreadUpdates/missingFiles signali uzorkuju do 500
  najnovijih jobova, uz `sampledForSignals`. Neki Admin maintenance inventari
  takodjer imaju scan granice; nisu pretvoreni u neogranicene metrike.
- Audit nevalidni actor/date parametri, svi exporti, cross-route correction
  race/route/final rollback i linked Video delete invarianti zahtijevaju
  dodatne fokusirane provjere. Nema izmisljene tvrdnje da su popravljeni.
- Shared file provjera ne zamjenjuje file lock/transakciju sa konkurentnim
  promjenama DB putanja; aliasi, svi TOCTOU slucajevi i shared preview folderi
  nisu formalno dokazani sigurnim.

## Test-harness i okruzenje, ne aplikacijski bugovi

- Jedan F18 retry test koristio je reusable raw fixture koji pipeline uredno
  brise nakon obrade; naredni test je dobijao ENOENT. Retry sada ima svoju kopiju.
- Browser test je trazio exact `Event`, a required label je `Event *`.
  Selektor je ispravljen, nacrt potvrden stvarnim textboxom.
- Quality switching test dosao je do kraja 12s klipa; sada resetuje timestamp
  i nastavlja play prije svakog kvaliteta. Nije mijenjana HLS funkcionalnost.
- Notification regresija sada provjerava stvarni tip `edit_job_comment`,
  a ne nepostojeci `job_comment`; author-excluded asercija vise nije
  lazno negativna. Test resetuje viewport prije desktop download navigacije
  i ceka kraj Fade animacije prije snimanja material dijaloga.
- Raniji Lighthouse Editor "desktop" zadrzao je 4x mobilnu simulaciju.
  Finalni runner bira eksplicitni ugradjeni desktop profil. Rezultati tih
  razlicitih profila ne predstavljaju isti before/after eksperiment.
- Firefox Windows binary ima side-by-side launch gresku. WebKit smoke
  prolazi, ali to ne rjesava niti prikriva Firefox ogranicenje.
- MongoDB explain hostname enkodiranje je tretirano ograniceno i odvojeno
  od podatkovnih gresaka; produkcijska UTF-8 validacija ostaje.

Stariji neuspjesni runovi su sacuvani radi sljedivosti. Njihov failure se
ne brise zato sto noviji run prolazi i ne predstavlja automatski aktuelni bug.
