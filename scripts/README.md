# Scripts

Script dev/ops manual. Jalankan dari root repo: `node scripts/<nama>.mjs`.
Script operasional dapat membaca kredensial dari `.env.local` — periksa script sebelum menjalankan. Evaluasi/preview ARA di bawah menggunakan data sintetis; mode live hanya membaca API key provider.

## ARA (lokal, tanpa pesan ke customer)

- `npm run test:ara`: regresi policy, API internal dan antrean customer.
- `npm run test:ara-200`: 200 workflow simulasi, tanpa Supabase/Fonnte nyata.
- `npm run preview:ara`: preview terisolasi pada `http://127.0.0.1:4175`.
- `node scripts/evaluate-ara.mjs --live --provider=claude` atau `--provider=openai`: panggilan API berbiaya dengan data sintetis; bukan pengiriman WA dan bukan bukti akurasi customer nyata.
- SOP, signature dan urutan migrasi/deploy: [ARA_READINESS](../docs/ARA_READINESS.md).

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
