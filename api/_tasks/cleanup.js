// api/_tasks/cleanup.js — Task cron grup cleanup (dipindah APA ADANYA dari
// api/cron-reminder.js, pemecahan _tasks/ Jul 2026). Entry & jadwal tetap di cron-reminder.js.
import { sb, isCronJobEnabled, log, deleteR2Object } from "./_shared.js";
import { logStructured } from "../_logger.js";

// ══════════════════════════════════════════════════
// TASK 4: Cleanup LOG DB lama (BUKAN foto/R2)
// agent_logs 30h, audit_log 30h, dispatch_logs 90h, payment_suggestions 30h.
// Penghapusan file R2 ada di task terpisah: r2-cleanup-90d, expense-foto-cleanup,
// snapshot-cleanup, payment-proof-cleanup.
// ══════════════════════════════════════════════════
export async function taskCleanup() {
  const result = { agent_logs: 0, audit_log: 0, dispatch_logs: 0, payment_suggestions: 0 };

  // Cutoffs retensi: agent_logs & audit_log = 30 hari, dispatch_logs = 90 hari
  const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const cutoff90 = new Date(Date.now() - 90 * 86400000).toISOString();

  // 1. Cleanup agent_logs > 30 hari (diperpendek dari 90 — kurangi ukuran tabel & beban DB)
  const { error: logDelErr, count: logCount } = await sb.from("agent_logs")
    .delete({ count: "exact" }).lt("created_at", cutoff30);
  if (logDelErr) console.error("[CLEANUP_AGENT_LOGS]", logDelErr.message);
  else result.agent_logs = logCount || 0;

  // 2. Cleanup audit_log > 30 hari (tumbuh paling cepat ~15MB/bulan)
  const { error: auditDelErr, count: auditCount } = await sb.from("audit_log")
    .delete({ count: "exact" }).lt("changed_at", cutoff30);
  if (auditDelErr) console.error("[CLEANUP_AUDIT_LOG]", auditDelErr.message);
  else result.audit_log = auditCount || 0;

  // 3. Cleanup dispatch_logs > 90 hari
  const { error: dispDelErr, count: dispCount } = await sb.from("dispatch_logs")
    .delete({ count: "exact" }).lt("sent_at", cutoff90);
  if (dispDelErr) console.error("[CLEANUP_DISPATCH_LOGS]", dispDelErr.message);
  else result.dispatch_logs = dispCount || 0;

  // 4. Cleanup payment_suggestions RESOLVED/REJECTED > 30 hari
  const { error: suggDelErr, count: suggCount } = await sb.from("payment_suggestions")
    .delete({ count: "exact" })
    .in("status", ["RESOLVED", "REJECTED"])
    .lt("created_at", cutoff30);
  if (suggDelErr) console.error("[CLEANUP_PAYMENT_SUGGESTIONS]", suggDelErr.message);
  else result.payment_suggestions = suggCount || 0;

  const summary = `agent_logs: ${result.agent_logs} | audit_log: ${result.audit_log} | dispatch_logs: ${result.dispatch_logs} | payment_suggestions: ${result.payment_suggestions}`;
  await log("CLEANUP", summary, "SUCCESS");
  return result;
}

