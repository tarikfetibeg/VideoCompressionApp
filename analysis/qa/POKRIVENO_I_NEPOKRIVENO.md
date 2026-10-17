# Feature pokrivenost i preostale provjere

> Tabela ispod je historijski baseline. Retest iz oktobarskog nastavka
> i preostale blokade su u [novom ciklusu](../../docs/QA_FUNKCIONALNI_CIKLUS_2026_10.md).
> `qa:release` razlikuje partial/blocked od passed. 684 UI kontrole su
> inventarisane, ne pojedinacno certificirane.

Status "djelimicno" znaci da navedeni scenariji imaju dokaz, ali svi slucajevi
iz plana jos nisu izvedeni. Inventar nije 100% klik coverage. Finalni runovi
su u `ZAVRSNI_REZULTATI.json`; UI/endpoint inventar je u `inventory/`.

| ID | Provjereni scenariji | Preostale provjere / status |
| --- | --- | --- |
| F01 | 7 rola, 10 realnih sesija, bad login, 42 permission kombinacije, neprijavljen API, Producer route denial, JWT expiry zabiljezen u soaku | DB outage UX, refresh/relogin nije implementiran; puni Back tok; djelimicno |
| F02 | SLA/kategorija, own/station server append, tudji raw odbijen, job direct upload, pocetni aktivni jobovi i >100 paging, lazy nacrt | Cijeli Novi prilog create preko UI-a, dupli submit/retry i svi event filteri; djelimicno |
| F03 | Unicode TXT brief, empty/unsupported rejection, OFF audio u paketu i ticket download | DOCX/PDF brief import edge slucajevi, OFF upload/delete/corrupt UI; djelimicno |
| F04 | Stvarni upload, queue completion, retry failed/missing source, ingest dok HLS backlog radi | GB batch, offline/abort/reconnect, startup raw recovery i restart; djelimicno |
| F05 | Claim race, pravo montazera, final upload, Material category/API/page2/lazy preview, Editor/VideoEditor route | Sve VideoEditor razlike i direct-final UI; djelimicno |
| F06 | Deadline/expiresAt, Admin close/reactivate, linked job hard-delete block, expire bez media delete | Eksplicitni rok/grace, legacy migracija i batch SLA iscrpno; djelimicno |
| F07 | Reporter/Editor/Producer/Admin recipients, author excluded, no-editor comment, read-job/read-all, context unit test | Stvarno cekanje 30s uz hidden/visible, correction fallback bez Producer-a i svi Snackbar/link slucajevi; djelimicno |
| F08 | Markeri create/delete/invalidtime, Realizator read-only, Reporter approve/reject, details role API | Sve metadata/QC fail/pass/segment akcije i marker deeplink UI; djelimicno |
| F09 | HLS manifest/segment, Auto/720p/480p, seek, nonblank frame, 206/416, invalid/expired token, traversal | Ticket refresh na istom timestampu, buffering/offline, 10Mbps/80ms TTFF, Safari; djelimicno |
| F10 | Lazy requests, manifest/frame, fallback/stale/cleanup component test, server dopuna preview/link | Sve touch/scrub interakcije i svaki asset failure u browseru; djelimicno |
| F11 | BHS prefix/alias category, role totals, page2/last page, ascending date, 10k/50k selective explain | Sve kombinacije filtera i runtime backfill/fallback varijante; djelimicno |
| F12 | Add/duplicate/reorder, Producer permission denial, mobile/keyboard up/down, correction replace | Program join/remove/replace sve UI varijante i scope; djelimicno |
| F13 | Realizator timestamp report, novi correction final -> Producer replace, air package/confirm aired | Changed-since-download signal svi edge slucajevi, sidebar detalji mobilno uz keyboard; djelimicno |
| F14 | Archive tag/category/review, duplicate-safe-delete, preview/layout i Archive sort | Duplicate group pagination i svi metadata/dismiss UI tokovi; djelimicno |
| F15 | Archive ensure/notification, poznat/nepoznat editor, route/claim race, resolve actors, stvarni correction final/replace; expired job ne sakriva request; dismiss reason/409; nova prijava stize na vec otvoren Editor tab kroz 30s refresh, mobilni red i akcije | Legacy startup/backfill, sve concurrent entrypoint kombinacije, hidden/visible i multi-process DB rollback; djelimicno |
| F16 | Svih 5 kindova, ZIP/Unicode/hash, private/expired/failed status, browser bytes/handoff/navigation/beforeunload | Veliki transfer/abort/resume, browser-save sve platforme, druga mreza; djelimicno |
| F17 | Oba Admina vide otvorene, close, private scope, submit/seen/internalnote/reply | Svi priority/assignee/page UI filteri; djelimicno |
| F18 | User role/password, owner/category/requeue, Admin/owner/Archive shared file, external path i junction safety | Bulk destructive edge slucajevi, konkurentna promjena fajl referenci; djelimicno |
| F19 | Program create/disable, category SLA update, Admin job lifecycle/delete | Svi filteri, batch SLA, linked program promjene; djelimicno |
| F20 | Actor audit, filtered delete, global totals/last page/old text match, 100k no-q performance | Export i svi invalid actor/date/search parametri; djelimicno |
| F21 | Storage refresh/thresholds, profile bounds/version/NVENC gate, real media output | Multi-volume/Atlas greska/full scanner izolacija/single-flight svi slucajevi i UI confirm; djelimicno |
| F22 | Dry-run, invalid HLS retention, shared source/atomic failed rebuild preservation, Windows junction | Raw retention/recovery/orphans/manifests/OFF cleanup i svi rebuild batch modovi; djelimicno |
| F23 | RTX3060 probe/encode, CPU fallback injection, format matrica, 20 HLS backlog sa ingestom | Redis/restart/recovery: blokirano; 30% NVENC speed cilj: nije prosao |
| F24 | 7 role dashboards, 8 Admin modula, nav/drawer layers/Escape, a11y label/contrast, lazy/loading | Login/NotFound svi states, focus recovery/screenreader, stvarni zoom i mobilni keyboard; djelimicno |

