# Sentry Setup Guide untuk AClean Web App

## Overview

Sentry adalah error tracking service yang akan otomatis menangkap dan melaporkan error di production. Dengan Sentry, kamu akan:

- ✅ Tahu instant saat ada error di production (React crash, API 500, cron job fail)
- ✅ Lihat stacktrace lengkap untuk debug cepat
- ✅ Dapat alert via email/Slack saat error kritis
- ✅ Gratis 5K events/bulan (cukup untuk MVP)

---

## Setup Steps (15 menit)

### **1. Buat Sentry Account & Project**

1. Buka https://sentry.io/signup/
2. Sign up (bisa pakai email atau GitHub)
3. Create new Organization (atau use default)
4. Click "Create Project" → pilih:
   - **For Frontend**: React
   - **For Backend**: Node.js

Kamu akan get **2 DSN** (satu untuk frontend, satu untuk backend).

**Contoh DSN:**
```
https://examplePublicKey@o0.ingest.sentry.io/0
```

---

### **2. Set Environment Variables**

Kamu sudah ada placeholder di `.env.local`:

```bash
# .env.local
VITE_SENTRY_DSN=https://your-react-dsn@o0.ingest.sentry.io/123
```

**Di Vercel Production:**

1. Buka https://vercel.com/dashboard
2. Pilih project "a-clean-webapp"
3. Settings → Environment Variables
4. Tambah 2 variables:

```
VITE_SENTRY_DSN = https://your-react-dsn@o0.ingest.sentry.io/123
SENTRY_DSN = https://your-node-dsn@o0.ingest.sentry.io/456
```

Redeploy Vercel setelah set env vars.

---

### **3. Test Frontend Error Capture**

Di dev environment:

```bash
npm run dev
# Buka app di http://localhost:3000
# Di browser console, jalankan:
console.error("Test Sentry Error");
```

Atau buat tombol test di React:

```jsx
<button onClick={() => {
  throw new Error("Testing Sentry frontend integration");
}}>
  Test Sentry Error
</button>
```

Setelah error terjadi, buka Sentry dashboard:
```
https://sentry.io/organizations/[your-org]/issues/
```

Harus ada error "Testing Sentry frontend integration" muncul dalam 10 detik.

---

### **4. Test Backend Error Capture**

Call API dengan error:

```bash
# Via curl di dev environment
curl -X POST http://localhost:3000/api/send-wa \
  -H "Content-Type: application/json" \
  -d '{"phone": "invalid", "message": "test"}'
```

Atau ke production (akan capture ke Sentry):

```bash
curl -X POST https://a-clean-webapp.vercel.app/api/send-wa \
  -H "Content-Type: application/json" \
  -d '{"phone": "invalid", "message": "test"}'
```

Error akan muncul di Sentry dashboard dalam 30 detik.

---

### **5. Setup Email Alert (Optional)**

1. Buka Sentry dashboard → Settings → Alerts
2. Click "Create Alert Rule"
3. Set:
   - **Trigger**: "When a new issue is detected"
   - **Notify**: Select "Email" + email kamu
   - **Conditions**: default ok
4. Save

Sekarang saat ada error baru, kamu akan dapat email notif.

---

## File Changes (Sudah Implemented)

| File | Change |
|------|--------|
| [src/main.jsx](src/main.jsx) | Init Sentry + ErrorBoundary |
| [api/_auth.js](api/_auth.js) | Init Sentry backend |
| [api/sentry-init.js](api/sentry-init.js) | Reusable Sentry setup |
| [api/[route].js](api/[route].js) | Capture API errors |
| [api/cron-reminder.js](api/cron-reminder.js) | Capture cron errors |
| [.env.local](.env.local) | Added VITE_SENTRY_DSN |

---

## What Gets Captured

### **Frontend (React)**
- React crashes
- Component errors
- Uncaught promise rejections
- Console errors

### **Backend (API)**
- API endpoint errors
- Validation failures
- Database errors
- Timeout errors

### **Cron Jobs**
- Task failures
- Database connection timeouts
- WhatsApp send failures
- Payment verification errors

---

## Viewing Errors in Sentry

### **Dashboard**
```
https://sentry.io/organizations/[your-org]/issues/
```

**Info yang tersedia per error:**
- Stacktrace (exactly where error happened)
- Frequency (how many times in last 24h)
- Affected users (how many)
- Breadcrumb (what happened before error)
- Environment (dev vs production)
- Browser/device info (untuk frontend)

### **Grouping**
Errors secara otomatis di-group berdasarkan stacktrace. Jadi 100 "Database connection timeout" errors akan grouped jadi 1 issue — lebih mudah dilacak.

---

## Pricing & Cost Management

### **Free Tier**
- 5,000 events/month
- Unlimited projects
- Basic features

### **Expected Usage (AClean)**
```
Estimate:
- 10 active users
- Daily API calls: ~200
- Cron jobs: ~20/day
- Errors per day: ~5-10 (expected)

Monthly events: ~300-500
→ Fits comfortably in free tier ✅
```

### **If Usage Exceeds 5K/month**
Opsi:
1. **Upgrade ke $29/month** (unlimited events)
2. **Reduce sample rate** (capture hanya 10% errors)
3. **Cleanup old issues** (delete resolved issues)

---

## Best Practices

### **DO**
- ✅ Let Sentry capture all errors (automatic)
- ✅ Monitor Sentry dashboard weekly
- ✅ Set up email alerts for critical errors
- ✅ Review error trends monthly

### **DON'T**
- ❌ Jangan manually send sensitive data (passwords, API keys)
- ❌ Jangan capture full request bodies (phone numbers di-redact otomatis)
- ❌ Jangan sample 100% di production (expensive)

---

## Troubleshooting

### **Error tidak muncul di Sentry**

**Check 1:** DSN dikonfigurasi?
```javascript
// Browser console
console.log(import.meta.env.VITE_SENTRY_DSN);
// Harus show DSN, bukan undefined
```

**Check 2:** Error terjadi setelah Sentry init?
- Sentry init di top of `src/main.jsx` — errors sebelumnya tidak caught
- Move `initSentry()` paling atas jika perlu

**Check 3:** Environment variable di Vercel sudah diset?
- Settings → Environment Variables
- Verify VITE_SENTRY_DSN ada
- Redeploy project

### **Terlalu banyak noisy errors**

Edit filter di `api/sentry-init.js`:
```javascript
beforeSend(event, hint) {
  // Skip network errors
  if (event.exception?.values?.[0]?.type === "NetworkError") return null;
  return event;
}
```

---

## Next Steps

1. **Today**: Get DSN, set env vars, test error capture
2. **This week**: Monitor Sentry dashboard, check for errors
3. **Next month**: Review usage, adjust sampling jika perlu

---

## Helpful Links

- Sentry Dashboard: https://sentry.io
- Sentry Docs: https://docs.sentry.io
- React Integration: https://docs.sentry.io/platforms/javascript/guides/react/
- Node.js Integration: https://docs.sentry.io/platforms/node/

---

**Questions?** Check Sentry docs or re-read this guide. Setup already done in code, just need DSN! 🚀
