// Biaya (Expenses) read-only E2E — verify halaman Biaya render + tab navigasi.
// READ-ONLY: tidak create/update/delete data. Auto-skip tanpa kredensial Owner.
// Coverage: tab Petty Cash / Material / Recycle Bin (soft-delete, migration 052).

import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth.js";

const hasCredentials = !!(process.env.E2E_OWNER_EMAIL && process.env.E2E_OWNER_PASSWORD);

test.describe("Biaya: read-only", () => {
  test.skip(!hasCredentials, "Set E2E_OWNER_EMAIL & E2E_OWNER_PASSWORD untuk run authenticated tests");

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "owner");
    // Buka menu Biaya
    const menuBtn = page.locator("button:has-text('Biaya'), a:has-text('Biaya')").first();
    await menuBtn.click({ timeout: 10000 });
    await page.waitForTimeout(1200);
  });

  test("halaman Biaya terbuka dengan summary total", async ({ page }) => {
    const content = await page.textContent("body");
    expect(content).toMatch(/Biaya|Petty Cash|transaksi/i);
    // Summary bar selalu menampilkan "Total: Rp ..."
    expect(content).toMatch(/Total:\s*Rp/i);
  });

  test("tab Petty Cash & Pembelian Material bisa di-switch", async ({ page }) => {
    const materialTab = page.locator("button:has-text('Pembelian Material')").first();
    await materialTab.click({ timeout: 10000 });
    await page.waitForTimeout(800);
    expect(await page.textContent("body")).toMatch(/Material|transaksi/i);

    const pettyTab = page.locator("button:has-text('Petty Cash')").first();
    await pettyTab.click({ timeout: 10000 });
    await page.waitForTimeout(800);
    expect(await page.textContent("body")).toMatch(/Petty Cash|transaksi/i);
  });

  test("Owner melihat tab Recycle Bin (Dihapus) — soft delete", async ({ page }) => {
    const trashTab = page.locator("button:has-text('Dihapus')").first();
    await expect(trashTab).toBeVisible({ timeout: 10000 });
    await trashTab.click();
    await page.waitForTimeout(1000);
    // Recycle bin: tampilkan data dihapus atau pesan kosong
    expect(await page.textContent("body")).toMatch(/Recycle Bin|Dihapus|kosong/i);
  });
});
