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
const chooseAndi = page => page.getByRole("button", { name: /Andi.*lokasi pelanggan/ }).click();
const chooseMaya = page => page.getByRole("button", { name: /Maya.*Ibu Maya/ }).click();

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
