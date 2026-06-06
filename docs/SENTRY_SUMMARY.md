# 🚀 Sentry Setup — Complete Summary

## What I've Done For You

### ✅ **Installed Packages**
```
✓ @sentry/react (frontend error tracking)
✓ @sentry/node (backend error tracking)
```

### ✅ **Updated Files**

#### Frontend
- **`src/main.jsx`**
  - Added Sentry initialization
  - Added ErrorBoundary wrapper (shows error UI instead of blank screen)
  - Auto-captures React crashes, promise rejections, console errors

#### Backend
- **`api/_auth.js`** — Initialize Sentry
- **`api/sentry-init.js`** — Reusable Sentry setup helper
- **`api/[route].js`** — All API endpoints now capture errors to Sentry
- **`api/cron-reminder.js`** — All cron jobs capture errors + context

#### Configuration
- **`.env.local`** — Added `VITE_SENTRY_DSN` placeholder
- **`SENTRY_SETUP.md`** — Detailed setup guide
- **`SENTRY_CHECKLIST.md`** — Step-by-step checklist (15 min)

### ✅ **What Gets Captured Automatically**

#### Frontend
```
✓ React component errors (crashes)
✓ JavaScript errors (throw, undefined variable)
✓ Promise rejections (async errors)
✓ Console errors (console.error)
✓ 404 chunk load errors
```

#### Backend
```
✓ API endpoint errors (validation, database, timeout)
✓ Missing environment variables
✓ Fonnte WhatsApp API failures
✓ Supabase connection errors
```

#### Cron Jobs
```
✓ Invoice reminder failures
✓ Stock alert failures
✓ Daily report failures
✓ Cleanup task failures
✓ All scheduled task errors with timestamp & task name
```

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    AClean Application                        │
├──────────────────┬──────────────────┬──────────────────────┤
│   React App      │   API Routes     │   Cron Jobs          │
│   (Frontend)     │   (Backend)      │   (Scheduled)        │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         │ Error occurs     │ Error occurs       │ Error occurs
         ↓                  ↓                    ↓
     ┌───────────────────────────────────────────────────┐
     │  Sentry.captureException()                        │
     │  - stacktrace                                     │
     │  - breadcrumb (what happened before)              │
     │  - context (user, route, cron task, etc)          │
     └────────────────┬─────────────────────────────────┘
                      │
                      ↓
           ┌──────────────────────────┐
           │  Sentry API Ingestion    │
           │  sentry.io/ingest        │
           └────────────┬─────────────┘
                        │
                        ↓
           ┌──────────────────────────┐
           │  Sentry Dashboard        │
           │  Issues / Alerts / Stats  │
           └────────────┬─────────────┘
                        │
                        ├─→ Email Alert (you)
                        ├─→ Slack Notification
                        └─→ Dashboard View
```

---

## How to Use (After Setup)

### **1. Monitor Errors**
```
Daily workflow:
1. Check email for Sentry alerts (if configured)
2. Buka Sentry dashboard: https://sentry.io/organizations/[your-org]/issues/
3. See new errors, click to see stacktrace
4. Debug & fix
```

### **2. Track Error Trends**
```
Weekly:
- How many errors per day?
- Which errors paling frequent?
- Affected berapa users?
- Priority untuk fix?
```

### **3. Understand Errors**
```
Sentry shows:
- Exact line of code where error occurred
- Full stacktrace (call chain)
- Context (browser, OS, user, request)
- Breadcrumb (sequence of actions before error)
- Frequency (how many times in 24h)
- Affected users (how many unique users)
```

---

## Quick Reference

### **Files Changed**
```
src/
  └─ main.jsx                      [MODIFIED] Init Sentry + ErrorBoundary
api/
  ├─ _auth.js                      [MODIFIED] Init Sentry
  ├─ sentry-init.js                [NEW]      Reusable setup
  ├─ [route].js                    [MODIFIED] Capture API errors
  └─ cron-reminder.js              [MODIFIED] Capture cron errors
.env.local                          [MODIFIED] Added VITE_SENTRY_DSN
SENTRY_SETUP.md                     [NEW]      Detailed guide
SENTRY_CHECKLIST.md                 [NEW]      Step-by-step checklist
```

### **Environment Variables Needed**
```
DEVELOPMENT (.env.local):
  VITE_SENTRY_DSN = https://your-react-dsn@o0.ingest.sentry.io/123

