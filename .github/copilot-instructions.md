---
name: AClean Webapp Instructions
description: Workspace instructions for AClean Webapp — a React + Supabase + Vercel project management app with WhatsApp integration and AI assistant
---

# AClean Webapp - Agent Instructions

This project is a service business management webapp with a monolithic React frontend, Vercel serverless backend, and Supabase database.

## Quick Start

```bash
npm install          # Install dependencies
npm run dev          # Dev server on port 3000
npm run build        # Production build → dist/
npm run preview      # Preview production build locally
```

## Tech Stack

- **Frontend**: React 18, Vite, Supabase JS client
- **Backend**: Vercel serverless functions (api/*.js)
- **Database**: Supabase (PostgreSQL)
- **Integrations**: Fonnte WhatsApp, Claude/OpenAI/Gemini AI, Cloudflare R2

## Key Files

| File | Purpose |
|------|---------|
| [src/App.jsx](src/App.jsx) | Main React component (~12,800 lines) — single monolithic file |
| [api/[route].js](api/[route].js) | Unified API router for WhatsApp, image upload, AI proxy |
| [api/ara-chat.js](api/ara-chat.js) | AI assistant proxy with Claude/OpenAI/Gemini/Groq fallback |
| [api/cron-reminder.js](api/cron-reminder.js) | Scheduled tasks (invoices, reports, stock alerts) |
| [api/_auth.js](api/_auth.js) | Shared middleware: CORS, rate limiting, token validation |
| [vercel.json](vercel.json) | Cron job schedules (4 jobs) |

## Architecture

All UI views in `App.jsx` are implemented as render functions inside `ACleanWebApp`. Navigation is via `activeMenu` state → `renderContent()` → appropriate render function.

### Authentication

- Frontend stores user in `currentUser` state
- User roles: `Owner` > `Admin` > `Teknisi` > `Helper`
- Role is loaded from `user_profiles` table at login
- API calls include `X-Internal-Token` header matching `INTERNAL_API_SECRET`

### Integrations

- **WhatsApp**: Fonnte API — `/api/receive-wa` webhook handles inbound messages
- **AI (ARA)**: System prompt from `brain.md` (stored in `app_settings` table) + live price list
- **Images**: Uploaded to Cloudflare R2 via AWS Sig V4 signing, served via `/api/foto` proxy

## Environment

Copy `env.example` to `.env.local`:
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — Supabase credentials
- `SUPABASE_SERVICE_KEY` — Backend-only (no `VITE_` prefix)
- Optional: `FONNTE_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `R2_*`, `INTERNAL_API_SECRET`

## Styling

No CSS framework. All styles are inline JS objects. Color scheme defined in `cs` object near top of `App.jsx`. Dark mode is default.

## Database

No ORM — raw Supabase query builder throughout. Key tables: `user_profiles`, `app_settings`, invoices, customers, jobs, inventory.