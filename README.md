# VideoCompressionApp

Professional ingest and video processing app for TV newsroom workflows.

## Core Workflow

1. Reporter/Admin uploads raw material with event, location, and date tags.
2. Backend stores the raw file and creates a `queued` video record.
3. Video worker transcodes the master file, creates browser preview and thumbnail, then marks processing as `completed` or `failed`.
4. Editor/VideoEditor/Producer/Admin performs QC.
5. Producer/Admin approves material for air, marks it aired, or archives it.

## Required Services

- Node.js
- MongoDB
- Redis, required by Bull video processing queue
- FFmpeg available on the server PATH

## Environment

Copy `.env.example` to `.env` and set real values:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/video_compression_app
JWT_SECRET=replace_with_a_long_random_secret
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5000
REDIS_URL=redis://127.0.0.1:6379
```

Public registration is disabled by default. Keep `ALLOW_PUBLIC_REGISTRATION=false` in production.

## First Admin

Set these in `.env`:

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD=change_this_password
```

Then run:

```bash
npm run admin:create
```

If the admin already exists and you need to reset its password, set:

```bash
ADMIN_RESET_PASSWORD=true
```

and run the command again.

## Running

Start the complete local system, web/API plus video worker:

```bash
npm run start:all
```

Or start each process separately:

```bash
npm start
```

```bash
npm run worker:video
```

For production, run both as managed services. The web process accepts uploads and API requests; the worker performs FFmpeg jobs.

## Frontend

Build:

```bash
npm run build --prefix frontend
```

Test:

```bash
npm test --prefix frontend -- --watchAll=false
```

## Operational Notes

- `storage/raw` keeps uploaded source files until processing and raw retention policy allow deletion.
- `storage/compressed` stores processed master/output files.
- `storage/previews` stores browser-compatible preview MP4 files.
- `storage/thumbnails` stores JPEG thumbnails.
- `storage/final` stores final uploaded packages that should not be transcoded as raw ingest.

## Next Recommended Work

- Add automatic technical QC using FFprobe and loudness checks.
- Define station-specific broadcast output profiles, such as MXF/XDCAM/AVC-Intra/ProRes depending on playout requirements.
- Add live processing updates through WebSocket or Server-Sent Events.
- Add server-side pagination/search for large archives.
- Add backup/archive policy for long-term media retention.
