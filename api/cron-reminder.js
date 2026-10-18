/**
 * /api/cron-reminder.js — ENTRY CRON (1 serverless function)
 * Task dipecah per domain ke api/_tasks/ (prefix _ tidak dihitung function
 * Vercel) — file ini tinggal: auth (CRON_SECRET/App Token), dispatcher tick
 * (jadwal jam WIB), dan task map. Helper bersama di _tasks/_shared.js.
 */

import * as Sentry from "@sentry/node";
import { timingSafeEqual } from "crypto";
import { initSentry, setCronContext } from "./sentry-init.js";
import { closeStaleCronRuns, runWithCronLogging } from "./_logger.js";
import { verifyAppToken } from "./_auth.js";
import { dueCronTasks, pendingCronTasks } from "./_cron-result.js";
import { runCronQueue, withDispatcherLease } from './_cron-dispatch.js';
import { taskBackupRetention } from "./_tasks/ops.js";
import { taskFieldReportReminder } from "./_tasks/field-reports.js";
import { sb, sendWA, log, OWNER_PHONE } from "./_tasks/_shared.js";
import { taskCleanup, taskR2Cleanup90d, taskExpenseFotoCleanup30d, taskPaymentProofCleanup90d, taskSnapshotCleanup, taskWaCleanup, taskLogCleanup } from "./_tasks/cleanup.js";
import { taskReminder, taskDaily, taskStock, taskServisReminder, taskVoucherExpiryReminder, taskLaporanStaleAlert, taskMaterialPulangReminder, taskWeeklyReport, taskMorningDispatch, taskRatingPrompt } from "./_tasks/reminders.js";
import { taskWaSnapshot, taskWaBackfill, taskScanBuktiBayar, taskRetryPaymentMedia, taskPaymentMediaWatchdog } from "./_tasks/wa-ai.js";
import { taskProjectAlerts, taskBackupData, taskPayrollWA, taskBonusEligible, taskMaintenanceContractExpiry, taskMaintenanceFollowupAlert, taskMaintenancePmDue, taskMediaGapAlert, taskDataIntegrityAudit, taskInfraUsageAlert } from "./_tasks/ops.js";

// Initialize Sentry
initSentry();

