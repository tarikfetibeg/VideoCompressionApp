# NVENC HLS i uslovna retencija MP4 previewa

## 1. Cilj i odluka

HLS ne zamjenjuje svaki MP4 preview. Aplikacija cuva najmanje jedan
browser-kompatibilan MP4 put kao fallback za:

- mastere u MOV/MXF containeru;
- HEVC/H.265 i druge video codece koje browser ne mora podrzati;
- 10-bitne ili druge pixel formate izvan 8-bitnog `yuv420p`;
- PCM i druge nepodrzane audio codece;
- legacy `/preview` i MP4 HTTP Range workflow;
- situaciju kada HLS nije napravljen ili je privremeno nedostupan.

Za novi H.264/AAC MP4 master zaseban MP4 preview je redundantan. Kada je
`mp4PreviewPolicy=when_required`, FFprobe potvrdi kompatibilnost i aplikacija
koristi master direktno za MP4 Range fallback, thumbnail i scrub preview.

Nijedan master/final fajl se ne brise kroz preview retention alat.

## 2. Pocetno stanje storagea

Mjerenje prije ove faze:

| Folder | Velicina |
| --- | ---: |
| `storage/previews` | 1,59 GB |
| `storage/hls-previews` | 2,62 GB |
| `storage/scrub-previews` | oko 28 MB |

Broj od 1,59 GB nije automatski reclaimable. Dio previewa je jedini
browser-kompatibilan fallback za MOV, MXF, HEVC, 10-bit ili nepodrzan audio.
Admin dry-run racuna samo kandidate koji u trenutku skeniranja ispunjavaju sve
sigurnosne uslove.

## 3. Browser compatibility provjera

`mediaCompatibilityService` koristi FFprobe. Alternativni fajl je prihvatljiv
samo ako:

1. fajl postoji i ima ekstenziju `.mp4`;
2. container koji prijavi FFprobe sadrzi MP4;
3. video codec je H.264;
4. pixel format je 8-bitni `yuv420p` ili `yuvj420p`;
5. audio je AAC, MP3 ili ga nema.

Provjera namjerno nije zasnovana samo na ekstenziji. MP4 moze sadrzati HEVC,
10-bitni video ili PCM audio, sto nije pouzdan fallback na svim klijentima.

Rezultat se biljezi u `Video.playbackCompatibility`: putanja, container,
video/audio codec, pixel format, razlog i vrijeme provjere.

## 4. MP4 preview dry-run i cleanup

Admin koristi:

```text
Storage Maintenance > MP4 preview cleanup
```

API:

```text
POST /api/admin/preview-retention/scan
POST /api/admin/preview-retention/cleanup
```

Default batch je 50, maksimum 500. Dry-run ne mijenja bazu ni disk. Preview je
siguran kandidat samo ako:

- nalazi se unutar `storage/previews`;
- HLS ima validan aktivni `master.m3u8`;
- postoji drugi browser-kompatibilan MP4 fallback;
- ista preview putanja nije vezana za drugi Video zapis;
- fajl jos postoji.

Cleanup prima ID-eve iz dry-runa, ali svaku stavku ponovo provjerava. Time se
zatvara vremenski prozor izmedju pregleda i potvrde. Nakon brisanja postavlja
`previewPath=null`, `sizePreview=0`, osvjezava compatibility metadata i pise
Audit Log. Master, thumbnail, scrub i HLS se ne brisu.

Cleanup nikada nije automatski scheduler.

## 5. Odvojeni HLS queue

Primarni video queue zavrsava ingest/final processing. Tek nakon toga dodaje
sekundarni HLS task u `hlsQueue`.

```text
upload -> videoQueue -> compressed/final + thumbnail + scrub
                  |
                  +-> hlsQueue -> 720p + 480p HLS
```

U Redis modu rade dva workera:

```powershell
npm run worker:video
npm run worker:hls
```

`npm run start:all` pokrece oba. U lokalnom QA modu postoje dva odvojena
in-memory queue objekta u web procesu. Prekinuti lokalni HLS taskovi se pri
restartu ponovo stavljaju u red. Produkcija treba koristiti Redis jer lokalni
queue nije durable.

