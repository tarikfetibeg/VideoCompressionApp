# Hybrid Media Edge i trajni transferi

## Granica podataka

Control plane u cloudu čuva metadata, workflow i notifikacije. Raw, master, final i veliki ZIP paketi ostaju u TV kući. Privatni S3 storage dobija samo HLS, thumbnail i scrub proxy sadržaj. Udaljeni korisnik bez LAN/VPN veze može raditi s jobovima i proxy pregledom, ali ne dobija original.

## Model lokacije

`MediaNode` opisuje edge/cloud čvor. `MediaAsset` čuva `video + kind + nodeId + relativePath + size + sha256`. Migracija ne briše postojeće apsolutne putanje; `mediaLocatorService` koristi novi zapis, zatim legacy fallback. Putanja se uvijek provjerava da ostaje unutar `MEDIA_STORAGE_ROOT`.

## Transfer protokoli

- Upload: tus 1.0 resumable endpoint na Media Edge-u.
- Download: HTTP Range, `ETag`/`If-Range` kada asset servis ima checksum.
- Desktop: Rust stream u `.part`, progress event, pauza i nastavak.
- Queue metadata: Tauri SQLite `v2-transfers.db` preživljava restart.
- Integrity: SHA-256 prije označavanja verificiranog asseta.
- Idempotency: `(user, idempotencyKey)` sprečava dupli transfer session.

Edge registracija i heartbeat koriste `EDGE_REGISTRATION_SECRET`; pojedinačni transfer koristi kratkotrajni JWT sa smjerom, node ID-em i asset ID-em. Edge ne zahtijeva inbound konekciju prema cloud bazi za control taskove, ali pilot implementacija još podržava direktan MongoDB pristup za kompatibilne worker modele. Produkcijski hardening treba ukloniti taj direktni DB pristup nakon potpunog task/result API razdvajanja.

## Operativni fallback

Ako Edge nije dostupan, metadata i HLS workflow ostaju funkcionalni. Original download jasno javlja da LAN/VPN ili Edge nisu dostupni. Ne radi se automatski cloud upload mastera. Postojeći MP4 Range endpoint ostaje kompatibilan tokom migracije.

## Reference

- [tus resumable upload protocol](https://tus.io/protocols/resumable-upload)
- [MDN HTTP Range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)
- [AWS S3 multipart upload overview](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)
- [NVIDIA FFmpeg GPU acceleration](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html)

