# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server on port 3000 (auto-switches to 3001 if busy)
npm run build        # Production build → dist/
npm run preview      # Preview production build locally
```

There are no tests in this project.

## Environment Setup

Copy `env.example` to `.env.local`. Required variables:
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — Supabase project credentials
- `SUPABASE_SERVICE_KEY` — Service role key (backend-only, not prefixed with VITE_)

Optional integrations: `FONNTE_TOKEN` (WhatsApp via Fonnte), `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`/`GROQ_API_KEY` (AI), `R2_*` variables (Cloudflare R2 image storage), `INTERNAL_API_SECRET` (backend token auth).

## Architecture

**Frontend:** React app with a monolithic root component in [src/App.jsx](src/App.jsx) (~13,000 lines). Navigation is handled by `activeMenu` state → `renderContent()` → lazy-loaded view components.

Views are split into dedicated files under `src/views/`. Heavy views are lazy-loaded via `React.lazy()`.

**Backend:** Vercel serverless functions in [api/](api/):
- [`api/[route].js`](api/[route].js) — Unified router (WhatsApp send/receive, image upload, AI proxy, token exchange)
- [`api/ara-chat.js`](api/ara-chat.js) — AI assistant proxy (Claude/OpenAI/Gemini/Groq with fallback)
- [`api/cron-reminder.js`](api/cron-reminder.js) — Scheduled tasks: overdue invoice reminders, daily WA report to owner, stock alerts, WA chat cleanup
- [`api/_auth.js`](api/_auth.js) — Shared middleware: CORS, rate limiting, internal token validation

**Database:** Supabase (PostgreSQL). Frontend connects via `@supabase/supabase-js` (anon key). Backend uses `SUPABASE_SERVICE_KEY`. No ORM — raw Supabase query builder throughout.

**Deployment:** Vercel. Cron jobs defined in [`vercel.json`](vercel.json) — currently 5 jobs (stock, reminder, daily, cleanup, wa-cleanup).

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
    MonitoringView.jsx     # System monitoring
    MyReportView.jsx       # Teknisi own report submission
    OrderInboxView.jsx     # Planning Order — time grid, team slots, order form
    OrdersView.jsx         # Order list + management
    PriceListView.jsx      # Service price list editor
    ReportsView.jsx        # Business reports & statistics
    ScheduleView.jsx       # Weekly schedule calendar view
    SettingsView.jsx       # App settings (WA, AI, cron toggles)
    TeknisiAdminView.jsx   # Technician & user management
    ToolBagView.jsx        # Tas Teknisi (Tool Bag) — checklist 24 alat/tas + history check WA

api/
  [route].js              # Unified API router
  ara-chat.js             # AI proxy
  cron-reminder.js        # Cron tasks
  _auth.js                # Auth middleware

migrations/               # SQL migration files (run manually in Supabase SQL Editor)
  001–012                 # Applied
  013_invoice_job_id_unique.sql     # Applied
  014_freon_qty_actual.sql          # Applied — freon timbang aktual
  022_customer_phone_name_unique.sql # Applied — UNIQUE(phone, name), support multi-lokasi
  023_ac_price_list.sql             # Applied — tabel harga unit AC per brand/tipe/kapasitas
  024_ac_price_list_rls.sql         # Applied — RLS policies untuk ac_price_list
  025_ac_price_list_seed_larger_pk.sql # Applied — seed 2.5PK & 3PK + UNIQUE constraint
  034_tool_bag_check.sql            # Applied — tool_bag_checklist + tool_bag_checks (24 alat × 10 tas) + reply_sent + wa_webhook_dedup
```

## Key Patterns

**Backend auth:** Frontend includes `X-Internal-Token` header (from `/api/get-api-token` exchange using Supabase JWT). Routes in `PUBLIC_ROUTES` skip this check.

**User roles:** Owner > Admin > Teknisi > Helper. Stored in `user_profiles` table. UI and backend functions guard by `currentUser.role`.

**Theme/styling:** No CSS framework — all styles are inline JS objects via `cs` object (`src/theme/cs.js`). Dark mode default.

**WhatsApp:** Fonnte API. Inbound → `/api/receive-wa` webhook → auto-reply keywords or forward to owner. Outbound via `sendWA()` in App.jsx. Bulk WA to teknisi/helper available from Planning Order panel.

**AI (ARA):** System prompt built from `brain.md` (in `app_settings` table) + live price list. Supports `[ACTION]` tags for DB mutations parsed client-side in `handleAraAction()`.

**Image storage:** Cloudflare R2 via AWS Sig V4 in `/api/upload-foto`. Served via `/api/foto` proxy.

**App settings:** Global config stored in `app_settings` table as key-value pairs.

**Inventory (Freon):** Teknisi reports usage with tabung spesifik (`unit_id`). Deducted immediately with `qty_actual = null`. Admin confirms actual weight via MatTrack ⚖️ — correction auto-adjusts per-tabung stock. Requires migration 014.

**Conflict detection:** `hasConflict()` and `isSlotConflict()` use actual service duration (not ±1hr flat). `cekTeknisiAvailableDB()` hits Supabase directly for race-condition-safe checks.

**Planning Order team slots:** Changing `team_slot` on an order propagates `teknisi`/`helper` fields to DB automatically via `handleQuickAssign`.

**Tool Bag Check (Tas Teknisi):** Teknisi/helper WA foto isi tas dengan caption `Pagi Tas N` / `Pulang Tas N` (N=1..10) → Fonnte webhook → Claude Haiku Vision (`claude-haiku-4-5`) analisa kelengkapan vs checklist (`tool_bag_checklist` per `bag_id`) → save di `tool_bag_checks` (overwrite per bag+session+tanggal: PATCH existing, INSERT new) → upload R2 di `tool-bag/YYYY-MM/tas-N/YYYY-MM-DD_<session>_<timestamp>.jpg` → reply WA detail (List Alat, Terdeteksi AI, Tidak Terdeteksi, Note) ke pengirim + ALERT ke Owner kalau CRITICAL/WARNING. Tools dengan `qty_min = 0` di-skip dari checklist & reply (convention: "tidak ada di tas itu"). Prompt AI pakai `TOOL_VISUAL_GUIDE` (few-shot visual descriptions) untuk improve akurasi vision — brand dipakai sebagai bagian dari nama (e.g. "Manifold Value", "Tang Ampere Value").

**Fonnte webhook retry / distributed lock:** Fonnte retry webhook saat response ambient >5s (AI vision butuh 8-12s) → bisa 3-4x retry paralel. Idempotency flag (`reply_sent`, `warning_sent`) di table `tool_bag_checks` saja tidak cukup karena race condition di INSERT awal (semua webhook lihat dup-check kosong). Solusi: tabel `wa_webhook_dedup` (PRIMARY KEY=`dedup_key`) sebagai DB-level atomic mutex. Di awal handler tool bag, INSERT row dengan dedup_key = `tb_<sender>_<bagId>_<session>_<mediaUrlSuffix>`. Retry berikutnya gagal INSERT (409 conflict) → return 200 langsung skip. Pola sama bisa dipakai untuk webhook lain yang berisiko duplikat.