Konfiguracija:

```dotenv
HLS_QUEUE_CONCURRENCY=1
```

Za jednu RTX 3060 default ostaje jedan istovremeni HLS task. Jedan task vec
koristi dvije NVENC sesije, po jednu za 720p i 480p.

## 6. Single-pass FFmpeg HLS

Jedan FFmpeg proces cita i dekodira izvor jednom. `split` pravi dvije grane,
a svaka koristi aspect-ratio-safe `scale` i `pad`:

```text
decode -> split -> 1280x720 -> HLS 720p
                ->  854x480 -> HLS 480p
```

Vertikalni i 4:3 materijal zadrzava proporcije; padding je dio fiksnog
16:9 izlaza. Obje rendicije koriste isti GOP i forced keyframe svakih cetiri
sekunde, sto omogucava stabilno prebacivanje kvaliteta.

Rendicije:

| Profil | Video | Audio |
| --- | ---: | ---: |
| 720p | 2,2 Mbit/s | AAC 128 kbit/s |
| 480p | 0,9 Mbit/s | AAC 96 kbit/s |

FFmpeg se pokrece preko `spawn(ffmpeg, args)` bez shell stringa. Ovo uklanja
shell quoting rizik i dozvoljava precizno citanje `-progress pipe:1`.

## 7. NVENC profil i CPU fallback

NVENC HLS koristi:

```text
h264_nvenc
preset p5
tune hq
profile high
rate control vbr
multipass qres
lookahead 20
spatial AQ + temporal AQ
4-second aligned GOP/keyframes
```

Admin prvo pokrece stvarni kratki encode:

```text
Admin > FFmpeg Settings > Pokreni NVENC probe
```

Samo uspjesan probe dozvoljava snimanje `hlsEncoder=h264_nvenc`. Pocetni
deploy ostaje na `libx264`.

Ako NVENC padne zbog GPU/driver/session/CUDA problema i
`hlsCpuFallback=true`, isti task se jednom ponavlja sa `libx264 veryfast`.
Greska izvornog fajla ili demux/decode greska se ne maskira CPU retryem.

`Video.hlsPreview` biljezi trazeni i stvarni encoder, preset, fallback razlog,
trajanje obrade, velicinu, verziju i zadnju rebuild gresku.

## 8. Versioned i atomican HLS rebuild

Novi build nastaje u:

```text
storage/hls-previews/<videoId>/.building-<id>/
```

Nakon encodea servis provjerava:

- master playlist;
- obje variant playliste;
- `#EXT-X-ENDLIST`;
- najmanje jedan segment po rendiciji.

Tek nakon validacije folder se preimenuje u `v-<id>` i Video zapis pokazuje na
novu verziju. Stari validni HLS ostaje aktivan ako rebuild padne. Neaktivne
verzije se uklanjaju tek nakon uspjesne aktivacije. Prethodna aktivna verzija
ima default grace period od 30 sekundi, duzi od media-ticket cache TTL-a, kako
player tokom prebacivanja ne bi dobio prolazni 404.

```dotenv
HLS_PREVIOUS_VERSION_GRACE_SECONDS=30
```

## 9. Capability i telemetry

API:

```text
GET  /api/admin/ffmpeg-capabilities
POST /api/admin/ffmpeg-capabilities/probe
```

Runtime pregled cita:

- FFmpeg verziju;
- prisutnost `h264_nvenc`, `hevc_nvenc` i `av1_nvenc`;
- CUDA hwaccel;
- `scale_cuda`, `scale_npp` i `hwupload_cuda`;
- NVIDIA GPU, driver i VRAM;
- rezultat stvarnog test encodea.

Provjereno 27.06.2026. na ovom serveru:

- FFmpeg 7.1 Gyan essentials;
- NVIDIA GeForce RTX 3060, 12 GB;
- driver 610.62;
- `h264_nvenc` i probe p5: PASS;
- CUDA, `scale_cuda` i `hwupload_cuda`: dostupni;
- `scale_npp`: nije ukljucen u ovom FFmpeg buildu.

Admin HLS summary prikazuje NVENC/CPU buildove, CPU fallbackove, rebuild
greske, zauzeti prostor i prosjecno vrijeme.