## Ogranicenja van lokalnog harnessa

- Nema fizickog Android/iPhone/Safari QA, mobilnog file pickera ili pravog
  OS/browser download resume dok je aplikacija zatvorena.
- Nema druge mreze/firewall/port forwarding/tunnela; CORS API smoke nije
  zamjena za remote end-to-end download.
- Redis nije instaliran/dostupan, pa Bull worker restart, Redis outage i
  trajnost queuea nisu testirani. Local mode je izricito zabiljezen.
- Playwright Firefox je blokiran Windows side-by-side problemom; nije
  dokaz da sama aplikacija ne radi u korisnikovom Firefoxu.
- Width sweep i DPR ne dokazuju svaki desktop monitor niti browser zoom.
  Automatska geometrija ne provjerava svako moguce semanticko preklapanje.
- Izabrani screenshots su vizuelno pregledani; nije rucno pregledana svaka
  kombinacija, stanje, dugacka tabela ili svih 644 kontrola.
- Nema mjerenog field INP-a ni stvarne studije reportera/manje tehnicki
  iskusnih korisnika. Kratki lab uzorci nisu njihova zamjena.
- Soak memory zapis pokazuje ponasanje ovog workload-a, ne dokaz odsustva
  svih memory leakova, listener/object URL ili HLS lifecycle gresaka.

## Sljedeci prakticni QA ciklus

1. Rijesiti prioritizovane runtime sigurnosne nadogradnje uz zasebno odobrenje.
2. Redis staging i worker restart/failure, backup/raw recovery/retention.
3. Realni Android/iOS/Firefox i drugi racunar na udaljenoj mrezi.
4. Veliki batch, interrupted download/upload i ticket refresh/offline.
5. Detaljna UI-ID -> scenario mapa i sve preostale F01-F24 grane.
6. Dugi broadcast NVENC benchmark bez konkurentnog soaka, uz iste profile.
7. Kontrolisani mobile profiling za stabilni TBT cilj, pa stvarni korisnicki
   UX i field metrike. Nema preuranjenog prelaska na novi stack.
