# Admin storage pregled i podesivi media profili

## 1. Cilj

Admin panel sada razlikuje tri vrste zauzeca:

- lokalni media storage;
- aplikacijske i operativne fajlove;
- MongoDB Atlas storage, koji nije dio lokalnog diska.

Media profili su verzionisani. Promjena profila utice na nove obrade, dok se
postojeci preview mijenja samo kroz rucno potvrden background rebuild.

## 2. Storage kategorije

Media:

- finalni masteri;
- kompresovani materijal;
- raw materijal;
- MP4, HLS i scrub previewi;
- thumbnail slike;
- OFF audio.

Operativno:

- privremeni upload/processing fajlovi;
- raw manifesti;
- aplikacijski logovi;
- perzistirani Admin metrics snapshot.

Aplikacija:

- aplikacijski kod, konfiguracija i dokumentacija;
- frontend production build;
- root, frontend i backend dependencies;
- `.git` razvojni podaci.

Scanner ne prati symlinkove i ne preklapa kategorije. Greska jednog foldera
se biljezi uz tu kategoriju i ne obara kompletan pregled.

## 3. Fizički disk i cache

Node.js 20 `fs.promises.statfs` vraca ukupne, zauzete i slobodne blokove
fizickog volumena. Storage i application volume se dedupliciraju kada su na
istom disku.

Detaljni folder scan moze proci kroz veliki broj dependency i HLS fajlova,
zato se ne radi na svakom Admin requestu:

- rezultat se kešira 10 minuta;
- snapshot se cuva u
  `storage/admin-metrics/storage-overview.json`;
- samo jedan scan moze biti aktivan;
- rucni refresh vraca HTTP 202;
- UI prikazuje prethodni snapshot i polluje dok novi scan traje.

Ocitavanje slobodnog fizickog prostora radi odmah i nije vezano za stari
snapshot.

## 4. Storage alarmi

Default:

```text
warning: 20% slobodnog prostora
critical: 10% slobodnog prostora
```

Admin moze promijeniti oba praga. Critical mora biti manji od warning praga.
Alarm je informativan: aplikacija ne blokira upload i ne brise fajlove
automatski.

Promjena praga ulazi u Audit Log kao `Update Storage Alert Settings`.

## 5. MongoDB statistika

Backend koristi read-only `dbStats` i prikazuje:

- data size;
- storage size;
- index size;
- total size kada ga provider vrati;
- broj kolekcija i dokumenata.

Atlas je udaljeni storage i ne ulazi u lokalne `used/free` vrijednosti.
Ako Atlas korisnik nema `dbStats` pravo, lokalni storage pregled ostaje
funkcionalan, a database panel prikazuje da metrika nije dostupna.

## 6. Media profili

### Master

Postojeca polja ostaju kompatibilna: codec, rezolucija, bitrate i frame rate.
To su defaulti za raw ingest; korisnik i dalje moze promijeniti tehnicki profil
pri uploadu.

### MP4 preview

- encoder: `libx264` ili `h264_nvenc`;
- rezolucija: 1920x1080, 1280x720 ili 854x480;
- video bitrate: 500-8000 kbps;
- AAC: 64/96/128/160/192 kbps;
- frame rate: fixed 25/30/50 ili source capped na 50;
- CPU preset: veryfast/faster/medium;
- NVENC preset: p4/p5/p6;
- automatski CPU fallback za stvarni NVENC runtime kvar.

Izlaz je uvijek H.264/yuv420p/AAC MP4 sa `faststart`. HEVC nije dozvoljen za
preview jer browser fallback mora ostati kompatibilan.

### HLS

Rendicije 720p i 480p ostaju obavezne. Admin mijenja video/audio bitrate,
segment od 2/4/6 sekundi, CPU/NVENC encoder i fallback. Keyframe/GOP ostaje
poravnat sa segment duration vrijednoscu.

### Thumbnail i scrub

Thumbnail:

- 640x360, 480x270 ili 320x180;
- JPEG `q` od 2 do 8.

Scrub:

- 6-24 framea;
- 320x180, 240x135 ili 160x90;
- JPEG `q` od 2 do 8.