## 10. Media ticket cache

HLS player za jednu sesiju trazi playlistu i vise segmenata. Bez cachea bi
svaki segment ponavljao MongoDB read za ticket, korisnika i video, plus write
za statistiku upotrebe.

Procesni cache:

```dotenv
MEDIA_TICKET_CACHE_TTL_SECONDS=15
MEDIA_TICKET_CACHE_MAX=5000
MEDIA_TICKET_USAGE_WRITE_INTERVAL_SECONDS=60
```

Ticket expiry se provjerava pri svakom zahtjevu. Cache samo smanjuje broj
ponovljenih DB operacija; ne mijenja kriptografski token niti TTL u bazi.
Promjena/ukidanje role moze se odraziti sa najvise 15 sekundi kasnjenja.
`useCount/lastUsedAt` se upisuje najvise jednom u 60 sekundi po aktivnom
ticketu.

Ovaj cache je lokalni per-process cache. Vise web instanci ne dijeli cache,
sto je prihvatljivo jer MongoDB ostaje izvor istine.

## 11. Benchmark

Komanda:

```powershell
npm run hls:benchmark -- --input="D:\QA\reprezentativni-klip.mp4"
```

Opcija `--keep` zadrzava privremene izlaze. Skripta:

- gradi isti 720p/480p profil sa CPU `libx264 veryfast`;
- gradi isti profil sa `h264_nvenc p5` ako su GPU i encoder dostupni;
- poredi ukupno vrijeme i velicinu;
- racuna 720p VMAF ako FFmpeg sadrzi `libvmaf`.

Trenutni Gyan essentials build nema `libvmaf`; skripta to eksplicitno
prijavljuje. Za VMAF acceptance treba FFmpeg build sa tim filterom.

Kratki sinteticki test od osam sekundi nije performance benchmark: GPU
inicijalizacija dominira i NVENC moze biti sporiji. Odluka se donosi nad
najmanje pet stvarnih klipova razlicitog trajanja, formata i frame ratea.

Acceptance cilj:

- najmanje 30% krace medijalno HLS vrijeme;
- VMAF najmanje 90;
- najvise tri VMAF boda ispod CPU reference pri istom bitrateu.

## 12. Rollout

1. Backup MongoDB baze i `storage/`.
2. Deploy koda sa `hlsEncoder=libx264`.
3. Pokrenuti Admin capability probe.
4. Benchmarkovati najmanje pet reprezentativnih klipova.
5. Ukljuciti `h264_nvenc`, preset `p5` i CPU fallback.
6. Graditi stare HLS previewe u malim batch paketima.
7. Pratiti HLS summary, GPU, CPU fallback i processing time.
8. Pokrenuti MP4 preview dry-run, prvo batch 10-50.
9. Pregledati razloge svih `Zadrzati` stavki.
10. Potvrditi mali cleanup batch i provjeriti Video Details/Range fallback.
11. Tek zatim povecati cleanup batch, maksimalno do 500.

Rollback:

- vratiti `hlsEncoder=libx264`;
- zaustaviti HLS worker bez zaustavljanja ingest workera;
- postojeci validni HLS i MP4 fallback ostaju dostupni;
- cleanup se ne moze automatski ponistiti, zato je backup i dry-run obavezan.

## 13. QA matrica

Testirati:

- H.264/AAC MP4: bez zasebnog previewa;
- H.264/PCM MP4: preview se mora napraviti;
- HEVC MP4: preview se mora napraviti;
- MOV i MXF: preview se mora napraviti;
- video bez audija: kompatibilan kada je H.264/yuv420p MP4;
- 10-bitni video: preview se mora napraviti;
- 4:3 i vertikalni video: bez deformacije;
- 25/30/50 fps: poravnati segmenti i seek;
- NVENC runtime kvar: jedan CPU fallback;
- source/decode kvar: bez pogresnog CPU retrya;
- 20 HLS taskova: ingest queue nastavlja obradu;
- nevalidan HLS, shared preview ili path izvan storagea: cleanup odbijen.

Obavezne tehnicke provjere:

