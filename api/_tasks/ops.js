// api/_tasks/ops.js — Task cron grup ops (dipindah APA ADANYA dari
// api/cron-reminder.js, pemecahan _tasks/ Jul 2026). Entry & jadwal tetap di cron-reminder.js.
import { sb, sendWA, isCronJobEnabled, fmt, log, deleteR2Object, OWNER_PHONE } from "./_shared.js";
import * as Sentry from "@sentry/node";
import { createHmac, createHash } from "crypto";

// ══════════════════════════════════════════════════
// TASK: Project Alerts — WA ke Owner untuk modul Project
// (1) project telat dari target, (2) Berita Acara PENDING >3 hari,
// (3) biaya aktual ≥85% RAB. Toggle: project_alerts_enabled (default ON).
// ══════════════════════════════════════════════════
export async function taskProjectAlerts() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key", ["project_alerts_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "project_alerts_enabled") || togMap["project_alerts_enabled"] !== "true") {
    await log("PROJECT_ALERTS", "Dilewati — toggle OFF", "INFO");
    return { skipped: true };
  }
  if (!OWNER_PHONE) { await log("PROJECT_ALERTS", "OWNER_PHONE belum diset", "INFO"); return { skipped: true }; }

  const wib = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const [pRes, baRes, eRes, puRes] = await Promise.all([
    sb.from("project_projects").select("id,nama,status,target,rab"),
    sb.from("project_daily_reports").select("project_id,tanggal,status,submitted_at,teknisi_name").eq("status", "PENDING"),
    sb.from("project_expenses").select("project_id,nominal"),
    sb.from("project_purchases").select("project_id,total"),
  ]);
  const projects = pRes.data || [];
  const active = projects.filter(p => ["BERJALAN", "FINISHING"].includes(p.status));
  const pName = id => (projects.find(p => p.id === id) || {}).nama || id;

  // 1) Telat dari target
  const late = active.filter(p => p.target && p.target < wib)
    .map(p => ({ nama: p.nama, days: Math.round((new Date(wib) - new Date(p.target)) / 86400000) }));

  // 2) Berita Acara PENDING > 3 hari
  const STALE_DAYS = 3;
  const cutoff = new Date(Date.now() - STALE_DAYS * 86400_000).toISOString();
  const stale = (baRes.data || []).filter(b => (b.submitted_at || b.tanggal || "") < cutoff)
    .map(b => ({ proj: pName(b.project_id), tanggal: b.tanggal, teknisi: b.teknisi_name || "-" }));

  // 3) Biaya aktual ≥85% RAB
  const cost = {};
  (eRes.data || []).forEach(e => cost[e.project_id] = (cost[e.project_id] || 0) + (e.nominal || 0));
  (puRes.data || []).forEach(x => cost[x.project_id] = (cost[x.project_id] || 0) + (x.total || 0));
  const overBudget = active.filter(p => p.rab > 0 && (cost[p.id] || 0) >= 0.85 * p.rab)
    .map(p => ({ nama: p.nama, cost: cost[p.id] || 0, ratio: Math.round((cost[p.id] || 0) / p.rab * 100) }));

  if (!late.length && !stale.length && !overBudget.length) {
    await log("PROJECT_ALERTS", "Tidak ada alert", "INFO");
    return { late: 0, stale: 0, overBudget: 0 };
  }

  let msg = "🏗️ *Alert Project — AClean*\n";
  if (late.length) msg += `\n⏰ *Telat dari target:*\n` + late.map(p => `• ${p.nama} — telat ${p.days} hari`).join("\n") + "\n";
  if (stale.length) msg += `\n📝 *Berita Acara belum diverifikasi (>${STALE_DAYS} hari):*\n` + stale.map(b => `• ${b.proj} — ${b.tanggal} (${b.teknisi})`).join("\n") + "\n";
  if (overBudget.length) msg += `\n💸 *Biaya ≥85% RAB:*\n` + overBudget.map(p => `• ${p.nama} — ${fmt(p.cost)} (${p.ratio}% RAB)`).join("\n") + "\n";
  msg += `\nCek modul Project untuk tindak lanjut.`;

  await sendWA(OWNER_PHONE, msg);
  await log("PROJECT_ALERTS", `late=${late.length} stale=${stale.length} overBudget=${overBudget.length}`, "SUCCESS");
  return { late: late.length, stale: stale.length, overBudget: overBudget.length };
}

