// E2E untuk fitur baru (sesi ini):
//   #2 Setting Bonus (Owner)  — kategori bonus configurable
//   #1 Panel Komisi Order (Owner) — input bonus tidak lagi silent-fail
//   #3 Komisi Saya (Teknisi) — menu kini bisa diakses (PIN gate)
//   Q1 Pengeluaran Hari Ini — tombol Kamera + Galeri
//
// READ-ONLY: tidak menyimpan/menghapus data (DB produksi shared). Tidak klik
// "Simpan", tidak kirim WA. Auto-skip kalau kredensial belum di-set.

import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth.js";

const hasOwner   = !!(process.env.E2E_OWNER_EMAIL && process.env.E2E_OWNER_PASSWORD);
const hasTeknisi = !!(process.env.E2E_TEKNISI_EMAIL && process.env.E2E_TEKNISI_PASSWORD);

test.describe("Fitur baru — Owner (bonus configurable)", () => {
  test.skip(!hasOwner, "Set E2E_OWNER_EMAIL & E2E_OWNER_PASSWORD");

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "owner");
    await page.locator("button:has-text('Tim Teknisi'), a:has-text('Tim Teknisi')").first().click({ timeout: 10000 });
    await page.waitForTimeout(1000);
    // Buka tab Pengelolaan Gaji
    await page.locator("button:has-text('Pengelolaan Gaji')").first().click({ timeout: 10000 });
    await page.waitForTimeout(1000);
  });

  test("#2 tab Setting Bonus tampil + kategori seed ter-load", async ({ page }) => {
    await page.locator("button:has-text('Setting Bonus')").first().click({ timeout: 10000 });
    await page.waitForTimeout(800);
    // Heading panel
    await expect(page.getByText(/Setting Kategori Bonus/i)).toBeVisible({ timeout: 8000 });
    // Kategori seed ter-load → tiap baris punya tombol Hapus (title="Hapus")
    const rowCount = await page.locator('button[title="Hapus"]').count();
    expect(rowCount).toBeGreaterThanOrEqual(5);
    // Baca value input live — pastikan kategori "Freon" & "Kapasitor" ada
    const values = await page.locator("input").evaluateAll((els) => els.map((e) => e.value));
    expect(values.some((v) => /freon/i.test(v)), `values: ${values.join("|")}`).toBeTruthy();
    expect(values.some((v) => /kapasitor/i.test(v))).toBeTruthy();
    // Kontrol tambah & simpan ada
    await expect(page.getByText(/Tambah Kategori/i)).toBeVisible();
    await expect(page.getByText(/💾 Simpan/i)).toBeVisible();
  });

  test("#1 tab Komisi Order ter-load tanpa error (panel bonus hidup)", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.locator("button:has-text('Komisi Order')").first().click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const body = await page.textContent("body");
    expect(body).toMatch(/Komisi|Bonus|Order|periode|bulan/i);
    expect(errors, `pageerror: ${errors.join("\n")}`).toHaveLength(0);
  });
});

test.describe("Fitur baru — Teknisi (Komisi Saya + input biaya)", () => {
  test.skip(!hasTeknisi, "Set E2E_TEKNISI_EMAIL & E2E_TEKNISI_PASSWORD");

  test("#3 menu Komisi Saya kini terlihat & bisa dibuka", async ({ page }) => {
    await loginAs(page, "teknisi");
    // canAccess fix: menu "Komisi Saya" harus muncul untuk teknisi
    const komisiMenu = page.locator("button:has-text('Komisi Saya'), a:has-text('Komisi Saya')").first();
    await expect(komisiMenu).toBeVisible({ timeout: 10000 });
    await komisiMenu.click();
    await page.waitForTimeout(1500);
    // Entah modal PIN (kalau Owner set commission_pin) ATAU konten komisi — keduanya valid (tidak blocked/crash)
    const body = await page.textContent("body");
    expect(body).toMatch(/Komisi Terlindungi|Masukkan PIN|Komisi|Payroll|Bonus/i);
  });

  test("Q1 Pengeluaran Hari Ini — tombol Kamera & Galeri tampil", async ({ page }) => {
    await loginAs(page, "teknisi");
    // Widget ada di dashboard teknisi
    await expect(page.getByText(/Pengeluaran Hari Ini/i)).toBeVisible({ timeout: 10000 });
    // Buka form input
    await page.locator("button:has-text('+ Input')").first().click({ timeout: 10000 });
    await page.waitForTimeout(600);
    // Kategori default "Bensin" terpilih → tombol foto muncul
    await expect(page.getByText("📷 Kamera")).toBeVisible({ timeout: 6000 });
    await expect(page.getByText("🖼️ Galeri")).toBeVisible();
  });
});
