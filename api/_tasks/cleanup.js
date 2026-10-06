// api/_tasks/cleanup.js — Task cron grup cleanup (dipindah APA ADANYA dari
// api/cron-reminder.js, pemecahan _tasks/ Jul 2026). Entry & jadwal tetap di cron-reminder.js.
import { sb, isCronJobEnabled, log, deleteR2Object } from "./_shared.js";
import { logStructured } from "../_logger.js";
import { extractR2Key, extractOwnedR2Key, ownedR2Prefixes, mapWithConcurrency } from "../_r2-key.js";

const R2_DELETE_BATCH = 50;
const R2_DELETE_CONCURRENCY = 10;

// ══════════════════════════════════════════════════
// TASK 4: Cleanup metadata operasional non-log.
// Retensi log teknis dipusatkan di taskLogCleanup → cleanup_operational_logs RPC.
// Di sini hanya dispatch_logs 90h dan payment_suggestions selesai 30h.
// Penghapusan file R2 ada di task terpisah: r2-cleanup-90d, expense-foto-cleanup,
// snapshot-cleanup, payment-proof-cleanup.
// ══════════════════════════════════════════════════
export async function taskCleanup() {
  const result = { dispatch_logs: 0, payment_suggestions: 0, errors: 0 };

  const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const cutoff90 = new Date(Date.now() - 90 * 86400000).toISOString();

  // 1. Cleanup dispatch_logs > 90 hari
  const { error: dispDelErr, count: dispCount } = await sb.from("dispatch_logs")
    .delete({ count: "exact" }).lt("sent_at", cutoff90);
  if (dispDelErr) { result.errors++; console.error("[CLEANUP_DISPATCH_LOGS]", dispDelErr.message); }
  else result.dispatch_logs = dispCount || 0;

  // 2. Cleanup payment_suggestions yang SUDAH selesai > 30 hari.
  //    Nilai status sebelumnya ditulis "RESOLVED"/"REJECTED" — keduanya TIDAK PERNAH ADA
  //    di tabel ini (nilai nyata: CONFIRMED / PENDING / DISMISSED), jadi sejak lahir cron
  //    ini menghapus 0 baris sambil tetap melapor sukses (audit 29 Agu 2026).
  //    PENDING sengaja TIDAK ikut dihapus: baris itu bisa jadi satu-satunya jejak bukti
  //    bayar yang belum ditinjau — menghapusnya = memusnahkan barang bukti.
  const { error: suggDelErr, count: suggCount } = await sb.from("payment_suggestions")
    .delete({ count: "exact" })
    .in("status", ["CONFIRMED", "DISMISSED"])
    .lt("created_at", cutoff30);
  if (suggDelErr) { result.errors++; console.error("[CLEANUP_PAYMENT_SUGGESTIONS]", suggDelErr.message); }
  else result.payment_suggestions = suggCount || 0;

  const summary = `dispatch_logs: ${result.dispatch_logs} | payment_suggestions: ${result.payment_suggestions} | log teknis: dikelola task log-cleanup`;
  await log("CLEANUP", summary, result.errors ? "ERROR" : "SUCCESS");
  return result;
}

