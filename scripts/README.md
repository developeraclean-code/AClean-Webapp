# Scripts

Script dev/ops manual. Jalankan dari root repo: `node scripts/<nama>.mjs`.
Semua baca kredensial dari `.env.local` (path relatif `../.env.local`) — **jangan pindah ke subfolder** tanpa update path.

## Smoke tests (verifikasi terhadap DB asli, cleanup otomatis)
| Script | Cakupan |
|---|---|
| `smoke-kasbon.mjs` | Kasbon request → approve → expense (50 multi-request, payroll grouping, idempotency) |
| `smoke-expense-vision.mjs` | Input biaya teknisi (bensin/parkir) — verdict AI, dedup hash, linkage, cleanup 30hr |
| `smoke-portal.mjs` | Portal customer reguler |
| `smoke-foto-readonly.mjs` | Galeri foto read-only portal |
| `smoke-customer-photos.mjs` | Foto customer |
| `smoke-internal.mjs` | Endpoint internal authed |

## E2E (integrasi alur penuh)
| Script | Cakupan |
|---|---|
| `e2e-maintenance.mjs` | Modul Maintenance B2B (client → unit → log → invoice → portal) |
| `e2e-order-autolog.mjs` | Order → auto-log ke maintenance unit |

## Seed (data awal / demo)
| Script | Data |
|---|---|
| `seed-transmarco.mjs` | PT Transmarco (22 unit maintenance) |
| `seed-jaya-kreasi.mjs`, `seed-jaya-kreasi-jalpanjang.mjs` | Jaya Kreasi |
| `seed-uiccp.mjs` | UICCP |
| `seed-maintenance-smoke.mjs` | Data smoke maintenance |

## WA AI (snapshot / backfill / klasifikasi)
| Script | Fungsi |
|---|---|
| `wa-snapshot-local.mjs` | Snapshot grup WA lokal |
| `wa-backfill-local.mjs`, `backfill-wa-grup-ai.mjs` | Backfill klasifikasi AI grup |
| `wa-observations-backfill.mjs` | Backfill shadow parser observations |
| `test-ai-vision.mjs`, `test-personal-classify.mjs` | Uji AI vision / klasifikasi personal |

## Util
| Script | Fungsi |
|---|---|
| `api-bridge.mjs` | Bridge API lokal (dev) |
