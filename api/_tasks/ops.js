// api/_tasks/ops.js — Task cron grup ops (dipindah APA ADANYA dari
// api/cron-reminder.js, pemecahan _tasks/ Jul 2026). Entry & jadwal tetap di cron-reminder.js.
import { sb, sendWA, sendWAWithResult, isCronJobEnabled, fmt, log, deleteR2Object, OWNER_PHONE } from "./_shared.js";
import * as Sentry from "@sentry/node";
import { backupFolder, mapWithConcurrency } from "../_r2-key.js";
import { BACKUP_TABLES } from '../_backup.js';

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

// Encrypted transactional export; shared with the explicit manual CLI.
export { taskBackupData } from './backup.js';

// Independent cleanup: does not create a backup or send messages.
export async function taskBackupRetention({ db = sb, remove = deleteR2Object } = {}) {
  const { data: settings, error: settingsError } = await db.from("app_settings").select("key,value").in("key", ["backup_data_enabled", "cron_jobs"]);
  if (settingsError) throw new Error(settingsError.message);
  const toggles = Object.fromEntries((settings || []).map(row => [row.key, row.value]));
  if (!isCronJobEnabled(toggles, "backup_data_enabled") || toggles.backup_data_enabled !== "true") return { skipped: true, purgedBackups: 0, errors: 0 };
  // Fail closed if the last known complete backup cannot be identified. A prolonged
  // backup failure must never make retention delete the final recovery copy.
  const recent = await db.from('backup_log').select('id,tables,notes,row_counts').order('created_at', { ascending: false }).range(0, 19);
  if (recent.error) throw new Error('Backup pelindung belum dapat dibaca');
  const latestComplete = (recent.data || []).find(row => Array.isArray(row.tables) &&
    (row.row_counts?.format === 2 ? BACKUP_TABLES.every(t => row.tables.includes(t)) && row.row_counts.sha256
      : ['invoices','orders','customers','service_reports'].every(t => row.tables.includes(t))));
  const protectedFolder = backupFolder(latestComplete?.notes);
  if (!protectedFolder) throw new Error('Tidak ada backup lengkap teridentifikasi; retensi dihentikan agar salinan terakhir tidak terhapus');
  const { data: oldLogs, error } = await db.from("backup_log").select("id,tables,notes,row_counts")
    .lt("created_at", new Date(Date.now() - 60 * 86400000).toISOString())
    .or('notes.like."backup/%",notes.like."Backup bulanan ke R2: backup/%"')
    .order("created_at", { ascending: true }).limit(5);
  if (error) throw new Error(error.message);
  const eligible = (oldLogs || []).filter(row => backupFolder(row.notes) !== protectedFolder);
  const outcomes = await mapWithConcurrency(eligible, 2, async row => {
    const folder = backupFolder(row.notes);
    const tables = row.tables;
    if (!folder || !Array.isArray(tables) || !tables.length || tables.some(t => !/^[a-z_]+$/.test(t))) return false;
    let keys;
    if (row.row_counts?.format === 2) {
      keys = [row.row_counts.bundle_key, row.row_counts.manifest_key];
      const prefix = `backup/${folder}/`;
      if (keys.some(k => typeof k !== 'string' || !k.startsWith(prefix) || !/^(bundle-[a-f0-9-]{36}\.json\.gz\.enc|manifest-[a-f0-9-]{36}\.json)$/.test(k.slice(prefix.length)))) return false;
    } else keys = tables.flatMap(t => [`backup/${folder}/${t}.json`, `backup/${folder}/${t}.json.gz`]);
    const deleted = await mapWithConcurrency(keys, 4, remove);
    if (!deleted.every(item => item.status === "fulfilled" && item.value === true)) return false;
    const { error: deleteError } = await db.from("backup_log").delete().eq("id", row.id);
    return !deleteError;
  });
  const purgedBackups = outcomes.filter(r => r.status === "fulfilled" && r.value === true).length;
  const result = { purgedBackups, protectedFolder, items_processed: purgedBackups, errors: outcomes.length - purgedBackups, has_more: oldLogs?.length === 5 && eligible.length > 0 };
  await log("BACKUP_RETENTION", JSON.stringify(result), result.errors ? "WARNING" : "SUCCESS");
  return result;
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
    .in("key", ["maintenance_followup_alert_enabled", "maintenance_followup_repeat_days", "cron_jobs"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "maintenance_followup_alert_enabled") || togMap["maintenance_followup_alert_enabled"] !== "true") {
    await log("MAINTENANCE_FOLLOWUP_ALERT", "Dilewati — maintenance_followup_alert_enabled OFF", "INFO");
    return { skipped: true };
  }

  const repeatDays = Math.max(1, Math.min(30, Number(togMap.maintenance_followup_repeat_days) || 7));
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const alertCutoff = new Date(Date.now() - repeatDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: staleRows, error: staleError } = await sb
    .from("maintenance_followups")
    .select("id,issue_type,description,found_date,found_by,priority,wa_alerted_at,maintenance_units(unit_code,location),maintenance_clients(name)")
    .eq("status", "open")
    .lte("found_date", threeDaysAgo)
    .or(`wa_alerted_at.is.null,wa_alerted_at.lte.${alertCutoff}`)
    .order("found_date", { ascending: true })
    .limit(100);
  if (staleError) throw new Error("Query follow-up maintenance gagal: " + staleError.message);
  const priorityRank = { critical: 0, high: 1, normal: 2, low: 3 };
  const stale = (staleRows || [])
    .sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)
      || String(a.found_date).localeCompare(String(b.found_date)))
    .slice(0, 30);

  if (!stale?.length) {
    await log("MAINTENANCE_FOLLOWUP_ALERT", "Tidak ada followup open >3 hari", "INFO");
    return { checked: true, items_processed: 0, staleCount: 0, repeatDays };
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

  const delivery = await sendWAWithResult(OWNER_PHONE, msg, { retries: 1, timeoutMs: 10000 });
  if (!delivery.ok) {
    await log("MAINTENANCE_FOLLOWUP_ALERT", `Gagal kirim ${stale.length} follow-up setelah ${delivery.attempts} percobaan: ${delivery.error}`, "ERROR");
    // Lempar error supaya cron_runs jujur berstatus FAILED dan tick berikutnya boleh retry.
    throw new Error("WA follow-up maintenance gagal: " + delivery.error);
  }

  // Audit baru ditulis SETELAH provider mengonfirmasi sukses. Update dibatasi status
  // open agar perubahan status oleh Admin saat request berlangsung tidak tertimpa.
  const alertIds = stale.map(f => f.id);
  const { error: markError } = await sb.from("maintenance_followups")
    .update({ wa_alerted_at: new Date().toISOString() })
    .in("id", alertIds)
    .eq("status", "open");
  if (markError) {
    await log("MAINTENANCE_FOLLOWUP_ALERT_AUDIT_FAIL", `WA terkirim tetapi marker ${stale.length} follow-up gagal: ${markError.message}`, "ERROR");
    throw new Error("WA terkirim, tetapi marker follow-up gagal disimpan: " + markError.message);
  }

  await log("MAINTENANCE_FOLLOWUP_ALERT", `Terkirim: ${stale.length} follow-up open >3 hari; cooldown ${repeatDays} hari`, "SUCCESS");
  return { items_processed: stale.length, staleCount: stale.length, waSent: true, attempts: delivery.attempts, repeatDays };
}


