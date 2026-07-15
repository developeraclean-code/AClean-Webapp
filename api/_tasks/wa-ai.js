// api/_tasks/wa-ai.js — Task cron grup wa-ai (dipindah APA ADANYA dari
// api/cron-reminder.js, pemecahan _tasks/ Jul 2026). Entry & jadwal tetap di cron-reminder.js.
import { sb, sendWA, log, isCronJobEnabled, OWNER_PHONE } from "./_shared.js";
import * as Sentry from "@sentry/node";
import { uploadBufferToR2, hasR2Config } from "../_r2-upload.js";
import { parseKasbonText, matchKasbonName, isKasbonApprovalMessage, resolveKasbonEntry, KASBON_APPROVER_PHONES } from "../_kasbon-parser.js";
import { buildExpenseDedupKey } from "../_expense-dedup.js";

// ══════════════════════════════════════════════════
// TASK: WA Daily Snapshot — Phase 2 review window
// Dump seluruh percakapan 3 grup ke R2 JSON tiap hari jam 20:00 WIB
// Window awal: 2026-06-04 → 2026-06-11 (review pattern utk tuning rule)
// ══════════════════════════════════════════════════
export async function taskWaSnapshot() {
  if (!hasR2Config()) return { skipped: true, reason: "no_r2_config" };
  // Tanggal target = hari ini WIB (cron jalan 20:00 WIB, ambil snapshot data hari ini)
  const nowUtcMs = Date.now();
  const wibMs = nowUtcMs + 7 * 3600_000;
  const dateStr = new Date(wibMs).toISOString().slice(0, 10);
  // Boundary WIB → UTC ISO untuk query Postgres
  const startWibUtcIso = new Date(Date.parse(dateStr + "T00:00:00+07:00")).toISOString();
  const endWibUtcIso = new Date(Date.parse(dateStr + "T23:59:59.999+07:00")).toISOString();

  // 1) Ambil monitored groups
  const { data: groups } = await sb.from("wa_monitored_groups")
    .select("group_id,group_name,enabled,capture_all,ai_expense_enabled,ai_material_enabled,ai_payment_enabled,ai_selesai_enabled,ai_quotation_enabled,ai_kasbon_enabled");
  const enabledGroups = (groups || []).filter(g => g.enabled);

  // 2) Per-group: ambil semua wa_group_logs hari ini
  const perGroup = [];
  let totalMessages = 0;
  let totalWithImage = 0;
  for (const g of enabledGroups) {
    const { data: logs } = await sb.from("wa_group_logs")
      .select("id,sender_phone,sender_name,type,content,parsed_ok,amount,job_id,image_url,r2_image_url,metadata,forwarded,created_at")
      .eq("group_id", g.group_id)
      .gte("created_at", startWibUtcIso)
      .lte("created_at", endWibUtcIso)
      .order("created_at", { ascending: true });
    const rows = logs || [];
    const withImg = rows.filter(r => !!r.image_url).length;
    totalMessages += rows.length;
    totalWithImage += withImg;
    perGroup.push({
      group_id: g.group_id,
      group_name: g.group_name,
      toggles: {
        capture_all: g.capture_all,
        ai_expense: g.ai_expense_enabled,
        ai_material: g.ai_material_enabled,
        ai_payment: g.ai_payment_enabled,
        ai_selesai: g.ai_selesai_enabled,
        ai_quotation: g.ai_quotation_enabled,
        ai_kasbon: g.ai_kasbon_enabled,
      },
      stats: { total: rows.length, with_image: withImg, parsed_ok: rows.filter(r => r.parsed_ok).length },
      messages: rows.map(r => ({
        id: r.id,
        wib: new Date(new Date(r.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 19),
        sender_phone: r.sender_phone,
        sender_name: r.sender_name,
        type: r.type,
        content: r.content,
        parsed_ok: r.parsed_ok,
        amount: r.amount,
        job_id: r.job_id,
        has_image: !!r.image_url,
        r2_image_url: r.r2_image_url,
        md5: r.metadata?.img_md5 || null,
        dup_of_log_id: r.metadata?.dup_of_log_id || null,
        forwarded: r.forwarded,
      })),
    });
  }

  // 3) AI extractions hari ini (cross-grup)
  const { data: aiRows } = await sb.from("ai_extractions")
    .select("id,group_id,sender_phone,sender_name,intent,confidence,status,extracted,notes,model,cost_usd,linked_table,linked_id,created_at")
    .gte("created_at", startWibUtcIso)
    .lte("created_at", endWibUtcIso)
    .order("created_at", { ascending: true });
  const aiArr = (aiRows || []).map(r => ({
    id: r.id, group_id: r.group_id, sender_name: r.sender_name,
    intent: r.intent, confidence: r.confidence, status: r.status,
    extracted: r.extracted, notes: r.notes, model: r.model, cost_usd: r.cost_usd,
    linked_table: r.linked_table, linked_id: r.linked_id,
    wib: new Date(new Date(r.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 19),
  }));

  // 4) Expenses dari WA grup hari ini
  const { data: expRows } = await sb.from("expenses")
    .select("id,date,subcategory,teknisi_name,amount,description,validation_status,created_by,created_at")
    .eq("date", dateStr)
    .in("created_by", ["wa_group", "wa_group_kasbon", "wa_group_ai"])
    .order("created_at", { ascending: true });
  const expArr = (expRows || []).map(r => ({
    id: r.id, subcategory: r.subcategory, teknisi_name: r.teknisi_name, amount: r.amount,
    description: r.description, validation_status: r.validation_status, created_by: r.created_by,
    wib: new Date(new Date(r.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 19),
  }));

  // 5) Payment suggestions hari ini
  const { data: paySuggRows } = await sb.from("payment_suggestions")
    .select("id,phone,sender_name,amount,bank,transfer_date,invoice_id,status,source,created_at")
    .gte("created_at", startWibUtcIso)
    .lte("created_at", endWibUtcIso)
    .order("created_at", { ascending: true });
  const paySuggArr = (paySuggRows || []).map(r => ({
    id: r.id, sender_name: r.sender_name, amount: r.amount, bank: r.bank,
    invoice_id: r.invoice_id, status: r.status, source: r.source,
    wib: new Date(new Date(r.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 19),
  }));

  const snapshot = {
    snapshot_date: dateStr,
    generated_at_utc: new Date().toISOString(),
    generated_at_wib: new Date(wibMs).toISOString().slice(0, 19) + "+07:00",
    summary: {
      groups: enabledGroups.length,
      total_messages: totalMessages,
      total_with_image: totalWithImage,
      total_ai_classified: aiArr.length,
      total_expenses_inserted: expArr.length,
      total_payment_suggestions: paySuggArr.length,
    },
    groups: perGroup,
    ai_extractions: aiArr,
    expenses_from_wa: expArr,
    payment_suggestions: paySuggArr,
  };

  // 6) Upload ke R2
  const json = JSON.stringify(snapshot, null, 2);
  const buf = Buffer.from(json, "utf8");
  const r2Key = `wa-snapshots/${dateStr}.json`;
  const up = await uploadBufferToR2({ buffer: buf, key: r2Key, mimeType: "application/json" });
  if (!up.ok) {
    await Sentry.captureMessage(`taskWaSnapshot R2 upload failed: ${up.err}`, "warning");
    return { ok: false, error: "r2_upload_failed", detail: up.err };
  }

  // 7) Save manifest di wa_daily_snapshots (UPSERT)
  await sb.from("wa_daily_snapshots").upsert({
    snapshot_date: dateStr,
    r2_key: r2Key,
    r2_url: up.url,
    groups_count: enabledGroups.length,
    total_messages: totalMessages,
    total_with_image: totalWithImage,
    total_ai_classified: aiArr.length,
    total_expenses_inserted: expArr.length,
    size_bytes: buf.length,
    notes: `Auto-snapshot phase 2 review window`,
  }, { onConflict: "snapshot_date" });

  return {
    ok: true,
    date: dateStr,
    r2_url: up.url,
    summary: snapshot.summary,
  };
}

// ══════════════════════════════════════════════════
// TASK: WA Backfill — re-parse wa_group_logs ke expenses Pending AI
// Re-run text-pattern biaya + kasbon parser + approval handler untuk
// pesan yang ketinggalan (e.g. deploy baru, parser improvement).
// AI Vision TIDAK di-re-run (mahal). Idempotent via dedup expense
// (date+teknisi+amount+created_by).
//
// Query: ?task=wa-backfill&from=YYYY-MM-DD&to=YYYY-MM-DD
// Default: hari ini (WIB) saja
// ══════════════════════════════════════════════════
export async function taskWaBackfill(opts = {}) {
  const SU = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SK = process.env.SUPABASE_SERVICE_KEY;
  if (!SU || !SK) return { skipped: true, reason: "no_supabase_env" };

  const todayWib = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const fromDate = opts.from || todayWib;
  const toDate = opts.to || fromDate;
  const startIso = new Date(Date.parse(fromDate + "T00:00:00+07:00")).toISOString();
  const endIso = new Date(Date.parse(toDate + "T23:59:59.999+07:00")).toISOString();

  // Cek dup expense — sama date+teknisi_name+amount+created_by berarti sudah ada
  const expenseAlreadyExists = async ({ date, teknisi_name, amount, created_by }) => {
    const url = SU + "/rest/v1/expenses?select=id"
      + "&date=eq." + date
      + "&teknisi_name=eq." + encodeURIComponent(teknisi_name || "")
      + "&amount=eq." + amount
      + "&created_by=eq." + created_by
      + "&limit=1";
    const r = await fetch(url, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
    if (!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  };

  // Ambil grup config (utk filter ai_kasbon_enabled per grup)
  const { data: groupsCfg } = await sb.from("wa_monitored_groups")
    .select("group_id,group_name,ai_kasbon_enabled,ai_expense_enabled");
  const cfgMap = Object.fromEntries((groupsCfg || []).map(g => [g.group_id, g]));

  // Ambil semua logs dalam range
  const { data: logs } = await sb.from("wa_group_logs")
    .select("id,sender_phone,sender_name,group_id,group_name,type,content,parsed_ok,amount,created_at,metadata")
    .gte("created_at", startIso).lte("created_at", endIso)
    .order("created_at", { ascending: true })
    .limit(1000); // PostgREST hard cap = 1000 — .limit(2000) silently returned 1000

  const counters = {
    logs_scanned: (logs || []).length,
    kasbon_single_inserted: 0,
    kasbon_multi_inserted: 0,
    biaya_inserted: 0,
    approval_acked: 0,
    skipped_dup: 0,
    skipped_no_match: 0,
  };

  for (const lg of (logs || [])) {
    const cfg = cfgMap[lg.group_id];
    if (!cfg) continue;
    const date = new Date(new Date(lg.created_at).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
    const profileName = lg.sender_name || lg.sender_phone;
    const text = lg.content || "";

    // ── KASBON parser ──
    if (cfg.ai_kasbon_enabled) {
      const k = parseKasbonText(text);
      if (k) {
        // Paritas jalur live (wa.js): resolusi via request panel — tanggal = tanggal
        // request, request ter-link = sudah tercatat (cegah backfill re-create duplikat
        // lintas-hari yang sudah dibersihkan). dedup_key ikut diisi (garis pertahanan DB).
        if (k.multi && Array.isArray(k.items)) {
          for (const it of k.items) {
            const mr = await matchKasbonName({ SU, SK, nameRaw: it.nameRaw });
            if (!mr.matched) { counters.skipped_no_match++; continue; }
            const resolved = await resolveKasbonEntry({ SU, SK, name: mr.matched.name, amount: it.amount, today: date });
            if (resolved.action === "skip_linked") { counters.skipped_dup++; continue; }
            const entryDate = resolved.date;
            const dup = await expenseAlreadyExists({ date: entryDate, teknisi_name: mr.matched.name, amount: it.amount, created_by: "wa_group_kasbon" });
            if (dup) { counters.skipped_dup++; continue; }
            await fetch(SU + "/rest/v1/expenses", {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
              body: JSON.stringify({
                date: entryDate, category: "petty_cash", subcategory: "Kasbon Karyawan",
                teknisi_name: mr.matched.name, amount: it.amount,
                description: `Kasbon ${mr.matched.name} (via WA Finance grup, dari ${profileName})${resolved.suffix} [BACKFILL]`,
                created_by: "wa_group_kasbon", validation_status: "PENDING_AI",
                dedup_key: buildExpenseDedupKey({ teknisiName: mr.matched.name, amount: it.amount, date: entryDate, subcategory: "Kasbon Karyawan" }),
              }),
            }).catch(e => {
              try { Sentry.captureException(e, { tags: { op: "backfill_kasbon_multi_insert" }, extra: { teknisi: mr.matched.name, amount: it.amount, date: entryDate } }); } catch (_) {}
            });
            counters.kasbon_multi_inserted++;
          }
        } else if (k.nameRaw) {
          const mr = await matchKasbonName({ SU, SK, nameRaw: k.nameRaw });
          if (!mr.matched) { counters.skipped_no_match++; continue; }
          const resolved = await resolveKasbonEntry({ SU, SK, name: mr.matched.name, amount: k.amount, today: date });
          if (resolved.action === "skip_linked") { counters.skipped_dup++; continue; }
          const entryDate = resolved.date;
          const dup = await expenseAlreadyExists({ date: entryDate, teknisi_name: mr.matched.name, amount: k.amount, created_by: "wa_group_kasbon" });
          if (dup) { counters.skipped_dup++; continue; }
          await fetch(SU + "/rest/v1/expenses", {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
            body: JSON.stringify({
              date: entryDate, category: "petty_cash", subcategory: "Kasbon Karyawan",
              teknisi_name: mr.matched.name, amount: k.amount,
              description: `Kasbon ${mr.matched.name} (via WA Finance grup, dari ${profileName})${resolved.suffix} [BACKFILL]`,
              created_by: "wa_group_kasbon", validation_status: "PENDING_AI",
              dedup_key: buildExpenseDedupKey({ teknisiName: mr.matched.name, amount: k.amount, date: entryDate, subcategory: "Kasbon Karyawan" }),
            }),
          }).catch(e => {
            try { Sentry.captureException(e, { tags: { op: "backfill_kasbon_single_insert" }, extra: { teknisi: mr.matched.name, amount: k.amount, date: entryDate } }); } catch (_) {}
          });
          counters.kasbon_single_inserted++;
        }
      }
    }

    // ── KASBON APPROVAL (annotate) ──
    if (cfg.ai_kasbon_enabled && isKasbonApprovalMessage(text)) {
      if (KASBON_APPROVER_PHONES.includes(lg.sender_phone)) {
        const qUrl = SU + "/rest/v1/expenses?select=id,description"
          + "&validation_status=eq.PENDING_AI&subcategory=eq." + encodeURIComponent("Kasbon Karyawan")
          + "&date=eq." + date + "&created_by=eq.wa_group_kasbon"
          + "&description=not.ilike." + encodeURIComponent("%[ACK by%");
        const qRes = await fetch(qUrl, { headers: { apikey: SK, Authorization: "Bearer " + SK } });
        const pendings = qRes.ok ? await qRes.json() : [];
        if (Array.isArray(pendings) && pendings.length > 0) {
          const hh = new Date(new Date(lg.created_at).getTime() + 7 * 3600_000).toISOString().slice(11, 16);
          const ackTag = ` [ACK by ${lg.sender_phone} at ${hh}]`;
          await Promise.all(pendings.map(p =>
            fetch(SU + "/rest/v1/expenses?id=eq." + p.id, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
              body: JSON.stringify({ description: (p.description || "") + ackTag }),
            }).catch(() => {})
          ));
          counters.approval_acked += pendings.length;
        }
      }
    }

    // ── BIAYA text-pattern (bensin/parkir/etc) ──
    if (cfg.ai_expense_enabled) {
      const biayaMatch = text.match(/^(bensin|makan|parkir|tol|belanja|beli|transport|bbm|solar|pertamax|consumable)[\s:]+(.+)/i);
      if (biayaMatch) {
        let nominalStr = biayaMatch[2]
          .replace(/(\d+)\s*(jt|juta)/gi, (_, n) => String(parseInt(n) * 1000000))
          .replace(/(\d+)\s*(rb|ribu|k)/gi, (_, n) => String(parseInt(n) * 1000));
        const nominalMatch = nominalStr.match(/[\d]{4,}/);
        if (nominalMatch) {
          const amt = parseInt(nominalMatch[0]);
          const k = biayaMatch[1].toLowerCase();
          const subcat = ["bensin","bbm","pertamax","solar"].includes(k) ? "Bensin Motor"
            : k === "parkir" ? "Parkir" : "Lain-lain";
          const dup = await expenseAlreadyExists({ date, teknisi_name: profileName, amount: amt, created_by: "wa_group" });
          if (!dup) {
            await fetch(SU + "/rest/v1/expenses", {
              method: "POST",
              headers: { "Content-Type": "application/json", apikey: SK, Authorization: "Bearer " + SK, Prefer: "return=minimal" },
              body: JSON.stringify({
                date, category: "petty_cash", subcategory: subcat,
                description: text + " (via WA grup) [BACKFILL]",
                amount: amt, teknisi_name: profileName,
                created_by: "wa_group", validation_status: "PENDING_AI",
              }),
            }).catch(() => {});
            counters.biaya_inserted++;
          } else {
            counters.skipped_dup++;
          }
        }
      }
    }
  }

  return { ok: true, from: fromDate, to: toDate, counters };
}

// ══════════════════════════════════════════════════
// TASK 6: Scan Bukti Bayar — cocokkan payment_suggestions ke invoice PAID tanpa bukti
// Sumber data: tabel payment_suggestions (lebih reliable dari R2 listing)
// Jalan setiap jam 02:00-11:00 UTC (Mon-Sat) via vercel.json crons
// ══════════════════════════════════════════════════
export async function taskScanBuktiBayar() {
  // Gate FAIL-OPEN (spt taskBackupData): task internal (tidak kirim WA ke customer),
  // default JALAN; berhenti hanya kalau eksplisit dimatikan via toggle Settings.
  const { data: togData } = await sb.from("app_settings").select("key,value").in("key", ["bukti_bayar_scan_enabled", "cron_jobs"]);
  const togMap = Object.fromEntries((togData || []).map(s => [s.key, s.value]));
  if (!isCronJobEnabled(togMap, "bukti_bayar_scan_enabled") || togMap["bukti_bayar_scan_enabled"] === "false") {
    await log("SCAN_BUKTI_BAYAR", "Dilewati — toggle OFF", "INFO");
    return { skipped: true };
  }

  // Ambil invoice PAID tanpa bukti:
  // - Minimum: 2026-05-01 (fungsi baru, data sebelumnya tidak reliable)
  // - Maximum lookback: 90 hari dari sekarang (untuk future-proofing)
  const cutoff90 = new Date(Date.now() - 90 * 86400000).toISOString();
  const cutoffDate = cutoff90 > "2026-05-01T00:00:00+00:00" ? cutoff90 : "2026-05-01T00:00:00+00:00";

  const [invRes, suggRes] = await Promise.all([
    sb.from("invoices")
      .select("id, customer, phone, total, paid_at, created_at")
      .eq("status", "PAID")
      .gt("total", 0)
      .or("payment_proof_url.is.null,payment_proof_url.eq.,payment_proof_url.eq.verified-manual-no-proof")
      .gte("created_at", cutoffDate)
      .order("created_at", { ascending: false })
      .limit(200),
    // Ambil semua payment_suggestions (PENDING dan RESOLVED) dalam 90 hari — jangan filter PENDING saja
    // supaya bukti yang sudah pernah diproses pun bisa dipakai sebagai fallback
    sb.from("payment_suggestions")
      .select("phone, image_url, created_at, amount, status")
      .gte("created_at", cutoffDate)
      .order("created_at", { ascending: true })
      .limit(500),
  ]);

  if (invRes.error) {
    await log("SCAN_BUKTI", "Gagal fetch invoices: " + invRes.error.message, "ERROR");
    return { error: invRes.error.message };
  }
  if (!invRes.data || invRes.data.length === 0) {
    await log("SCAN_BUKTI", "Tidak ada invoice PAID tanpa bukti (≥1 Mei 2026 atau 90 hari terakhir)", "INFO");
    return { checked: 0, updated: 0 };
  }
  if (suggRes.error) {
    await log("SCAN_BUKTI", "Gagal fetch payment_suggestions: " + suggRes.error.message, "ERROR");
    return { error: suggRes.error.message };
  }

  const invs = invRes.data;
  const suggestions = suggRes.data || [];

  // Build phone → suggestions map (sorted oldest→newest, sudah di-sort dari query)
  const phoneMap = {};
  // Suffix-6-digit map: untuk fallback kalau phone customer typo (e.g. 1 digit hilang)
  // Contoh: invoice phone "62856976881" (typo) cocok dengan bukti dari "628567976881"
  // karena last 6 digit sama: "976881"
  const suffixMap = {};
  // All suggestions list (untuk fuzzy amount fallback)
  const allEntries = [];
  for (const s of suggestions) {
    const phone = (s.phone || "").replace(/[^0-9]/g, "");
    if (!phone || phone.length < 8 || !s.image_url) continue;
    const entry = { ...s, phone, ts: new Date(s.created_at).getTime(), amountNum: Number(s.amount) || 0 };
    if (!phoneMap[phone]) phoneMap[phone] = [];
    phoneMap[phone].push(entry);
    if (phone.length >= 9) {
      const suf = phone.slice(-6);
      if (!suffixMap[suf]) suffixMap[suf] = [];
      suffixMap[suf].push(entry);
    }
    allEntries.push(entry);
  }

  let updated = 0;
  let fuzzyMatched = 0;
  const updateLog = [];
  const fuzzyReview = []; // bukti yang match by amount tapi phone beda — perlu owner verify

  const before3d = 3 * 24 * 60 * 60 * 1000;
  const after30d = 30 * 24 * 60 * 60 * 1000;
  const inWindowFn = (entries, invTs) => entries.filter(e => e.ts >= invTs - before3d && e.ts <= invTs + after30d);
  const pickBestFn = (entries, invTs) => {
    const afterInv = entries.filter(e => e.ts >= invTs).sort((a, b) => a.ts - b.ts);
    const beforeInv = entries.filter(e => e.ts < invTs).sort((a, b) => a.ts - b.ts);
    return afterInv.length > 0 ? afterInv[0]
         : beforeInv.length > 0 ? beforeInv[beforeInv.length - 1]
         : null;
  };

  for (const inv of invs) {
    const rawPhone = (inv.phone || "").replace(/[^0-9]/g, "");
    if (!rawPhone || rawPhone.length < 8) continue;
    const invTs = new Date(inv.created_at).getTime();
    const invTotal = Number(inv.total) || 0;

    // ── TIER 1: Exact phone match (existing logic) ──
    let best = null;
    let matchMode = "exact_phone";
    const entries = phoneMap[rawPhone];
    if (entries && entries.length > 0) {
      best = pickBestFn(inWindowFn(entries, invTs), invTs);
    }

    // ── TIER 2: Suffix-6 match (fallback kalau phone typo 1 digit) ──
    // Hanya jika TIER 1 gagal & amount match (toleransi 5% atau Rp 5.000)
    if (!best && rawPhone.length >= 9 && invTotal > 0) {
      const suf = rawPhone.slice(-6);
      const sufCands = suffixMap[suf] || [];
      const inWin = inWindowFn(sufCands, invTs).filter(e => {
        if (!e.amountNum) return false;
        const diff = Math.abs(e.amountNum - invTotal);
        return diff <= Math.max(5000, invTotal * 0.05);
      });
      if (inWin.length > 0) {
        best = pickBestFn(inWin, invTs);
        matchMode = "suffix6_amount";
      }
    }

    // ── TIER 3: Amount-only fuzzy match (toleransi ketat: ≤1% atau Rp 1.000) ──
    // Untuk kasus customer bayar dari rekening keluarga (phone beda total).
    // Tier 3 hanya AUTO-LINK kalau amount exact match (toleransi Rp 1.000) AND ada exactly 1 kandidat.
    // Kalau ambigu (>1 match) → log ke fuzzyReview untuk owner verify, jangan auto-link.
    if (!best && invTotal > 0) {
      const inWin = inWindowFn(allEntries, invTs).filter(e => {
        if (!e.amountNum) return false;
        return Math.abs(e.amountNum - invTotal) <= 1000;
      });
      if (inWin.length === 1) {
        best = inWin[0];
        matchMode = "amount_exact_unique";
      } else if (inWin.length > 1) {
        fuzzyReview.push({
          invoice_id: inv.id,
          customer: inv.customer,
          total: invTotal,
          candidates: inWin.map(e => ({ phone: e.phone, sender: e.sender_name, amount: e.amountNum, ts: e.created_at })),
        });
      }
    }

    if (!best) continue;

    const { error: upErr } = await sb
      .from("invoices")
      .update({ payment_proof_url: best.image_url, updated_at: new Date().toISOString() })
      .eq("id", inv.id);

    if (!upErr) {
      updated++;
      if (matchMode !== "exact_phone") fuzzyMatched++;
      const tag = matchMode === "exact_phone" ? "" : ` [${matchMode}]`;
      updateLog.push(inv.id + " ← " + inv.customer + " (" + (best.amount ? "Rp " + Number(best.amount).toLocaleString("id") : "?") + ")" + tag);
    }
  }

  // Log kandidat ambigu untuk owner review
  if (fuzzyReview.length > 0) {
    await log("SCAN_BUKTI_FUZZY", "Ambiguous matches (amount sama, multi-kandidat — perlu verify owner):\n" +
      fuzzyReview.map(r => `${r.invoice_id} ${r.customer} Rp${r.total.toLocaleString("id")} → ${r.candidates.length} kandidat: ${r.candidates.map(c => c.phone).join(", ")}`).join("\n"),
      "WARNING");
  }

  const summary = `Dicek: ${invs.length} invoice, ${suggestions.length} bukti WA | Diupdate: ${updated} (fuzzy: ${fuzzyMatched}, ambigu: ${fuzzyReview.length})`;
  await log("SCAN_BUKTI", summary + (updateLog.length ? "\n" + updateLog.join("\n") : ""), updated > 0 ? "SUCCESS" : "INFO");

  // Notif owner jika ada yang terupdate
  if (updated > 0) {
    await sendWA(OWNER_PHONE,
      "🧾 *Auto-Scan Bukti Bayar*\n" +
      "Ditemukan " + updated + " bukti transfer dan sudah dilink ke invoice:\n\n" +
      updateLog.slice(0, 10).map(l => "• " + l).join("\n") +
      (updateLog.length > 10 ? "\n...dan " + (updateLog.length - 10) + " lainnya" : "")
    );
  }

  return { checked: invs.length, suggestions: suggestions.length, updated, details: updateLog };
}