// ══════════════════════════════════════════════════
// TASK 5b: Cleanup R2 mirror untuk image grup WA (>90 hari)
// — Image grup di-mirror ke R2 saat masuk (audit trail Phase 1 WA AI).
//   Setelah 90 hari, hapus dari R2 untuk privacy + cost. Row di wa_group_logs
//   tetap tersimpan (metadata only) dengan r2_purged_at terisi.
// ══════════════════════════════════════════════════
export async function taskR2Cleanup90d() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key", ["r2_cleanup_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "r2_cleanup_enabled") || togMap["r2_cleanup_enabled"] !== "true") {
    await log("R2_CLEANUP_90D", "Dilewati — toggle OFF", "INFO");
    return { skipped: true };
  }

  const result = { swept: 0, purged: 0, errors: 0 };
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();

  const { data: rows, error } = await sb.from("wa_group_logs")
    .select("id, r2_image_url, r2_uploaded_at")
    .lt("r2_uploaded_at", cutoff)
    .is("r2_purged_at", null)
    .not("r2_image_url", "is", null)
    .limit(500);
  if (error) {
    await log("R2_CLEANUP_90D", "Query gagal: " + error.message, "ERROR");
    return { error: error.message };
  }
  result.swept = (rows || []).length;
  if (result.swept === 0) {
    await log("R2_CLEANUP_90D", "Tidak ada image >90 hari", "INFO");
    return result;
  }

  for (const row of rows) {
    try {
      // Ekstrak key dari URL (format: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>)
      const url = new URL(row.r2_image_url);
      const parts = url.pathname.split("/").filter(Boolean);
      const key = parts.slice(1).join("/"); // skip bucket name
      if (!key) { result.errors++; continue; }
      const ok = await deleteR2Object(key);
      if (ok) {
        await sb.from("wa_group_logs").update({ r2_purged_at: new Date().toISOString() }).eq("id", row.id);
        result.purged++;
      } else {
        result.errors++;
      }
    } catch (e) {
      result.errors++;
      console.warn("[R2_CLEANUP_90D]", row.id, e.message);
    }
  }

  await log("R2_CLEANUP_90D", `swept=${result.swept} purged=${result.purged} errors=${result.errors}`, "SUCCESS");
  return result;
}

// ══════════════════════════════════════════════════
// TASK: Expense Foto Cleanup — hapus foto R2 pengeluaran teknisi >30 hari
// Sumber: ai_extractions source='teknisi_dashboard'. Record expense TETAP (data keuangan),
// hanya foto bukti yang di-purge agar R2 tidak numpuk. r2_url di-null setelah purge.
// ══════════════════════════════════════════════════
export async function taskExpenseFotoCleanup30d() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key", ["expense_foto_cleanup_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "expense_foto_cleanup_enabled") || togMap["expense_foto_cleanup_enabled"] !== "true") {
    await log("EXPENSE_FOTO_CLEANUP", "Dilewati — toggle OFF", "INFO");
    return { skipped: true };
  }

  const result = { swept: 0, purged: 0, errors: 0 };
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const { data: rows, error } = await sb.from("ai_extractions")
    .select("id, r2_url")
    .eq("source", "teknisi_dashboard")
    .lt("created_at", cutoff)
    .not("r2_url", "is", null)
    .limit(500);
  if (error) { await log("EXPENSE_FOTO_CLEANUP", "Query gagal: " + error.message, "ERROR"); return { error: error.message }; }
  result.swept = (rows || []).length;
  if (result.swept === 0) { await log("EXPENSE_FOTO_CLEANUP", "Tidak ada foto >30 hari", "INFO"); return result; }

  for (const row of rows) {
    try {
      // r2_url format: "/api/foto?key=<encoded>" → ekstrak key
      let key = null;
      try { key = new URL("http://x" + row.r2_url).searchParams.get("key"); } catch { key = null; }
      if (!key) { result.errors++; continue; }
      const ok = await deleteR2Object(key);
      if (ok) {
        await sb.from("ai_extractions").update({ r2_url: null }).eq("id", row.id);
        result.purged++;
      } else { result.errors++; }
    } catch (e) { result.errors++; console.warn("[EXPENSE_FOTO_CLEANUP]", row.id, e.message); }
  }
  await log("EXPENSE_FOTO_CLEANUP", `swept=${result.swept} purged=${result.purged} errors=${result.errors}`, "SUCCESS");
  return result;
}

