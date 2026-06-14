# Archivist role - reference dokumentacija

Ovaj dokument sadrzi reference koje su koriscene kao inspiracija za `Archivist` rolu i `Archive Desk` workflow u aplikaciji.

## Kratki zakljucak

Profesionalne medijske arhive se ne oslanjaju samo na "folder sa klipovima". Najvazniji slojevi su:

- opisni metapodaci: naslov, event, tema, reporter, keywords/tagovi;
- tehnicki metapodaci: format, codec, trajanje, velicina, lokacija fajla;
- kontrolisani vokabulari: standardizovani nazivi za tip materijala i tagove;
- audit/preservation log: ko je sta promijenio, kada i zasto;
- review queue: materijal koji je unesen, ali jos nije arhivski pregledan;
- duplicate management: jasno biranje master klipa i sigurno uklanjanje duplikata.

Zato je u aplikaciju dodan poseban `Archive Desk`, a ne samo dodatno admin dugme.

## Reference

### PBCore

Link: https://pbcore.org/

PBCore je standard za katalogizaciju i opis audiovizuelnog sadrzaja. Relevantan je jer televizijska arhiva mora odvojeno cuvati opis materijala i tehnicke podatke o fajlu.

Primjena u aplikaciji:

- `keywords` / tagovi su tretirani kao opisni metapodaci;
- `contentType` / `finalCategory` su osnova za kontrolisanu klasifikaciju materijala;
- tehnicki podaci videa ostaju u `Video` modelu zajedno sa arhivskim review statusom;
- `Archive Desk` omogucava arhivisti da popravlja metapodatke bez punog admin pristupa.

### PBCore Controlled Vocabularies

Link: https://pbcore.org/pbcore-controlled-vocabularies

PBCore preporucuje kontrolisane vokabulare za dosljedno imenovanje i pretragu AV materijala.

Primjena u aplikaciji:

- content type kategorije poput `Prilog`, `Insert`, `Promo`, `Marketing`, `Grafika`, `Spica`, `Ostalo` rade kao prvi nivo kontrolisanog vokabulara;
- `Archivist` moze mijenjati kategoriju videa;
- buduce poboljsanje treba biti poseban vocabulary manager za standardne tagove, sinonime i zabranjene duple termine.

### PREMIS

Link: https://www.loc.gov/standards/premis/

PREMIS je standard za preservation metadata, odnosno za dugorocno pracenje digitalnih objekata i akcija nad njima.

Primjena u aplikaciji:

- svaka arhivska promjena ulazi u audit log;
- tag update, content-type update, review status i duplicate delete imaju zasebne audit akcije;
- review status pamti ko je pregledao materijal i kada;
- brisanje duplikata pamti koji klip je obrisan, koji je ostao kao master i koje putanje su stvarno obrisane ili preskocene.

Relevantne audit akcije:

- `Archive Update Video Tags`
- `Archive Update Video Content Type`
- `Archive Review Video`
- `Archive Delete Duplicate Video`

### Library of Congress Recommended Formats Statement

Link: https://www.loc.gov/preservation/resources/rfs/

Library of Congress RFS opisuje vaznost fizickih i tehnickih karakteristika formata za dugorocnu dostupnost digitalnog sadrzaja.

Primjena u aplikaciji:

- video model vec pamti format, codec, rezoluciju, bitrate, framerate, trajanje i velicine fajlova;
- arhivist sada ima uvid u tehnicko stanje materijala preko video detalja i Archive Desk liste;
- buduce poboljsanje je arhivski "format risk" indikator: npr. materijal bez previewa, bez trajanja, nepoznat codec, ogroman raw fajl ili nedostajuci compressed master.

### FADGI

Link: https://www.digitizationguidelines.gov/guidelines/digitize-technical.html

FADGI naglasava standardizovane smjernice, testiranje i monitoring kao osnovu pouzdanog digitalnog programa.

Primjena u aplikaciji:

- `Review Queue` je uveden kao dnevni QA/arhivski monitoring red;
- `needs_metadata` status odvaja materijal koji postoji, ali jos nije dovoljno dobro opisan;
- `needs_correction` signal iz realizatorskog/produkcijskog workflowa ostaje vidljiv arhivisti;
- arhivist ima pregled materijala koji je unesen, ali nije pregledan.

## Implementirane odluke u aplikaciji

- Nova rola: `Archivist`.
- Nova stranica: `/archivist-dashboard`.
- Novi API namespace: `/api/archive`.
- Novi review statusi:
  - `unreviewed`
  - `reviewed`
  - `needs_metadata`
  - `duplicate`
- Novi arhivski metadata fieldovi u `Video` modelu:
  - `archiveReviewStatus`
  - `archiveReviewedBy`
  - `archiveReviewedAt`
  - `archiveReviewNotes`
  - `archiveTagsUpdatedBy`
  - `archiveTagsUpdatedAt`
  - `duplicateOf`
- Novi pogledi u UI-u:
  - `Review Queue`
  - `All Videos`
  - `Duplicates`
- `Video Details` ima `Edit metadata` za arhivistu/admina, gdje se opisni metapodaci mijenjaju kroz kontrolisana polja iz sistema.
- Program, content type, reporter i editor se validiraju prema postojecim sistemskim zapisima prije snimanja.
- Tehnicki podaci fajla i `originalFilename` ostaju sistemski/read-only.
- Arhivist workflow namjerno ignorise kompresovane sirovine/raw ingest materijal; arhivski posao pocinje nad zavrsenim/smontiranim materijalom koji ima dugorocnu vrijednost.
- `Needs metadata` u Archive Desk Actions nije editor metapodataka, nego arhivska oznaka da materijal treba dodatno opisati ili ocistiti prije finalnog reviewa.

## Preporucena sljedeca poboljsanja

### Checksum / hash

Najvaznije sljedece poboljsanje je dodavanje checksum vrijednosti pri uploadu ili processingu videa.

Preporuka:

- racunati `SHA-256` za original i/ili final master fajl;
- cuvati hash u `Video` modelu;
- duplicate detection prvo raditi po hashu, a tek onda po naslovu/trajanju/velicini;
- pri brisanju duplikata prikazati da li je hash identican ili je samo kandidat.

### Kontrolisani tag vocabulary

Trenutni tagovi su slobodan unos. To je brzo za TV rad, ali dugorocno pravi nered.

Preporuka:

- dodati admin/arhivist panel za standardne tagove;
- dodati sinonime, npr. `vlada`, `vlada fbih`, `federalna vlada`;
- dodati zabranjene ili spojene tagove;
- nuditi autocomplete pri unosu tagova.

### Rights / usage metadata

TV arhiva treba razlikovati materijal koji se smije slobodno koristiti od materijala sa ogranicenjima.

Preporuka:

- dodati status prava koristenja;
- oznaciti agencijski, interni, promo, marketing i eksterni materijal;
- dodati napomenu o embargu ili ogranicenom emitovanju.

### Batch arhivske akcije

Arhivist ce cesto raditi desetine klipova iz istog eventa.

Preporuka:

- batch `mark reviewed`;
- batch `add tag`;
- batch `change content type`;
- batch `needs metadata`.

### Export za dokumentaciju i migraciju

Posto se aplikacija dokumentuje i kroz Word dokument, korisno je imati export arhivskih zapisa.

Preporuka:

- CSV export za osnovne metapodatke;
- PBCore-like export za buducu migraciju u pravi MAM/archive sistem;
- izvjestaj o neociscenim duplikatima i nepregledanom materijalu.