// ══════════════════════════════════════════════════
// TASK 5b: Cleanup R2 mirror untuk image grup WA (>90 hari)
// — Image grup di-mirror ke R2 saat masuk (audit trail Phase 1 WA AI).
//   Setelah 90 hari, hapus dari R2 untuk privacy + cost. Row di wa_group_logs
//   tetap tersimpan (metadata only) dengan r2_purged_at terisi.
// ══════════════════════════════════════════════════
export async function taskR2Cleanup90d() {
  const { data: togData, error: toggleError } = await sb.from("app_settings").select("key,value").in("key", ["r2_cleanup_enabled", "cron_jobs"]);
  if (toggleError) {
    await log("R2_CLEANUP_90D", "Gagal membaca toggle: " + toggleError.message, "ERROR");
    throw new Error("R2 cleanup toggle: " + toggleError.message);
  }
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
    .order("r2_uploaded_at", { ascending: true })
    .limit(R2_DELETE_BATCH);
  if (error) {
    await log("R2_CLEANUP_90D", "Query gagal: " + error.message, "ERROR");
    throw new Error("R2 cleanup query: " + error.message);
  }
  result.swept = (rows || []).length;
  if (result.swept === 0) {
    await log("R2_CLEANUP_90D", "Tidak ada image >90 hari", "INFO");
    return result;
  }

  const outcomes = await mapWithConcurrency(rows || [], R2_DELETE_CONCURRENCY, async row => {
    const key = extractR2Key(row.r2_image_url);
    if (!key) return { id: row.id, ok: false, reason: "invalid_key" };
    return { id: row.id, ok: await deleteR2Object(key) };
  });
  const purgedIds = outcomes
    .filter(x => x?.status === "fulfilled" && x.value?.ok)
    .map(x => x.value.id);
  result.purged = purgedIds.length;
  result.errors = result.swept - result.purged;
  if (purgedIds.length > 0) {
    const { error: markError } = await sb.from("wa_group_logs")
      .update({ r2_purged_at: new Date().toISOString() })
      .in("id", purgedIds);
    if (markError) {
      result.errors += purgedIds.length;
      result.purged = 0;
      console.error("[R2_CLEANUP_90D_MARK]", markError.message);
    }
  }

  await log("R2_CLEANUP_90D", `swept=${result.swept} purged=${result.purged} errors=${result.errors}`,
    result.errors > 0 ? "WARNING" : "SUCCESS");
  result.has_more = result.swept === R2_DELETE_BATCH;
  return result;
}

// ══════════════════════════════════════════════════
// TASK: Expense Foto Cleanup — hapus foto R2 pengeluaran teknisi >30 hari
// Sumber: ai_extractions source='teknisi_dashboard'. Record expense TETAP (data keuangan),
// hanya foto bukti yang di-purge agar R2 tidak numpuk. r2_url di-null setelah purge.
// ══════════════════════════════════════════════════
export async function taskExpenseFotoCleanup30d() {
  const { data: togData, error: toggleError } = await sb.from("app_settings").select("key,value").in("key", ["expense_foto_cleanup_enabled", "cron_jobs"]);
  if (toggleError) {
    await log("EXPENSE_FOTO_CLEANUP", "Gagal membaca toggle: " + toggleError.message, "ERROR");
    throw new Error("Expense cleanup toggle: " + toggleError.message);
  }
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
    .order("created_at", { ascending: true })
    .limit(R2_DELETE_BATCH);
  if (error) {
    await log("EXPENSE_FOTO_CLEANUP", "Query gagal: " + error.message, "ERROR");
    throw new Error("Expense cleanup query: " + error.message);
  }
  result.swept = (rows || []).length;
  if (result.swept === 0) { await log("EXPENSE_FOTO_CLEANUP", "Tidak ada foto >30 hari", "INFO"); return result; }

  const outcomes = await mapWithConcurrency(rows || [], R2_DELETE_CONCURRENCY, async row => {
    const key = extractR2Key(row.r2_url);
    if (!key) return { id: row.id, ok: false };
    return { id: row.id, ok: await deleteR2Object(key) };
  });
  const purgedIds = outcomes
    .filter(x => x?.status === "fulfilled" && x.value?.ok)
    .map(x => x.value.id);
  result.purged = purgedIds.length;
  result.errors = result.swept - result.purged;
  if (purgedIds.length > 0) {
    const { error: markError } = await sb.from("ai_extractions").update({ r2_url: null }).in("id", purgedIds);
    if (markError) {
      result.errors += purgedIds.length;
      result.purged = 0;
      console.error("[EXPENSE_FOTO_CLEANUP_MARK]", markError.message);
    }
  }
  await log("EXPENSE_FOTO_CLEANUP", `swept=${result.swept} purged=${result.purged} errors=${result.errors}`,
    result.errors > 0 ? "WARNING" : "SUCCESS");
  result.has_more = result.swept === R2_DELETE_BATCH;
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
  const { data: togData, error: toggleError } = await sb.from("app_settings").select("key,value").in("key", ["payment_proof_cleanup_enabled", "cron_jobs"]);
  if (toggleError) {
    await log("PAYMENT_PROOF_CLEANUP", "Gagal membaca toggle: " + toggleError.message, "ERROR");
    throw new Error("Payment proof cleanup toggle: " + toggleError.message);
  }
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
    .eq("status", "PAID")
    .or(ownedR2Prefixes().map(prefix => `payment_proof_url.like."${prefix.replace(/"/g, '\\"')}%"`).join(','))
    .or(`paid_at.lt.${cutoff},and(paid_at.is.null,created_at.lt.${cutoff})`)
    .order("paid_at", { ascending: true, nullsFirst: true })
    .limit(R2_DELETE_BATCH);
  if (error) {
    await log("PAYMENT_PROOF_CLEANUP", "Query gagal: " + error.message, "ERROR");
    throw new Error("Payment proof cleanup query: " + error.message);
  }
  result.swept = (rows || []).length;
  if (result.swept === 0) { await log("PAYMENT_PROOF_CLEANUP", "Tidak ada bukti bayar >90 hari", "INFO"); return result; }

  const outcomes = await mapWithConcurrency(rows || [], R2_DELETE_CONCURRENCY, async row => {
    const key = extractOwnedR2Key(row.payment_proof_url);
    if (!key) return { id: row.id, ok: false, skipped: true };
    return { id: row.id, ok: await deleteR2Object(key) };
  });
  const purgedIds = outcomes
    .filter(x => x?.status === "fulfilled" && x.value?.ok)
    .map(x => x.value.id);
  result.skipped_external = outcomes.filter(x => x?.status === "fulfilled" && x.value?.skipped).length;
  result.purged = purgedIds.length;
  result.errors = result.swept - result.purged - result.skipped_external;
  if (purgedIds.length > 0) {
    const { error: markError } = await sb.from("invoices")
      .update({ payment_proof_url: "purged-90d", updated_at: new Date().toISOString() })
      .in("id", purgedIds);
    if (markError) {
      result.errors += purgedIds.length;
      result.purged = 0;
      console.error("[PAYMENT_PROOF_CLEANUP_MARK]", markError.message);
    }
  }
  await log("PAYMENT_PROOF_CLEANUP", `swept=${result.swept} purged=${result.purged} errors=${result.errors} skipped=${result.skipped_external}`,
    result.errors > 0 ? "WARNING" : "SUCCESS");
  result.has_more = result.swept === R2_DELETE_BATCH;
  return result;
}