// ══════════════════════════════════════════════════
// TASK: tick — DISPATCHER untuk Vercel Hobby (cron native tak andal, maks 2/hari).
// Dipanggil sering dari luar (GitHub Actions per jam). Cek jam WIB → jalankan task yang
// jadwalnya sudah tiba hari ini & BELUM sukses hari ini (catch-up, idempoten via cron_runs).
// Cap per-invocation agar tidak timeout; sisa task tertangani tick berikutnya.
// bukti-bayar: jalan tiap tick jam kerja (idempoten internal, tak perlu guard harian).
// ══════════════════════════════════════════════════
export async function taskTick(options = {}) {
  return withDispatcherLease(sb, () => taskTickWithLease(options));
}
async function taskTickWithLease({ cleanupOnly = false } = {}) {
  const tickStartedAt = Date.now();
  const nowWib = new Date(Date.now() + 7 * 3600000);
  const hour = nowWib.getUTCHours();   // jam WIB
  // Vercel membatasi endpoint ini 60 detik. Sisakan waktu untuk menutup
  // cron_runs, menulis log, dan mengirim response sebelum platform mematikan proses.
  // Tutup semua run basi, bukan hanya task yang kebetulan sedang dimulai lagi.
  // Ini membuat Monitoring jujur setelah function Vercel pernah diputus paksa.
  await closeStaleCronRuns(sb, 20 * 60 * 1000);

  // Jadwal: jam WIB tiap task (konversi dari skema lama UTC+7). dow/dom opsional.
  const schedule = [
    // Time-sensitive: before slow quota/cleanup work, durable dedup per person/day.
    { t: "field-report-reminder", fn: taskFieldReportReminder, h: 20, repeatable: true, priority: 2, budgetMs: 18_000 },
    { t: "payment-media-retry", fn: taskRetryPaymentMedia, h: 0, repeatable: true, intervalMs: 15 * 60_000, priority: 3, budgetMs: 11_000 },
    { t: "bukti-bayar", fn: taskScanBuktiBayar, h: 9, untilHour: 18, repeatable: true, intervalMs: 60 * 60_000 },
    { t: "cleanup",                  fn: taskCleanup,                h: 2, dom: 1, cleanup: true },
    { t: "r2-cleanup-90d",           fn: taskR2Cleanup90d,           h: 3, cleanup: true },
    { t: "expense-foto-cleanup",     fn: taskExpenseFotoCleanup30d,  h: 3, cleanup: true },
    // Bounded 2.000 baris/tabel; harian agar backlog turun bertahap tanpa spike DB.
    { t: "log-cleanup",              fn: taskLogCleanup,             h: 3, cleanup: true },
    { t: "payment-proof-cleanup",    fn: taskPaymentProofCleanup90d, h: 3, cleanup: true },
    { t: "backup-retention",         fn: taskBackupRetention, h: 3, cleanup: true },
    { t: "stock",                    fn: taskStock,                  h: 8 },
    { t: "servis-reminder",          fn: taskServisReminder,         h: 8,  dow: 1 },
    { t: "weekly",                   fn: taskWeeklyReport,           h: 8,  dow: 0 },
    // Backup cukup berat; jam 11 memisahkannya dari task stok/weekly jam 8.
    { t: "backup", fn: taskBackupData, h: 11, dow: 1, catchUpWeekly: true, continuable: true, priority: 1, budgetMs: 24_000, minimumMs: 23_000 },
    { t: "wa-cleanup",               fn: taskWaCleanup,              h: 9, cleanup: true },
    { t: "rating-prompt",            fn: taskRatingPrompt,           h: 9 },
    { t: "project-alerts",           fn: taskProjectAlerts,          h: 9 },
    { t: "morning-dispatch",         fn: taskMorningDispatch,        h: 9 },
    { t: "reminder",                 fn: taskReminder,               h: 10 },
    { t: "voucher-expiry",           fn: taskVoucherExpiryReminder,  h: 10 },
    { t: "laporan-stale",              fn: taskLaporanStaleAlert,          h: 10 },
    { t: "maintenance-followup-alert", fn: taskMaintenanceFollowupAlert,   h: 10 },
    { t: "maintenance-contract-expiry", fn: taskMaintenanceContractExpiry, h: 10, dow: 1 },
    { t: "maintenance-pm-due",         fn: taskMaintenancePmDue,          h: 8,  dow: 1 },
    { t: "snapshot-cleanup",           fn: taskSnapshotCleanup,            h: 10, cleanup: true },
    { t: "bonus-eligible",           fn: taskBonusEligible,          h: 7 },
    { t: "media-gap-alert",          fn: taskMediaGapAlert,          h: 13 },
    { t: "payment-media-health",     fn: taskPaymentMediaWatchdog,   h: 9 },
    { t: "payment-media-health-sore", fn: taskPaymentMediaWatchdog, h: 19 },
    { t: "media-gap-alert-sore",     fn: taskMediaGapAlert,          h: 16 },
    { t: "data-integrity-audit", fn: taskDataIntegrityAudit, h: 7, dow: 1, catchUpWeekly: true, priority: 0, budgetMs: 15_000 },
    { t: "infra-usage-alert", fn: taskInfraUsageAlert, h: 7, continuable: true, budgetMs: 15_000, minimumMs: 12_000 },
    { t: "payroll-wa",               fn: taskPayrollWA,              h: 18, dow: 6 },
    // wa-snapshot DIMATIKAN dari jadwal (4 Jul 2026) — window review pattern WA
    // selesai 12 Jun; dump harian percakapan grup tak lagi diperlukan. Fungsi
    // taskWaSnapshot tetap ada utk manual: /api/cron-reminder?task=wa-snapshot.
    // Data lama wa_daily_snapshots ter-purge otomatis oleh snapshot-cleanup (60h).
    { t: "daily",                    fn: taskDaily,                  h: 21 },
    { t: "material-pulang-reminder", fn: taskMaterialPulangReminder, h: 22 },
  ];

  const due = dueCronTasks(schedule, Date.now(), cleanupOnly).filter(s => s.untilHour === undefined || hour <= s.untilHour);

  // Mana yang BELUM jalan hari ini (cron_runs since WIB-midnight) → catch-up idempoten
  const midnightWibUtc = new Date(Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate()) - 7 * 3600000).toISOString();
  const todayRuns = [];
  const weekStart = new Date(new Date(midnightWibUtc).getTime() - 7 * 86400_000).toISOString();
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from("cron_runs").select("task_name,status,started_at,metadata")
      .in('task_name', due.map(t => t.t)).gte("started_at", weekStart)
      .order('started_at', { ascending: false }).order('id', { ascending: false }).range(from, from + 499);
    if (error) throw new Error('Riwayat cron gagal dibaca: ' + error.message);
    todayRuns.push(...(data || []));
    if ((data || []).length < 500) break;
  }
  const outstanding = pendingCronTasks(due, todayRuns).filter(task => !task.intervalMs || !todayRuns.some(r =>
    r.task_name === task.t && r.status === 'SUCCESS' && Date.now() - new Date(r.started_at).getTime() < task.intervalMs));
  const result = await runCronQueue(outstanding, { startedAt: tickStartedAt,
    run: (name, fn, options) => runWithCronLogging(sb, name, fn, options) });
  await log("TICK", `${hour}:00 WIB — jalan: ${result.ran.join(", ") || "(tidak ada/selesai)"} | sisa ${result.pending}`, "INFO");
  return { ...result, hourWib: hour };
}


