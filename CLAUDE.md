# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server on port 3000 (auto-switches to 3001 if busy)
npm run build        # Production build → dist/
npm run preview      # Preview production build locally
```

There are no tests in this project (except `src/lib/__tests__/` unit tests via Vitest).

## Environment Setup

Copy `env.example` to `.env.local`. Required variables:
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — Supabase project credentials
- `SUPABASE_SERVICE_KEY` — Service role key (backend-only, not prefixed with VITE_)

Optional integrations: `FONNTE_TOKEN` (WhatsApp via Fonnte), `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`/`GROQ_API_KEY` (AI), `R2_*` variables (Cloudflare R2 image storage), `INTERNAL_API_SECRET` (backend token auth), `OWNER_PHONE` (required for cron WA alerts).

## Architecture

**Frontend:** React app with a monolithic root component in [src/App.jsx](src/App.jsx) (~13,000 lines). Navigation is handled by `activeMenu` state → `renderContent()` → lazy-loaded view components.

Views are split into dedicated files under `src/views/`. Heavy views are lazy-loaded via `React.lazy()`.

**Backend:** Vercel serverless functions in [api/](api/):
- [`api/[route].js`](api/[route].js) — Unified router (WhatsApp send/receive, image upload, AI proxy, token exchange)
- [`api/ara-chat.js`](api/ara-chat.js) — AI assistant proxy (Claude/OpenAI/Gemini/Groq with fallback)
- [`api/cron-reminder.js`](api/cron-reminder.js) — Scheduled tasks: overdue invoice reminders, daily WA report to owner, stock alerts, WA chat cleanup, laporan stale alert
- [`api/_auth.js`](api/_auth.js) — Shared middleware: CORS, rate limiting, internal token validation

**Database:** Supabase (PostgreSQL). Frontend connects via `@supabase/supabase-js` (anon key). Backend uses `SUPABASE_SERVICE_KEY`. No ORM — raw Supabase query builder throughout.

**Deployment:** Vercel. Cron jobs defined in [`vercel.json`](vercel.json) — 20+ scheduled jobs.

## Role Access Control (ENFORCE THIS — see also SOP_ADMIN_ROLE.md)

Role hierarchy: **Owner > Admin > Teknisi > Helper**. Enforced in `canAccess()` in App.jsx.

| Menu / Fitur | Owner | Admin | Teknisi | Helper |
|---|---|---|---|---|
| Dashboard | ✅ | ✅ | ✅ | ✅ |
| Planning Order | ✅ | ✅ | ❌ | ❌ |
| Order Masuk | ✅ | ✅ | ❌ | ❌ |
| Jadwal | ✅ | ✅ | ✅ | ✅ |
| Invoice | ✅ | ✅ | ❌ | ❌ |
| Customer | ✅ | ✅ | ❌ | ❌ |
| Inventori | ✅ | ✅ | ❌ | ❌ |
| **Price List** | ✅ Edit | ❌ Blocked | ❌ | ❌ |
| Tim Teknisi | ✅ | ✅ | ❌ | ❌ |
| Laporan Tim | ✅ | ✅ | ❌ | ❌ |
| ARA Chat | ✅ | ✅ | ❌ | ❌ |
| **Statistik** | ✅ | ❌ Blocked | ❌ | ❌ |
| **ARA Log** | ✅ | ❌ Blocked | ❌ | ❌ |
| **Deleted Audit** | ✅ | ❌ Blocked | ❌ | ❌ |
| **Settings** | ✅ | ❌ Blocked | ❌ | ❌ |
| **Monitoring** | ✅ | ❌ Blocked | ❌ | ❌ |
| Finance | ✅ | ❌ Blocked | ❌ | ❌ |
| Stok Material | ✅ | ✅ | ❌ | ❌ |
| Biaya | ✅ | ✅ | ❌ | ❌ |
| **Laporan Saya** | ❌ | ❌ | ✅ | ✅ |

**Critical rules (DO NOT violate):**
- `pricelist` menu dan edit buttons → Owner only. Admin diblok di `canAccess()` dan di `canEdit` PriceListView.
- `settings` → Owner only. Admin tidak bisa ubah toggle WA/AI/cron.
- `reports` (Statistik), `agentlog` (ARA Log), `deletedaudit` (Deleted Audit) → Owner only. Admin diblok di `canAccess()`.
- Delete operations dalam view (order, invoice, customer) → umumnya Owner only. Admin = input & edit only, NO delete.
- Supabase `user_profiles` DELETE tidak punya RLS policy untuk anon key → pakai `/api/manage-user` endpoint untuk delete user.

## Key Business Rules

**Invoice:**
- Overdue threshold: **7 hari** setelah invoice di-approve
- Status flow: Draft → APPROVED → UNPAID → PAID / OVERDUE / PARTIAL_PAID
- Setelah `markInvoicePaid()` → wajib update `orders.status = 'PAID'` di DB juga (App.jsx sudah handle post-3934)

**Laporan Teknisi:**
- Max unit per laporan: **30 unit** (naik dari 10 per commit 92e3936)
- Status: PENDING → SUBMITTED → VERIFIED / REVISION / REJECTED
- Laporan >3 hari belum VERIFIED → alert WA ke Owner (cron `laporan-stale`, 10:00 WIB)

**WhatsApp (Cron):**
- Toggle cron selalu pakai AND-logic: `isCronJobEnabled(togMap, key)` DAN standalone key `=== "true"`
- `cron_jobs` JSON di `app_settings` adalah sumber utama. Toggle di Settings UI harus sync KEDUANYA (standalone key + cron_jobs JSON)
- Jika hanya sync salah satu → WA bisa bocor meski toggle OFF

**Customer:**
- UNIQUE constraint: `(phone, name)` — 1 nomor HP boleh punya banyak customer asal nama beda (multi-lokasi)
- Phone selalu di-normalize ke format `628xxx`
- `upsertCustomer()` di writes.js — dead code, jangan pakai (conflict key salah). Gunakan `insertCustomer()` untuk baru, `updateCustomer()` untuk edit.

**Order:**
- Jenis servis tidak bisa diedit setelah dibuat (harus hapus & buat ulang per SOP)
- Conflict detection pakai durasi aktual, bukan ±1 jam flat

## File Structure

```
src/
  App.jsx                  # Root component — state, auth, modals, renderContent()
  main.jsx                 # React entry point
  theme/cs.js              # Color scheme object (dark mode default)
  context/AppContext.js    # React context for shared state
  constants/
    services.js            # SERVICE_TYPES list
    status.js              # statusColor, statusLabel maps
  lib/
    customers.js           # sameCustomer, findCustomer, buildCustomerHistory
    dateTime.js            # getLocalDate, getLocalISOString, isWorkingHours
    inventory.js           # isFreonItem, displayStock, computeStockStatus
    phone.js               # normalizePhone, samePhone
    pricing.js             # PRICE_LIST_DEFAULT, hitungLabor, hargaPerUnit...
    safeJson.js            # safeJsonParse
    techColor.js           # TECH_PALETTE, getTechColor
    validators.js          # validateEmail, validatePhone, validateDate...
    __tests__/             # Unit tests (vitest)
  data/
    reads.js               # All Supabase SELECT helpers (fetchOrders, fetchInvoices...)
    writes.js              # All Supabase INSERT/UPDATE/DELETE helpers
  components/
    InvoicePDF.jsx         # @react-pdf/renderer invoice PDF
    ServiceReportPDF.jsx   # @react-pdf/renderer service report PDF (6 photos/page)
    ViewErrorBoundary.jsx  # Per-view error boundary
  views/
    AgentLogView.jsx       # ARA agent log viewer
    AraView.jsx            # AI chat assistant (ARA)
    CustomersView.jsx      # Customer management
    DashboardView.jsx      # Main dashboard — stats, team grid, chart
    DeletedAuditView.jsx   # Deleted records audit trail
    ExpensesView.jsx       # Operational expenses
    InventoryView.jsx      # Inventory management + restock
    InvoiceView.jsx        # Invoice list, approval, payment
    LaporanTimView.jsx     # Team report verification (Owner/Admin)
    MatTrackView.jsx       # Material usage tracking + freon timbang aktual
    MonitoringView.jsx     # System monitoring (Owner only)
    MyReportView.jsx       # Teknisi/Helper own report submission
    OrderInboxView.jsx     # Planning Order — time grid, team slots, order form
    OrdersView.jsx         # Order list + management
    PriceListView.jsx      # Service price list editor (Owner only — canEdit = Owner)
    ReportsView.jsx        # Business reports & statistics
    ScheduleView.jsx       # Weekly schedule calendar view
    SettingsView.jsx       # App settings (Owner only — blocked for Admin)
    TeknisiAdminView.jsx   # Technician & user management
    ToolBagView.jsx        # Tas Teknisi (Tool Bag) — checklist 24 alat/tas + history check WA