// ══════════════════════════════════════════════════
// TASK: Snapshot cleanup — retention 60 hari
// Hapus objek R2 (file .json) + row wa_daily_snapshots yg > 60 hari.
// FIX: dulu hanya hapus row DB & andalkan r2-cleanup-90d, tapi cron itu hanya
// memproses wa_group_logs → file snapshot orphan selamanya. Sekarang hapus R2 langsung.
// ══════════════════════════════════════════════════
export async function taskSnapshotCleanup() {
  const { data: togData, error: toggleError } = await sb.from("app_settings").select("key,value").in("key", ["snapshot_cleanup_enabled", "cron_jobs"]);
  if (toggleError) {
    await log("SNAPSHOT_CLEANUP", "Gagal membaca toggle: " + toggleError.message, "ERROR");
    throw new Error("Snapshot cleanup toggle: " + toggleError.message);
  }
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "snapshot_cleanup_enabled") || togMap["snapshot_cleanup_enabled"] !== "true") {
    await log("SNAPSHOT_CLEANUP", "Dilewati — toggle OFF", "INFO");
    return { skipped: true };
  }

  const cutoff = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10);
  // Ambil rows yg expired (utk delete R2 objects)
  const { data: stale, error: queryError } = await sb.from("wa_daily_snapshots")
    .select("id,snapshot_date,r2_key")
    .lt("snapshot_date", cutoff)
    .order("snapshot_date", { ascending: true })
    .limit(R2_DELETE_BATCH);
  if (queryError) {
    await log("SNAPSHOT_CLEANUP", "Query gagal: " + queryError.message, "ERROR");
    throw new Error("Snapshot cleanup query: " + queryError.message);
  }
  const count = (stale || []).length;
  if (count === 0) {
    await log("SNAPSHOT_CLEANUP", "Tidak ada snapshot >60 hari", "INFO");
    return { ok: true, deleted: 0, purged: 0, cutoff };
  }

  // Hapus row DB hanya untuk objek yang sukses dihapus/ternyata sudah tidak ada.
  // Ini mencegah file orphan saat R2 sementara gagal tetapi metadata keburu hilang.
  const outcomes = await mapWithConcurrency(stale || [], R2_DELETE_CONCURRENCY, async row => ({
    id: row.id,
    ok: row.r2_key ? await deleteR2Object(row.r2_key) : true,
  }));
  const deletedIds = outcomes
    .filter(x => x?.status === "fulfilled" && x.value?.ok)
    .map(x => x.value.id);
  let purged = deletedIds.length;
  let errors = count - purged;
  if (deletedIds.length > 0) {
    const { error: dbDeleteError } = await sb.from("wa_daily_snapshots").delete().in("id", deletedIds);
    if (dbDeleteError) {
      errors += deletedIds.length;
      purged = 0;
      console.error("[SNAPSHOT_CLEANUP_MARK]", dbDeleteError.message);
    }
  }
  await log("SNAPSHOT_CLEANUP", `candidates=${count} deleted=${purged} errors=${errors} (cutoff ${cutoff})`,
    errors > 0 ? "WARNING" : "SUCCESS");
  return { ok: errors === 0, candidates: count, deleted: purged, purged, errors, cutoff, has_more: count === R2_DELETE_BATCH };
}

