import { test, expect } from "@playwright/test";
import { loginAs } from "./fixtures/auth.js";

const hasTeknisi = Boolean(process.env.E2E_TEKNISI_EMAIL && process.env.E2E_TEKNISI_PASSWORD);

test.describe("Alur lapangan cepat — read only", () => {
  test.skip(!hasTeknisi, "Set E2E_TEKNISI_EMAIL & E2E_TEKNISI_PASSWORD");

  test("dashboard teknisi dan draft laporan tidak memicu page error", async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await loginAs(page, "teknisi");
    await expect(page.locator("body")).toContainText(/Selamat datang|Dashboard/i, { timeout: 15000 });

    const reportButton = page.getByRole("button", { name: /Laporan & Material|Isi Laporan Pekerjaan|Isi laporan tertua/i }).first();
    if (await reportButton.count()) {
      await reportButton.click();
      const modal = page.getByText("Laporan Servis", { exact: true });
      if (await modal.count()) {
        await expect(modal).toBeVisible();
        await expect(page.getByText(/Draft (tersimpan otomatis|dipulihkan)|Menyimpan draft/i)).toBeVisible();
        const quick = page.getByRole("button", { name: /Mode Cepat/i });
        if (await quick.count()) await expect(quick).toBeVisible();
      }
    }

    expect(errors, `pageerror: ${errors.join("\n")}`).toEqual([]);
  });
});
