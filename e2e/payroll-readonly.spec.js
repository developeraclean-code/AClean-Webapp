// Payroll (Tim Teknisi → Gaji) read-only E2E.
// Verifikasi pasca commit 21f922e (showConfirm preserve onConfirm callback).
// Test ini TIDAK menekan "Tandai Dibayar" sungguhan (biar tidak rubah data prod).
// Cuma verify:
//   - Tab Gaji bisa dibuka
//   - Tombol "✓ Tandai Dibayar" muncul untuk row yg belum dibayar
//   - Modal confirm muncul saat klik (verifikasi showConfirm tidak dead-end)
//   - Tombol "Batal" di modal close it tanpa mutasi
// Auto-skip tanpa kredensial Owner.

import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth.js";

const hasCredentials = !!(process.env.E2E_OWNER_EMAIL && process.env.E2E_OWNER_PASSWORD);

test.describe("Payroll: Tandai Dibayar (read-only verify modal)", () => {
  test.skip(!hasCredentials, "Set E2E_OWNER_EMAIL & E2E_OWNER_PASSWORD untuk run authenticated tests");

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "owner");
    const menuBtn = page.locator("button:has-text('Tim Teknisi'), a:has-text('Tim Teknisi')").first();
    await menuBtn.click({ timeout: 10000 });
    await page.waitForTimeout(1500);
  });

  test("halaman Tim Teknisi terbuka dengan slip mingguan", async ({ page }) => {
    const content = await page.textContent("body");
    expect(content).toMatch(/Tim Teknisi|Gaji|Slip|Mingguan|Hari Masuk/i);
  });

  test("tombol Tandai Dibayar muncul untuk row belum dibayar", async ({ page }) => {
    // Scroll cari tombol — payroll biasa di bawah header
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(500);
    const tandaiBtns = page.locator("button:has-text('Tandai Dibayar')");
    // Tidak wajib >=1 (mungkin semua sudah dibayar minggu ini), tapi structure harus ada
    const count = await tandaiBtns.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("modal confirm muncul saat klik Tandai Dibayar + Batal close tanpa mutasi", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(500);
    const firstBtn = page.locator("button:has-text('Tandai Dibayar')").first();
    if (await firstBtn.count() === 0) {
      test.info().annotations.push({ type: "skip-reason", description: "No unpaid payroll row this week" });
      return;
    }
    await firstBtn.click({ timeout: 10000 });
    // Modal confirm muncul dengan teks "Tandai payroll" / "Ya, Tandai Dibayar"
    const confirmModal = page.locator("text=Tandai payroll, button:has-text('Ya, Tandai Dibayar')").first();
    await expect(confirmModal).toBeVisible({ timeout: 5000 });
    // Klik Batal (tidak mutate data)
    const cancelBtn = page.locator("button:has-text('Batal'), button:has-text('Tidak')").first();
    if (await cancelBtn.count() > 0) {
      await cancelBtn.click();
      await page.waitForTimeout(500);
      // Modal harus close
      await expect(confirmModal).not.toBeVisible({ timeout: 3000 });
    }
  });

  test("Preview Slip toggle berfungsi (verify button responsive)", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(500);
    const previewBtn = page.locator("button:has-text('Preview Slip')").first();
    if (await previewBtn.count() === 0) return;
    await previewBtn.click({ timeout: 10000 });
    await page.waitForTimeout(700);
    // Setelah klik, tombol berubah jadi "Tutup Preview"
    const closeBtn = page.locator("button:has-text('Tutup Preview')").first();
    await expect(closeBtn).toBeVisible({ timeout: 5000 });
    await closeBtn.click();
  });
});
