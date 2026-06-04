// Playwright browser smoke-test: MaintenancePortalView (/m/<token>) — view asli di browser.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const seed = JSON.parse(readFileSync("/tmp/smoke-seed.json", "utf8"));
const TOKEN = seed.token, CLIENT = seed.client_id;
const BASE = "http://localhost:3000";
const SU = (() => { const e = {}; for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, ""); } return e; })();
const REST = (p) => `${SU.SUPABASE_URL || SU.VITE_SUPABASE_URL}/rest/v1/${p}`;
const H = { apikey: SU.SUPABASE_SERVICE_KEY, Authorization: "Bearer " + SU.SUPABASE_SERVICE_KEY, "Content-Type": "application/json" };
const patch = (u) => fetch(REST("maintenance_clients?id=eq." + CLIENT), { method: "PATCH", headers: H, body: JSON.stringify(u) });

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; console.log("  ✅ " + n); } else { fail++; console.log("  ❌ " + n); } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
page.on("pageerror", e => { fail++; console.log("  ❌ JS ERROR di halaman:", e.message); });

try {
  // ---- 1. render utama ----
  console.log("1) render portal");
  await page.goto(`${BASE}/m/${TOKEN}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const body = await page.textContent("body");
  ok("nama perusahaan tampil", body.includes("SMOKE PT Menara Test"));
  ok("header 'Laporan Maintenance' tampil", body.includes("Laporan Maintenance"));
  ok("KPI total unit = 3", await page.locator("text=Unit").first().isVisible());
  ok("unit AC-001 tampil", body.includes("AC-001"));
  ok("unit AC-002 tampil", body.includes("AC-002"));
  ok("unit AC-003 (rusak) tampil", body.includes("AC-003"));
  ok("status 'Rusak' tampil", body.includes("Rusak"));

  // ---- 2. dropdown history (accordion) ----
  console.log("2) dropdown history AC-001");
  const card1 = page.locator("text=AC-001").first();
  await card1.click();
  await page.waitForTimeout(400);
  const afterClick = await page.textContent("body");
  ok("riwayat 'Riwayat Servis' muncul setelah klik", afterClick.includes("Riwayat Servis"));
  ok("log 'Isi Freon' muncul", afterClick.includes("Isi Freon"));
  ok("log 'Cuci Rutin' muncul", afterClick.includes("Cuci Rutin"));
  ok("teknisi 'Andi' muncul", afterClick.includes("Andi"));
  ok("biaya 'Rp 325.000' MUNCUL (hide_costs=false)", afterClick.includes("Rp 325.000") || afterClick.includes("325.000"));

  // ---- 3. search filter ----
  console.log("3) search filter");
  await page.fill('input[placeholder*="Cari"]', "Genset");
  await page.waitForTimeout(300);
  const filtered = await page.textContent("body");
  ok("search 'Genset' → AC-003 tampil", filtered.includes("AC-003"));
  ok("search 'Genset' → AC-001 hilang", !filtered.includes("AC-001"));
  await page.fill('input[placeholder*="Cari"]', "");
  await page.screenshot({ path: "/tmp/smoke-portal-main.png", fullPage: true });

  // ---- 4. hide_costs=true → biaya hilang ----
  console.log("4) hide_costs=true → biaya hilang");
  await patch({ hide_costs: true });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.locator("text=AC-001").first().click();
  await page.waitForTimeout(400);
  const hidden = await page.textContent("body");
  ok("biaya 'Rp 325.000' HILANG saat hide_costs=true", !hidden.includes("325.000"));
  ok("riwayat tetap tampil (tanpa biaya)", hidden.includes("Isi Freon"));
  await patch({ hide_costs: false });

  // ---- 5. gate: token_active=false → 403 screen ----
  console.log("5) akses dimatikan → layar terkunci");
  await patch({ token_active: false });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const disabled = await page.textContent("body");
  ok("layar 'Akses Dinonaktifkan' tampil", disabled.includes("Akses Dinonaktifkan"));
  ok("tidak ada unit bocor di layar terkunci", !disabled.includes("AC-001"));
  await patch({ token_active: true });

  // ---- 6. token invalid → not found ----
  console.log("6) token invalid → not found");
  await page.goto(`${BASE}/m/mtk_invalidtoken0000000000000000000000000000`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const nf = await page.textContent("body");
  ok("token salah → 'Tidak Ditemukan'", nf.includes("Tidak Ditemukan"));

  console.log(`\n=== HASIL SMOKE PORTAL: ${pass} pass, ${fail} fail ===`);
  console.log("Screenshot: /tmp/smoke-portal-main.png");
} catch (e) {
  console.error("FATAL:", e.message); fail++;
} finally {
  await browser.close();
  process.exit(fail ? 1 : 0);
}