// ══════════════════════════════════════════════════
// TASK: Auto-Return Bawa Material Stale
// Jalan tiap hari malam (22:00 WIB / 15:00 UTC)
// Brought yang stuck > 24h → RETURNED (kembali ke stok virtual)
// + Auto-USED kalau orders sudah COMPLETED/PAID tapi brought masih BROUGHT
// ══════════════════════════════════════════════════
export async function taskAutoReturnBrought() {
  const cutoff24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const now = new Date().toISOString();

  // Step 1: brought records > 24h yang masih BROUGHT (lupa di-laporan)
  const { data: stale, error: e1 } = await sb.from("job_materials_brought")
    .select("id, job_id, unit_label, brought_by, brought_at")
    .eq("status", "BROUGHT")
    .lt("brought_at", cutoff24h)
    .limit(500);
  if (e1) {
    await log("AUTO_RETURN_BROUGHT", "Fetch error: " + e1.message, "ERROR");
    return { error: e1.message };
  }
  const staleRows = stale || [];

  // Step 2: cross-check orders — kalau order sudah COMPLETED/PAID, lebih relevan tag USED
  // bukan RETURNED. Tapi karena tidak ada qty_used, default ke RETURNED untuk safety.
  let returnedCnt = 0;
  if (staleRows.length > 0) {
    const ids = staleRows.map(r => r.id);
    const { error: e2 } = await sb.from("job_materials_brought")
      .update({ status: "RETURNED", updated_at: now, notes: "auto-returned (>24h tidak ke-laporan)" })
      .in("id", ids);
    if (e2) {
      await log("AUTO_RETURN_BROUGHT", "Update error: " + e2.message, "ERROR");
      return { error: e2.message };
    }
    returnedCnt = ids.length;
  }

  // Step 3: log summary + (kalau ada) alert ke owner
  const summary = `Returned: ${returnedCnt} brought records (>24h stuck)`;
  await log("AUTO_RETURN_BROUGHT", summary, returnedCnt > 0 ? "SUCCESS" : "INFO");

  if (returnedCnt > 0 && OWNER_PHONE) {
    const byTech = {};
    staleRows.forEach(r => {
      if (!byTech[r.brought_by]) byTech[r.brought_by] = [];
      byTech[r.brought_by].push(`${r.unit_label} (${r.job_id})`);
    });
    const lines = Object.entries(byTech).map(([t, list]) =>
      `• ${t}: ${list.slice(0,3).join(", ")}${list.length > 3 ? ` +${list.length-3} lagi` : ""}`).join("\n");
    await sendWA(OWNER_PHONE,
      "📦 *Auto-Return Bawa Material*\n" +
      `${returnedCnt} unit di-return ke stok karena >24h tidak ke-laporan:\n\n${lines}\n\n` +
      "Periksa apakah teknisi lupa input laporan."
    );
  }

  return { returned: returnedCnt, details: staleRows.map(r => r.id) };
}

