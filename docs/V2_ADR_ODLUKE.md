# Aplikacija v2 - Architecture Decision Records

## ADR-001: Tauri 2 umjesto Electrona

Prihvaćeno. Postojeći React/MUI ostaje renderer, dok Tauri daje manji runtime, native tray/deep link/updater i Rust transfer proces. WebView2 offline runtime ulazi u installer. Posljedica je obavezni Rust/MSVC build lanac.

## ADR-002: Hybrid control plane i lokalni Media Edge

Prihvaćeno. Cloud je autoritet za metadata/workflow; veliki originali ostaju lokalno. Samo proxy asseti idu u privatni object storage. Time se čuvaju LAN performanse i trošak, uz ograničen remote original access.

## ADR-003: Transactional outbox prije realtime emitovanja

Prihvaćeno. MongoDB Notification/EventOutbox je izvor istine; Redis/Socket.IO služi samo za nisku latenciju. Ovo je potrebno jer Redis Pub/Sub ima at-most-once semantiku.

## ADR-004: tus upload i HTTP Range download

Prihvaćeno. Standardni protokoli zamjenjuju ad-hoc velike blob transfere. Desktop SQLite i `.part` fajl omogućavaju recovery, a idempotency key sprečava duplikate.

## ADR-005: Browser UI se gasi tek na 2.0 cutoveru

Prihvaćeno. `DESKTOP_ONLY_MODE` je rollout prekidač. Backend i legacy API ostaju kompatibilni tokom pilot/rollback prozora; web root se ne gasi prije role parity odobrenja.

## ADR-006: Premiere UXP plus univerzalni workspace

Prihvaćeno. Premiere 25.6+ koristi UXP panel; starije verzije koriste `Media/OFF/Brief/Exports/manifest.json`. Ne upravljamo automatski export presetima u prvom releaseu.

