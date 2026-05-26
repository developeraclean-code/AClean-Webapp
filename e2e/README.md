# E2E Tests — AClean Webapp

Playwright-based end-to-end tests untuk catch regression di UI critical paths.

## Quick Start

```bash
# Install browser binary (once)
npx playwright install chromium

# Run all E2E tests (butuh dev server jalan di localhost:3000)
npm run test:e2e

# Interactive UI mode (recommended saat dev tests)
npm run test:e2e:ui

# Headed mode (lihat browser saat test jalan)
npm run test:e2e:headed

# Lihat HTML report dari run terakhir
npm run test:e2e:report
```

## Categories

| File | Type | Butuh Credentials |
|------|------|------------------|
| `smoke.spec.js` | Smoke — app boot, login page | ❌ No |
| `auth.spec.js` | Login flow | ✅ Yes |
| `navigation.spec.js` | Menu navigation (Owner) | ✅ Yes |
| `invoice-readonly.spec.js` | Invoice list & preview | ✅ Yes |

## Setup Credentials (Optional)

Untuk run authenticated tests, buat file `.env.test` di root project:

```bash
# .env.test (TIDAK di-commit, di .gitignore)
E2E_OWNER_EMAIL=your-owner-email@example.com
E2E_OWNER_PASSWORD=your-password
E2E_ADMIN_EMAIL=admin@example.com
E2E_ADMIN_PASSWORD=admin-password
```

Lalu jalankan dengan dotenv-cli atau export manual:

```bash
# Option 1: export inline
E2E_OWNER_EMAIL=... E2E_OWNER_PASSWORD=... npm run test:e2e

# Option 2: source .env.test
set -a; source .env.test; set +a; npm run test:e2e
```

Test tanpa credentials akan **auto-skip** authenticated tests (smoke tests tetap jalan).

## Test Strategy

**READ-ONLY by design** — tests TIDAK create/update/delete data production.

Kenapa? Karena belum ada Supabase test branch:
- Risk pollute production DB
- Risk overlap dengan user activity
- Cleanup script kompleks

Yang di-cover:
- ✅ App boot (no critical errors)
- ✅ Login form rendering
- ✅ Login flow (valid + invalid credentials)
- ✅ Menu navigation
- ✅ Invoice list rendering
- ✅ Preview PDF (verify modal/iframe buka)

Yang TIDAK di-cover (butuh test DB):
- ❌ Create order
- ❌ Approve invoice
- ❌ Mark invoice paid
- ❌ Send WA
- ❌ Edit/delete data

## Debugging Tests

```bash
# Run satu test file
npx playwright test e2e/smoke.spec.js

# Run satu test by name
npx playwright test -g "login form muncul"

# Debug mode (step-by-step)
npx playwright test --debug

# Lihat trace dari failed test
npx playwright show-trace test-results/.../trace.zip
```

## Configuration

- Base URL: `http://localhost:3000` (override dengan `BASE_URL=...`)
- Browser: Chromium only (untuk speed)
- Parallel: NO (sequential — single worker, hindari race condition Supabase)
- Retries: 0 lokal, 2 di CI
- Timeout: 30s per test
- Auto-start dev server: YES (kalau belum running di port)

## Adding New Tests

1. Buat file `e2e/*.spec.js`
2. Import `loginAs` dari `./fixtures/auth.js` kalau butuh auth
3. Pakai `test.skip(!hasCredentials, ...)` untuk graceful skip
4. **READ-ONLY** — jangan modify data production tanpa test branch

Pattern contoh:
```javascript
import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth.js";

const hasCredentials = !!(process.env.E2E_OWNER_EMAIL && process.env.E2E_OWNER_PASSWORD);

test.describe("My Feature", () => {
  test.skip(!hasCredentials, "Set E2E credentials untuk authenticated tests");

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "owner");
  });

  test("should do X", async ({ page }) => {
    // ...
  });
});
```

## CI Integration (Future)

Belum diintegrasikan dengan GitHub Actions / Vercel preview deploy. Saat siap:
- Set `E2E_OWNER_EMAIL` & `E2E_OWNER_PASSWORD` sebagai GitHub Secrets
- Run `npm run test:e2e` di workflow setelah build success
- Block merge ke main kalau tests fail
