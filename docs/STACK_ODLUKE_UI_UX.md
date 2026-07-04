# Stack odluke za UI/UX redizajn

Zadnja izmjena: 2026-06-15

## Trenutna odluka

Prva faza redizajna ostaje na postojećem React + MUI stacku.

Razlog:

- postojeći feature-i su već stabilno vezani za React komponente, MUI kontrole, axios i React Router
- `npm run build --prefix frontend` je prije redizajna prolazio bez greške
- najveći trenutni dobitak za UX i performanse dolazi iz boljeg layouta, centralizovanih status komponenti i paginiranih API prikaza, ne iz zamjene frameworka

## Dodane arhitekturne odluke

- Uveden je `AppShell` kao zajednički operativni okvir za role-aware navigaciju, globalni upload/status bar i kompaktan radni layout.
- Uvedene su zajedničke UI komponente: `WorkspaceHeader`, `KpiStrip`, `FilterBar`, `ActionToolbar`, `EmptyState`, `ConfirmDialog` i `StatusChip`.
- Uvedene su centralne BHS label mape za role, processing, QC, broadcast, job i priority statuse.
- Dodani su paginirani workspace endpoint-i:
  - `GET /api/videos/workspace`
  - `GET /api/edit-jobs/workspace`
  - `GET /api/broadcast/library-search`
- U fazi 2 dodani su dodatni workspace endpoint-i bez promjene stacka:
  - `GET /api/archive/videos/workspace`
  - `GET /api/archive/duplicates/workspace`
  - `GET /api/feedback/workspace`
  - `GET /api/admin/audit-logs/workspace`
- Admin Video Management i Reporter Archive koriste lazy thumbnail ucitavanje preko `IntersectionObserver`; media-ticket streaming nije uveden jer bi to bila odvojena sigurnosna i backend promjena.

## Stack promjene koje nisu urađene u ovoj fazi

Ove promjene ostaju moguće, ali zahtijevaju posebnu konsultaciju prije implementacije:

- Vite umjesto CRA
- TanStack Query za server state/cache
- TanStack Virtual za jako velike liste/tabele
- React Hook Form za kompleksne forme
- media-ticket streaming model za `<video>`/thumbnail URL-ove

## Performance pravilo

Performanse se tretiraju kao UX funkcionalnost. Prvo se optimizuju:

- server-side paginacija i search
- manje duplog pollinga
- centralizovan prikaz statusa obrade
- lazy/odgođeno učitavanje medija gdje je moguće bez promjene sigurnosnog modela

Ako se pokaže da postojeći React/MUI sloj nije dovoljan za velike produkcijske količine, sljedeći prijedlog treba sadržavati mjerljiv razlog, očekivani dobitak i rizik migracije.
