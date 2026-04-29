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

api/
  [route].js              # Unified API router
  ara-chat.js             # AI proxy
  cron-reminder.js        # Cron tasks
  _auth.js                # Auth middleware

migrations/               # SQL migration files (run manually in Supabase SQL Editor)
  001–012                 # Applied
  013_invoice_job_id_unique.sql     # Apply if not done
  014_freon_qty_actual.sql          # PENDING — required for freon timbang feature
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
