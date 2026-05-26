// Login flow tests — verify auth jalan dengan benar.
// Butuh env: E2E_OWNER_EMAIL, E2E_OWNER_PASSWORD
// Set di .env.test (tidak di-commit, lihat .gitignore)

import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth.js";

const hasCredentials = !!(process.env.E2E_OWNER_EMAIL && process.env.E2E_OWNER_PASSWORD);

test.describe("Auth Flow", () => {
  test.skip(!hasCredentials, "Set E2E_OWNER_EMAIL & E2E_OWNER_PASSWORD untuk run authenticated tests");

  test("Owner login berhasil → redirect ke Dashboard", async ({ page }) => {
    await loginAs(page, "owner");

    // Verify dashboard loaded
    await expect(page.getByText("Dashboard").first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Selamat (pagi|siang|sore|malam)/i).first()).toBeVisible();
  });

  test("Login dengan password salah → tetap di login page", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', process.env.E2E_OWNER_EMAIL);
    await page.fill('input[type="password"]', "wrong_password_xxx");
    await page.click('button:has-text("Masuk")');

    // Beri waktu untuk error muncul
    await page.waitForTimeout(2000);

    // Masih di login page — input email masih visible (artinya belum redirect)
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});
