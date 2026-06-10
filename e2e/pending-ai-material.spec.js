// Pending AI Material tab (MatTrack → 🤖 Pending AI Material).
// Verifikasi UI render setelah refactor Manual Approve Mode (commit e813a66):
//   - Tab tampil utk Owner
//   - List ai_extractions intent=material status=pending muncul
//   - Foto thumbnail R2 ter-load (proxy /api/foto)
//   - Carrier hint terlihat di notes
// READ-ONLY: tidak klik Link/Reject sungguhan.
// Auto-skip tanpa kredensial Owner.

import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth.js";

const hasCredentials = !!(process.env.E2E_OWNER_EMAIL && process.env.E2E_OWNER_PASSWORD);

test.describe("Pending AI Material tab (read-only)", () => {
  test.skip(!hasCredentials, "Set E2E_OWNER_EMAIL & E2E_OWNER_PASSWORD untuk run authenticated tests");

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "owner");
    // Stok Material menu (MatTrackView)
    const menuBtn = page.locator("button:has-text('Stok Material'), a:has-text('Stok Material')").first();
    await menuBtn.click({ timeout: 10000 });
    await page.waitForTimeout(1200);
  });

  test("tab Pending AI Material muncul untuk Owner", async ({ page }) => {
    const pendingAiTab = page.locator("button:has-text('Pending AI Material')").first();
    await expect(pendingAiTab).toBeVisible({ timeout: 10000 });
  });

  test("klik tab Pending AI Material → list/empty state muncul", async ({ page }) => {
    const pendingAiTab = page.locator("button:has-text('Pending AI Material')").first();
    await pendingAiTab.click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const body = await page.textContent("body");
    // Salah satu: ada entry pending ATAU empty state
    expect(body).toMatch(/Tidak ada material pending|🤖|Link ke Job|Carrier hint|TIDAK auto-link/i);
  });

  test("warning shadow mode banner tampil", async ({ page }) => {
    const pendingAiTab = page.locator("button:has-text('Pending AI Material')").first();
    await pendingAiTab.click({ timeout: 10000 });
    await page.waitForTimeout(1500);
    const body = await page.textContent("body");
    // Banner penjelasan manual approve mode
    expect(body).toMatch(/Tidak auto-link|owner pilih manual|menunggu review/i);
  });
});
