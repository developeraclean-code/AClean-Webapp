# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Dev server on port 3000
npm run build        # Production build → dist/
npm run preview      # Preview production build locally
```

There are no tests in this project.

## Environment Setup

Copy `env.example` to `.env.local`. Required variables:
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — Supabase project credentials
- `SUPABASE_SERVICE_KEY` — Service role key (backend-only, not prefixed with VITE_)

Optional integrations: `FONNTE_TOKEN` (WhatsApp), `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY`/`GROQ_API_KEY` (AI), `R2_*` variables (Cloudflare R2 image storage), `INTERNAL_API_SECRET` (backend token auth).

## Architecture

**Frontend:** Single monolithic React component in [src/App.jsx](src/App.jsx) (~12,800 lines). All UI views are implemented as render functions inside `ACleanWebApp`. Navigation is handled by `activeMenu` state dispatching to `renderContent()` which calls the appropriate render function.

**Backend:** Vercel serverless functions in [api/](api/):
- [`api/[route].js`](api/[route].js) — Unified router for all API endpoints (WhatsApp send/receive, image upload, AI proxy, test-connection)
- [`api/ara-chat.js`](api/ara-chat.js) — Dedicated AI assistant proxy (Claude/OpenAI/Gemini/Groq with fallback logic)
- [`api/cron-reminder.js`](api/cron-reminder.js) — Scheduled tasks: invoice overdue reminders, daily WhatsApp report, stock alerts, photo cleanup
- [`api/_auth.js`](api/_auth.js) — Shared middleware: CORS, rate limiting, internal token validation

**Database:** Supabase (PostgreSQL). Frontend connects directly via `@supabase/supabase-js` using the anon key. Backend uses `SUPABASE_SERVICE_KEY` for privileged operations. No ORM — raw Supabase query builder throughout.

**Deployment:** Vercel with 4 cron jobs defined in [`vercel.json`](vercel.json).

## Key Patterns

**Backend auth:** All API calls from frontend include `X-Internal-Token` header matching `INTERNAL_API_SECRET`. Routes in `PUBLIC_ROUTES` array skip this check.

**User roles:** Owner > Admin > Teknisi > Helper. Role is stored in `user_profiles` table and loaded at login. UI conditionally renders features based on `currentUser.role`.

**Theme/styling:** No CSS framework — all styles are inline JS objects. Color scheme defined as a `cs` object near the top of App.jsx with dark mode as default.

**WhatsApp:** Uses Fonnte API. Inbound messages hit `/api/receive-wa` webhook, which auto-replies to keywords and forwards unknown messages to owner phone.

**AI (ARA):** System prompt is dynamically built from `brain.md` (stored in `app_settings` table) + live price list. Supports [ACTION] tags for database mutations (UPDATE_INVOICE, MARK_PAID, etc.) parsed client-side in `handleAraAction()`.

**Image storage:** Photos uploaded to Cloudflare R2 via AWS Sig V4 signing in `/api/upload-foto`. Served via `/api/foto` proxy to handle CORS and auth.

**App settings:** Global config (WhatsApp autoreply toggle, LLM provider, cron schedules, brain.md content) stored in the `app_settings` Supabase table as key-value pairs.