export default async function handler(req, res) {
  const { setCorsHeaders } = await import("./_auth.js");
  setCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).end();

  // Auth: terima CRON_SECRET (Bearer) atau INTERNAL_API_SECRET (X-Internal-Token)
  const auth   = req.headers.authorization || "";
  const cronSecret     = process.env.CRON_SECRET;
  const internalSecret = process.env.INTERNAL_API_SECRET;

  let authorized = false;
  // Check CRON_SECRET (Vercel cron / curl)
  if (cronSecret) {
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token.length > 0) {
      const tBuf = Buffer.from(token, "utf-8");
      const sBuf = Buffer.from(cronSecret, "utf-8");
      if (tBuf.length === sBuf.length) authorized = timingSafeEqual(tBuf, sBuf);
    }
  }
  // Check INTERNAL_API_SECRET (manual trigger dari dashboard)
  if (!authorized && internalSecret) {
    const iToken = req.headers["x-internal-token"] || req.headers["x-api-key"] || "";
    if (iToken.length > 0) {
      // Accept App Token (HMAC-signed JWT dari _auth.js signAppToken)
      if (iToken.split(".").length === 3) {
        const claims = verifyAppToken(iToken);
        if (claims) authorized = true;
      } else {
        const tBuf = Buffer.from(iToken, "utf-8");
        const sBuf = Buffer.from(internalSecret, "utf-8");
        if (tBuf.length === sBuf.length) authorized = timingSafeEqual(tBuf, sBuf);
      }
    }
  }

  if (!cronSecret && !internalSecret) return res.status(500).json({error:"Auth not configured"});
  if (!authorized) return res.status(401).json({error:"Unauthorized"});

  // ── task=notify: relay teks → WA Owner (dipakai cloud agent terjadwal: Morning Brief / Ops Review) ──
  // Tujuan SELALU OWNER_PHONE — bukan relay umum, jadi blast radius terbatas walau secret bocor.
  // Tidak di-track di cron_runs (bukan scheduled task). Body: { "message": "..." }.
  if ((req.query.task || "") === "notify") {
    if (req.method !== "POST") return res.status(405).json({ ok:false, error:"POST required" });
    try {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      if (!body || typeof body !== "object") body = {};
      let message = (body.message ?? "").toString().trim();
      if (!message) return res.status(400).json({ ok:false, error:"message kosong" });
      if (message.length > 3500) message = message.slice(0, 3490) + "\n…(dipotong)";
      const sent = await sendWA(OWNER_PHONE, message);
      await log("NOTIFY", `WA ke Owner ${sent ? "terkirim" : "GAGAL"} (${message.length} char)`, sent ? "INFO" : "WARN");
      return res.status(200).json({ ok: sent, task: "notify", chars: message.length });
    } catch (err) {
      await log("NOTIFY", `error: ${err.message}`, "ERROR");
      return res.status(200).json({ ok:false, task:"notify", error: err.message });
    }
  }

  const task = req.query.task || "reminder";
  // Never fall back to invoice reminders when an obsolete URL is invoked.
  if (["auto-return-brought", "auto-verify-laporan", "auto-verify-laporan-48jam"].includes(task)) {
    return res.status(410).json({ ok: false, task, retired: true, error: "Otomasi dihentikan. Material dikelola Admin; verifikasi laporan wajib manual melalui modul." });
  }

  try {
    // Set Sentry context for cron job
    setCronContext(task);

    // Map task name → handler. Pakai runWithCronLogging untuk auto-track cron_runs.
    const taskMap = {
      "daily":            taskDaily,
      "stock":            taskStock,
      "cleanup":          taskCleanup,
      "wa-cleanup":       taskWaCleanup,
      "bukti-bayar":      taskScanBuktiBayar,
      "payment-media-retry": taskRetryPaymentMedia,
      "payment-media-health": taskPaymentMediaWatchdog,
      "backup":           taskBackupData,
      "weekly":           taskWeeklyReport,
      "morning-dispatch": taskMorningDispatch,
      "rating-prompt":    taskRatingPrompt,
      "servis-reminder":  taskServisReminder,
      "voucher-expiry":   taskVoucherExpiryReminder,
      "laporan-stale":              taskLaporanStaleAlert,
      "maintenance-followup-alert":  taskMaintenanceFollowupAlert,
      "maintenance-contract-expiry": taskMaintenanceContractExpiry,
      "maintenance-pm-due":          taskMaintenancePmDue,
      "material-pulang-reminder":   taskMaterialPulangReminder,
      "payroll-wa":       taskPayrollWA,
      "bonus-eligible":   taskBonusEligible,
      "log-cleanup":      taskLogCleanup,
      "field-report-reminder": taskFieldReportReminder,
      "r2-cleanup-90d":   taskR2Cleanup90d,
      "expense-foto-cleanup": taskExpenseFotoCleanup30d,
      "payment-proof-cleanup": taskPaymentProofCleanup90d,
      "wa-snapshot":      taskWaSnapshot,
      "wa-backfill":      () => taskWaBackfill({ from: req.query.from, to: req.query.to }),
      "snapshot-cleanup": taskSnapshotCleanup,
      "project-alerts":   taskProjectAlerts,
      "media-gap-alert":  taskMediaGapAlert,
      "data-integrity-audit": taskDataIntegrityAudit,
      "infra-usage-alert": taskInfraUsageAlert,
      "reminder":         taskReminder,
      "tick":             taskTick,
      "cleanup-tick":     () => taskTick({ cleanupOnly: true }),
      "backup-retention": taskBackupRetention,
    };
    const handler = taskMap[task] || taskReminder;
    const taskKey = taskMap[task] ? task : "reminder";

    const guardedHandler = ['backup', 'infra-usage-alert', 'data-integrity-audit'].includes(taskKey)
      ? () => withDispatcherLease(sb, handler) : handler;
    const result = await runWithCronLogging(sb, taskKey, guardedHandler, {
      timeoutMs: taskKey === "payment-media-retry" ? 50_000 : ["tick", "cleanup-tick"].includes(taskKey) ? 45_000 : 25_000,
      requireAudit: true,
    });

    return res.json({ ok:true, task, timestamp:new Date().toISOString(), ...result });
  } catch(err) {
    await log("CRON_ERROR", `task=${task}: ${err.message}`, "ERROR");

    // Capture cron error to Sentry
    Sentry.captureException(err, {
      tags: {
        type: "cron",
        task: task,
        timestamp: new Date().toISOString(),
      },
    });

    // Return 200 (not 500) so Vercel doesn't retry the cron job
    return res.status(200).json({ ok:false, error:err.message, task });
  }
}
