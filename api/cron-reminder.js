/**
 * /api/cron-reminder.js — ENTRY CRON (1 serverless function)
 * Task dipecah per domain ke api/_tasks/ (prefix _ tidak dihitung function
 * Vercel) — file ini tinggal: auth (CRON_SECRET/App Token), dispatcher tick
 * (jadwal jam WIB), dan task map. Helper bersama di _tasks/_shared.js.
 */

import * as Sentry from "@sentry/node";
import { timingSafeEqual } from "crypto";
import { initSentry, setCronContext } from "./sentry-init.js";
import { runWithCronLogging } from "./_logger.js";
import { verifyAppToken } from "./_auth.js";
import { sb, sendWA, log, OWNER_PHONE } from "./_tasks/_shared.js";
import { taskCleanup, taskR2Cleanup90d, taskExpenseFotoCleanup30d, taskPaymentProofCleanup90d, taskSnapshotCleanup, taskWaCleanup, taskLogCleanup } from "./_tasks/cleanup.js";
import { taskReminder, taskDaily, taskStock, taskServisReminder, taskVoucherExpiryReminder, taskLaporanStaleAlert, taskMaterialPulangReminder, taskWeeklyReport, taskMorningDispatch, taskRatingPrompt } from "./_tasks/reminders.js";
import { taskWaSnapshot, taskWaBackfill, taskScanBuktiBayar } from "./_tasks/wa-ai.js";
import { taskProjectAlerts, taskAutoReturnBrought, taskBackupData, taskPayrollWA, taskBonusEligible, taskMaintenanceContractExpiry, taskMaintenanceFollowupAlert } from "./_tasks/ops.js";

// Initialize Sentry
initSentry();

