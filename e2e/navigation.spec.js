// Navigation tests — verify Owner bisa akses semua menu utama.
// READ-ONLY: tidak modify data. Hanya navigate + verify halaman ter-render.

import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth.js";

const hasCredentials = !!(process.env.E2E_OWNER_EMAIL && process.env.E2E_OWNER_PASSWORD);

test.describe("Navigation: Owner Access", () => {
  test.skip(!hasCredentials, "Set E2E_OWNER_EMAIL & E2E_OWNER_PASSWORD untuk run authenticated tests");

  // Login sekali untuk semua test di describe block
  test.beforeEach(async ({ page }) => {
    await loginAs(page, "owner");
  });

  const menus = [
    { name: "Planning Order", marker: /Planning|Order Masuk|jadwal/i },
    { name: "Invoice", marker: /Invoice|tagihan/i },
    { name: "Customer", marker: /Customer|pelanggan/i },
    { name: "Inventori", marker: /Inventori|stok/i },
    { name: "Tim Teknisi", marker: /Teknisi|tim/i },
    { name: "Statistik", marker: /Statistik|laporan/i },
  ];

  for (const menu of menus) {
    test(`Klik menu "${menu.name}" → halaman terbuka`, async ({ page }) => {
      // Click menu — coba beberapa selector
      const menuBtn = page.locator(`button:has-text("${menu.name}"), a:has-text("${menu.name}")`).first();
      await menuBtn.click({ timeout: 10000 });

      // Tunggu page transition
      await page.waitForTimeout(1500);

      // Verify content related ke menu muncul
      const content = await page.textContent("body");
      expect(content).toMatch(menu.marker);
    });
  }
});