// ══════════════════════════════════════════════════
// TASK 6: Cleanup WA chat lama (>14 hari)
// ══════════════════════════════════════════════════
export async function taskWaCleanup() {
  const { data: togData, error: toggleError } = await sb.from("app_settings").select("key,value").in("key",["wa_cleanup_enabled","cron_jobs"]);
  if (toggleError) throw new Error('WA cleanup toggle: ' + toggleError.message);
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
  const { data: pendingSugg, error: pendingError } = await sb.from("payment_suggestions")
    .select("phone").eq("status", "PENDING").gte("created_at", cutoff);
  if (pendingError) throw new Error('Proteksi bukti bayar gagal dibaca: ' + pendingError.message);
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

  const errors = Number(Boolean(msgErr)) + Number(Boolean(convErr));
  await log("WA_CLEANUP", `${msgsDeleted || 0} pesan & ${convsDeleted || 0} conversations dihapus (>14 hari). ${protectedPhones.length} phone dilindungi. Raw webhook dikelola task log-cleanup.`, errors ? 'ERROR' : 'SUCCESS');
  return { msgsDeleted: msgsDeleted || 0, convsDeleted: convsDeleted || 0, protectedPhones: protectedPhones.length, errors };
}

// ══════════════════════════════════════════════════
// TASK 14: Log Cleanup — satu kebijakan database, bounded per batch.
// Tidak pernah menyentuh order, laporan, invoice, payment, expense, atau ledger stok.
// ══════════════════════════════════════════════════
export async function taskLogCleanup() {
  try {
    const { data, error } = await sb.rpc("cleanup_operational_logs", {
      p_apply: true,
      p_batch_size: 2000,
    });
    if (error) {
      // Jeda deployment aman: bila kode API tiba sebelum migration 179 tersedia,
      // pakai RPC observability lama untuk satu siklus. Tidak ada direct delete.
      const missingNewRpc = error.code === "PGRST202" || error.code === "42883"
        || /cleanup_operational_logs.*(schema cache|does not exist|not found)/i.test(error.message || "");
      if (missingNewRpc) {
        const legacy = await sb.rpc("cleanup_observability_logs", { retention_days: 90 });
        if (!legacy.error) {
          const summary = (legacy.data || []).map(r => `${r.table_name}=${r.deleted_count}`).join(", ");
          await logStructured(sb, {
            action: "LOG_CLEANUP_LEGACY_FALLBACK",
            severity: "warn",
            category: "cron",
            detail: summary || "Migration 179 belum aktif; fallback lama tidak menemukan log",
            metadata: { deleted: legacy.data || [] },
          });
          return { deleted: legacy.data || [], fallback: true, summary };
        }
      }
      await logStructured(sb, {
        action: "LOG_CLEANUP",
        severity: "error",
        category: "cron",
        detail: "RPC cleanup_operational_logs failed: " + error.message,
      });
      return { error: error.message };
    }
    const summary = Object.entries(data?.deleted || {}).map(([table, count]) => `${table}=${count}`).join(", ");
    await logStructured(sb, {
      action: "LOG_CLEANUP",
      severity: "info",
      category: "cron",
      detail: summary || "Tidak ada log yang perlu dihapus",
      metadata: data,
    });
    return { ...data, summary, has_more: Object.values(data?.deleted || {}).some(n => n >= 2000) };
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
