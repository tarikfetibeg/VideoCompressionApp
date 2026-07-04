# Indexiranje i performanse velikih video lista

Datum: 2026-06-15

Ovaj dokument opisuje prvu fazu optimizacije za bazu koja raste na hiljade video klipova, edit jobova, feedback prijava i audit logova. Cilj je ubrzati postojece workspace ekrane bez promjene stacka, bez uklanjanja workflowa i bez lomljenja API response shape-a.

## Sta je implementirano

- Dodani su Mongoose indexi u glavne modele: `Video`, `EditJob`, `Feedback` i `AuditLog`.
- Dodano je tehnicko polje `searchText` na `Video`, `EditJob` i `Feedback`.
- `searchText` se popunjava na `save()` i sakriven je iz API odgovora preko `select: false`.
- Workspace search koristi MongoDB `$text` nad `searchText` umjesto sirokog `$or` regexa preko vise polja.
- Backend ignorise search upite krace od 2 znaka, a frontend ih ne salje prema API-ju.
- Dodane su operativne komande:
  - `npm run searchtext:backfill`
  - `npm run indexes:create`
  - `npm run indexes:explain`

## SearchText strategija

`searchText` je normalizovani tekstualni sloj za pretragu. Normalizacija radi:

- `NFKC` Unicode normalizaciju
- lower-case za `bs-BA`
- uklanjanje navodnika koji imaju posebno znacenje u text search queryju
- spajanje viska whitespacea
- zadrzavanje BHS dijakritike

Polja koja ulaze u `searchText`:

- `Video`: finalni naslov, originalni filename, filename, event, location, kategorija, keywords, processing/QC/correction/archive biljeske i timecode opisi.
- `EditJob`: title, description, script, program, segment title/notes/type, komentari i change log sazetci.
- `Feedback`: title, description, type, priority, status, area, admin komentar, admin odgovor, page URL i admin komentari.

## Indexi po kolekciji

### Video

- `video_search_text_idx`: text index za `searchText`.
- `video_upload_date_idx`: opsti recent sort.
- `video_processing_upload_idx`: processing liste i retry/monitoring.
- `video_status_processing_upload_idx`: Production/Archive osnovni filter.
- `video_uploader_upload_idx`: Reporter scope i owner pregledi.
- `video_broadcast_workspace_idx`: Producer/Ready material i broadcast status.
- `video_archive_review_idx`: Archivist review queue.
- `video_content_type_library_idx`: biblioteka po content type-u.
- `video_source_job_idx`: final videos po edit jobu.
- `video_program_air_date_idx`: program/airDate final materijal.
- `video_tag_date_idx`: datum snimanja/tagovanja.

### EditJob

- `edit_job_search_text_idx`: text index za job search.
- `edit_job_status_updated_idx`: job board status + recent sort.
- `edit_job_editor_status_updated_idx`: assigned editor workflow.
- `edit_job_reporter_status_updated_idx`: reporter scope.
- `edit_job_priority_updated_idx`: prioritetni pregled.
- `edit_job_deadline_updated_idx`: deadline sort/filter.

### Feedback

- `feedback_search_text_idx`: text index za feedback search.
- `feedback_status_priority_updated_idx`: admin triage queue.
- `feedback_submitter_updated_idx`: "moje prijave".
- `feedback_assignee_status_updated_idx`: assigned admin workflow.
- `feedback_area_type_updated_idx`: filtriranje po modulu i tipu.

### AuditLog

- `audit_log_timestamp_idx`: najnoviji audit logovi.
- `audit_log_user_timestamp_idx`: filter po korisniku.
- `audit_log_action_timestamp_idx`: filter po tacnoj akciji.

Audit `details` ostaje fleksibilan `Mixed` objekat. Zato slobodna details pretraga i dalje radi bounded scan preko workspace endpointa, ali se ignorise ako je kraca od 2 znaka.

## Query pravila

- Equality filteri idu prvi u compound indexima, zatim sort polja, u skladu sa MongoDB ESR smjernicom.
- Workspace endpointi ostaju paginirani i ne smiju vracati kompletne kolekcije.
- Search input se debounceuje na frontendu i salje tek kada ima najmanje 2 karaktera.
- Stari endpointi ostaju kompatibilni, ali novi workspace endpointi su preferirani za velike liste.
- `createIndexes()` se koristi za kontrolisano kreiranje indexa i ne brise postojece indexe automatski.

## Ocekivani efekti

- Manje `COLLSCAN` queryja na glavnim workspace ekranima.
- Brzi prvi page za velike liste.
- Stabilnije server-side search/filter kombinacije.
- Manje nepotrebnih API poziva dok korisnik kuca search.
- Manji rizik da admin/production ekran postane neupotrebljiv kada baza predje nekoliko hiljada klipova.

## Ogranicenja

- MongoDB text search nije isto sto i full MAM/content AI indexing.
- Search ne indeksira stvarni govor, OCR, lica, objekte ili scene iz videa.
- Audit `details` jos nema poseban `detailsText`; to je moguca druga faza ako audit logovi narastu dovoljno.
- Duplicate archive workflow i dalje radi grupisanje kandidata u memoriji jer algoritam zavisi od normalizovanog naslova, trajanja i velicine.

## Roadmap nakon mjerenja

- Ako MongoDB text search ne bude dovoljan: razmotriti MongoDB Atlas Search, OpenSearch ili Meilisearch.
- Ako se trazi pretraga stvarnog sadrzaja videa: dodati transcript/OCR/object indexing kao odvojeni projekat.
- Ako audit logovi postanu veliki: dodati `detailsText` i poseban index ili export/reporting storage.
- Ako liste narastu iznad desetina hiljada stavki po ekranu: razmotriti TanStack Virtual i detaljnije server-side facet agregacije.

## Reference

- MongoDB Indexes: https://www.mongodb.com/docs/manual/indexes/
- MongoDB Equality, Sort, Range guideline: https://www.mongodb.com/docs/manual/tutorial/equality-sort-range-guideline/
- MongoDB Text Indexes: https://www.mongodb.com/docs/manual/core/indexes/index-types/index-text/
- MongoDB Partial Indexes: https://www.mongodb.com/docs/manual/core/index-partial/
- MongoDB explain executionStats: https://www.mongodb.com/docs/manual/reference/method/cursor.explain/
- Mongoose schema indexes: https://mongoosejs.com/docs/guide.html#indexes
- AWS Media2Cloud ingestion workflow: https://docs.aws.amazon.com/solutions/latest/media2cloud-on-aws/ingestion-workflow.html
- Azure AI Video Indexer overview: https://learn.microsoft.com/en-us/azure/azure-video-indexer/video-indexer-overview
- Google Cloud Video Intelligence: https://cloud.google.com/video-intelligence/docs
- OpenSearch introduction: https://docs.opensearch.org/latest/getting-started/intro/
- Meilisearch quick start: https://www.meilisearch.com/docs/getting_started/first_project
