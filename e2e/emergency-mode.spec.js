import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

test("mode darurat tetap dapat dipakai saat seluruh request Supabase gagal", async ({ page }) => {
  await page.route("**/*.supabase.co/**", route => route.abort());
  await page.goto("/");
  await page.evaluate(async () => {
    const vault = await import("/src/lib/emergencyVault.js");
    const passphrase = "frasa-sandi-darurat-uji-2026";
    await vault.prepareEmergencyVault({ owner: { id: "owner-test", name: "Owner Test", role: "Owner" }, passphrase });
    await vault.activatePreparedEmergencyVault(passphrase, "Simulasi Supabase mati");
  });
  await page.reload();

  await expect(page.getByRole("heading", { name: /Mode Darurat AClean/ })).toBeVisible();
  await expect(page.getByText("Masuk ke Panel")).toHaveCount(0);
  await page.getByLabel("Frasa sandi perangkat").fill("frasa-sandi-darurat-uji-2026");
  await page.getByRole("button", { name: "Buka catatan" }).click();
  await page.getByLabel("Nama customer *").fill("Customer Uji");
  await page.getByLabel("Tanggal kerja *").fill("2026-10-04");
  await page.getByLabel("Layanan *").fill("Cleaning");
  await page.getByLabel("Tim/teknisi *").fill("Team A");
  await page.getByRole("button", { name: "Simpan catatan lokal" }).click();
  await expect(page.getByText(/1 catatan · 1 perlu rekonsiliasi/)).toBeVisible();
  await page.reload();
  await page.getByLabel("Frasa sandi perangkat").fill("frasa-sandi-darurat-uji-2026");
  await page.getByRole("button", { name: "Buka catatan" }).click();
  await expect(page.getByText("Customer Uji")).toBeVisible();
});

test("aktivasi Owner langsung membuka formulir tanpa frasa sandi kedua", async ({ page }) => {
  await page.route("**/*.supabase.co/**", route => route.abort());
  await page.goto("/");
  await page.evaluate(async () => {
    const vault = await import("/src/lib/emergencyVault.js");
    await vault.prepareEmergencyVault({ owner: { id: "owner-test", name: "Owner Test", role: "Owner" }, passphrase: "frasa-sandi-darurat-uji-2026" });
  });
  await page.reload();
  await page.getByRole("button", { name: /Aktifkan perangkat darurat/ }).click();
  await page.getByLabel("Frasa sandi perangkat").fill("frasa-sandi-darurat-uji-2026");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Aktifkan mode darurat" }).click();
  await expect(page.getByRole("heading", { name: "Catat pekerjaan saat offline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Buka catatan" })).toHaveCount(0);
});

test("Owner dan teknisi bertukar laporan foto tanpa Supabase, retry tidak duplikat", async ({ page, browser }) => {
  await page.route("**/*.supabase.co/**", route => route.abort());
  await page.goto("/");
  await page.evaluate(async () => {
    const vault = await import("/src/lib/emergencyVault.js");
    const phrase = "frasa-sandi-darurat-uji-2026";
    await vault.prepareEmergencyVault({ owner: { id: "owner-test", name: "Owner Test", role: "Owner" }, passphrase: phrase });
    await vault.activatePreparedEmergencyVault(phrase, "Simulasi Supabase mati");
  });
  await page.reload();
  await page.getByLabel("Frasa sandi perangkat").fill("frasa-sandi-darurat-uji-2026");
  await page.getByRole("button", { name: "Buka catatan" }).click();
  await page.getByLabel("Nama customer *").fill("Belfood");
  await page.getByLabel("Tanggal kerja *").fill("2026-10-04");
  await page.getByLabel("Layanan *").fill("Cleaning");
  await page.getByLabel("Tim/teknisi *").fill("Team A+B");
  await page.getByRole("button", { name: "Simpan catatan lokal" }).click();
  await expect(page.getByText(/1 catatan · 1 perlu rekonsiliasi/)).toBeVisible();
  const assignmentDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Unduh paket tugas teknisi" }).click();
  const assignment = readFileSync(await (await assignmentDownload).path());

  const techContext = await browser.newContext();
  const tech = await techContext.newPage();
  await tech.route("**/*.supabase.co/**", route => route.abort());
  await tech.goto("/field-emergency");
  await tech.getByLabel("Paket tugas darurat").setInputFiles({ name: "tugas.json", mimeType: "application/json", buffer: assignment });
  await tech.getByLabel("Nama teknisi *").fill("Rey");
  await tech.getByLabel("Jumlah unit aktual *").fill("17");
  await tech.getByLabel("Pekerjaan aktual *").fill("Cleaning aktual 17 unit");
  await tech.getByLabel("Foto pekerjaan").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y7Y0yAAAAAASUVORK5CYII=", "base64") });
  await expect(tech.getByText("Foto pekerjaan (1/8)")).toBeVisible();
  await tech.reload();
  await tech.getByLabel("Paket tugas darurat").setInputFiles({ name: "tugas.json", mimeType: "application/json", buffer: assignment });
  await expect(tech.getByLabel("Nama teknisi *")).toHaveValue("Rey");
  await expect(tech.getByText("Foto pekerjaan (1/8)")).toBeVisible();
  const reportDownload = tech.waitForEvent("download");
  await tech.getByRole("button", { name: "Unduh paket laporan terenkripsi" }).click();
  const report = readFileSync(await (await reportDownload).path());
  expect(report.toString()).not.toContain("Cleaning aktual 17 unit");

  await page.getByLabel("Impor laporan teknisi").setInputFiles({ name: "laporan.json", mimeType: "application/json", buffer: report });
  await expect(page.getByText("Cleaning aktual 17 unit")).toBeVisible();
  await expect(page.getByAltText("foto.png")).toBeVisible();
  await page.getByRole("button", { name: "Terima laporan ke antrean" }).click();
  await expect(page.getByText(/2 catatan · 2 perlu rekonsiliasi/)).toBeVisible();
  await page.getByLabel("Impor laporan teknisi").setInputFiles({ name: "laporan.json", mimeType: "application/json", buffer: report });
  await expect(page.getByText("Paket ini sudah pernah diimpor; tidak akan dicatat ulang.")).toBeVisible();
  await expect(page.getByText(/2 catatan · 2 perlu rekonsiliasi/)).toBeVisible();
  await techContext.close();
});