// ══════════════════════════════════════════════════
// TASK: Payment Proof Cleanup — hapus foto bukti bayar R2 >90 hari (umur file)
// Invoice TETAP utuh (record keuangan), hanya FILE bukti yang di-purge agar R2 tak numpuk.
// payment_proof_url di-set sentinel "purged-90d" setelah hapus (bukan null) supaya
// tidak ikut di-scan ulang taskScanBuktiBayar. Hanya proses URL real "/api/foto?key=..."
// — sentinel (verified-*, manual-confirmed:*) & URL eksternal di-skip.
// Umur dihitung dari coalesce(paid_at, created_at).
// ══════════════════════════════════════════════════
export async function taskPaymentProofCleanup90d() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key", ["payment_proof_cleanup_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "payment_proof_cleanup_enabled") || togMap["payment_proof_cleanup_enabled"] !== "true") {
    await log("PAYMENT_PROOF_CLEANUP", "Dilewati — toggle OFF", "INFO");
    return { skipped: true };
  }

  const result = { swept: 0, purged: 0, errors: 0, skipped_external: 0 };
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  // Hanya bukti real R2 (/api/foto?key=...) yang umurnya >90 hari (pakai paid_at, fallback created_at)
  const { data: rows, error } = await sb.from("invoices")
    .select("id, payment_proof_url, paid_at, created_at")
    .like("payment_proof_url", "/api/foto?key=%")
    .or(`paid_at.lt.${cutoff},and(paid_at.is.null,created_at.lt.${cutoff})`)
    .limit(500);
  if (error) { await log("PAYMENT_PROOF_CLEANUP", "Query gagal: " + error.message, "ERROR"); return { error: error.message }; }
  result.swept = (rows || []).length;
  if (result.swept === 0) { await log("PAYMENT_PROOF_CLEANUP", "Tidak ada bukti bayar >90 hari", "INFO"); return result; }

  for (const row of rows) {
    try {
      // payment_proof_url format: "/api/foto?key=<encoded>" → ekstrak key
      let key = null;
      try { key = new URL("http://x" + row.payment_proof_url).searchParams.get("key"); } catch { key = null; }
      if (!key) { result.skipped_external++; continue; }
      const ok = await deleteR2Object(key);
      if (ok) {
        await sb.from("invoices").update({ payment_proof_url: "purged-90d", updated_at: new Date().toISOString() }).eq("id", row.id);
        result.purged++;
      } else { result.errors++; }
    } catch (e) { result.errors++; console.warn("[PAYMENT_PROOF_CLEANUP]", row.id, e.message); }
  }
  await log("PAYMENT_PROOF_CLEANUP", `swept=${result.swept} purged=${result.purged} errors=${result.errors} skipped=${result.skipped_external}`, "SUCCESS");
  return result;
}

// ══════════════════════════════════════════════════
// TASK: Snapshot cleanup — retention 60 hari
// Hapus objek R2 (file .json) + row wa_daily_snapshots yg > 60 hari.
// FIX: dulu hanya hapus row DB & andalkan r2-cleanup-90d, tapi cron itu hanya
// memproses wa_group_logs → file snapshot orphan selamanya. Sekarang hapus R2 langsung.
// ══════════════════════════════════════════════════
export async function taskSnapshotCleanup() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key", ["snapshot_cleanup_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "snapshot_cleanup_enabled") || togMap["snapshot_cleanup_enabled"] !== "true") {
    await log("SNAPSHOT_CLEANUP", "Dilewati — toggle OFF", "INFO");
    return { skipped: true };
  }

  const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
  // Ambil rows yg expired (utk delete R2 objects)
  const { data: stale } = await sb.from("wa_daily_snapshots")
    .select("id,snapshot_date,r2_key")
    .lt("snapshot_date", cutoff)
    .limit(500);
  const count = (stale || []).length;
  if (count === 0) {
    await log("SNAPSHOT_CLEANUP", "Tidak ada snapshot >60 hari", "INFO");
    return { ok: true, deleted: 0, purged: 0, cutoff };
  }

  // Hapus file R2 per row (key tersimpan di r2_key, format: wa-snapshots/<date>.json)
  let purged = 0, errors = 0;
  for (const row of stale) {
    if (!row.r2_key) continue;
    const ok = await deleteR2Object(row.r2_key);
    if (ok) purged++; else { errors++; console.warn("[SNAPSHOT_CLEANUP] R2 delete gagal:", row.r2_key); }
  }

  // Hapus row DB setelah R2 dibersihkan
  await sb.from("wa_daily_snapshots").delete().lt("snapshot_date", cutoff);
  await log("SNAPSHOT_CLEANUP", `deleted=${count} r2_purged=${purged} errors=${errors} (cutoff ${cutoff})`, "SUCCESS");
  return { ok: true, deleted: count, purged, errors, cutoff };
}