MP4, thumbnail, scrub i HLS koriste aspect-ratio-safe scale/pad. Vertikalni i
4:3 video se ne rastezu.

## 7. Verzije profila

Svaka grupa ima odvojenu verziju:

- `masterProfileVersion`;
- `mp4PreviewProfileVersion`;
- `hlsProfileVersion`;
- `thumbnailProfileVersion`;
- `scrubProfileVersion`.

Version se povecava samo kada se promijeni output-affecting polje te grupe.
Raw retention i storage prag ne oznacavaju previewe kao zastarjele.

Video pamti stvarno koristen profil, encoder, dimenzije, velicinu, trajanje
obrade i gresku. Postojeci asset bez profile versiona je `legacy/outdated`.

## 8. Rebuild

Admin moze rebuildati:

- `missing`;
- `outdated`;
- eksplicitno odabrane videe iz Video Managementa.

Batch je 1-50 klipova. MP4, thumbnail i scrub koriste zaseban preview
maintenance queue, concurrency 1. HLS ostaje u vlastitom HLS queueu. Ingest
queue nije blokiran.

MP4 i thumbnail prvo nastaju kao `.building-*` fajl. Stari fajl se zamjenjuje
tek nakon validacije, a kod DB greske se vraca backup. Scrub i HLS koriste
versioned foldere i aktiviraju novu verziju tek nakon validacije.

Promjena profila nikada sama ne pokrece rebuild.

## 9. API

```text
GET  /api/admin/storage/overview
POST /api/admin/storage/overview/refresh
GET  /api/admin/storage/settings
PUT  /api/admin/storage/settings
GET  /api/admin/media-previews/summary
POST /api/admin/media-previews/rebuild
GET  /api/admin/ffmpeg-settings
PUT  /api/admin/ffmpeg-settings
```

Primjer rebuild zahtjeva:

```json
{
  "scope": "outdated",
  "assetTypes": ["mp4", "hls", "thumbnail", "scrub"],
  "limit": 10
}
```

Selected rebuild dodatno salje `videoIds` i koristi `scope: "selected"`.

## 10. Pocetni baseline

Mjerenje prije implementacije:

| Grupa/folder | Velicina |
| --- | ---: |
| lokalni storage ukupno | oko 18,1 GB |
| aplikacija van storagea | oko 1,13 GB |
| final | 6,58 GB |
| compressed | 3,64 GB |
| HLS | 2,81 GB |
| MP4 preview | 1,71 GB |
| temp | 1,70 GB |
| raw | 1,54 GB |
| slobodan disk | oko 448,5 GB |

Baseline je QA orijentir, ne hard-coded vrijednost.

## 11. Rollout

1. Backup MongoDB baze i `storage/`.
2. Instalirati/pokrenuti Node.js 20; `package.json` i lock sada zahtijevaju
   `20.x`.
3. Deployati sa postojecim default profilima.
4. Otvoriti `Admin > Maintenance > Kapacitet` i sacekati prvi scan.
5. Pokrenuti NVENC capability probe prije izbora NVENC profila.
6. Sacuvati profile i provjeriti povecane verzije.
7. Rebuildati pet reprezentativnih klipova.
8. Provjeriti Video Details, HLS seek, thumbnail i scrub.
9. Tek zatim pokretati vece batch pakete.

## 12. Rollback

- vratiti prethodne postavke profila;
- zaustaviti preview/HLS worker bez zaustavljanja ingest workera;
- stari validni asset ostaje dostupan ako rebuild padne;
- profilne metadata vrijednosti su dodatne i ne lome legacy API;
- storage snapshot se moze obrisati; aplikacija ce ga ponovo generisati.

Nijedan master/final fajl se ne brise kroz rebuild.

## 13. Reference

- [Node.js 20 fs.statfs](https://nodejs.org/docs/latest-v20.x/api/fs.html#fspromisesstatfspath-options)
- [FFmpeg codec dokumentacija](https://ffmpeg.org/ffmpeg-codecs.html)
- [FFmpeg filter dokumentacija](https://ffmpeg.org/ffmpeg-filters.html)
- [FFmpeg HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-2)
- [NVIDIA FFmpeg GPU vodic](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html)

