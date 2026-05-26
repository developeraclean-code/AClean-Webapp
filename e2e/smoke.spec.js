// Smoke tests — verify app boots & login page renders.
// Tidak butuh credentials, aman dijalankan kapan saja.

import { test, expect } from "@playwright/test";

test.describe("Smoke: App Boot", () => {
  test("app loads tanpa error console critical", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Filter false-positive errors yg sudah dikenal (SES, supabase token refresh saat fresh load)
    const critical = errors.filter((msg) =>
      !msg.includes("SES_") &&
      !msg.includes("intrinsic") &&
      !msg.includes("Refresh Token") &&
      !msg.includes("LLM Config")
    );

    expect(critical, `Critical errors: ${critical.join("\n")}`).toHaveLength(0);
  });

  test("login form muncul dengan email & password fields", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Masuk ke Panel|AClean/i).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Masuk")')).toBeVisible();
  });

  test("title halaman = AClean", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/AClean/i);
  });

  test("submit login kosong → validation atau error", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('input[type="email"]');

    // Click tanpa isi → form harus tetap di login page (tidak redirect)
    await page.click('button:has-text("Masuk")');
    await page.waitForTimeout(1000); // beri kesempatan validation muncul

    // Masih di login page (input email masih visible)
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});
