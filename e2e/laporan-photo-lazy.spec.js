// READ-ONLY: foto pada kartu Laporan Tim tidak dibuat/diminta sebelum dropdown dibuka.
import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth.js";

const hasCredentials = !!(process.env.E2E_OWNER_EMAIL && process.env.E2E_OWNER_PASSWORD);

test.describe("Laporan Tim photo lazy loading", () => {
  test.skip(!hasCredentials, "Butuh kredensial E2E Owner");

  test("galeri foto baru dirender ketika dibuka dan hanya satu galeri aktif", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));

    await loginAs(page, "owner");
    await page.getByRole("button", { name: /Laporan Tim$/ }).click();

    const toggles = page.getByTestId("report-photo-toggle");
    await expect(toggles.first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("report-photo-grid")).toHaveCount(0);

    await toggles.first().click();
    const firstGrid = page.getByTestId("report-photo-grid");
    await expect(firstGrid).toBeVisible();
    expect(await firstGrid.locator("img").count()).toBeGreaterThan(0);

    if (await toggles.count() > 1) {
      await toggles.nth(1).click();
      await expect(page.getByTestId("report-photo-grid")).toHaveCount(1);
      await expect(toggles.first()).toHaveAttribute("aria-expanded", "false");
      await expect(toggles.nth(1)).toHaveAttribute("aria-expanded", "true");
    }

    expect(pageErrors).toEqual([]);
  });
});
