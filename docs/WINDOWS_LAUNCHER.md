# Windows launcher

## Brzo koristenje

U glavnom folderu aplikacije dvoklikom otvori **Pokreni aplikaciju.cmd**.
Ne trebaju administratorska prava, novi paketi niti .exe kompilacija.
Meni koristi Windows PowerShell i postojece projektne komande.

| Opcija | Efekat |
| --- | --- |
| 1 | Pokrece `node scripts/startAll.js`, isto kao `npm run start:all`. Koristi postojeci frontend build. |
| 2 | Izvrsava `npm run build --prefix frontend`. |
| 3 | Izvrsava build, pa pokrece aplikaciju samo ako je build uspio. |
| 4 | Lokalno provjerava Node/npm, prisustvo zavisnosti, frontend build, FFmpeg/FFprobe i konfiguracijske fajlove. |
| 5 | Nakon unosa `INSTALIRAJ` izvrsava `npm ci`, zatim `npm ci --prefix frontend`. |
| 6 | Izvrsava frontend testove bez watch moda: `npm test --prefix frontend -- --watchAll=false --runInBand`. |
| 7 | Pokrece `node --test` nad svim `tests/backend/*.test.js`. |
| 0 | Izlazi iz menija. |

Nakon izmjena frontenda odaberi **3**. Kada kod nije mijenjan i build vec
postoji, dovoljna je **1**. Za prvu instalaciju zavisnosti koristi **5**,
zatim pripremi konfiguraciju i odaberi **3**.

Build prepisuje `frontend/build`; nije zero-downtime deploy. Ako isti
folder trenutno servira aktivne korisnike, build planiraj u terminu
odrzavanja. Launcher ne zaustavlja drugu vec pokrenutu instancu.

## Preduslovi i konfiguracija

- `node` i `npm.cmd` trebaju biti dostupni u PATH-u. Projekat trenutno
  deklarise Node.js 20.x. Starija verzija od 20 zaustavlja akciju; novija
  daje upozorenje jer nije deklarisana u projektu. Launcher ne instalira
  ni ne nadogradjuje Node.js. Postojeci rizik zastarjelog runtimea ostaje
  evidentiran u QA dokumentaciji; njegova migracija je odvojena odluka.
- Root i frontend imaju svoje `package-lock.json` fajlove. Opcija 5 ih
  koristi bez nadogradnje zakljucanih verzija, ali ponovo instalira
  `node_modules` i izvrsava dependency install skripte. Potreban je internet.
  Ne izvrsava `npm update` ili `npm audit fix`.
- Vlastiti `.env` priprema se prema `.env.example`. Ne koristiti primjer
  lozinke ili JWT tajne u stvarnom radu. Launcher ne kreira/ne mijenja `.env`
  i ne prikazuje njegove vrijednosti. Postojeca dotenv-flow pravila i
  varijable procesa ostaju mjerodavni za konfiguraciju aplikacije.
- MongoDB i FFmpeg/FFprobe trebaju biti dostupni aplikaciji. Redis je
  potreban u `redis` queue modu. `startAll.js` vec provjerava Redis i zauzet
  web port. Launcher ne pokrece MongoDB/Redis servis i ne mijenja queue mod.
- Provjera u opciji 4 ne kontaktira bazu/Redis i ne izvodi NVENC test.
  Prisustvo fajla ili alata nije potvrda ispravnosti konfiguracije.

## Pokretanje i zaustavljanje

Server i njegovi workeri rade u istom konzolnom prozoru kroz postojeci
`startAll.js`. Log je vidljiv; ne pokrecu se skriveni background serveri.
Zaustavljanje se vrsi preko **Ctrl+C**. Ako se zajedno zatvori i meni,
ponovo otvori launcher za sljedecu komandu. Opcija 0 dostupna je dok je
meni slobodan; nije zaseban stop-service mehanizam.

Prije zaustavljanja pricekaj zavrsetak aktivnih FFmpeg obrada i transfera.
Postojece ogranicenje `local` queue moda ostaje: red je u memoriji i ne
predstavlja trajan produkcijski queue. Launcher ne uvodi Windows servis
ni automatski startup prilikom paljenja racunara.

Aplikacija je obicno na `http://localhost:5000`, ali `PORT` iz postojece
konfiguracije moze odrediti drugi port. Konacni port prikazuje server.
Zauzeti port se **ne oslobadja automatski**: launcher ne gasi tudje Node
procese i ne mijenja firewall, port forwarding ni adrese pristupa.

## Direktne komande

Iz PowerShella u glavnom folderu mogu se birati akcije bez menija:

```powershell
& '.\Pokreni aplikaciju.cmd' -Action build
& '.\Pokreni aplikaciju.cmd' -Action start
& '.\Pokreni aplikaciju.cmd' -Action build-start
& '.\Pokreni aplikaciju.cmd' -Action check
& '.\Pokreni aplikaciju.cmd' -Action frontend-test
& '.\Pokreni aplikaciju.cmd' -Action backend-test
```

`-DryRun` ispisuje plan komandi bez njihovog izvrsavanja:

```powershell
& '.\Pokreni aplikaciju.cmd' -Action build-start -DryRun
```

Putanja projekta racuna se iz lokacije skripte, ne iz trenutnog terminal
foldera. Podrzani su razmaci i BHS znakovi u putanji. Kod greske direktna
akcija vraca ne-nulti exit code, a meni prikazuje gresku i ostaje dostupan.
Neuspjela komanda zaustavlja naredne korake iste akcije.

PowerShell `ExecutionPolicy Bypass` koristi se samo za proces launchera;
ne mijenja se trajna sistemska politika. Organizacijska pravila mogu
zabraniti izvrsavanje skripti i tada ih treba provjeriti s administratorom.

## Sigurnosne granice i regresijski testovi

Migracije, backfill, kreiranje indexa, cleanup materijala i stvaranje Admin
racuna nisu dio menija. Izvrsavaju se iskljucivo prema zasebnim runbookovima.
Nema automatskog pristupa stvarnoj bazi, brisanja storagea ili dugotrajnih
`qa:all`/`qa:release`/soak ciklusa.

Testovi launchera se izvrsavaju zasebno na Windowsu:

```powershell
node --test tests/launcher/windowsLauncher.test.js
```

Koriste privremeni projekat i lazni npm/start proces; ne pokrecu stvarni
server, instalaciju ni DB operacije. Provjeravaju mapu komandi, .cmd ulaz,
rad iz drugog foldera, razmake/dijakritiku, build failure gating, nedostajuci
build/lockfile, potvrdu instalacije i frontend test argumente. Nisu zamjena
za funkcionalni QA same aplikacije.

### Provjera 17.10.2026.

- Osam launcher regresijskih testova: prolazno.
- Stvarni frontend build kroz `.cmd -Action build`: prolazno.
- Backend unit testovi kroz launcher: 12/12 prolazno.
- Frontend testovi kroz launcher: 50/50, 15 suiteova prolazno.
- Lokalna provjera okruzenja: prikazuje prisutne alate/build i odsustvo
  `.env`/`MONGODB_URI` u ovom worktreeju, bez prikaza tajni.

Backend loopback/junction testovi i frontend Jest cache prvo su blokirani
ogranicenjima sandboxa; ponavljanje izvan sandboxa je proslo. U pocetnom
test harnessu ispravljeno je Windows argument quoting pri pozivu `.cmd`.
Build ima postojece Browserslist upozorenje, a frontend testovi postojece
React `act` warninge; zavisnosti nisu nadogradjivane. Nije pokrenuta stvarna
aplikacija, instalacija ili migracija. Testni podprocesi su zavrsili.
