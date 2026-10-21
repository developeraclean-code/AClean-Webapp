import { test, expect } from "@playwright/test";

const id = "11111111-1111-4111-8111-111111111111";
const user = { id, aud: "authenticated", email: "synthetic-owner@example.test", app_metadata: { provider: "email" }, user_metadata: {} };
const profile = { ...user, name: "Owner Simulasi", role: "Owner", active: true, status: "active", color: "#38bdf8", avatar: "S" };
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = { access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: id, aud: "authenticated", role: "authenticated", exp: 4102444800 })}.SIMULATED_SIGNATURE`, refresh_token: "SIMULATED_REFRESH", expires_in: 3600, token_type: "bearer", user };

async function fixture(page, { role = "Owner", orders = [] } = {}) {
  const roleProfile = { ...profile, role };
  const state = { mode: "healthy", auth: "healthy", active: 0, peak: 0, failedReads: 0, authCalls: 0, profileLists: 0, external: [], writes: [], errors: [], releaseAuth: null };
  page.on("pageerror", error => state.errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:3199" && !url.pathname.startsWith("/api/")) return route.continue();
    const fulfill = (body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
    if (url.origin === "http://127.0.0.1:3199") return fulfill({ success: true, token: "SIMULATED_INTERNAL", expiresIn: 3600, providers: [], status: "ok" });
    if (url.origin !== "https://database.simulated.test") { state.external.push(url.origin); return route.abort(); }
    if (request.method() === "OPTIONS") return fulfill({});
    if (url.pathname === "/auth/v1/token") {
      state.authCalls++;
      if (state.auth === "hold") await new Promise(resolve => { state.releaseAuth = resolve; });
      if (state.auth === "outage") return fulfill({ code: "unexpected_failure", msg: "Database unavailable" }, 503);
      if (state.auth === "invalid") return fulfill({ code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
      return fulfill(token);
    }
    if (url.pathname.startsWith("/auth/")) return fulfill(url.pathname.endsWith("/user") ? user : {});
    if (!url.pathname.startsWith("/rest/v1/")) return fulfill({});
    const table = url.pathname.split("/").at(-1);
    if (!["GET", "HEAD"].includes(request.method())) {
      state.writes.push({ table, method: request.method() });
      if (url.pathname.includes("/rpc/")) return fulfill(null);
      return fulfill([]);
    }
    state.peak = Math.max(state.peak, ++state.active);
    try {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (state.mode === "outage") { state.failedReads++; return await fulfill({ code: "PGRST002", message: "Could not query database schema cache" }, 503); }
      if (request.method() === "HEAD") return route.fulfill({ status: 200, headers: { "Content-Range": "0-0/0" } });
      if (table === "user_profiles") {
        if (!url.searchParams.has("id")) state.profileLists++;
        return await fulfill(url.searchParams.has("id") ? roleProfile : [roleProfile, { id: "SIM-T", name: "Teknisi Simulasi", role: "Teknisi", active: true }]);
      }
      if (table === "app_settings") return await fulfill([
        { key: "wa_monitor_enabled", value: "false" }, { key: "wa_payment_detect", value: "false" },
        { key: "wa_payment_inbox_enabled", value: "false" }, { key: "wa_provider", value: "fonnte" },
      ]);
      if (table === "orders") return await fulfill(orders);
      return await fulfill([]);
    } finally { state.active--; }
  });
  return state;
}
async function enter(page) {
  await page.locator("#loginEmail").fill(user.email);
  await page.locator("#loginPassword").fill("SIMULATED_PASSWORD_NOT_REAL");
  await page.getByRole("button", { name: "Masuk →", exact: true }).click();
}

test("full app bounds reads, shows an outage, and safely recovers without changing payments", async ({ page }) => {
  const state = await fixture(page);
  await page.clock.install({ time: new Date("2026-10-19T10:00:00Z") });
  await page.goto("/"); await enter(page);
  await expect(page.getByRole("button", { name: "Keluar →", exact: true })).toBeVisible();
  await expect(page.getByText("Memuat data dari Supabase...", { exact: true })).toHaveCount(0);
  await expect.poll(() => state.profileLists).toBe(1);
  expect(state.peak).toBeLessThanOrEqual(3);
  state.mode = "outage";
  await page.clock.runFor(100_000);
  const banner = page.getByRole("status", { name: "Status koneksi data" });
  await expect(banner).toContainText("Pembaruan data sedang terkendala");
  expect(state.failedReads).toBeLessThanOrEqual(5);
  await expect(banner.getByRole("button")).toBeDisabled();
  const failedBefore = state.failedReads;
  await page.clock.runFor(5000); expect(state.failedReads).toBe(failedBefore);
  state.mode = "healthy";
  await page.clock.runFor(16_000);
  await expect(banner.getByRole("button", { name: "Coba muat data kembali" })).toBeEnabled();
  await banner.getByRole("button").click();
  await expect(banner).toHaveCount(0);
  expect(state.peak).toBeLessThanOrEqual(3);
  expect(state.writes.filter(row => ["invoices", "payments", "invoice_payments", "inventory", "service_reports"].includes(row.table))).toEqual([]);
  expect(state.external).toEqual([]); expect(state.errors).toEqual([]);
});

test("Auth outage never consumes password attempts; real invalid credentials still do", async ({ page }) => {
  const state = await fixture(page); state.auth = "outage";
  await page.goto("/");
  for (let i = 0; i < 5; i++) {
    await enter(page);
    await expect(page.getByText(/percobaan ini tidak dihitung sebagai password salah/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Masuk →", exact: true })).toBeEnabled();
  }
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("aclean_loginAttempts") || "0"))).toBe(0);
  state.auth = "invalid"; await enter(page);
  await expect(page.getByText("Email atau password salah. (1/5 percobaan)")).toBeVisible();
  expect(state.external).toEqual([]); expect(state.errors).toEqual([]);
});

test("rapid double-click sends only one login request", async ({ page }) => {
  const state = await fixture(page); state.auth = "hold";
  await page.goto("/");
  await page.locator("#loginEmail").fill(user.email); await page.locator("#loginPassword").fill("SIMULATED_PASSWORD_NOT_REAL");
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(b => b.textContent === "Masuk →");
    button.click(); button.click();
  });
  await expect.poll(() => state.authCalls).toBe(1);
  await expect(page.getByRole("button", { name: "Memeriksa login…" })).toBeDisabled();
  state.auth = "healthy"; state.releaseAuth();
  await expect(page.getByRole("button", { name: "Keluar →", exact: true })).toBeVisible();
  expect(state.authCalls).toBe(1); expect(state.external).toEqual([]); expect(state.errors).toEqual([]);
});

test("connection status stays usable on a narrow mobile screen", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date("2026-10-19T10:00:00Z") });
  await page.goto("/"); await enter(page);
  await expect(page.getByText("Memuat data dari Supabase...", { exact: true })).toHaveCount(0);
  await expect.poll(() => state.profileLists).toBe(1);
  state.mode = "outage"; await page.clock.runFor(100_000);
  await expect(page.getByRole("status", { name: "Status koneksi data" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(state.external).toEqual([]); expect(state.errors).toEqual([]);
});

for (const role of ["Admin", "Finance", "Teknisi", "Helper"]) {
  test(`${role} retains its access and can recover REST reads safely`, async ({ page }) => {
    const state = await fixture(page, { role });
    await page.clock.install({ time: new Date("2026-10-19T10:00:00Z") });
    await page.goto("/"); await enter(page);
    await expect(page.getByRole("button", { name: "Keluar →", exact: true })).toBeVisible();
    await expect.poll(() => state.profileLists).toBe(1);
    await expect(page.getByRole("button", { name: /Pengaturan/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Mode Darurat/ })).toHaveCount(0);
    state.mode = "outage"; await page.clock.runFor(100_000);
    const banner = page.getByRole("status", { name: "Status koneksi data" });
    await expect(banner).toBeVisible();
    state.mode = "healthy"; await page.clock.runFor(16_000);
    await banner.getByRole("button", { name: "Coba muat data kembali" }).click();
    await expect(banner).toHaveCount(0);
    expect(state.peak).toBeLessThanOrEqual(3);
    expect(state.external).toEqual([]); expect(state.errors).toEqual([]);
    expect(state.writes.filter(row => ["invoices", "payments", "invoice_payments", "inventory", "service_reports"].includes(row.table))).toEqual([]);
  });
}

for (const scenario of [
  { name: 'regular', customer: 'BAPAK SANDI', id: 'SIM-SANDI', time: '09:30:00', end: '11:00:00', slot: 'Team 01', duration: '(1.5 jam)' },
  { name: 'overnight', customer: 'CUSTOMER MALAM SIMULASI', id: 'SIM-NIGHT', time: '23:00:00', end: '04:00:00', slot: 'Malam 01', duration: '(5 jam)' },
  { name: 'unassigned', customer: 'CUSTOMER BELUM ADA JAM', id: 'SIM-UNTIMED', time: null, end: null, slot: '' },
]) {
  test(`Planning grid ${scenario.name}: click job, inspect duration and open the correct edit form without writes`, async ({ page }) => {
    const order = { id: scenario.id, customer: scenario.customer, phone: '628120000009', date: '2026-10-20',
      time: scenario.time, time_end: scenario.end, team_slot: scenario.slot, status: 'CONFIRMED',
      service: 'Cleaning', units: 1, teknisi: 'Teknisi Simulasi', address: 'Alamat simulasi', updated_at: '2026-10-20T01:00:00Z' };
    const state = await fixture(page, { orders: [order] });
    await page.clock.install({ time: new Date('2026-10-20T03:00:00Z') });
    await page.goto('/'); await enter(page);
    await expect.poll(() => state.profileLists).toBe(1);
    await page.getByRole('button', { name: /Planning Order/ }).click();
    if (scenario.name === 'unassigned') {
      await page.getByText(scenario.customer, { exact: true }).first().click();
    } else {
      await page.locator('[draggable][title]').filter({ hasText: scenario.customer }).click();
    }
    const detail = page.getByRole('region', { name: `Detail jadwal ${scenario.customer}`, exact: true });
    await expect(detail).toBeVisible();
    if (scenario.duration) await expect(detail).toContainText(scenario.duration);
    if (scenario.name === 'overnight') await expect(detail).toContainText('(+1 hari)');
    await detail.getByRole('button', { name: '✏️ Edit Form', exact: true }).click();
    const heading = page.getByText(`✏️ Edit Planning — ${scenario.id}`, { exact: true });
    await expect(heading).toBeVisible();
    await expect(heading).toBeInViewport();
    await expect(page.getByPlaceholder('Ketik nama atau nomor WA...')).toHaveValue(scenario.customer);
    const form = heading.locator('..').locator('..');
    await expect(form.locator('input[type="time"]').nth(0)).toHaveValue(scenario.time?.slice(0, 5) || '09:00');
    await expect(form.locator('input[type="time"]').nth(1)).toHaveValue(scenario.end?.slice(0, 5) || '10:00');
    if (scenario.name === 'overnight') {
      await expect(form.getByLabel('Tanggal selesai', { exact: true })).toHaveValue('next');
      await expect(form.getByLabel('Tanggal selesai', { exact: true })).toContainText('2026-10-21');
    }
    await expect(form.getByRole('button', { name: 'Simpan Perubahan', exact: true })).toBeEnabled();
    await form.getByRole('button', { name: 'Batal Edit', exact: true }).click();
    await expect(heading).toHaveCount(0);
    expect(state.writes.filter(row => ['orders', 'invoices', 'service_reports', 'inventory'].includes(row.table))).toEqual([]);
    expect(state.errors).toEqual([]); expect(state.external).toEqual([]);
  });
}
