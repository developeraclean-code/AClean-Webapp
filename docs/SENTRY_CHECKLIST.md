# ✅ Sentry Setup Checklist

**Estimated Time:** 15 minutes

---

## **Phase 1: Sentry Account Setup (5 min)**

- [ ] **1.1** Buka https://sentry.io/signup/
- [ ] **1.2** Sign up dengan email atau GitHub
- [ ] **1.3** Create Organization (atau gunakan default)
- [ ] **1.4** Create first Project → Select "React"
  - Catat DSN React: `https://xxxxx@o0.ingest.sentry.io/123`
- [ ] **1.5** Create second Project → Select "Node.js"
  - Catat DSN Node.js: `https://yyyyy@o0.ingest.sentry.io/456`

---

## **Phase 2: Local Environment Setup (3 min)**

- [ ] **2.1** Buka `.env.local` di project root
- [ ] **2.2** Isi `VITE_SENTRY_DSN` dengan React DSN:
  ```
  VITE_SENTRY_DSN=https://xxxxx@o0.ingest.sentry.io/123
  ```
- [ ] **2.3** Save file
- [ ] **2.4** Jalankan dev server:
  ```bash
  npm run dev
  ```
- [ ] **2.5** Buka http://localhost:3000 di browser

---

## **Phase 3: Frontend Test (2 min)**

- [ ] **3.1** Di browser, buka DevTools (F12)
- [ ] **3.2** Paste ke console:
  ```javascript
  throw new Error("Test Sentry - Sent from browser console");
  ```
- [ ] **3.3** Tekan Enter (page akan refresh)
- [ ] **3.4** Tunggu 10 detik
- [ ] **3.5** Buka Sentry Dashboard → Issues
  - Harus ada error "Test Sentry - Sent from browser console"
- [ ] **3.6** Click error → lihat stacktrace, breadcrumb, device info

---

## **Phase 4: Backend Test (2 min)**

- [ ] **4.1** Buka terminal baru
- [ ] **4.2** Jalankan curl test:
  ```bash
  curl -X POST http://localhost:3000/api/send-wa \
    -H "Content-Type: application/json" \
    -d '{"phone": "invalid", "message": "test"}'
  ```
- [ ] **4.3** Tunggu 30 detik
- [ ] **4.4** Refresh Sentry Dashboard → Issues
  - Harus ada error dari API (validation failed atau similar)
- [ ] **4.5** Click error → lihat route, method, stacktrace

---

## **Phase 5: Vercel Production Setup (3 min)**

**Note:** Ini untuk production, bisa skip kalau belum siap. Lakukan setelah confirm local test success.

- [ ] **5.1** Buka https://vercel.com/dashboard
- [ ] **5.2** Pilih project "a-clean-webapp"
- [ ] **5.3** Settings → Environment Variables
- [ ] **5.4** Click "Add New"
  - Name: `VITE_SENTRY_DSN`
  - Value: `https://xxxxx@o0.ingest.sentry.io/123` (React DSN)
  - Click Save
- [ ] **5.5** Click "Add New" lagi
  - Name: `SENTRY_DSN`
  - Value: `https://yyyyy@o0.ingest.sentry.io/456` (Node.js DSN)
  - Click Save
- [ ] **5.6** Back to "Deployments"
- [ ] **5.7** Click "Redeploy" pada latest deployment
  - Tunggu sampai selesai (hijau = success)
- [ ] **5.8** Buka production app: https://a-clean-webapp.vercel.app
- [ ] **5.9** Trigger error untuk test (lihat Phase 3/4)
  - Seharusnya error muncul di Sentry dalam 30 detik

---

## **Phase 6: Email Alerts (Optional, 1 min)**

- [ ] **6.1** Buka Sentry Dashboard
- [ ] **6.2** Settings → Alerts
- [ ] **6.3** Click "Create Alert Rule"
- [ ] **6.4** Configure:
  - Trigger: "When a new issue is detected"
  - Notify: Email (pilih email kamu)
  - Conditions: All issues (default)
- [ ] **6.5** Click "Save Rule"
- [ ] **6.6** Sekarang saat error baru terjadi, kamu dapat email notif

---

## **Phase 7: Verify Integration (3 min)**

- [ ] **7.1** Cek semua files sudah diupdate:
  - ✅ `src/main.jsx` — Sentry init + ErrorBoundary
  - ✅ `api/_auth.js` — Sentry import
  - ✅ `api/sentry-init.js` — Backend Sentry setup
  - ✅ `api/[route].js` — Error capture
  - ✅ `api/cron-reminder.js` — Cron error capture
  - ✅ `.env.local` — VITE_SENTRY_DSN diisi

- [ ] **7.2** Run build untuk verify:
  ```bash
  npm run build
  ```
  - Harus success (no errors)

- [ ] **7.3** Lihat Sentry dashboard 1-2x dalam seminggu:
  - Verifikasi errors di-capture dengan benar
  - Check stacktrace detailed & helpful

---

## **Done! ✅**

Sentry sekarang fully integrated. Kapan pun ada error di production:
1. Sentry capture otomatis
2. Kamu dapat notif (kalau email alert enabled)
3. Lihat detail error di dashboard — debug cepat

---

## **Troubleshooting**

### Error tidak muncul di Sentry?

**Checklist:**
- [ ] `VITE_SENTRY_DSN` di `.env.local` ada isinya (bukan empty)
- [ ] Dev server di-restart setelah edit `.env.local`
- [ ] Browser cache di-clear (Ctrl+Shift+Delete → clear all)
- [ ] Network tab di DevTools — ada request ke `ingest.sentry.io`?
- [ ] Vercel env vars di-set + redeploy dilakukan

**Jika masih tidak muncul:**
- [ ] Buka Sentry → Settings → Client Keys
  - Verify DSN di config file sama dengan di Sentry

### Terlalu banyak error (noisy)?

Edit filter di `api/sentry-init.js`:
```javascript
beforeSend(event, hint) {
  // Skip network errors
  if (event.exception?.values?.[0]?.type === "NetworkError") return null;
  return event;
}
```

---

## **Next Actions**

After checklist done:

1. **Daily**: Monitor Sentry issues (5 min)
   - Review new errors
   - Debug stacktrace
   - Create fixes

2. **Weekly**: Check error trends
   - Paling sering error apa?
   - Affected how many users?
   - What to prioritize?

3. **Monthly**: Review usage
   - Events captured vs free limit
   - Upgrade kalau perlu

---

**Questions?** Re-read [SENTRY_SETUP.md](SENTRY_SETUP.md) untuk detail lebih lengkap.

**All done? Commit!**
```bash
git add .
git commit -m "feat: add Sentry error tracking integration"
git push
```