// TASK: maintenance-pm-due — Senin 08:00 WIB mingguan
// Roda pengingat PPM: WA ke Owner berisi unit yang jadwal servisnya SUDAH lewat
// (overdue) + yang jatuh tempo ≤7 hari, dikelompokkan per klien. Melengkapi
// auto-roll jadwal di autolog (portal.js) — roll bikin jadwal maju, task ini
// memastikan yang terlewat tidak senyap. Toggle: maintenance_pm_due_enabled.
// ══════════════════════════════════════════════════
export async function taskMaintenancePmDue() {
  const { data: togData } = await sb.from("app_settings").select("key,value")
    .in("key", ["maintenance_pm_due_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "maintenance_pm_due_enabled") || togMap["maintenance_pm_due_enabled"] !== "true") {
    await log("MAINTENANCE_PM_DUE", "Dilewati — maintenance_pm_due_enabled OFF", "INFO");
    return { skipped: true };
  }
  const ownerPhone = process.env.OWNER_PHONE;
  if (!ownerPhone) return { skipped: true, reason: "OWNER_PHONE not set" };

  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10); // WIB
  const in7 = new Date(Date.now() + 7 * 3600_000 + 7 * 86400000).toISOString().slice(0, 10);

  const { data: units } = await sb
    .from("maintenance_units")
    .select("id,unit_code,location,next_service_date,client_id,maintenance_clients(name)")
    .eq("status", "active")
    .not("next_service_date", "is", null)
    .lte("next_service_date", in7)
    .order("next_service_date")
    .limit(500);

  if (!units?.length) {
    await log("MAINTENANCE_PM_DUE", "Tidak ada unit jatuh tempo ≤7 hari", "INFO");
    return { checked: true, due: 0 };
  }

  // Kelompokkan per klien: hitung overdue vs minggu ini
  const byClient = {};
  for (const u of units) {
    const nama = u.maintenance_clients?.name || "(tanpa klien)";
    if (!byClient[nama]) byClient[nama] = { overdue: 0, minggu: 0, contoh: [] };
    const g = byClient[nama];
    if (u.next_service_date < today) g.overdue++; else g.minggu++;
    if (g.contoh.length < 3) g.contoh.push(`${u.unit_code}${u.location ? " (" + u.location + ")" : ""} — ${u.next_service_date}`);
  }
  const totOverdue = units.filter(u => u.next_service_date < today).length;
  const totMinggu = units.length - totOverdue;

  const lines = Object.entries(byClient).map(([nama, g]) =>
    `🏢 *${nama}*\n${g.overdue ? `   🔴 ${g.overdue} unit TERLEWAT\n` : ""}${g.minggu ? `   🟡 ${g.minggu} unit jatuh tempo minggu ini\n` : ""}${g.contoh.map(c => "   • " + c).join("\n")}`);

  const msg = `📅 *JADWAL PM MAINTENANCE*\n\nTotal: 🔴 ${totOverdue} terlewat · 🟡 ${totMinggu} minggu ini\n\n${lines.join("\n\n")}\n\nBuat order dari menu Maintenance → tab Unit (pilih unit → Buat Order).`;
  await sendWA(ownerPhone, msg);
  await log("MAINTENANCE_PM_DUE", `Alert PM: ${totOverdue} overdue + ${totMinggu} minggu ini (${Object.keys(byClient).length} klien)`, "INFO");
  return { ok: true, overdue: totOverdue, due_week: totMinggu };
}

