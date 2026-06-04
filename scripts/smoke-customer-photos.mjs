// Smoke-test browser: portal customer regular — galeri foto di accordion laporan.
import { chromium } from "playwright";
const TOKEN = process.env.SMOKE_TOKEN;
const BASE = "http://localhost:3000";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n); } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 920 } });
page.on("pageerror", e => { fail++; console.log("  ❌ JS ERROR:", e.message); });
try {
  await page.goto(`${BASE}/${TOKEN}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const body = await page.textContent("body");
  ok("portal load (ada Riwayat Servis)", body.includes("Riwayat Servis"));

  // cari tombol expand laporan+foto
  const btn = page.locator('button:has-text("Foto Servis"), button:has-text("Lihat Laporan")').first();
  ok("tombol 'Lihat Laporan & Foto' ada", await btn.count() > 0);
  if (await btn.count() > 0) {
    await btn.click();
    await page.waitForTimeout(700);
    const after = await page.textContent("body");
    ok("section '📷 Foto Servis' muncul", after.includes("Foto Servis"));
    // cek ada <img> dari r2.dev (foto asli)
    const imgs = await page.locator('img[src*="r2.dev"]').count();
    ok("thumbnail foto R2 ter-render (>0)", imgs > 0);
    console.log("    jumlah <img r2.dev>:", imgs);
    await page.screenshot({ path: "/tmp/smoke-customer-photos.png", fullPage: true });
  }
  console.log(`\n=== HASIL: ${pass} pass, ${fail} fail ===`);
} catch (e) { console.error("FATAL:", e.message); fail++; }
finally { await browser.close(); process.exit(fail ? 1 : 0); }