```powershell
node --check backend/services/hlsPreviewService.js
node --check backend/services/mediaCompatibilityService.js
node --check backend/services/previewRetentionService.js
node --check backend/services/ffmpegCapabilityService.js
node --check backend/queues/hlsQueue.js
node --check backend/workers/hlsWorker.js
npm run build --prefix frontend
npm test --prefix frontend -- --watchAll=false
```

## 14. Poznate granice i naredne optimizacije

- GPU decode i `scale_cuda` su namjerno odgodjeni dok se ne izmjeri matrica
  stvarnih broadcast codeca. Software decode je pouzdaniji za mjesovite ulaze.
- `scale_npp` trenutno nije dostupan.
- Cold HLS retention moze kasnije uklanjati dugo nekoristene HLS verzije i
  regenerisati ih na prvi pregled, dok MP4 Range radi odmah.
- Reverse-proxy internal sendfile vrijedi tek kod vecih paralelnih opterecenja.
- fMP4 HLS treba razmatrati kao zasebnu kompatibilnost/migraciju, ne kao tihu
  promjenu postojeceg TS workflowa.
- Scrub preview zauzima oko 28 MB i nije storage prioritet.

## 15. Sluzbene reference

- [NVIDIA Using FFmpeg with NVIDIA GPU Hardware Acceleration](https://docs.nvidia.com/video-technologies/video-codec-sdk/13.0/ffmpeg-with-nvidia-gpu/index.html)
  - NVENC/NVDEC FFmpeg arhitektura i multi-output primjeri.
- [NVIDIA Video Encode and Decode Support Matrix](https://developer.nvidia.com/video-encode-decode-support-matrix)
  - codec, GPU generacija i session capability provjera.
- [FFmpeg NVENC encoder documentation](https://ffmpeg.org/ffmpeg-codecs.html#nvenc)
  - NVENC encoder opcije i FFmpeg integracija.
- [FFmpeg filter documentation](https://ffmpeg.org/ffmpeg-filters.html)
  - `split`, `scale`, `pad`, `libvmaf` i CUDA filteri.
- [FFmpeg HLS muxer](https://ffmpeg.org/ffmpeg-formats.html#hls-2)
  - HLS VOD playliste, segmenti i muxer opcije.
- [RFC 8216: HTTP Live Streaming](https://datatracker.ietf.org/doc/html/rfc8216)
  - format master/variant playlista i segmentiranog streama.
- [MDN HTTP Range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)
  - MP4 fallback sa `Range` i `206 Partial Content`.
- [Node.js child_process.spawn](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)
  - proces bez shell stringa i sigurno prosljedjivanje argumenata.
- [Node.js file system](https://nodejs.org/api/fs.html)
  - rename, unlink i sigurni storage lifecycle.

## 16. Rezultat implementacijske provjere 27.06.2026.

- `node --check`: 77/77 backend source JavaScript fajlova prolazi.
- Frontend production build: PASS.
- Frontend testovi: 5/5 suiteova i 12/12 testova prolazi.
- `git diff --check`: PASS; prikazana su samo Windows LF/CRLF upozorenja.
- Stvarni `h264_nvenc p5` capability probe na RTX 3060: PASS.
- Single-pass HLS test sa 720p/480p, videom sa audiom: PASS.
- Single-pass HLS test sa vertikalnim 25 fps videom bez audija: PASS.
- FFprobe assertion:
  - H.264/yuv420p/AAC MP4 je browser-kompatibilan;
  - HEVC MP4 je odbijen zbog codeca;
  - H.264 MOV je odbijen zbog containera.
- NVENC fallback assertion razlikuje GPU/session kvar od source/demux greske.
- Lokalni runtime:
  - MongoDB konekcija: PASS;
  - odvojeni lokalni video/HLS queue: PASS;
  - `/login`: HTTP 200;
  - Admin capability endpoint bez tokena: HTTP 401;
  - browser console greske na login ekranu: 0.

Sinteticki klipovi od 4-8 sekundi potvrdjuju funkcionalnost, ali ne i ciljano
ubrzanje. Na tako kratkom materijalu NVENC inicijalizacija je bila veca od
ustede. Performance acceptance ostaje benchmark pet stvarnih produkcijskih
klipova nakon Admin probea.