// ══════════════════════════════════════════════════
// TASK 7: Backup Data Mingguan ke R2
// Jalan tiap Senin 08:00 WIB (jadwal di taskTick dispatcher)
// Export invoices, orders, customers, service_reports ke R2
// ══════════════════════════════════════════════════
export async function taskBackupData() {
  // Gate FAIL-OPEN — sengaja BEDA dari SOP strict (=== "true") milik task WA-customer:
  // backup wajib default JALAN; key hilang tidak boleh mematikan backup diam-diam.
  // Berhenti hanya kalau eksplisit dimatikan (standalone "false" / cron_jobs active:false).
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key", ["backup_data_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "backup_data_enabled") || togMap["backup_data_enabled"] === "false") {
    await log("BACKUP_DATA", "Dilewati — toggle OFF", "INFO");
    return { skipped: true };
  }

  const r2Key    = process.env.R2_ACCESS_KEY;
  const r2Secret = process.env.R2_SECRET_KEY;
  const r2Account= process.env.R2_ACCOUNT_ID;
  const r2Bucket = process.env.R2_BUCKET_NAME || "aclean-files";

  if (!r2Key || !r2Secret || !r2Account) {
    await log("BACKUP_DATA", "R2 credentials tidak lengkap — skip", "ERROR");
    return { skipped: true };
  }

  function hmac(key, data) { return createHmac("sha256", key).update(data).digest(); }
  function sigV4Put(key, body, contentType) {
    const host = r2Account + ".r2.cloudflarestorage.com";
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:\-]|\.\d{3}/g, "").slice(0, 15) + "Z";
    const dateStr = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256").update(body).digest("hex");
    const canonicalUri = "/" + r2Bucket + "/" + key;
    const canonicalHeaders = "content-type:" + contentType + "\nhost:" + host + "\nx-amz-content-sha256:" + payloadHash + "\nx-amz-date:" + amzDate + "\n";
    const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = "PUT\n" + canonicalUri + "\n\n" + canonicalHeaders + "\n" + signedHeaders + "\n" + payloadHash;
    const credScope = dateStr + "/auto/s3/aws4_request";
    const strToSign = "AWS4-HMAC-SHA256\n" + amzDate + "\n" + credScope + "\n" + createHash("sha256").update(canonicalRequest).digest("hex");
    const signingKey = hmac(hmac(hmac(hmac("AWS4" + r2Secret, dateStr), "auto"), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(strToSign).digest("hex");
    const authorization = "AWS4-HMAC-SHA256 Credential=" + r2Key + "/" + credScope + ", SignedHeaders=" + signedHeaders + ", Signature=" + signature;
    return { url: "https://" + host + canonicalUri, headers: { Authorization: authorization, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash, "content-type": contentType, host } };
  }

  const now = new Date(Date.now() + 7 * 3600000); // WIB
  const dateStr = now.toISOString().slice(0, 10); // "2026-06-16" — folder ber-tanggal (riwayat point-in-time)
  const tables = ["invoices", "orders", "customers", "service_reports"];
  const results = {};

  // PostgREST membatasi 1000 baris/response → .limit(5000) TIDAK berlaku. Paginate via .range()
  // agar backup LENGKAP (sebelumnya tabel >1000 baris terpotong diam-diam).
  async function fetchAllRows(table) {
    const PAGE = 1000;
    const all = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select("*").order("created_at", { ascending: false }).range(from, from + PAGE - 1);
      if (error) return { error };
      all.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return { data: all };
  }

  for (const table of tables) {
    try {
      const { data, error } = await fetchAllRows(table);
      if (error) { results[table] = "ERROR: " + error.message; continue; }
      const body = JSON.stringify({ exported_at: new Date().toISOString(), table, count: data.length, data });
      const r2Key2 = "backup/" + dateStr + "/" + table + ".json";
      const { url, headers } = sigV4Put(r2Key2, body, "application/json");
      const putRes = await fetch(url, { method: "PUT", headers, body });
      results[table] = putRes.ok ? data.length + " rows" : "PUT_FAIL:" + putRes.status;
    } catch(e) {
      results[table] = "EXCEPTION: " + e.message;
    }
  }

  // Catat ke backup_log (notes = path folder, dipakai untuk retensi di bawah)
  const successTables = tables.filter(t => results[t] && !results[t].startsWith("ERROR") && !results[t].startsWith("PUT_FAIL") && !results[t].startsWith("EXCEPTION"));
  try {
    await sb.from("backup_log").insert({
      type: "auto-r2-weekly",
      tables: successTables,           // ARRAY column — jangan join
      row_counts: results,             // jsonb column — pass object langsung
      exported_by: "CRON",
      notes: "backup/" + dateStr + "/"
    });
  } catch(e) { console.error("[BACKUP_LOG]", e.message); }

  // ── Retensi 60 hari (2 bulan): hapus folder backup lama dari R2 + backup_log ──
  // Folder ber-tanggal di-track via backup_log.notes ("backup/YYYY-MM-DD/"). Format lama
  // (yearMonth / notes non-tanggal) di-skip aman — tidak ikut terhapus.
  let purgedBackups = 0;
  try {
    const cutoffISO = new Date(Date.now() - 60 * 86400000).toISOString();
    const { data: oldLogs } = await sb.from("backup_log")
      .select("id, tables, notes").lt("created_at", cutoffISO).limit(50);
    for (const bl of oldLogs || []) {
      const folder = String(bl.notes || "").trim().replace(/^backup\//, "").replace(/\/$/, "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(folder)) continue; // hanya folder ber-tanggal
      const tbls = (Array.isArray(bl.tables) && bl.tables.length) ? bl.tables : tables;
      for (const t of tbls) { await deleteR2Object("backup/" + folder + "/" + t + ".json"); }
      await sb.from("backup_log").delete().eq("id", bl.id);
      purgedBackups++;
    }
  } catch(e) { console.error("[BACKUP_RETENTION]", e.message); }

  const summary = "Backup " + dateStr + ": " + Object.entries(results).map(([t, r]) => t + "=" + r).join(", ") + (purgedBackups ? ` | retensi: hapus ${purgedBackups} backup >60h` : "");
  await log("BACKUP_DATA", summary, successTables.length === tables.length ? "SUCCESS" : "WARNING");
  return { dateStr, results, purgedBackups };
}

// ══════════════════════════════════════════════════
// PAYROLL WA — Sabtu 18:00 WIB (11:00 UTC)
// Kirim slip gaji ke semua aktif Teknisi & Helper
// ══════════════════════════════════════════════════
export async function taskPayrollWA() {
  const { data: togRows } = await sb.from("app_settings").select("key,value")
    .in("key", ["payroll_wa_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togRows || []).map(r => [r.key, r.value]));
  if (!isCronJobEnabled(togMap, "payroll_wa_enabled") || togMap["payroll_wa_enabled"] !== "true") {
    return { skipped: true, reason: "payroll_wa_enabled=false" };
  }

  // Hitung periode minggu ini (Senin–Sabtu)
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now); monday.setDate(now.getDate() + diffToMon);
  const saturday = new Date(monday); saturday.setDate(monday.getDate() + 5);
  const periodStart = monday.toISOString().slice(0, 10);
  const periodEnd   = saturday.toISOString().slice(0, 10);

  // Ambil semua payroll minggu ini yang belum dikirim WA
  const { data: rows } = await sb.from("weekly_payroll")
    .select("*, user_profiles!weekly_payroll_user_id_fkey(phone)")
    .eq("period_start", periodStart)
    .is("wa_sent_at", null);

  if (!rows || rows.length === 0) return { skipped: true, reason: "no_payroll_rows" };

  const fmt = n => Number(n || 0).toLocaleString("id-ID");
  const fmtD = d => d ? new Date(d + "T00:00:00").toLocaleDateString("id-ID", { day: "numeric", month: "short" }) : "-";

  let sent = 0, failed = 0;
  for (const row of rows) {
    const phone = row.user_profiles?.phone;
    if (!phone) { failed++; continue; }

    const fullBonus = row.role === "Helper" ? 75000 : 100000;
    const lateStr   = row.late_days > 0 ? `\nTelat Masuk : ${row.late_days} hr × -Rp 10.000 = -Rp ${fmt(row.late_days * 10000)}` : "";
    const kasbonStr = row.kasbon_total > 0 ? `\nKasbon : -Rp ${fmt(row.kasbon_total)}` : "";
    const fullStr   = row.full_week_bonus ? `\nBonus Full Week : +Rp ${fmt(fullBonus)}` : "";
    const manStr    = row.manual_bonus > 0 ? `\nBonus Manual : +Rp ${fmt(row.manual_bonus)}${row.manual_bonus_note ? " (" + row.manual_bonus_note + ")" : ""}` : "";

    // Ambil bonus yang DIBAYAR minggu ini (filter by paid_at, BUKAN order_date —
    // komisi cair 30–45 hari setelah order_date, jadi order_date pasti di luar rentang minggu ini).
    const { data: bonuses } = await sb.from("order_bonuses")
      .select("bonus_type,total_amount,amount_per_person,order_id")
      .eq("status", "PAID")
      .gte("paid_at", periodStart)
      .lte("paid_at", periodEnd + "T23:59:59")
      .contains("team_members", [row.user_name]);

    const totalKomisi = (bonuses || []).reduce((s, b) => s + Number(b.amount_per_person || 0), 0);
    const bonusLines  = (bonuses || []).length > 0
      ? (bonuses || []).map(b => `[${b.order_id || "-"}] : +Rp ${fmt(b.amount_per_person)}`).join("\n")
      : "Belum ada komisi dibayar minggu ini";

    const msg = `📋 *SLIP GAJI MINGGUAN*\n━━━━━━━━━━━━━━━━━━━━━\n👷 *${row.user_name}* | ${row.role}\nPeriode: ${fmtD(row.period_start)} – ${fmtD(row.period_end)}\n━━━━━━━━━━━━━━━━━━━━━\n*GAJI POKOK*\nHari Masuk : ${row.days_worked} hari × Rp ${fmt(row.daily_rate)}\n             = Rp ${fmt(row.days_worked * row.daily_rate)}${fullStr}${lateStr}${kasbonStr}${manStr}\n━━━━━━━━━━━━━━━━━━━━━\n*KOMISI (Dibayar Minggu Ini)*\n${bonusLines}\nTotal Komisi: Rp ${fmt(totalKomisi)}\n━━━━━━━━━━━━━━━━━━━━━\n*TOTAL GAJI : Rp ${fmt(row.gross_salary)}*\nStatus : ${row.is_paid ? "✅ SUDAH DIBAYAR" : "⏳ BELUM DIBAYAR"}\n━━━━━━━━━━━━━━━━━━━━━`;

    const ok = await sendWA(phone, msg);
    if (ok) {
      await sb.from("weekly_payroll").update({ wa_sent_at: new Date().toISOString() }).eq("id", row.id);
      sent++;
    } else { failed++; }
  }

  // NB: flip PENDING → ELIGIBLE dipindah ke taskBonusEligible (harian, independen).
  // Dulu di sini → tak jalan kalau tak ada payroll row minggu ini (early-return di atas).

  await log("PAYROLL_WA", `Sent=${sent} Failed=${failed} period=${periodStart}`, sent > 0 ? "SUCCESS" : "WARN");
  return { sent, failed, period: periodStart };
}

// ══════════════════════════════════════════════════
// TASK: Bonus Eligible — flip komisi PENDING → ELIGIBLE setelah >30 hari (harian, independen)
// Dipisah dari payroll-wa supaya status DB tetap akurat walau payroll belum digenerate / WA OFF.
// PENTING: builder Supabase TIDAK punya .catch (cuma thenable) — pakai await+try/catch.
// ══════════════════════════════════════════════════
export async function taskBonusEligible() {
  try {
    const { error } = await sb.rpc("fn_auto_eligible_bonuses");
    if (error) throw new Error(error.message);
    await log("BONUS_ELIGIBLE", "Komisi >30 hari di-flip ke ELIGIBLE", "SUCCESS");
    return { ok: true };
  } catch (e) {
    try { Sentry.captureException(e, { tags: { op: "fn_auto_eligible_bonuses" } }); } catch (_) {}
    await log("BONUS_ELIGIBLE", `fail: ${e.message}`, "ERROR");
    return { ok: false, error: e.message };
  }
}

// ══════════════════════════════════════════════════
// TASK: maintenance-contract-expiry — Senin 10:00 WIB
// Alert Owner 30 hari dan 7 hari sebelum kontrak maintenance expired.
// ══════════════════════════════════════════════════
export async function taskMaintenanceContractExpiry() {
  const { data: togData } = await sb.from("app_settings").select("key,value")
    .in("key", ["maintenance_contract_expiry_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "maintenance_contract_expiry_enabled") || togMap["maintenance_contract_expiry_enabled"] !== "true") {
    await log("MAINTENANCE_CONTRACT_EXPIRY", "Dilewati — maintenance_contract_expiry_enabled OFF", "INFO");
    return { skipped: true };
  }
  const ownerPhone = process.env.OWNER_PHONE;
  if (!ownerPhone) return { skipped: true, reason: "OWNER_PHONE not set" };

  const today = new Date().toISOString().slice(0, 10);
  const in7  = new Date(Date.now() + 7  * 86400000).toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const { data: expiring } = await sb
    .from("maintenance_contracts")
    .select("id, contract_number, title, end_date, client_id, maintenance_clients(name)")
    .eq("status", "active")
    .lte("end_date", in30)
    .gte("end_date", today)
    .order("end_date");

  if (!expiring?.length) {
    await log("MAINTENANCE_CONTRACT_EXPIRY", "Tidak ada kontrak yang akan expired dalam 30 hari", "INFO");
    return { ok: true, checked: 0 };
  }

  const lines = expiring.map(c => {
    const daysLeft = Math.ceil((new Date(c.end_date) - new Date()) / 86400000);
    const urgency = daysLeft <= 7 ? "🔴 MENDESAK" : "⚠️ Perhatian";
    const clientName = c.maintenance_clients?.name || c.client_id;
    return `${urgency} ${clientName}\n  Kontrak: ${c.contract_number}\n  Berakhir: ${c.end_date} (${daysLeft} hari lagi)`;
  });

  const msg = `📋 *KONTRAK MAINTENANCE — AKAN EXPIRED*\n\n${lines.join("\n\n")}\n\nSegera hubungi klien untuk perpanjangan kontrak.`;
  await sendWA(ownerPhone, msg);
  await log("MAINTENANCE_CONTRACT_EXPIRY", `Alert ${expiring.length} kontrak — ${expiring.map(c=>c.contract_number).join(",")}`, "INFO");
  return { ok: true, alerted: expiring.length };
}

// TASK: maintenance-followup-alert — 10:00 WIB harian
// Cari followup maintenance dengan status 'open' lebih dari 3 hari → WA alert ke Owner.
// Pattern: sama seperti laporan-stale. Toggle: maintenance_followup_alert_enabled
// ══════════════════════════════════════════════════
export async function taskMaintenanceFollowupAlert() {
  const { data: togData } = await sb.from("app_settings").select("key,value")
    .in("key", ["maintenance_followup_alert_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "maintenance_followup_alert_enabled") || togMap["maintenance_followup_alert_enabled"] !== "true") {
    await log("MAINTENANCE_FOLLOWUP_ALERT", "Dilewati — maintenance_followup_alert_enabled OFF", "INFO");
    return { skipped: true };
  }

  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: stale } = await sb
    .from("maintenance_followups")
    .select("id,issue_type,description,found_date,found_by,priority,maintenance_units(unit_code,location),maintenance_clients(name)")
    .eq("status", "open")
    .lte("found_date", threeDaysAgo)
    .order("priority", { ascending: true })   // critical dulu
    .order("found_date", { ascending: true })
    .limit(30);

  if (!stale?.length) {
    await log("MAINTENANCE_FOLLOWUP_ALERT", "Tidak ada followup open >3 hari", "INFO");
    return { checked: true, staleCount: 0 };
  }

  const ISSUE_LABEL = {
    kapasitor_rusak: "Kapasitor Rusak",
    bocor_freon: "Bocor Freon",
    kompresor_lemah: "Kompresor Lemah",
    drain_tersumbat: "Drain Tersumbat",
    pcb_rusak: "PCB Rusak",
    filter_buntu: "Filter Buntu",
    fan_motor_lemah: "Fan Motor Lemah",
    lainnya: "Temuan Lain",
  };
  const PRIORITY_ICON = { critical: "🔴", high: "🟠", normal: "🟡", low: "⚪" };

  const tgl = new Date(Date.now() + 7 * 60 * 60 * 1000).toLocaleDateString("id-ID", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  let msg = `🔧 *FOLLOWUP MAINTENANCE BELUM DITANGANI*\n${tgl}\n\n`;
  msg += `${stale.length} temuan lapangan sudah >3 hari belum selesai:\n\n`;

  stale.forEach((f, i) => {
    const unit = f.maintenance_units;
    const client = f.maintenance_clients;
    const hariLewat = Math.floor((Date.now() - new Date(f.found_date).getTime()) / (1000 * 60 * 60 * 24));
    const icon = PRIORITY_ICON[f.priority] || "🟡";
    msg += `${i + 1}. ${icon} *${ISSUE_LABEL[f.issue_type] || f.issue_type}*\n`;
    msg += `   Unit: ${unit?.unit_code || "?"} — ${unit?.location || "?"}\n`;
    if (client?.name) msg += `   Klien: ${client.name}\n`;
    msg += `   Ditemukan: ${f.found_date} (${hariLewat} hari lalu)`;
    if (f.found_by) msg += ` oleh ${f.found_by}`;
    msg += "\n";
    if (f.description) msg += `   Catatan: ${f.description}\n`;
    msg += "\n";
  });

  msg += `_Segera tindak lanjuti atau buat quotasi ke klien. — ARA AClean_`;

  // Tandai wa_alerted_at untuk semua yang baru saja di-alert (anti spam harian)
  const alertIds = stale.map(f => f.id);
  await sb.from("maintenance_followups")
    .update({ wa_alerted_at: new Date().toISOString() })
    .in("id", alertIds)
    .is("wa_alerted_at", null);   // hanya yang belum pernah di-alert hari ini

  const waSent = await sendWA(OWNER_PHONE, msg);
  await log("MAINTENANCE_FOLLOWUP_ALERT", `Alert: ${stale.length} followup open >3 hari`, waSent ? "SUCCESS" : "WARNING");
  return { staleCount: stale.length, waSent };
}

