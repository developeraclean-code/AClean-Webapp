import { test, expect } from "@playwright/test";
import { build } from "esbuild";

let js, css;
test.beforeAll(async () => {
  const result = await build({ entryPoints: ["e2e/fixtures/wa-workspace.jsx"], bundle: true, write: false, outdir: "/tmp/wa-workspace-test", jsx: "automatic", define: { "process.env.NODE_ENV": '"test"' } });
  js = result.outputFiles.find(f => f.path.endsWith(".js")).text;
  css = result.outputFiles.find(f => f.path.endsWith(".css")).text;
});
test.beforeEach(async ({ page }) => {
  await page.route("https://wa-workspace.test/**", route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ contentType: path.endsWith(".js") ? "application/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
      body: path.endsWith(".js") ? js : path.endsWith(".css") ? css : '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/bundle.css"><style>body{font-family:Arial,sans-serif;background:#0a0f1e;color:white}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("https://wa-workspace.test/");
});
const chooseAndi = page => page.locator('.wa-conversation[data-phone="6281234567890"]').click();
const chooseMaya = page => page.locator('.wa-conversation[data-phone="6281234567891"]').click();

test("desktop keeps inbox alongside chat and scopes orders, invoices, and reorder to a location", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await chooseAndi(page);
  await expect(page.getByText("Iya kak, 3 unit.", { exact: false })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Daftar percakapan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Jadwalkan", exact: true })).toBeDisabled();
  await page.getByLabel("Lokasi pelanggan").selectOption("a");
  await expect(page.getByText("INV-RUMAH", { exact: true })).toBeVisible();
  await expect(page.getByText("INV-KANTOR", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Ingatkan pembayaran", exact: true }).click();
  await expect(page.getByLabel("Pesan WhatsApp")).toHaveValue(/300.000/);
  expect(await page.evaluate(() => window.waTest.calls.filter(c => c.type === "send"))).toHaveLength(0);
  await page.getByRole("button", { name: "↻ Reorder", exact: true }).click();
  expect(await page.evaluate(() => window.waTest.calls.find(c => c.type === "order").draft)).toMatchObject({ customer: "Bapak Andi Rumah", units: 3, date: "", teknisi: "" });
  await page.screenshot({ path: "/tmp/aclean-whatsapp-desktop.png" });
  expect(errors).toEqual([]);
});

test("late history responses and draft text never leak into another chat", async ({ page }) => {
  await page.evaluate(() => { window.waTest.delays["6281234567890"] = 500; });
  await chooseAndi(page);
  await page.getByLabel("Pesan WhatsApp").fill("Draf untuk Andi");
  await chooseMaya(page);
  await expect(page.getByText("Pesan khusus Maya", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Pesan WhatsApp")).toHaveValue("");
  await page.waitForTimeout(600);
  await expect(page.getByText("Iya kak, 3 unit.", { exact: false })).toHaveCount(0);
  await page.getByLabel("Pesan WhatsApp").fill("Draf untuk Maya");
  await chooseAndi(page);
  await expect(page.getByLabel("Pesan WhatsApp")).toHaveValue("Draf untuk Andi");
});

test("failed sends keep drafts; successful sends stay with their original recipient", async ({ page }) => {
  await chooseAndi(page);
  await page.getByLabel("Pesan WhatsApp").fill("Pesan uji kirim");
  await page.evaluate(() => { window.waTest.sendResult = false; });
  await page.getByRole("button", { name: "Kirim ↗", exact: true }).click();
  await expect(page.getByLabel("Pesan WhatsApp")).toHaveValue("Pesan uji kirim");
  await expect(page.getByRole("button", { name: "Kirim ↗", exact: true })).toBeEnabled();
  await page.evaluate(() => { window.waTest.sendResult = true; window.waTest.sendDelay = 500; });
  await page.getByRole("button", { name: "Kirim ↗", exact: true }).click();
  await chooseMaya(page);
  await expect(page.getByText("Pesan khusus Maya", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Pesan WhatsApp")).toBeEnabled();
  await expect(page.locator(".wa-message-content").filter({ hasText: "Pesan uji kirim" })).toHaveCount(0);
  await chooseAndi(page);
  await expect(page.getByLabel("Pesan WhatsApp")).toHaveValue("");
  await expect(page.locator(".wa-message-content").filter({ hasText: "Pesan uji kirim" })).toHaveCount(1);
  expect(await page.evaluate(() => window.waTest.calls.filter(c => c.type === "send").map(c => c.phone))).toEqual(["6281234567890", "6281234567890"]);
});

test("history errors are visible and retry recovers", async ({ page }) => {
  await page.evaluate(() => { window.waTest.historyError = true; });
  await chooseMaya(page);
  await expect(page.getByRole("alert")).toContainText("Riwayat gagal dimuat");
  await page.evaluate(() => { window.waTest.historyError = false; });
  await page.getByRole("button", { name: "Coba lagi" }).click();
  await expect(page.getByText("Pesan khusus Maya", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("mobile has working back navigation and an interactive customer drawer without overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await chooseAndi(page);
  await expect(page.getByRole("complementary", { name: "Daftar percakapan" })).toBeHidden();
  await page.getByRole("button", { name: "Aksi pelanggan ☷" }).click();
  await page.getByLabel("Lokasi pelanggan").selectOption("a");
  await expect(page.getByText("INV-RUMAH", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Tutup aksi pelanggan" }).click();
  await page.getByLabel("Pesan WhatsApp").fill("Baris pertama");
  await page.getByLabel("Pesan WhatsApp").press("Enter");
  expect(await page.evaluate(() => window.waTest.calls.filter(c => c.type === "send"))).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/aclean-whatsapp-mobile.png" });
  await page.getByRole("button", { name: "Kembali ke daftar chat" }).click();
  await expect(page.getByRole("complementary", { name: "Daftar percakapan" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("follow-up persists across chats, appears in due queue, and handles conflicting edits", async ({ page }) => {
  await chooseAndi(page);
  await page.getByLabel("Status tindak lanjut").selectOption("WAITING_CUSTOMER");
  await page.getByLabel("Pengingat (WIB)").fill("2026-01-01T09:00");
  await page.getByLabel("Penanggung jawab").fill("Dedy");
  await page.getByLabel("Catatan internal").fill("Hubungi untuk konfirmasi 3 unit.");
  await page.getByRole("button", { name: "Simpan tindak lanjut", exact: true }).click();
  await expect(page.getByText("Tindak lanjut tersimpan untuk seluruh admin.")).toBeVisible();
  await chooseMaya(page); await chooseAndi(page);
  await expect(page.getByLabel("Catatan internal")).toHaveValue("Hubungi untuk konfirmasi 3 unit.");
  await page.getByRole("button", { name: "Jatuh follow-up", exact: true }).click();
  await expect(page.locator(".wa-conversation")).toHaveCount(1);
  await page.evaluate(() => { window.waTest.followupConflict = true; });
  await page.getByLabel("Catatan internal").fill("Perubahan belum tersimpan");
  await page.getByRole("button", { name: "Simpan tindak lanjut", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("admin lain");
  await expect(page.getByLabel("Catatan internal")).toHaveValue("Perubahan belum tersimpan");
});

test("scheduling proposes a live slot, prepares an order, and refuses failed rechecks", async ({ page }) => {
  await chooseAndi(page); await page.getByLabel("Lokasi pelanggan").selectOption("a");
  await page.getByRole("button", { name: "Slot jadwal", exact: true }).click();
  await page.getByLabel("Tanggal servis").fill("2099-10-05");
  await page.getByLabel("Jumlah unit", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Cari slot tim", exact: true }).click();
  await page.getByRole("button", { name: "Draf tawaran", exact: true }).first().click();
  await expect(page.getByLabel("Pesan WhatsApp")).toHaveValue(/2099-10-05/);
  await page.getByRole("button", { name: "Pilih slot", exact: true }).first().click();
  expect(await page.evaluate(() => window.waTest.calls.find(c => c.type === "order").draft)).toMatchObject({ date: "2099-10-05", units: 3, time: "09:00", team_slot: "Team 01" });
  await page.evaluate(() => { window.waTest.scheduleError = true; });
  await page.getByRole("button", { name: "Pilih slot", exact: true }).first().click();
  await expect(page.getByRole("alert")).toContainText("Jadwal gagal dimuat");
  expect(await page.evaluate(() => window.waTest.calls.filter(c => c.type === "order"))).toHaveLength(1);
});

test("slot cards show dated technicians, mark preset-only teams tentative, and reject stale or absent crew", async ({ page }) => {
  await chooseAndi(page); await page.getByLabel("Lokasi pelanggan").selectOption("a");
  await page.getByRole("button", { name: "Slot jadwal", exact: true }).click();
  const firstDate=await page.evaluate(()=>window.waTest.rosters[0].date);
  await page.getByLabel("Tanggal servis").fill(firstDate);
  await page.getByRole("button", { name: "Cari slot tim", exact: true }).click();
  await expect(page.locator(".wa-info-card").filter({hasText:"Team 01 (Rian)"}).first()).toContainText("Teknisi roster: Rian");
  await expect(page.locator(".wa-info-card").filter({hasText:"Team 02 (Rey)"}).first()).toContainText("roster harian belum diisi");
  await page.evaluate(()=>{window.waTest.rosters[0].member1="Ari";});
  await page.locator(".wa-info-card").filter({hasText:"Team 01 (Rian)"}).first().getByRole("button",{name:"Pilih slot"}).click();
  await expect(page.getByRole("alert")).toContainText("Anggota tim berubah");
  expect(await page.evaluate(()=>window.waTest.calls.filter(c=>c.type==="order"))).toHaveLength(0);
  const absentDate=await page.evaluate(()=>window.waTest.rosters[1].date);
  await page.getByLabel("Tanggal servis").fill(absentDate);
  await page.getByRole("button", { name: "Cari slot tim", exact: true }).click();
  await expect(page.locator(".wa-info-card").filter({hasText:"Team 01"})).toHaveCount(0);
});

test("payment review allocates across locations and retries the same transaction ID", async ({ page }) => {
  await chooseAndi(page);
  await page.getByRole("button", { name: "Verifikasi bayar", exact: true }).click();
  await page.getByLabel("Bukti pembayaran", { exact: true }).selectOption("p2");
  await page.getByLabel(/INV-RUMAH.*Bapak Andi Rumah/).check();
  await page.getByLabel(/INV-KANTOR.*Bapak Andi Kantor/).check();
  await expect(page.getByRole("button", { name: "Konfirmasi pembayaran", exact: true })).toBeDisabled();
  await page.getByLabel(/Saya sudah memeriksa/).check();
  await page.evaluate(() => { window.waTest.paymentError = true; });
  await page.getByRole("button", { name: "Konfirmasi pembayaran", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Koneksi terputus");
  await expect(page.getByLabel("Nominal diterima")).toBeDisabled();
  await page.evaluate(() => { window.waTest.paymentError = false; });
  await page.getByRole("button", { name: "Periksa / ulangi transaksi yang sama", exact: true }).click();
  await expect(page.getByText("Pembayaran dan alokasi invoice tersimpan.")).toBeVisible();
  const calls = await page.evaluate(() => window.waTest.calls.filter(c => c.name === "apply_wa_payment"));
  expect(calls).toHaveLength(2); expect(calls[0].p.p_id).toBe(calls[1].p.p_id);
  expect(calls[1].p.p_allocations).toEqual([{invoice_id:"INV-RUMAH",amount:300000},{invoice_id:"INV-KANTOR",amount:300000}]);
});

test("PDF sending records history and blocks an uncertain document resend", async ({ page }) => {
  await chooseAndi(page); await page.getByLabel("Lokasi pelanggan").selectOption("a");
  await page.getByRole("button", { name: "Dokumen", exact: true }).click();
  await page.getByRole("button", { name: "Kirim PDF invoice", exact: true }).click();
  await expect(page.locator(".wa-order").filter({hasText:"INVOICE"})).toHaveCount(0);
  await expect(page.getByText("Diterima gateway", { exact: true }).first()).toBeVisible();
  await page.evaluate(() => { window.waTest.sendUncertain = true; });
  await page.getByRole("button", { name: "Kirim PDF laporan", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kirim PDF laporan", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => window.waTest.calls.filter(c=>c.type==="send").map(c=>c.kind))).toEqual(["INVOICE","REPORT"]);
});

test("service follow-up uses completed work and prevents repeat contact during cooldown", async ({ page }) => {
  await chooseMaya(page);
  await page.getByRole("button", { name: "Servis berkala", exact: true }).click();
  await page.getByRole("button", { name: "Buat draf penawaran servis", exact: true }).click();
  await expect(page.getByLabel("Pesan WhatsApp")).toHaveValue(/2026-01-01/);
  await page.getByRole("button", { name: "Kirim pengingat servis", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kirim pengingat servis", exact: true })).toBeDisabled();
  await expect(page.getByText("Pengingat sudah dikirim/diproses dalam 30 hari terakhir.")).toBeVisible();
  expect(await page.evaluate(() => window.waTest.calls.filter(c=>c.kind==="SERVICE_REMINDER"))).toHaveLength(1);
});

test("uncertain text attempts reuse their request ID without sending twice", async ({ page }) => {
  await chooseMaya(page);
  await page.evaluate(() => { window.waTest.sendUncertain = true; });
  await page.getByLabel("Pesan WhatsApp").fill("Pesan dengan status belum pasti");
  await page.getByRole("button", { name: "Kirim ↗", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Status belum pasti");
  await page.getByRole("button", { name: "Kirim ↗", exact: true }).click();
  expect(await page.evaluate(() => window.waTest.calls.filter(c=>c.type==="send"))).toHaveLength(1);
  await expect(page.getByLabel("Pesan WhatsApp")).toHaveValue("Pesan dengan status belum pasti");
});

test("reminder draft keeps its customer context across chats and uses the tracked reminder channel", async ({ page }) => {
  await chooseMaya(page);
  await page.getByRole("button", { name: "Servis berkala", exact: true }).click();
  await page.getByRole("button", { name: "Buat draf penawaran servis", exact: true }).click();
  await chooseAndi(page); await chooseMaya(page);
  await expect(page.getByText("Pengingat servis: Ibu Maya", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Kirim ↗", exact: true }).click();
  await expect(page.getByLabel("Pesan WhatsApp")).toHaveValue("");
  expect(await page.evaluate(() => window.waTest.calls.filter(c=>c.type==="send").map(c=>c.kind))).toEqual(["SERVICE_REMINDER"]);
  await page.getByRole("button", { name: "Servis berkala", exact: true }).click();
  await expect(page.getByRole("button", { name: "Kirim pengingat servis", exact: true })).toBeDisabled();
});

test("operational payment controls fit inside the mobile customer drawer", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
  await chooseAndi(page); await page.getByRole("button", { name: "Aksi pelanggan ☷" }).click();
  await page.getByRole("button", { name: "Verifikasi bayar", exact: true }).click();
  await page.getByLabel("Bukti pembayaran", { exact: true }).selectOption("p1");
  await page.getByLabel(/INV-RUMAH.*Bapak Andi Rumah/).check();
  await expect(page.getByLabel("Nominal diterima")).toHaveValue("200000");
  expect(await page.locator(".wa-context").evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({ path: "/tmp/aclean-wa-operations-mobile.png" });
});

for (const button of ["+ Jadwalkan", "↻ Reorder"]) {
  test(`${button} opens a popup over WhatsApp, saves without crew, then appears in the weekly Team calendar`, async ({ page }) => {
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://wa-workspace.test/?planning=1");
    await chooseAndi(page); await page.getByLabel("Lokasi pelanggan").selectOption("a");
    await page.getByRole("button", { name: button, exact: true }).click();
    const popup=page.getByRole("dialog",{name:"Rencanakan dari WhatsApp"});
    await expect(popup).toBeVisible();
    await expect(page.getByLabel("Pesan WhatsApp")).toBeVisible();
    await expect(popup.getByLabel("Tanggal pengerjaan")).toHaveValue("");
    await popup.getByRole("button",{name:"Simpan planning",exact:true}).click();
    await expect(popup.getByRole("alert")).toContainText("tanggal");
    await popup.getByLabel("Tanggal pengerjaan").fill("2099-10-10");
    await expect(popup.getByLabel("Team",{exact:true})).toHaveValue("");
    await popup.getByRole("button",{name:"Simpan planning",exact:true}).click();
    await expect(popup.getByRole("heading",{name:"Planning tersimpan"})).toBeVisible();
    await popup.getByRole("button",{name:"Lihat di Jadwal"}).click();
    const card=page.locator('.team-day-cell[data-team="unassigned"][data-date="2099-10-10"] .team-job').filter({hasText:"Bapak Andi Rumah"});
    await expect(card).toBeVisible(); await expect(card).toContainText("Tentatif");
    const row=await page.evaluate(()=>window.waTest.orders.find(o=>o.id.startsWith('WA-')));
    expect(row).toMatchObject({customer_id:"a",date:"2099-10-10",status:"PENDING",team_slot:null,teknisi:null,helper:null,dispatch:false});
    expect(await page.evaluate(()=>window.waTest.calls.filter(c=>['send','dispatch'].includes(c.type)))).toHaveLength(0);
    expect(errors).toEqual([]);
  });
}

test("Team suggestions carry exact start/end into popup and failed save preserves the plan",async({page})=>{
  await page.goto("https://wa-workspace.test/?planning=1");
  await chooseAndi(page);await page.getByLabel("Lokasi pelanggan").selectOption('a');
  await page.getByRole('button',{name:'Slot jadwal',exact:true}).click();
  await page.getByLabel('Tanggal servis').fill('2099-10-11');
  await page.getByLabel('Jumlah unit',{exact:true}).fill('3');
  await page.getByRole('button',{name:'Cari slot tim',exact:true}).click();
  await page.getByRole('button',{name:'Pilih slot',exact:true}).first().click();
  const popup=page.getByRole('dialog',{name:'Rencanakan dari WhatsApp'});
  await expect(popup.getByLabel('Team',{exact:true})).toHaveValue('Team 01');
  await expect(popup.getByLabel('Tanggal pengerjaan')).toHaveValue('2099-10-11');
  await expect(popup.getByLabel('Jam selesai',{exact:true})).toHaveValue('12:00');
  await page.evaluate(()=>{window.waTest.planningSaveError=true;});
  await popup.getByRole('button',{name:'Simpan planning',exact:true}).click();
  await expect(popup.getByRole('alert')).toContainText('Database tidak tersedia');
  await expect(popup.getByLabel('Tanggal pengerjaan')).toHaveValue('2099-10-11');
  await page.evaluate(()=>{window.waTest.planningSaveError=false;});
  await popup.getByRole('button',{name:'Simpan planning',exact:true}).click();
  await expect(popup.getByRole('heading',{name:'Planning tersimpan'})).toBeVisible();
});

const openTeamCalendar=async page=>{
  await page.clock.setFixedTime(new Date('2026-10-05T04:00:00Z'));
  await page.goto('https://wa-workspace.test/?planning=1');
  await page.getByRole('button',{name:'Tutup WhatsApp'}).click();
  await page.getByRole('button',{name:'Jadwal Tim',exact:true}).click();
  await expect(page.locator('.team-row-label')).toHaveCount(9);
};

test('grid satu jam menampilkan nama dan area lengkap tanpa mengubah panjang blok waktu',async({page})=>{
  await openTeamCalendar(page);
  await page.evaluate(()=>{
    window.waTest.orders.push({id:'SHORT-LONG-NAME',customer:'IBU JULIANA MELATI MAS',address:'Villa Melati Mas Blok I 10, BSD',area:'BSD',service:'Cleaning',units:1,status:'CONFIRMED',date:'2026-10-05',time:'09:00',time_end:'10:00',team_slot:'Team 05'});
    window.waTest.orders.push({id:'HALF-HOUR-LATE',customer:'BAPAK ROBERT INTAN',address:'Alam Sutera',area:'Alam Sutera',service:'Repair',units:1,status:'CONFIRMED',date:'2026-10-05',time:'17:30',time_end:'18:00',team_slot:'Team 06'});
  });
  await page.getByRole('button',{name:'↻ Muat ulang',exact:true}).click();
  const lane=page.locator('.team-time-row[data-team="Team 05"] .team-time-lane').filter({hasText:'IBU JULIANA MELATI MAS'});
  await expect(lane.locator('.team-time-detail')).toContainText('09:00–10:00 · IBU JULIANA MELATI MAS');
  await expect(lane.locator('.team-time-detail')).toContainText('📍 BSD');
  expect(await lane.locator('button').evaluate(el=>el.style.width)).toBe('10%');
  const layout=await lane.locator('.team-time-detail').evaluate(el=>({content:el.scrollHeight,visible:el.clientHeight,clipped:el.scrollWidth>el.clientWidth}));
  expect(layout.content).toBeLessThanOrEqual(layout.visible);
  expect(layout.clipped).toBe(false);
  const halfHour=page.locator('.team-time-row[data-team="Team 06"] .team-time-lane').filter({hasText:'BAPAK ROBERT INTAN'});
  await expect(halfHour.locator('.team-time-detail')).toContainText('17:30–18:00 · BAPAK ROBERT INTAN');
  await expect(halfHour.locator('.team-time-detail')).toContainText('📍 Alam Sutera');
  await expect(halfHour.locator('button')).toBeEmpty();
  await page.locator('.team-time-row[data-team="Team 05"]').screenshot({path:'/tmp/aclean-grid-readability.png'});
});

test('weekly Team calendar follows presets, daily crews, absences and hourly detail',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openTeamCalendar(page);
  await expect(page.locator('.team-row-label').filter({hasText:'Team 09'})).toHaveCount(0);
  await expect(page.locator('.team-day-cell[data-team="Team 01"][data-date="2026-10-06"]')).toContainText('Rian');
  const absent=page.locator('.team-day-cell[data-team="Team 01"][data-date="2026-10-07"]');
  await expect(absent).toContainText('Budi'); await expect(absent).toContainText('Sari');
  await expect(absent).toContainText('Perlu pengganti');await expect(absent).toContainText('Terkonfirmasi');
  await page.locator('.team-day').filter({hasText:'07/10'}).click();
  await expect(page.getByRole('region',{name:'Jadwal mingguan per Team'}).locator('.team-day-detail')).toContainText('2026-10-07');
  await expect(page.getByLabel('Timeline harian')).toContainText('10:00–12:00');
  await page.evaluate(()=>window.waTest.presets.push({slot:'Team 09',sort_order:9}));
  await page.getByRole('button',{name:'↻ Muat ulang',exact:true}).click();
  await expect(page.locator('.team-row-label')).toHaveCount(10);
  await page.screenshot({path:'/tmp/aclean-team-week.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('hourly WIB grid is above weekly planning and week date selection returns to the grid',async({page})=>{
  await openTeamCalendar(page);
  const positions=await page.evaluate(()=>{
    const grid=document.querySelector('.team-day-detail'),weekly=document.querySelector('.team-week-heading');
    return {grid:grid.getBoundingClientRect().top,weekly:weekly.getBoundingClientRect().top};
  });
  expect(positions.grid).toBeLessThan(positions.weekly);
  await page.locator('.team-day').filter({hasText:'06/10'}).click();
  await expect(page.locator('.team-day-navigation h3')).toHaveText('2026-10-06');
  await expect(page.locator('.team-day-detail')).toBeInViewport();
  await expect(page.locator('.team-time-row[data-team="Team 01"]')).toContainText('Ibu Ratna');
});

test('rescheduling keeps the same job, confirmation and clears old-day crew',async({page})=>{
  await openTeamCalendar(page);
  await page.locator('.team-week-grid [data-job-id="JOB-TEAM-A"] .team-job-main').click();
  const popup=page.getByRole('dialog',{name:'Ubah rencana pekerjaan'});
  await popup.getByLabel('Tanggal pengerjaan').fill('2026-10-08');
  await popup.getByLabel('Team',{exact:true}).selectOption('Team 02');
  await popup.getByLabel('Alasan perubahan').fill('Pelanggan meminta pindah ke Kamis');
  await popup.getByRole('button',{name:'Simpan perubahan',exact:true}).click();
  await expect(popup.getByRole('heading',{name:'Planning tersimpan'})).toBeVisible();
  await popup.getByRole('button',{name:'Lihat di Jadwal'}).click();
  await expect(page.locator('.team-day-cell[data-team="Team 02"][data-date="2026-10-08"] [data-job-id="JOB-TEAM-A"]')).toBeVisible();
  await expect(page.locator('.team-day-cell[data-date="2026-10-06"] [data-job-id="JOB-TEAM-A"]')).toHaveCount(0);
  const rows=await page.evaluate(()=>window.waTest.orders.filter(o=>o.id==='JOB-TEAM-A'));
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({status:'CONFIRMED',teknisi:null,helper:null,dispatch:false});
});

test('dragging an hourly job opens the shared planning popup and updates the same job after confirmation',async({page})=>{
  await openTeamCalendar(page);
  await page.locator('.team-day').filter({hasText:'06/10'}).click();
  const source=page.locator('.team-time-row[data-team="Team 01"] .team-time-lane button[aria-label*="Ibu Ratna"]');
  const target=page.locator('.team-time-row[data-team="Team 02"] .team-time-lanes');
  const width=(await target.boundingBox()).width;
  await source.dragTo(target,{sourcePosition:{x:4,y:20},targetPosition:{x:Math.round(width*.2),y:24}});
  const popup=page.getByRole('dialog',{name:'Ubah rencana pekerjaan'});
  await expect(popup.getByLabel('Team',{exact:true})).toHaveValue('Team 02');
  await expect(popup.getByLabel('Jam mulai',{exact:true})).toHaveValue('11:00');
  await expect(popup.getByLabel('Jam selesai',{exact:true})).toHaveValue('13:00');
  await expect(popup.getByLabel('Alasan perubahan')).toHaveValue(/Geser jadwal 2026-10-06 · Team 01 09:00–11:00 → 2026-10-06 · Team 02 11:00–13:00/);
  await popup.getByLabel('Jam mulai',{exact:true}).fill('11:30');
  await expect(popup.getByLabel('Alasan perubahan')).toHaveValue(/Team 02 11:30–13:30/);
  await popup.getByLabel('Jam mulai',{exact:true}).fill('11:00');
  expect(await page.evaluate(()=>window.waTest.orders.find(o=>o.id==='JOB-TEAM-A').team_slot)).toBe('Team 01');
  await popup.getByRole('button',{name:'Simpan perubahan',exact:true}).click();
  await expect(popup.getByRole('heading',{name:'Planning tersimpan'})).toBeVisible();
  await popup.getByRole('button',{name:'Lihat di Jadwal'}).click();
  await expect(page.locator('.team-time-row[data-team="Team 02"] .team-time-lane').filter({hasText:'Ibu Ratna'})).toContainText('11:00–13:00');
  const rows=await page.evaluate(()=>window.waTest.orders.filter(o=>o.id==='JOB-TEAM-A'));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({date:'2026-10-06',time:'11:00',time_end:'13:00',team_slot:'Team 02',status:'CONFIRMED',teknisi:null,helper:null});
  expect(rows[0].notes).toContain('Geser jadwal 2026-10-06 · Team 01 09:00–11:00 → 2026-10-06 · Team 02 11:00–13:00');
  await page.getByRole('button',{name:'Planning Order',exact:true}).click();
  await expect(page.getByRole('region',{name:'Planning Order lokal'})).toContainText('Ibu Ratna');
});

test('cancelled drag leaves the job intact and a conflicting target is rejected before planning opens',async({page})=>{
  await openTeamCalendar(page);
  await page.locator('.team-day').filter({hasText:'06/10'}).click();
  const source=page.locator('.team-time-row[data-team="Team 01"] .team-time-lane button[aria-label*="Ibu Ratna"]');
  const target=page.locator('.team-time-row[data-team="Team 02"] .team-time-lanes');
  const width=(await target.boundingBox()).width;
  await source.dragTo(target,{sourcePosition:{x:4,y:20},targetPosition:{x:Math.round(width*.2),y:24}});
  await page.getByRole('dialog',{name:'Ubah rencana pekerjaan'}).getByRole('button',{name:'Batal',exact:true}).click();
  expect(await page.evaluate(()=>window.waTest.orders.find(o=>o.id==='JOB-TEAM-A'))).toMatchObject({time:'09:00',time_end:'11:00',team_slot:'Team 01'});
  await page.evaluate(()=>window.waTest.orders.push({id:'JOB-BLOCK',customer:'Pemesan lain',phone:'6281234567000',service:'Cleaning',units:2,status:'CONFIRMED',date:'2026-10-06',time:'11:00',time_end:'13:00',team_slot:'Team 02'}));
  await page.getByRole('button',{name:'↻ Muat ulang',exact:true}).click();
  await source.dragTo(target,{sourcePosition:{x:4,y:20},targetPosition:{x:Math.round(width*.2),y:24}});
  await expect(page.getByRole('alert')).toContainText('bertabrakan');
  await expect(page.getByRole('dialog',{name:'Ubah rencana pekerjaan'})).toHaveCount(0);
});

test('drag confirmation rechecks current roster and blocks saves when schedule reads fail',async({page})=>{
  await openTeamCalendar(page);
  await page.locator('.team-day').filter({hasText:'06/10'}).click();
  const source=page.locator('.team-time-row[data-team="Team 01"] .team-time-lane button[aria-label*="Ibu Ratna"]');
  const target=page.locator('.team-time-row[data-team="Team 02"] .team-time-lanes');
  const width=(await target.boundingBox()).width;
  await source.dragTo(target,{sourcePosition:{x:4,y:20},targetPosition:{x:Math.round(width*.2),y:24}});
  const popup=page.getByRole('dialog',{name:'Ubah rencana pekerjaan'});
  await page.evaluate(()=>{window.waTest.scheduleError=true;});
  await popup.getByRole('button',{name:'Simpan perubahan',exact:true}).click();
  await expect(popup.getByRole('alert')).toContainText('Jadwal gagal dimuat');
  await page.evaluate(()=>{window.waTest.scheduleError=false;window.waTest.absences.push({date:'2026-10-06',teknisi:'Rey',status:'OFF',is_available:false});});
  await popup.getByRole('button',{name:'Simpan perubahan',exact:true}).click();
  await expect(popup.getByRole('alert')).toContainText('Rey tidak tersedia');
  expect(await page.evaluate(()=>window.waTest.calls.filter(c=>c.name==='save_schedule_plan'))).toHaveLength(0);
  expect(await page.evaluate(()=>window.waTest.orders.find(o=>o.id==='JOB-TEAM-A').team_slot)).toBe('Team 01');
});

test('uncertain save retries the same request instead of duplicating a job',async({page})=>{
  await page.goto('https://wa-workspace.test/?planning=1');await chooseMaya(page);
  await page.getByRole('button',{name:'+ Jadwalkan',exact:true}).click();
  const popup=page.getByRole('dialog',{name:'Rencanakan dari WhatsApp'});
  await popup.getByLabel('Tanggal pengerjaan').fill('2099-10-13');
  await page.evaluate(()=>{window.waTest.planningLostResponse=true;});
  await popup.getByRole('button',{name:'Simpan planning',exact:true}).click();
  await expect(popup.getByRole('alert')).toContainText('Koneksi terputus');
  await expect(popup.getByLabel('Tanggal pengerjaan')).toBeDisabled();
  await popup.getByRole('button',{name:'Periksa penyimpanan',exact:true}).click();
  await expect(popup.getByRole('heading',{name:'Planning tersimpan'})).toBeVisible();
  const requests=await page.evaluate(()=>window.waTest.calls.filter(c=>c.name==='save_schedule_plan'));
  expect(requests).toHaveLength(2);expect(requests[0].p.p_request_id).toBe(requests[1].p.p_request_id);
  expect(await page.evaluate(()=>window.waTest.orders.filter(o=>o.id.startsWith('WA-')))).toHaveLength(1);
});

test('mobile popup fits screen, retains chat on close, and calendar scrolls inside its container',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.goto('https://wa-workspace.test/?planning=1');await chooseMaya(page);
  await page.getByRole('button',{name:'+ Jadwalkan',exact:true}).click();
  const popup=page.getByRole('dialog',{name:'Rencanakan dari WhatsApp'});
  await popup.getByLabel('Tanggal pengerjaan').fill('2099-10-13');
  await popup.getByLabel('Team',{exact:true}).selectOption('Team 08');
  await expect(popup.getByRole('button',{name:'09:00–10:00',exact:true})).toBeVisible();
  expect(await popup.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:'/tmp/aclean-team-popup-mobile.png'});
  await popup.getByRole('button',{name:'Tutup rencana'}).click();
  await expect(page.getByLabel('Pesan WhatsApp')).toBeVisible();
  await page.getByRole('button',{name:'Tutup WhatsApp'}).click();
  await page.getByRole('button',{name:'Jadwal Tim',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});


test('slot collision blocks save and stale admin changes do not overwrite the saved job',async({page})=>{
  await openTeamCalendar(page);
  await page.locator('.team-day-cell[data-team="Team 01"][data-date="2026-10-06"] .team-add').click();
  const create=page.getByRole('dialog',{name:'Rencanakan pekerjaan'});
  await expect(create.getByText(/Slot tim atau anggota bertabrakan/)).toBeVisible();
  await expect(create.getByRole('button',{name:'Simpan planning',exact:true})).toBeDisabled();
  await create.getByRole('button',{name:'Tutup rencana'}).click();
  await page.locator('.team-week-grid [data-job-id="JOB-TEAM-A"] .team-job-main').click();
  const edit=page.getByRole('dialog',{name:'Ubah rencana pekerjaan'});
  await edit.getByLabel('Alasan perubahan').fill('Mengubah catatan pelanggan');
  await page.evaluate(()=>{window.waTest.orders.find(o=>o.id==='JOB-TEAM-A').notes='Diubah admin lain';});
  await edit.getByRole('button',{name:'Simpan perubahan',exact:true}).click();
  await expect(edit.getByRole('alert')).toContainText('admin lain');
  expect(await page.evaluate(()=>window.waTest.orders.find(o=>o.id==='JOB-TEAM-A').notes)).toBe('Diubah admin lain');
});

test('failed calendar reads cannot offer a new slot as if it were free',async({page})=>{
  await openTeamCalendar(page);
  await page.evaluate(()=>{window.waTest.scheduleError=true;});
  await page.getByRole('button',{name:'↻ Muat ulang',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Jadwal gagal dimuat');
  await expect(page.getByRole('button',{name:'+ Rencanakan',exact:true}).first()).toBeDisabled();
  await page.evaluate(()=>{window.waTest.scheduleError=false;});
  await page.getByRole('button',{name:'↻ Muat ulang',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'+ Rencanakan',exact:true}).first()).toBeEnabled();
});

test('Jadwal stops at 19:00, estimates missing end times, and keeps night bookings in Planning Order',async({page})=>{
  await openTeamCalendar(page);
  await page.evaluate(()=>{
    window.waTest.presets.push({slot:'Malam 01',sort_order:99});
    window.waTest.orders.push({id:'LATE-TEST',customer:'Pekerjaan sore uji',service:'Repair',units:2,status:'CONFIRMED',date:'2026-10-05',time:'17:00',time_end:'20:00',team_slot:'Team 08'});
  });
  await page.getByRole('button',{name:'↻ Muat ulang',exact:true}).click();
  await page.getByRole('button',{name:'Buka WhatsApp',exact:true}).click();
  await chooseMaya(page);
  await page.getByRole('button',{name:'+ Jadwalkan',exact:true}).click();
  const popup=page.getByRole('dialog',{name:'Rencanakan dari WhatsApp'});
  await popup.getByLabel('Tanggal pengerjaan').fill('2026-10-05');
  await popup.getByLabel('Team',{exact:true}).selectOption('Malam 01');
  await popup.getByLabel('Jumlah unit',{exact:true}).fill('2');
  await popup.getByLabel('Jam mulai',{exact:true}).fill('19:00');
  await popup.getByRole('button',{name:'Simpan planning',exact:true}).click();
  await expect(popup.getByRole('heading',{name:'Planning tersimpan'})).toBeVisible();
  await popup.getByRole('button',{name:'Lihat di Jadwal'}).click();
  await expect(page.locator('.team-time-head span')).toHaveText(Array.from({length:11},(_,i)=>`${String(i+9).padStart(2,'0')}:00`));
  await expect(page.locator('.team-row-label')).toHaveCount(9);
  await expect(page.getByLabel('Filter Team jadwal')).not.toContainText('Malam');
  await expect(page.locator('.team-board')).not.toContainText('Ibu Maya');
  await expect(page.getByLabel('Timeline harian')).toContainText('09:00–12:00');
  const late=page.getByLabel('Timeline harian').getByRole('button',{name:/Pekerjaan sore uji/});
  expect(await late.evaluate(el=>({left:el.style.left,width:el.style.width}))).toEqual({left:'80%',width:'20%'});
  expect(await page.evaluate(()=>window.waTest.orders.find(o=>o.team_slot==='Malam 01').time_end)).toBe('21:00');
  await page.getByRole('button',{name:'Planning Order',exact:true}).click();
  await expect(page.getByRole('region',{name:'Planning Order lokal'})).toContainText('Ibu Maya');
});

test('day arrows navigate across both week boundaries and retain hourly booking actions',async({page})=>{
  await openTeamCalendar(page);
  const day=page.locator('.team-day-navigation h3');
  await expect(day).toHaveText('2026-10-05');
  await page.getByRole('button',{name:'Hari sebelumnya',exact:true}).click();
  await expect(day).toHaveText('2026-10-04');
  await expect(page.locator('.team-day.selected')).toContainText('04/10');
  await page.getByRole('button',{name:'Hari berikutnya',exact:true}).click();
  await expect(day).toHaveText('2026-10-05');
  await page.getByRole('button',{name:'Hari berikutnya',exact:true}).click();
  await expect(day).toHaveText('2026-10-06');
  const timeline=page.getByLabel('Timeline harian');
  await timeline.getByRole('button',{name:/Ibu Ratna/}).click();
  await expect(page.getByRole('dialog',{name:'Ubah rencana pekerjaan'}).getByLabel('Tanggal pengerjaan')).toHaveValue('2026-10-06');
  await page.getByRole('button',{name:'Tutup rencana'}).click();
  await page.locator('.team-day').filter({hasText:'11/10'}).click();
  await page.getByRole('button',{name:'Hari berikutnya',exact:true}).click();
  await expect(day).toHaveText('2026-10-12');
  await expect(page.locator('.team-day.selected')).toContainText('12/10');
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:'Hari sebelumnya'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Hari berikutnya'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/aclean-team-day-navigation-mobile.png'});
});

test('inbox resolves Customer names without visiting Customer menu and preserves the actual recipient',async({page})=>{
  await page.goto('https://wa-workspace.test/?empty-customers=1');
  const maya=page.locator('.wa-conversation[data-phone="6281234567891"]');
  await expect(maya.locator('strong')).toHaveText('Ibu Maya');
  await expect(maya).toContainText('Pelanggan terdaftar');
  await expect(maya).toContainText('+62 812-3456-7891');
  await page.evaluate(()=>{window.waTest.conversations[1].name='R';});
  await page.getByRole('button',{name:'Muat ulang percakapan'}).click();
  await maya.click();
  await expect(page.locator('.wa-chat-header h3')).toHaveText('Ibu Maya');
  await expect(page.locator('.wa-whatsapp-alias')).toHaveText('Nama WhatsApp: R');
  await page.getByLabel('Pesan WhatsApp').fill('Uji identitas pelanggan');
  await page.getByRole('button',{name:'Kirim ↗',exact:true}).click();
  expect(await page.evaluate(()=>window.waTest.calls.find(c=>c.type==='send').phone)).toBe('6281234567891');
  await page.getByLabel('Cari percakapan').fill('Ibu Maya');
  await expect(page.locator('.wa-conversation')).toHaveCount(1);
  await page.getByLabel('Hapus pencarian').click();
  await chooseAndi(page);
  await expect(page.locator('.wa-chat-header h3')).toContainText('Bapak Andi Kantor / Bapak Andi Rumah');
  await expect(page.getByRole('button',{name:'+ Jadwalkan',exact:true})).toBeDisabled();
  await page.getByLabel('Lokasi pelanggan').selectOption('b');
  await expect(page.locator('.wa-chat-header h3')).toHaveText('Bapak Andi Kantor');
  await page.screenshot({path:'/tmp/aclean-wa-customer-names.png'});
  await page.evaluate(()=>{
    window.waTest.conversations[2].phone='+819012345678';
    window.waTest.customers.push({id:'jp',name:'Pelanggan Jepang',phone:'+819012345678'});
  });
  await page.getByRole('button',{name:'Muat ulang percakapan'}).click();
  await expect(page.locator('.wa-conversation[data-phone="819012345678"] strong')).toHaveText('Pelanggan Jepang');
});

test('lookup failure is visible, blocks mistaken customer creation, and manual refresh resolves legacy numbers',async({page})=>{
  await page.goto('https://wa-workspace.test/?empty-customers=1');
  await page.evaluate(()=>{window.waTest.customerLookupError=true;window.waTest.customers[2].phone='081234567891';});
  await page.getByRole('button',{name:'Muat ulang percakapan'}).click();
  await chooseMaya(page);
  await expect(page.getByRole('alert')).toContainText('Nama Customer belum dapat diverifikasi');
  await expect(page.getByRole('button',{name:'+ Jadwalkan',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Baru',exact:true}).click();
  await expect(page.locator('.wa-conversation')).toHaveCount(0);
  await page.evaluate(()=>{window.waTest.customerLookupError=false;});
  await page.getByRole('button',{name:'Coba lagi nama pelanggan'}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'+ Jadwalkan',exact:true})).toBeEnabled();
  await expect(page.locator('.wa-chat-header h3')).toHaveText('Ibu Maya');
  await expect(page.locator('.wa-conversation')).toHaveCount(1);
  await expect(page.locator('.wa-conversation')).toContainText('Kontak baru');
  const before=await page.evaluate(()=>window.waTest.calls.filter(c=>c.type==='customer-lookup').length);
  await page.clock.install();await page.clock.fastForward(60000);
  expect(await page.evaluate(()=>window.waTest.calls.filter(c=>c.type==='customer-lookup').length)).toBe(before);
});

test("server-only proof loads without global cache and suggests a reviewed multi-invoice allocation with R2 preview", async ({page})=>{
  await page.route('https://wa-workspace.test/api/foto?**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><text x="5" y="40">Transfer Rp1.200.000</text></svg>'}));
  await page.evaluate(()=>window.waTest.proofs.push({id:'server-only',phone:'6281234567890',status:'PENDING',amount:1200000,bank:'BCA',image_url:'/api/foto?key=wa-inbox%2Fproof.jpg'}));
  await chooseAndi(page);
  await page.getByRole('button',{name:'Verifikasi bayar',exact:true}).click();
  await page.getByLabel('Bukti pembayaran',{exact:true}).selectOption('server-only');
  await expect(page.getByLabel(/INV-RUMAH.*Bapak Andi Rumah/)).toBeChecked();
  await expect(page.getByLabel(/INV-KANTOR.*Bapak Andi Kantor/)).toBeChecked();
  const image=page.getByRole('img',{name:'Bukti transfer yang akan diverifikasi'});
  await expect(image).toBeVisible();
  await expect.poll(()=>image.evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByRole('button',{name:'Konfirmasi pembayaran',exact:true})).toBeDisabled();
  await page.getByLabel(/Saya sudah memeriksa/).check();
  await page.getByRole('button',{name:'Konfirmasi pembayaran',exact:true}).click();
  await expect(page.getByText('Pembayaran dan alokasi invoice tersimpan.')).toBeVisible();
  const calls=await page.evaluate(()=>window.waTest.calls.filter(c=>c.name==='apply_wa_payment'));
  expect(calls[0].p.p_allocations).toEqual([{invoice_id:'INV-RUMAH',amount:300000},{invoice_id:'INV-KANTOR',amount:900000}]);
});

test("proof query errors are visible and manual refresh recovers without polling",async({page})=>{
  await page.evaluate(()=>{window.waTest.paymentLoadError=true;});
  await chooseAndi(page);
  await page.getByRole('button',{name:'Verifikasi bayar',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Bukti belum dapat dimuat');
  await expect(page.getByText('Tidak ada bukti yang menunggu pemeriksaan pada nomor ini.')).toHaveCount(0);
  await page.evaluate(()=>{window.waTest.paymentLoadError=false;});
  await page.getByRole('button',{name:'Muat ulang bukti & invoice',exact:true}).click();
  await expect(page.getByLabel('Bukti pembayaran',{exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test("late payment response cannot populate a different customer's review panel",async({page})=>{
  await page.evaluate(()=>{window.waTest.paymentLoadDelay=500;});
  await chooseAndi(page);await chooseMaya(page);
  await page.getByRole('button',{name:'Verifikasi bayar',exact:true}).click();
  await expect(page.getByText('Tidak ada bukti yang menunggu pemeriksaan pada nomor ini.')).toBeVisible();
  await expect(page.getByLabel('Bukti pembayaran',{exact:true})).toHaveCount(0);
});

test('hourly grid shows the approximate area and planning lets admin correct it',async({page})=>{
  await openTeamCalendar(page);
  await page.locator('.team-day').filter({hasText:'06/10'}).click();
  const bsd=page.getByLabel('Timeline harian').locator('.team-time-lane').filter({has:page.locator('button[data-area="BSD"]')});
  await expect(bsd.locator('.team-time-detail')).toContainText('Ibu Ratna');
  await expect(bsd.locator('.team-time-detail')).toContainText('📍 BSD');
  await expect(page.locator('.team-day-cell[data-date="2026-10-06"] .team-job').filter({hasText:'Ibu Ratna'})).toContainText('BSD');
  await expect(page.getByRole('link',{name:'Periksa alamat Ibu Ratna di Maps'})).toHaveAttribute('href',/De%20Park%20BSD%20City/);
  await page.locator('.team-day').filter({hasText:'07/10'}).click();
  const graha=page.locator('.team-time-lane').filter({has:page.locator('button[data-area="Graha Raya"]')});
  await expect(graha.locator('.team-time-detail')).toContainText('📍 Graha Raya');
  await page.locator('.team-day-cell[data-team="unassigned"][data-date="2026-10-06"] .team-add').click();
  await page.getByLabel('Pelanggan',{exact:true}).fill('Ibu Rini');
  await page.getByLabel('WhatsApp',{exact:true}).fill('6281234567888');
  await page.getByLabel('Alamat lokasi').fill('De Park BSD City, Tangerang Selatan');
  await expect(page.getByLabel('Area layanan')).toHaveValue('BSD');
  await page.getByLabel('Area layanan').selectOption('Bintaro');
  await page.getByLabel('Alamat lokasi').fill('De Park BSD City, Tangerang Selatan Blok B');
  await expect(page.getByLabel('Area layanan')).toHaveValue('Bintaro');
  await page.getByRole('button',{name:'Simpan planning'}).click();
  await expect(page.getByText('Planning tersimpan')).toBeVisible();
  const saved=await page.evaluate(()=>window.waTest.calls.findLast(c=>c.name==='save_schedule_plan'));
  expect(saved.p.p_plan.area).toBe('Bintaro');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Tutup rencana'}).click();
  await page.locator('.team-day').filter({hasText:'06/10'}).click();
  await expect(page.getByLabel('Timeline harian').locator('.team-time-lane').filter({has:page.locator('button[data-area="BSD"]')}).locator('.team-time-detail')).toContainText('📍 BSD');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
