import { chromium } from "playwright";
const TOKEN = process.env.SMOKE_TOKEN, BASE = "http://localhost:3000";
let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n); } };
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 430, height: 920 } });
try {
  await page.goto(`${BASE}/${TOKEN}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const btn = page.locator('button:has-text("Foto Servis"), button:has-text("Lihat Laporan")').first();
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(800); }
  // src pakai proxy /api/foto
  const proxied = await page.locator('img[src*="/api/foto?key="]').count();
  ok("img pakai proxy /api/foto?key= (>0)", proxied > 0);
  // tidak ada <a> pembungkus foto (read-only)
  const anchors = await page.locator('a:has(img[src*="/api/foto"])').count();
  ok("foto TIDAK dibungkus <a> (read-only)", anchors === 0);
  // gambar benar2 ter-load (naturalWidth>0)
  await page.waitForTimeout(1500);
  const loaded = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll('img[src*="/api/foto?key="]')];
    return { total: imgs.length, ok: imgs.filter(i => i.naturalWidth > 0).length };
  });
  ok(`thumbnail benar-benar ter-render (${loaded.ok}/${loaded.total} naturalWidth>0)`, loaded.ok > 0);
  // pointer-events none
  const noClick = await page.evaluate(() => {
    const i = document.querySelector('img[src*="/api/foto?key="]');
    return i ? getComputedStyle(i).pointerEvents === "none" : false;
  });
  ok("img pointer-events:none (tak bisa diklik)", noClick);
  await page.screenshot({ path: "/tmp/smoke-foto-readonly.png", fullPage: true });
  console.log(`\n=== ${pass} pass, ${fail} fail ===`);
} catch (e) { console.error("FATAL:", e.message); fail++; }
finally { await b.close(); process.exit(fail ? 1 : 0); }
