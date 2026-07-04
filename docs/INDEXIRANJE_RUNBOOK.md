# Runbook: uvodjenje indexa i SearchText optimizacije

Datum: 2026-06-15

Ovaj runbook opisuje kako sigurno uvesti indexe i `searchText` optimizaciju u lokalnu, QA ili produkcijsku bazu.

## Prije pocetka

1. Napraviti backup MongoDB baze.
2. Potvrditi da aplikacija koristi ispravan `MONGODB_URI` u `.env`.
3. Potvrditi da je `MONGOOSE_AUTO_INDEX=false` osim ako se namjerno radi lokalni dev eksperiment.
4. Deployati kod koji sadrzi nova `searchText` polja, index definicije i skripte.
5. Ne oslanjati se na automatsko kreiranje indexa pri startu aplikacije; koristiti komande ispod.

## Komande

### 1. Backfill SearchText

```bash
npm run searchtext:backfill
```

Opcioni veci/manji batch:

```bash
npm run searchtext:backfill -- --batch=1000
```

Skripta prolazi kroz `Video`, `EditJob` i `Feedback`, racuna `searchText` i upisuje ga preko `bulkWrite`.

### 2. Kreiranje indexa

```bash
npm run indexes:create
```

Skripta koristi Mongoose `createIndexes()` za registrovane modele. Ne koristi `syncIndexes()`, jer `syncIndexes()` moze obrisati indexe koji nisu definisani u shemi.

### 3. Explain provjera

```bash
npm run indexes:explain
```

Opcioni search termin:

```bash
EXPLAIN_SEARCH="dnevnik sarajevo" npm run indexes:explain
```

Na Windows PowerShell-u:

```powershell
$env:EXPLAIN_SEARCH="dnevnik sarajevo"; npm run indexes:explain
```

Rezultat treba zabiljeziti u QA biljeske. Primarni workspace queryji ne bi trebali imati `COLLSCAN` kao jedini winning stage.

## Preporuceni redoslijed deploymenta

1. Backup baze.
2. Deploy backend/frontend koda.
3. Pokrenuti:

```bash
npm run searchtext:backfill
```

4. Pokrenuti:

```bash
npm run indexes:create
```

5. Pokrenuti:

```bash
npm run indexes:explain
```

6. Otvoriti aplikaciju i rucno provjeriti:
   - Production Desk / Materijal
   - Edit Jobs board
   - Producer / TV archive
   - Archivist / Materijal i Duplikati
   - Admin / Video Management
   - Admin / Feedback Inbox
   - Admin / Audit Logs

## QA prihvatljivost

- Workspace liste moraju ostati paginirane.
- Search se ne salje prema API-ju za 0 ili 1 karakter.
- `searchText` se ne smije pojavljivati u API odgovorima.
- Novi video, novi edit job i nova feedback prijava moraju automatski dobiti `searchText`.
- Admin update feedbacka mora obnoviti `searchText`.
- `npm run indexes:explain` treba pokazati index usage za glavne recent/status queryje.
- Na testnoj bazi sa 10k+ videa prvi page ne smije ucitavati sve video dokumente niti media blobove.

## Rollback

Ako index uspori write workload ili izazove problem:

1. Vratiti aplikacijski kod na prethodnu verziju ako je potrebno.
2. `searchText` polja mogu ostati u dokumentima; stari kod ih ignorise.
3. Ako treba ukloniti specifican index, uraditi to rucno u Mongo shellu po imenu indexa iz `docs/INDEXIRANJE_I_PERFORMANSE.md`.
4. Ne pokretati `syncIndexes()` kao rollback bez zasebne provjere, jer moze obrisati indexe koji su rucno dodani za druge potrebe.

Primjer rucnog uklanjanja indexa:

```javascript
db.videos.dropIndex("video_search_text_idx")
```

## Napomene za produkciju

- Index build moze trositi IO/CPU; pokretati van najintenzivnijeg ingest perioda.
- Backfill je batchovan, ali ipak radi write operacije nad velikim kolekcijama.
- Ako baza ima vrlo veliki broj dokumenata, prvo pokrenuti na kopiji baze ili QA okruzenju.
- Explain rezultat treba uporediti prije/poslije vecih promjena filtera, sortova ili novih workspace endpointa.
- Web proces i video worker koriste `MONGOOSE_AUTO_INDEX=false` kao default, pa se produkcijski index build pokrece samo kroz `npm run indexes:create`.
