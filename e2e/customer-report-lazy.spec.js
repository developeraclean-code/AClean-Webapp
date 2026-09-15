// READ-ONLY: memastikan detail Service Report Customer benar-benar load-on-demand.
import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth.js";

const hasCredentials = !!(process.env.E2E_OWNER_EMAIL && process.env.E2E_OWNER_PASSWORD);

test.describe("Customer Service Report lazy loading", () => {
  test.skip(!hasCredentials, "Butuh kredensial E2E Owner");

  test("query detail baru berjalan setelah dropdown dibuka", async ({ page }) => {
    const detailRequests = [];
    const detailResponses = [];
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("request", request => {
      const url = new URL(request.url());
      if (url.pathname.endsWith("/service_reports") && url.searchParams.has("job_id")) {
        detailRequests.push(url.toString());
      }
    });
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.pathname.endsWith("/service_reports") && url.searchParams.has("job_id")) {
        detailResponses.push(response.status());
      }
    });

    await loginAs(page, "owner");
    await page.getByRole("button", { name: /Customer$/ }).click();
    await expect(page.getByText(/^Customers /).first()).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "Riwayat", exact: true }).first().click();

    const dropdown = page.getByRole("button", { name: "▼ Lihat Service Report" }).first();
    await expect(dropdown).toBeVisible({ timeout: 15000 });
    expect(detailRequests).toHaveLength(0);

    await dropdown.click();
    await expect.poll(() => detailRequests.length, { timeout: 10000 }).toBe(1);
    await expect(page.getByText(/Service Report|Belum ada Service Report/).last()).toBeVisible({ timeout: 10000 });
    await expect.poll(() => detailResponses.length, { timeout: 10000 }).toBe(1);
    expect(detailResponses[0]).toBeLessThan(400);
    await expect(page.getByRole("alert")).toHaveCount(0);

    await page.getByRole("button", { name: "▲ Tutup Service Report" }).first().click();
    await page.getByRole("button", { name: "▼ Lihat Service Report" }).first().click();
    await page.waitForTimeout(300);
    expect(detailRequests).toHaveLength(1);
    expect(pageErrors).toEqual([]);
  });
});