// ══════════════════════════════════════════════════
// TASK 6: Cleanup WA chat lama (>14 hari)
// ══════════════════════════════════════════════════
export async function taskWaCleanup() {
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key",["wa_cleanup_enabled","cron_jobs"]);
  const togMap = Object.fromEntries((togData||[]).map(s=>[s.key, s.value]));
  if (!isCronJobEnabled(togMap, "wa_cleanup_enabled") || togMap["wa_cleanup_enabled"] !== "true") {
    await log("WA_CLEANUP", "Dilewati — WA Auto-Cleanup dinonaktifkan via Settings", "INFO");
    return { skipped: true };
  }

  // ── Rekonsiliasi status payment_suggestion (cegah PENDING basi) ──
  // PENDING yang invoice-nya sudah PAID → CONFIRMED. Kalau dibiarkan, status nyangkut PENDING
  // selamanya → proteksi cleanup melebar (hapus 0 pesan) + antrian payment numpuk. Jalan harian.
  try {
    const { data: pend } = await sb.from("payment_suggestions")
      .select("id, invoice_id").eq("status", "PENDING").not("invoice_id", "is", null);
    const invIds = [...new Set((pend || []).map(p => p.invoice_id).filter(Boolean))];
    if (invIds.length > 0) {
      const { data: invs } = await sb.from("invoices").select("id, status").in("id", invIds);
      const paidSet = new Set((invs || []).filter(i => i.status === "PAID").map(i => i.id));
      const toConfirm = (pend || []).filter(p => paidSet.has(p.invoice_id)).map(p => p.id);
      if (toConfirm.length > 0) {
        await sb.from("payment_suggestions")
          .update({ status: "CONFIRMED", resolved_at: new Date().toISOString(), resolved_by: "system::auto-reconcile" })
          .in("id", toConfirm);
        await log("PAYMENT_RECONCILE", `${toConfirm.length} payment_suggestion PENDING→CONFIRMED (invoice sudah PAID)`);
      }
    }
  } catch (e) { console.error("[PAYMENT_RECONCILE]", e.message); }

  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();

  // Lindungi HANYA nomor dengan payment_suggestion PENDING yang masih BARU (<14 hari).
  // PENTING: dulu melindungi SEMUA PENDING (termasuk yang basi >14h = artefak antrian, invoice
  // sebenarnya sudah lunas tapi status tak pernah jadi CONFIRMED). Akibatnya ratusan nomor basi
  // melindungi hampir semua chat lama → cleanup hapus 0 pesan & data numpuk. Batasi ke <14h.
  const { data: pendingSugg } = await sb.from("payment_suggestions")
    .select("phone").eq("status", "PENDING").gte("created_at", cutoff);
  const protectedPhones = [...new Set((pendingSugg || []).map(p => p.phone).filter(Boolean))];

  // Hapus SEMUA wa_messages >14 hari sekaligus (kecuali nomor terlindungi) — DELETE by-condition,
  // bukan fetch+limit kecil, supaya backlog tidak pernah menumpuk. Postgres tangani puluhan ribu
  // baris dalam milidetik.
  let msgQ = sb.from("wa_messages").delete({ count: "exact" }).lt("created_at", cutoff);
  if (protectedPhones.length > 0) msgQ = msgQ.not("phone", "in", `(${protectedPhones.join(",")})`);
  const { error: msgErr, count: msgsDeleted } = await msgQ;
  if (msgErr) console.error("[WA_CLEANUP_MSG]", msgErr.message);

  let convQ = sb.from("wa_conversations").delete({ count: "exact" }).lt("updated_at", cutoff);
  if (protectedPhones.length > 0) convQ = convQ.not("phone", "in", `(${protectedPhones.join(",")})`);
  const { error: convErr, count: convsDeleted } = await convQ;
  if (convErr) console.error("[WA_CLEANUP_CONV]", convErr.message);

  // wa_webhook_raw: retensi 30 hari. Tabel firehose (130k+ insert/batch) — tanpa retensi jadi
  // storage hog ~20 MB+. Tidak ada data sensitif di sini (hanya raw payload webhook Fonnte).
  const rawCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const { error: rawErr, count: rawDeleted } = await sb
    .from("wa_webhook_raw").delete({ count: "exact" }).lt("created_at", rawCutoff);
  if (rawErr) console.error("[WA_CLEANUP_RAW]", rawErr.message);

  await log("WA_CLEANUP", `${msgsDeleted || 0} pesan & ${convsDeleted || 0} conversations dihapus (>14 hari). ${protectedPhones.length} phone dilindungi. ${rawDeleted || 0} wa_webhook_raw dihapus (>30 hari).`);
  return { msgsDeleted: msgsDeleted || 0, convsDeleted: convsDeleted || 0, protectedPhones: protectedPhones.length, rawDeleted: rawDeleted || 0 };
}