// ══════════════════════════════════════════════════
// TASK: tick — DISPATCHER untuk Vercel Hobby (cron native tak andal, maks 2/hari).
// Dipanggil sering dari luar (GitHub Actions per jam). Cek jam WIB → jalankan task yang
// jadwalnya sudah tiba hari ini & BELUM sukses hari ini (catch-up, idempoten via cron_runs).
// Cap per-invocation agar tidak timeout; sisa task tertangani tick berikutnya.
// bukti-bayar: jalan tiap tick jam kerja (idempoten internal, tak perlu guard harian).
// ══════════════════════════════════════════════════
async function taskTick() {
  const nowWib = new Date(Date.now() + 7 * 3600000);
  const hour = nowWib.getUTCHours();   // jam WIB
  const dow  = nowWib.getUTCDay();     // 0=Min..6=Sab (WIB)
  const dom  = nowWib.getUTCDate();    // tanggal WIB
  const CAP  = 6;                       // maks task non-bukti per tick

  // Jadwal: jam WIB tiap task (konversi dari skema lama UTC+7). dow/dom opsional.
  const schedule = [
    { t: "cleanup",                  fn: taskCleanup,                h: 2,  dom: 1 },
    { t: "r2-cleanup-90d",           fn: taskR2Cleanup90d,           h: 3 },
    { t: "expense-foto-cleanup",     fn: taskExpenseFotoCleanup30d,  h: 3 },
    { t: "log-cleanup",              fn: taskLogCleanup,             h: 3,  dow: 0 },
    { t: "payment-proof-cleanup",    fn: taskPaymentProofCleanup90d, h: 3 },
    { t: "stock",                    fn: taskStock,                  h: 8 },
    { t: "servis-reminder",          fn: taskServisReminder,         h: 8,  dow: 1 },
    { t: "weekly",                   fn: taskWeeklyReport,           h: 8,  dow: 0 },
    { t: "backup",                   fn: taskBackupData,             h: 8,  dow: 1 },
    { t: "wa-cleanup",               fn: taskWaCleanup,              h: 9 },
    { t: "rating-prompt",            fn: taskRatingPrompt,           h: 9 },
    { t: "project-alerts",           fn: taskProjectAlerts,          h: 9 },
    { t: "morning-dispatch",         fn: taskMorningDispatch,        h: 9 },
    { t: "reminder",                 fn: taskReminder,               h: 10 },
    { t: "voucher-expiry",           fn: taskVoucherExpiryReminder,  h: 10 },
    { t: "laporan-stale",              fn: taskLaporanStaleAlert,          h: 10 },
    { t: "maintenance-followup-alert", fn: taskMaintenanceFollowupAlert,   h: 10 },
    { t: "maintenance-contract-expiry", fn: taskMaintenanceContractExpiry, h: 10, dow: 1 },
    { t: "snapshot-cleanup",           fn: taskSnapshotCleanup,            h: 10 },
    { t: "bonus-eligible",           fn: taskBonusEligible,          h: 7 },
    { t: "payroll-wa",               fn: taskPayrollWA,              h: 18, dow: 6 },
    // wa-snapshot DIMATIKAN dari jadwal (4 Jul 2026) — window review pattern WA
    // selesai 12 Jun; dump harian percakapan grup tak lagi diperlukan. Fungsi
    // taskWaSnapshot tetap ada utk manual: /api/cron-reminder?task=wa-snapshot.
    // Data lama wa_daily_snapshots ter-purge otomatis oleh snapshot-cleanup (60h).
    { t: "daily",                    fn: taskDaily,                  h: 21 },
    { t: "auto-return-brought",      fn: taskAutoReturnBrought,      h: 22 },
    { t: "material-pulang-reminder", fn: taskMaterialPulangReminder, h: 22 },
  ];

  const ran = [];
  // bukti-bayar: scan tiap tick jam kerja 9-18 WIB
  if (hour >= 9 && hour <= 18) {
    try { await runWithCronLogging(sb, "bukti-bayar", () => taskScanBuktiBayar()); ran.push("bukti-bayar"); }
    catch (e) { console.error("[TICK] bukti-bayar", e.message); }
  }

  // Task due hari ini (jamnya sudah tiba) & cocok dow/dom
  const due = schedule.filter(s =>
    hour >= s.h &&
    (s.dow === undefined || s.dow === dow) &&
    (s.dom === undefined || s.dom === dom)
  );

  // Mana yang BELUM jalan hari ini (cron_runs since WIB-midnight) → catch-up idempoten
  const midnightWibUtc = new Date(Date.UTC(nowWib.getUTCFullYear(), nowWib.getUTCMonth(), nowWib.getUTCDate()) - 7 * 3600000).toISOString();
  const { data: todayRuns } = await sb.from("cron_runs").select("task_name").gte("started_at", midnightWibUtc);
  const alreadyRan = new Set((todayRuns || []).map(r => r.task_name));

  let count = 0, pending = 0;
  for (const s of due) {
    if (alreadyRan.has(s.t)) continue;
    if (count >= CAP) { pending++; continue; }
    try { await runWithCronLogging(sb, s.t, () => s.fn()); ran.push(s.t); count++; }
    catch (e) { console.error("[TICK]", s.t, e.message); }
  }

  await log("TICK", `${hour}:00 WIB — jalan: ${ran.join(", ") || "(tidak ada/selesai)"}${pending ? ` | sisa ${pending} (tick berikutnya)` : ""}`, "INFO");
  return { hourWib: hour, ran, pending };
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
      "backup":           taskBackupData,
      "weekly":           taskWeeklyReport,
      "morning-dispatch": taskMorningDispatch,
      "rating-prompt":    taskRatingPrompt,
      "servis-reminder":  taskServisReminder,
      "voucher-expiry":   taskVoucherExpiryReminder,
      "laporan-stale":              taskLaporanStaleAlert,
      "maintenance-followup-alert":  taskMaintenanceFollowupAlert,
      "maintenance-contract-expiry": taskMaintenanceContractExpiry,
      "material-pulang-reminder":   taskMaterialPulangReminder,
      "payroll-wa":       taskPayrollWA,
      "bonus-eligible":   taskBonusEligible,
      "log-cleanup":      taskLogCleanup,
      "auto-return-brought": taskAutoReturnBrought,
      "r2-cleanup-90d":   taskR2Cleanup90d,
      "expense-foto-cleanup": taskExpenseFotoCleanup30d,
      "payment-proof-cleanup": taskPaymentProofCleanup90d,
      "wa-snapshot":      taskWaSnapshot,
      "wa-backfill":      () => taskWaBackfill({ from: req.query.from, to: req.query.to }),
      "snapshot-cleanup": taskSnapshotCleanup,
      "project-alerts":   taskProjectAlerts,
      "reminder":         taskReminder,
      "tick":             taskTick,
    };
    const handler = taskMap[task] || taskReminder;
    const taskKey = taskMap[task] ? task : "reminder";

    const result = await runWithCronLogging(sb, taskKey, () => handler());

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
