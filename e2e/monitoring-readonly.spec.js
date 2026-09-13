// Monitoring smoke test — hanya membaca data live melalui proxy API dev.
import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth.js";

const hasCredentials = !!(process.env.E2E_OWNER_EMAIL && process.env.E2E_OWNER_PASSWORD);

test.describe("Monitoring: read-only", () => {
  test.skip(!hasCredentials, "Butuh kredensial E2E Owner");

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "owner");
    await page.locator("button:has-text('Monitoring'), a:has-text('Monitoring')").first().click({ timeout: 10000 });
  });

  test("overview menampilkan health dan tidak berhenti di loading", async ({ page }) => {
    await expect(page.getByText("Mission Control")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("body")).toContainText(/Healthy|Degraded|Unhealthy|Monitoring gagal/i, { timeout: 15000 });
    await expect(page.getByText("Logs Checked")).toBeVisible();
  });

  test("tab Cron, AI Cost, dan Audit dapat dibuka", async ({ page }) => {
    await page.getByRole("button", { name: /Cron Jobs/ }).click();
    await expect(page.getByText(/Cron Runs/)).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /AI Cost/ }).click();
    await expect(page.getByText(/AI Cost Tracking/)).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: /Audit Log/ }).click();
    await expect(page.getByRole("combobox").first()).toHaveValue("", { timeout: 10000 });
  });
});
