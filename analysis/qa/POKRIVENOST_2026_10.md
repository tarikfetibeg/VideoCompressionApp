# Aktuelna funkcionalna pokrivenost

Identitet: source/build hash u svakom runu. Rezultati od 03.10. su baseline.
Ovo je mapa scenarija, ne tvrdnja o svim kontrolama ili sigurnosna potvrda.

| Oblast | Novi dokaz | Granica / preostalo |
| --- | --- | --- |
| F01 prijava/role | 10 stvarnih racuna, 42 role kombinacije, guest route matrica, typed expiry, same-account re-login, promjena drugog taba | DB outage je middleware/login unit provjera, ne pravi Mongo restart; stari JWT policy odgodjen |
| F02 Reporter | stvarni Novi prilog create, jedan POST na double click, server/archive append, direct job upload, dva draft refresh testa | svi event filteri i upload retry UI nisu iscrpljeni |
| F03 brief/OFF | stvarni TXT/DOCX/MD/RTF, invalid/unsupported PDF i corrupt DOCX; OFF u paketu i shared delete | PDF import nije postojeca funkcija; sve audio korupcije/UI varijante nisu testirane |
| F04 ingest | queue completion, failed/missing source retry, orphan recovery i kasniji soak workload | GB batch, browser upload abort i Redis restart ostaju nepokriveni |
| F05 montaza | claim race, final ownership, Material paging/category/lazy preview, Editor/VideoEditor route | sve role-specific dugmadi nisu pojedinacno pokrivene |
| F06 lifecycle/SLA | explicit invalid selection, category/editor/deadline/priority, close/cancel/reactivate/delete, expiry bez media delete | svaki grace/legacy migracijski slucaj nije zatvoren |
| F07 notifikacije | recipijenti, 35-row paging, read-all/job, stvarni editor komentar -> reporter bell, read failure i duplicate read | sve hidden/visible Snackbar timing grane nisu iscrpljene |
| F08 details/markeri | create/delete/invalid time, Realizator read-only, reporter approve/reject | sve QC/meta/segment UI akcije nisu pojedinacno izvrsene |
| F09 streaming | stvarni decoded frame, 120s HLS, seek/quality, native Range, expiry/invalid ticket, refresh scheduling, 10Mbps/80ms | fizicki Safari, dugotrajni offline i stvarni 2h ticket lifetime nisu simulacijom dokazani |
| F10 slike | lazy thumbnail/scrub, missing/stale/object URL component test, server append details link | kompletan touch i sve asset corruption grane nisu zatvorene |
| F11 archive search | prefix/dijakritika/legacy kategorija, totals/page/sort, 10k/50k i search+legacy eligibility explain | sve filter kombinacije i runtime backfill varijante nisu dokazani |
| F12 rundown | add/duplicate/reorder, keyboard/touch alternative, correction replace | sva program join/remove/replace UI stanja nisu zatvorena |
| F13 realizacija | timestamp -> correction final -> replace -> resolve, air ZIP i confirm aired | fizicki remote transfer i sve changed-since-download grane ostaju |
| F14 arhiva | tag/meta/category/review, safe duplicate deletion, preview i mobilni red | sva duplicate paging i metadata UI stanja ostaju |
| F15 ispravke | assigned/unassigned, claim/report race, actor history, expired-job visibility, dismiss reason/409, live mobile queue | multi-process rollback i sve konkurentne rute nisu transakcijski dokazani |
| F16 download | pet kindova, Unicode ZIP/hash/status, native handoff+SPA, beforeunload, actual abort/full retry, live 60s heartbeat i kontrolisana ticket TTL migracija; korisnik prijavio LAN save na Firefox uredjajima | nema ZIP resume garancije; druga mreza blocked; device snapshot nije posljednji ticket/z-index build |
| F17 feedback | oba Admina/open queue, private fields, submit/seen/note/reply/close | svaki priority/assignee/filter UI korak nije zatvoren |
| F18 Admin video/user | role/password/owner/category/requeue i shared-file safety | linked video delete ostaje otvoren rizik na korisnikov zahtjev; immediate auth revocation odgodjen |
| F19 Admin program/jobs | kategorija/SLA i program create/disable, lifecycle i validacija | batch i historijski link edge slucajevi nisu iscrpljeni |
| F20 audit | global total/last page/legacy search, actor/date validation, CSV/JSON Unicode export i filtered delete | proizvoljni JSON text search je i dalje O(n), svi historijski oblici nisu poznati |
| F21 storage/profili | snapshot/refresh/pragovi/profil validation/version, cached p95, stvarni output | multi-volume/fault/Atlas/symlink scanner puna matrica ostaje |
| F22 maintenance | raw active/master/shared/outside, OFF shared/junction, manifest traversal, orphan recovery, atomic failure preservation | sve missing/outdated/selected kombinacije i TOCTOU nisu iscrpljene |
| F23 encoder/queue | stvarni NVENC probe+HLS, inject failure -> CPU, format matrica i odvojeni backlog | Redis blokiran; sinteticki speed/VMAF benchmark nije dokaz svih broadcast klipova |
| F24 UI | 7 x 29 viewporta, 8 Admin modula x3, 28 native zoom stanja, 14 WebKit layout i Edge playback; korisnik prijavio Firefox na Xiaomi14 i LAN desktopu | automatizovani Firefox launch blokiran; odabrani snimci nisu pregled svakog od 684 UI elementa; native zoom PNG capture ogranicenje u VIZUELNI_PREGLED_2026_10.md |

## Gates

- P1 linked Video delete i security/runtime rizici ostaju otvoreni, iako je
  korisnik prihvatio odgodu. Nema tvrdnje release kandidata bez P1 nalaza.
- Android/LAN potvrde su zasebni user-reported dokazi u QA_STVARNI_UREDAJI.md;
  nisu instrumentovani dokaz svih scenarija svih uloga na finalnom buildu.
- Druga mreza, iPhone/Safari i izolovani Redis su blocked dok nema dokaza.
- Soak, Lighthouse i NVENC rezultate uzeti iz zavrsnog indeksa tek po
  zavrsetku, bez unaprijed upisanog passed statusa.
- 684 UI i 136 route definicija imaju inventar. Guest rejection ne dokazuje
  uspjesan autorizovani tok svake rute. Za punu pokrivenost potrebna je
  preostala kontrola -> handler -> scenario -> rezultat mapa.
