# Zavrsni indeks lokalnog QA

Branch: codex/Web-Optimizacija. Status: **djelimicna pokrivenost sa otvorenim rizicima**.

| Suite | Run ID | Pass | Fail | Blocked |
| --- | --- | ---: | ---: | ---: |
| api | 2026-10-11T12-01-09-271Z-68229c | 47 | 0 | 0 |
| browser | 2026-10-11T12-03-18-048Z-c83300 | 39 | 0 | 0 |
| performance | 2026-10-11T12-08-10-837Z-bb9bed | 21 | 0 | 0 |
| soak-30 | 2026-10-11T09-45-15-057Z-b22220 | 1 | 0 | 0 |
| media | 2026-10-11T12-06-08-329Z-5bb9fe | 32 | 0 | 0 |
| soak-60 | 2026-10-03T18-11-39-509Z-32b616 | 0 | 1 | 0 |
| benchmark | 2026-10-10T20-29-55-363Z-dc7bbf | 6 | 1 | 0 |
| lighthouse | 2026-10-11T12-09-08-744Z-b81e33 | 6 | 0 | 0 |
| session | 2026-10-11T12-05-39-889Z-faa741 | 6 | 0 | 0 |
| edges | 2026-10-11T12-01-34-099Z-a0c530 | 8 | 0 | 0 |
| ui-acceptance | 2026-10-11T11-56-49-891Z-57f7fb | 6 | 0 | 0 |
| maintenance | 2026-10-11T12-05-55-554Z-fa23d8 | 8 | 0 | 0 |
| policy-characterization | 2026-10-11T12-01-43-569Z-ba2633 | 1 | 0 | 2 |
| network | 2026-10-11T12-06-31-371Z-e17113 | 4 | 0 | 0 |
| tickets | 2026-10-11T12-07-01-254Z-fd070f | 2 | 0 | 0 |
| soak-75 | 2026-10-11T10-15-44-780Z-253f4d | 1 | 0 | 0 |

Browser engine ogranicenja su u browser-engines.json; prolaz suitea ne pretvara Firefox u prolaz. Lighthouse capture prolaz nije prolaz svih performance pragova. Soak 60 i NVENC speed nalaz ostaju vidljivi.

Indeks sadrzi razlicite aplikacijske snapshotove. Provjeriti source/build hash; stariji soak ili benchmark nije automatski retest posljednjeg builda. Aktuelne korisnicke odluke, preskakanja i granice: [QA predaja](PREDAJA_QA_2026_10.md).

Historijski detalji: docs/QA_IZVRSENJE_WEB_OPTIMIZACIJA.md, NALAZI_I_POPRAVKE.md i POKRIVENO_I_NEPOKRIVENO.md.

Pattern secret scan: 0 kandidata, bez prikaza sadrzaja.
