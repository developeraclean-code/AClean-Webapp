import { test, expect } from "@playwright/test";
import { build } from "esbuild";

let bundle;
test.beforeAll(async () => {
  const result = await build({ entryPoints: ["e2e/fixtures/payroll-rate.jsx"], bundle: true, write: false, outdir: "/tmp/aclean-payroll-rate", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' } });
  bundle = result.outputFiles.find(file => file.path.endsWith(".js")).text;
});
test.beforeEach(async ({ page }) => {
  await page.route("https://payroll-rate.test/**", route => route.fulfill({ contentType: route.request().url().endsWith(".js") ? "application/javascript" : "text/html", body: route.request().url().endsWith(".js") ? bundle : '<!doctype html><html><body style="background:#0e1b2a;color:white"><div id="root"></div><script src="/bundle.js"></script></body></html>' }));
  await page.goto("https://payroll-rate.test/");
});

test("gaji baru dan adjustment lama tersimpan sampai panel dibuka ulang; slip terbuka ikut berubah", async ({ page }) => {
  await page.getByLabel("Gaji harian Karyawan Baru").fill("125000");
  await page.getByRole("button", { name: "✓ Simpan" }).first().click();
  await expect(page.getByText("Tersimpan: Rp 125.000/hari")).toBeVisible();
  await page.getByLabel("Gaji harian Karyawan Lama").fill("175000");
  await page.getByRole("button", { name: "✓ Simpan" }).click();
  await expect(page.getByText("Tersimpan: Rp 175.000/hari")).toBeVisible();
  expect(await page.evaluate(() => window.payrollTest.profileRates)).toEqual({ new: 125000, old: 175000 });
  expect(await page.evaluate(() => window.payrollTest.payrollRows[0].daily_rate)).toBe(175000);
  await page.getByRole("button", { name: "Buka ulang payroll" }).click();
  await expect(page.getByLabel("Gaji harian Karyawan Baru")).toHaveValue("125000");
  await expect(page.getByLabel("Gaji harian Karyawan Lama")).toHaveValue("175000");
});

test("update nol baris tidak tampil seolah tersimpan dan nominal draf tetap ada", async ({ page }) => {
  await page.evaluate(() => { window.payrollTest.failProfile = true; });
  await page.getByLabel("Gaji harian Karyawan Baru").fill("125000");
  await page.getByRole("button", { name: "✓ Simpan" }).click();
  await expect(page.getByRole("alert")).toContainText("Data karyawan tidak ditemukan atau akses simpan ditolak");
  await expect(page.getByLabel("Gaji harian Karyawan Baru")).toHaveValue("125000");
  expect(await page.evaluate(() => window.payrollTest.profileRates.new)).toBe(0);
  await page.evaluate(() => { window.payrollTest.failProfile = false; });
  await page.getByRole("button", { name: "✓ Simpan" }).click();
  await expect(page.getByText("Tersimpan: Rp 125.000/hari")).toBeVisible();
});

test("gaji tersimpan tetapi kegagalan sinkron slip terlihat; Finance tidak dapat mengedit", async ({ page }) => {
  await page.evaluate(() => { window.payrollTest.failPayroll = true; });
  await page.getByLabel("Gaji harian Karyawan Lama").fill("180000");
  await page.getByRole("button", { name: "✓ Simpan" }).click();
  await expect(page.getByRole("alert")).toContainText("slip minggu ini belum tersinkron");
  expect(await page.evaluate(() => window.payrollTest.profileRates.old)).toBe(180000);
  expect(await page.evaluate(() => window.payrollTest.payrollRows[0].daily_rate)).toBe(150000);
  await page.getByRole("button", { name: "Masuk sebagai Finance" }).click();
  await expect(page.getByLabel("Gaji harian Karyawan Lama")).toBeDisabled();
});

test("reset gaji tidak mengaku berhasil bila ditolak dan memperbarui slip saat berhasil", async ({ page }) => {
  await page.evaluate(() => { window.payrollTest.failProfile = true; });
  await page.locator('button[title="Reset ke 0"]').click();
  await expect(page.getByRole("alert")).toContainText("Data karyawan tidak ditemukan atau akses simpan ditolak");
  expect(await page.evaluate(() => window.payrollTest.profileRates.old)).toBe(150000);
  await page.evaluate(() => { window.payrollTest.failProfile = false; });
  await page.locator('button[title="Reset ke 0"]').click();
  await expect(page.getByLabel("Gaji harian Karyawan Lama")).toHaveValue("0");
  expect(await page.evaluate(() => window.payrollTest.payrollRows[0].daily_rate)).toBe(0);
});
