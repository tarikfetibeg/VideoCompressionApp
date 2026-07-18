# Aplikacija v2 migracija i rollout runbook

## 1. Preduvjeti

- Potvrđen backup MongoDB-a i media storagea.
- Node.js 20, Rust stable MSVC, Visual Studio Build Tools i WebView2.
- Odvojene tajne za JWT, Edge registraciju i transfer.
- TLS DNS za control API; firewall dozvoljava desktop HTTPS/WSS i LAN Edge port.
- Potpisni certifikat i Tauri updater ključ dostupni samo CI secret storeu.

## 2. Baseline

```powershell
npm test --prefix frontend -- --watchAll=false
npm run build --prefix frontend
npm run check --workspace @vca/premiere-uxp
npm run desktop:check
```

Sačuvati vrijeme cold starta, idle memoriju i rezultate po rolama. Browser UI se još ne gasi.

Za lokalni QA bez Redisa koristiti `PROCESSING_QUEUE=local`. Realtime tada automatski
koristi lokalni Socket.IO gateway i ne pokušava spajanje na `REDIS_URL`. Postavka
`REALTIME_REDIS_ENABLED=true` koristi se tek kada je Redis stvarno dostupan.

Desktop development konfiguracija namjerno ima prazan updater endpoint i javni ključ.
Prije potpisanog pilot builda vrijednosti iz `tauri.updater.conf.json.example` moraju se
zamijeniti stvarnim HTTPS endpointom i Tauri updater javnim ključem.

Za lokalni desktop QA dovoljna je jedna komanda:

```powershell
npm run desktop:dev
```

Komanda provjerava port `5000`, pokreće lokalni backend samo kada već nije aktivan,
čeka da API bude spreman i zatim pokreće Vite/Tauri. Pri zatvaranju development sesije
gasi samo backend i workere koje je sama pokrenula. Za test samo Tauri klijenta uz već
ručno pokrenut backend može se koristiti `npm run desktop:dev:client`.

Desktop development WebView koristi origin `http://localhost:5173`. Orchestrator ga
dozvoljava samo za loopback hostove dok je `DESKTOP_DEV_MODE=true`; kod ručnog pokretanja
backenda isti origin treba biti naveden u `ALLOWED_ORIGINS`. CORS greška u backend logu
znači da klijent nije došao sa eksplicitno dozvoljenog origina.

### Desktop API i download ticket URL

- Backend namjerno vraca relativni ticket, npr. `/api/downloads/tickets/<token>`.
- U lokalnom `npm run desktop:dev` modu klijent ga pretvara u apsolutni
  `http://localhost:5173/api/...` URL, pa download prolazi kroz isti Vite proxy kao API.
- Za instalirani MSI/NSIS build `VITE_API_BASE_URL` mora biti apsolutan i postavljen u
  trenutku frontend builda, npr. `https://vca.example.ba/api`. Instalirani klijent
  zahtijeva HTTPS prema trenutno definisanom Tauri CSP-u.
- Na udaljenom racunaru se ne smije koristiti `http://localhost:5000/api`, jer
  `localhost` tada oznacava taj udaljeni racunar, a ne TV server.
- Native downloader prihvata samo HTTP(S). Poruka o nekonfigurisanom Desktop API URL-u
  znaci da je production build napravljen sa relativnim `/api` bez stvarne server adrese.

## 3. Dry-run i migracija

```powershell
npm run v2:migrate:dry-run
npm run v2:migrate
npm run indexes:create
```

Skripta je idempotentna: kreira primarni MediaNode, `MediaAsset` zapise za putanje unutar storage roota, notification default polja, escalation politike i v2 indexe. Ne briše legacy putanje i ne pomjera fajlove. Vrijednosti `outsideStorage` moraju se ručno pregledati.

## 4. Control plane

Kopirati `.env.v2.example` u secret manager, izgraditi frontend, zatim:

```powershell
docker compose -f docker-compose.v2.yml build
docker compose -f docker-compose.v2.yml up -d redis control-api event-worker reverse-proxy
```

U produkciji reverse proxy mora dobiti HTTPS certifikat; priloženi nginx port 80 je lokalni/pilot primjer. `EVENT_OUTBOX_MODE=worker` sprečava dupli in-process worker.

## 5. Media Edge

Na LAN računaru postaviti `MEDIA_STORAGE_ROOT`, `EDGE_BASE_URL`, registration/transfer tajne i `CONTROL_API_URL`. Pokrenuti `npm run edge:start`. Admin mora vidjeti heartbeat, disk i capabilityje. Zatim testirati tus prekid/nastavak i Range download.

## 6. Desktop pilot

1. Buildati i potpisati MSI/NSIS i updater JSON za kanal `pilot`.
2. Instalirati po jedan uređaj za svaku rolu.
3. Testirati tray, autostart, single instance, deep link, remote revoke i Windows notification permission.
4. Prekinuti mrežu, sleep/wake i download; potvrditi `.part`/SQLite nastavak.
5. Testirati Storyboard konflikt i Premiere fallback workspace.

## 7. Cutover

Tek nakon potpisane feature-parity matrice deployati `DESKTOP_ONLY_MODE=true`. API ostaje aktivan, web root vraća 410. Stable kanal se objavljuje nakon pilot soak perioda. Podržavati trenutni i prethodni desktop release.

## Rollback

- Vratiti `DESKTOP_ONLY_MODE=false` i prethodni API image.
- Desktop updater kanal usmjeriti na prethodni potpisani release.
- Ne brisati v2 kolekcije; stari API ih ignoriše.
- `MediaAsset` je aditivan i legacy putanje ostaju izvor fallbacka.
- Za outbox problem zaustaviti event worker; događaji ostaju neobjavljeni u MongoDB-u i mogu se nastaviti kasnije.

## Acceptance checklist

- Cold start <= 3 s, idle <= 250 MB, notification p95 <= 2 s.
- 50 klijenata, 100k videa, 500 aktivnih jobova, 20 HLS pregleda, 10 transfera.
- Role permission, ack/escalation, offline catch-up, checksum, disk full, Edge/cloud outage.
- Windows 1366x768 i 1920x1080, scaling 125/150%, tastatura, tray, updater i signed installer.
- Nakon QA ugasiti sve dev servere i workere.