// ══════════════════════════════════════════════════
// TASK 14: Log Cleanup — retention agent_logs, cron_runs, ai_usage (90 hari)
// Dipanggil weekly via vercel.json cron (lihat juga task=cleanup untuk audit_log + R2)
// ══════════════════════════════════════════════════
export async function taskLogCleanup() {
  try {
    const { data, error } = await sb.rpc("cleanup_observability_logs", { retention_days: 90 });
    if (error) {
      await logStructured(sb, {
        action: "LOG_CLEANUP",
        severity: "error",
        category: "cron",
        detail: "RPC cleanup_observability_logs failed: " + error.message,
      });
      return { error: error.message };
    }
    // Tabel di luar RPC observability — bersihkan langsung supaya tidak tumbuh tanpa batas:
    // audit_log (retensi 60h via changed_at) & wa_webhook_raw (payload mentah Fonnte, retensi 7h).
    const extra = [];
    try {
      const auditCutoff = new Date(Date.now() - 60 * 86400000).toISOString();
      const { count: auditDel } = await sb.from("audit_log").delete({ count: "exact" }).lt("changed_at", auditCutoff);
      extra.push(`audit_log=${auditDel || 0}`);
    } catch (e) { console.error("[LOG_CLEANUP_AUDIT]", e.message); }
    try {
      const rawCutoff = new Date(Date.now() - 7 * 86400000).toISOString();
      const { count: rawDel } = await sb.from("wa_webhook_raw").delete({ count: "exact" }).lt("created_at", rawCutoff);
      extra.push(`wa_webhook_raw=${rawDel || 0}`);
    } catch (e) { console.error("[LOG_CLEANUP_RAW]", e.message); }

    const summary = [...(data || []).map(r => `${r.table_name}=${r.deleted_count}`), ...extra].join(", ");
    await logStructured(sb, {
      action: "LOG_CLEANUP",
      severity: "info",
      category: "cron",
      detail: summary || "Tidak ada log yang perlu dihapus",
      metadata: { deleted: data, extra },
    });
    return { deleted: data, extra, summary };
  } catch (err) {
    await logStructured(sb, {
      action: "LOG_CLEANUP",
      severity: "error",
      category: "cron",
      detail: err.message,
    });
    return { error: err.message };
  }
}