api/
  [route].js              # Unified API router
  ara-chat.js             # AI proxy
  cron-reminder.js        # Cron tasks (12 tasks, lihat vercel.json untuk jadwal)
  _auth.js                # Auth middleware

SOP_ADMIN_ROLE.md         # SOP lengkap untuk Admin role — baca ini sebelum ubah role/access logic
migrations/               # SQL migration files (run manually in Supabase SQL Editor)
```

## Migrations Status (semua sudah Applied di Supabase)

```
001–014   # Applied — constraint, audit trail, freon qty actual
015       # Applied — trade_in support di invoices
016       # Applied — invoice repair gratis
017       # Applied — group payment
018       # Applied — AC unit invoice (table ac_units)
019       # Applied — PARTIAL_PAID status
020       # Applied — quotations (table quotations)
021       # Applied — survey fields di orders
022       # Applied — UNIQUE(phone, name) customers, multi-lokasi support
023       # Applied — tabel harga unit AC per brand/tipe/kapasitas
024       # Applied — RLS policies untuk ac_price_list
025       # Applied — seed 2.5PK & 3PK + UNIQUE constraint
026       # Applied — multi_day_job (parent_job_id, is_multi_day)
027       # Applied — orders parent FK
028       # Applied — unique payment proof
029       # Applied — invoice_payments table
030       # Applied — customer_tokens table
031       # Applied — customer_engagement (customer_feedback table)
032       # Applied — voucher improvements
033       # Applied — invoice send audit
034       # Applied — tool_bag_checklist + tool_bag_checks + wa_webhook_dedup
035       # Applied — wa group logs
036       # Applied — Gree price list seed
037       # Applied — Daikin price list seed
038       # Applied — normalize phone, sync customers dari orders, fix DEFAULT id (lpad bug)
```

## Key Patterns

**Backend auth:** Frontend includes `X-Internal-Token` header (from `/api/get-api-token` exchange using Supabase JWT). Routes in `PUBLIC_ROUTES` skip this check.

**User roles:** Owner > Admin > Teknisi > Helper. Stored in `user_profiles` table. UI guards by `currentUser.role`. **Selalu enforce per tabel Role Access di atas** — jangan tambah akses Admin ke price list atau settings tanpa konfirmasi Owner.

**Theme/styling:** No CSS framework — all styles are inline JS objects via `cs` object (`src/theme/cs.js`). Dark mode default.

**WhatsApp:** Fonnte API. Inbound → `/api/receive-wa` webhook → auto-reply keywords or forward to owner. Outbound via `sendWA()` in App.jsx. Bulk WA to teknisi/helper available from Planning Order panel.

**AI (ARA):** System prompt built from `brain.md` (in `app_settings` table) + live price list. Supports `[ACTION]` tags for DB mutations parsed client-side in `handleAraAction()`.

**Image storage:** Cloudflare R2 via AWS Sig V4 in `/api/upload-foto`. Served via `/api/foto` proxy.

**App settings:** Global config stored in `app_settings` table as key-value pairs. `cron_jobs` key menyimpan JSON array konfigurasi cron jobs.

**Inventory (Freon):** Teknisi reports usage with tabung spesifik (`unit_id`). Deducted immediately with `qty_actual = null`. Admin confirms actual weight via MatTrack ⚖️ — correction auto-adjusts per-tabung stock. Requires migration 014.

**Conflict detection:** `hasConflict()` and `isSlotConflict()` use actual service duration (not ±1hr flat). `cekTeknisiAvailableDB()` hits Supabase directly for race-condition-safe checks.

**Planning Order team slots:** Changing `team_slot` on an order propagates `teknisi`/`helper` fields to DB automatically via `handleQuickAssign`.

**Tool Bag Check (Tas Teknisi):** Teknisi/helper WA foto isi tas dengan caption `Pagi Tas N` / `Pulang Tas N` (N=1..10) → Fonnte webhook → Claude Haiku Vision (`claude-haiku-4-5`) analisa kelengkapan vs checklist (`tool_bag_checklist` per `bag_id`) → save di `tool_bag_checks` (overwrite per bag+session+tanggal: PATCH existing, INSERT new) → upload R2 di `tool-bag/YYYY-MM/tas-N/YYYY-MM-DD_<session>_<timestamp>.jpg` → reply WA detail (List Alat, Terdeteksi AI, Tidak Terdeteksi, Note) ke pengirim + ALERT ke Owner kalau CRITICAL/WARNING. Tools dengan `qty_min = 0` di-skip dari checklist & reply (convention: "tidak ada di tas itu"). Prompt AI pakai `TOOL_VISUAL_GUIDE` (few-shot visual descriptions) untuk improve akurasi vision — brand dipakai sebagai bagian dari nama (e.g. "Manifold Value", "Tang Ampere Value").

**Fonnte webhook retry / distributed lock:** Fonnte retry webhook saat response ambient >5s (AI vision butuh 8-12s) → bisa 3-4x retry paralel. Idempotency flag (`reply_sent`, `warning_sent`) di table `tool_bag_checks` saja tidak cukup karena race condition di INSERT awal (semua webhook lihat dup-check kosong). Solusi: tabel `wa_webhook_dedup` (PRIMARY KEY=`dedup_key`) sebagai DB-level atomic mutex. Di awal handler tool bag, INSERT row dengan dedup_key = `tb_<sender>_<bagId>_<session>_<mediaUrlSuffix>`. Retry berikutnya gagal INSERT (409 conflict) → return 200 langsung skip. Pola sama bisa dipakai untuk webhook lain yang berisiko duplikat.

**Cron toggle pattern (PENTING):** Semua cron task harus cek toggle via AND-logic:
```js
// Fetch WAJIB include "cron_jobs" key
const { data } = await sb.from("app_settings").select("key,value")
  .in("key", ["my_feature_enabled", "cron_jobs", ...otherKeys]);
const togMap = Object.fromEntries(...);
// Check WAJIB pakai isCronJobEnabled() + standalone key
if (!isCronJobEnabled(togMap, "my_feature_enabled") || togMap["my_feature_enabled"] !== "true") {
  return { skipped: true };
}
```
Jika hanya cek salah satu → WA bisa bocor ke customer saat toggle OFF.