PRODUCTION (Vercel Settings):
  VITE_SENTRY_DSN = https://your-react-dsn@o0.ingest.sentry.io/123
  SENTRY_DSN = https://your-node-dsn@o0.ingest.sentry.io/456
```

### **DSN Format**
- **Frontend DSN** (React) → `VITE_SENTRY_DSN`
- **Backend DSN** (Node.js) → `SENTRY_DSN`

(Get both from Sentry dashboard after signup)

---

## Testing

### **Frontend Error Test**
```bash
# Di browser console
throw new Error("Test frontend error");
```

### **Backend Error Test**
```bash
# Invalid API call (will trigger validation error)
curl -X POST http://localhost:3000/api/send-wa \
  -H "Content-Type: application/json" \
  -d '{"phone": "invalid", "message": "test"}'
```

### **Verify in Sentry**
```
https://sentry.io/organizations/[org]/issues/
→ Should see errors within 30 seconds
```

---

## Cost Breakdown

| Plan | Events/Month | Cost | Best For |
|------|-------------|------|----------|
| **Free** | 5,000 | $0 | MVP, small teams |
| **Pro** | Unlimited | $29 | Growing apps |
| **Enterprise** | Unlimited | Custom | Large orgs |

**AClean estimate:** ~300-500 events/month → Free tier sufficient ✅

---

## What Happens Now

### **Scenario 1: Frontend Error**
```
User browse app → click button → React crash
  ↓ (automatic)
Sentry captures: "ReferenceError: undefined variable"
  ↓
Dashboard shows: Exact line, stacktrace, browser info
  ↓ (if alert enabled)
You get email: "New error: ReferenceError in App.jsx:4521"
  ↓
You click → see full context, debug, fix
```

### **Scenario 2: Cron Job Failure**
```
10:00 AM → Cron job runs: "laporan-stale" check
  ↓
Database timeout error occurs
  ↓ (automatic)
Sentry captures: "Error: DB query timeout after 30s"
  With context: task=laporan-stale, timestamp=...
  ↓
Dashboard shows: Error frequency, when it started
  ↓ (if alert enabled)
You get notif: "Cron job laporan-stale failed"
  ↓
You check → fix DB connection issue, re-run
```

### **Scenario 3: API 500 Error**
```
Customer call: /api/send-wa → Fonnte API down
  ↓
Error: "Fonnte 502 Bad Gateway"
  ↓ (automatic)
Sentry captures: route=send-wa, method=POST, error details
  ↓
Dashboard shows: Affected 3 customers, error count = 47
  ↓ (if alert enabled)
You get email immediately
  ↓
You see root cause (Fonnte down), notify customers, implement fallback
```

---

## Next Steps

### **Immediately** (10 min)
- [ ] Follow `SENTRY_CHECKLIST.md`
- [ ] Get DSN from sentry.io
- [ ] Test local setup
- [ ] Commit: `git commit -m "feat: add Sentry error tracking"`

### **This Week**
- [ ] Set Vercel env vars
- [ ] Redeploy to production
- [ ] Test production errors
- [ ] Configure email alerts

### **Ongoing**
- [ ] Check Sentry dashboard 1-2x/week
- [ ] Monitor error trends
- [ ] Fix critical errors ASAP
- [ ] Review cron job reliability

---

## Support

**Issues?** Read in order:
1. `SENTRY_CHECKLIST.md` — Step-by-step guide
2. `SENTRY_SETUP.md` — Detailed explanations
3. Sentry Docs: https://docs.sentry.io
4. Email: support@sentry.io

**Code changes?** All in:
- `src/main.jsx`
- `api/sentry-init.js`
- `api/_auth.js`
- `api/[route].js`
- `api/cron-reminder.js`

---

## ✅ Verification Checklist

Before going live, verify:

- [ ] `npm run build` succeeds (no errors)
- [ ] `.env.local` has `VITE_SENTRY_DSN`
- [ ] Dev server starts without errors (`npm run dev`)
- [ ] Frontend error captured (threw test error, saw in Sentry)
- [ ] Backend error captured (called API with bad input, saw in Sentry)
- [ ] Email alert configured (optional but recommended)

---

**Everything integrated! 🎉**

Now just get DSN from sentry.io and you're golden.

Read `SENTRY_CHECKLIST.md` for step-by-step walkthrough (15 min).