// ══════════════════════════════════════════════════
// TASK: Media-Gap Alert — deteksi Fonnte berhenti kirim media (foto)
// Insiden 14 Agu 2026: seharian 0 foto masuk (Fonnte drop media) padahal 552
// pesan teks normal → bukti transfer customer tak terdeteksi → payment
// suggestion mati DIAM-DIAM (baru ketahuan besoknya). Alert Owner same-day
// kalau WA jelas aktif (banyak pesan masuk) tapi 0 media dalam 5 jam terakhir.
// Toggle: media_gap_alert_enabled (default ON). Owner-only — tak pernah WA ke
// customer, jadi gate cukup isCronJobEnabled (bisa dimatikan di Settings).
// ══════════════════════════════════════════════════
export async function taskMediaGapAlert() {
  const { data: togData } = await sb.from("app_settings").select("key,value")
    .in("key", ["media_gap_alert_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "media_gap_alert_enabled")) {
    await log("MEDIA_GAP_ALERT", "Dilewati — media_gap_alert_enabled OFF", "INFO");
    return { skipped: true };
  }

  // Dedupe: sudah alert dalam 12 jam terakhir → skip (jangan spam Owner).
  const { data: recent } = await sb.from("agent_logs").select("time")
    .eq("action", "MEDIA_GAP_ALERT_FIRED")
    .gte("time", new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString())
    .limit(1);
  if (recent?.length) return { skipped: true, reason: "sudah alert <12j" };

  // Window 5 jam terakhir. Hitung pesan masuk vs media (foto/dokumen/video).
  const since = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  const { count: inbound } = await sb.from("wa_webhook_raw")
    .select("*", { count: "exact", head: true })
    .gte("created_at", since).eq("has_message", true);
  const { count: media } = await sb.from("wa_webhook_raw")
    .select("*", { count: "exact", head: true })
    .gte("created_at", since).eq("has_message", true)
    .in("msg_type", ["image", "document", "video"]);

  const MIN_ACTIVITY = 30;   // WA jelas aktif kalau >=30 pesan masuk dalam 5 jam
  if ((inbound || 0) < MIN_ACTIVITY || (media || 0) > 0) {
    return { checked: true, inbound: inbound || 0, media: media || 0, ok: true };
  }

  // WA aktif tapi 0 media 5 jam → kemungkinan Fonnte berhenti meneruskan gambar.
  const jam = new Date(Date.now() + 7 * 60 * 60 * 1000).toLocaleString("id-ID", { hour: "2-digit", minute: "2-digit" });
  const msg = `⚠️ *ALERT: Media WA Tidak Masuk*\n\n${inbound} pesan masuk dalam 5 jam terakhir, tapi *0 foto/media*. Kemungkinan Fonnte berhenti meneruskan gambar (seperti insiden 14 Agu).\n\nDampak: *bukti transfer customer tidak terdeteksi* → payment suggestion bisa terlewat.\n\nCek: kirim tes foto ke nomor bisnis. Kalau tidak masuk → restart device / scan ulang Fonnte.\n_(per ${jam} WIB)_`;
  await sendWA(OWNER_PHONE, msg);
  await log("MEDIA_GAP_ALERT_FIRED", `${inbound} pesan / 0 media dalam 5 jam → alert Owner`, "WARNING");
  return { alerted: true, inbound: inbound || 0, media: 0 };
}

export { taskDataIntegrityAudit } from './integrity.js';
export { taskInfraUsageAlert } from './infra.js';
