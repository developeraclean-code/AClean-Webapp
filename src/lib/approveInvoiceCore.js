// Levenshtein distance sederhana — dipakai guard job_id di bawah untuk membedakan
// "typo kecil nama customer" (masih boleh lanjut) dari "job_id nyasar ke customer
// lain sama sekali" (harus diblok). Hindari exact-match yang terlalu ketat — pernah
// memblokir approve gara-gara "IBU OLIVA" vs "IBU OLIVIA" (beda 1 huruf, job sama).
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => { const row = [i]; row.length = n + 1; return row; });
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// approveInvoiceCore — approve invoice (core, tanpa kirim WA): set UNPAID + update
// order + retro-match bayar. Diekstrak dari App.jsx (Fase 3, pola ctx).
export async function approveInvoiceCore(inv, {
  addAgentLog, auditUserName, currentUser, fmt, getLocalDate, getLocalISOString,
  ordersData, reportError, retroMatchPayment, setAuditUser, setInvoicesData,
  setOrdersData, showNotif, supabase, updateInvoice, updateOrderStatus, validatePositiveNumber,
} = {}) {
    // Input validation
    if (!inv.id || inv.id.trim().length === 0) {
      showNotif("❌ Invoice ID tidak valid");
      return null;
    }
    // Allow Rp 0 for repair_gratis (free repairs), but require positive for regular invoices
    if (!inv.repair_gratis && !validatePositiveNumber(inv.total)) {
      showNotif("❌ Invoice total harus lebih dari 0");
      return null;
    }
    if (!inv.customer || inv.customer.trim().length === 0) {
      showNotif("❌ Nama customer tidak valid");
      return null;
    }

    // Guard: job_id invoice harus milik order dengan customer yang MIRIP — cegah status
    // order "nyasar" ke job lain kalau job_id invoice ternyata salah tunjuk (insiden
    // Wilcent/DB Style 03 Agu 2026: job_id laporan/invoice keliru nunjuk order lain).
    // Toleransi typo kecil (mis. "IBU OLIVA" vs "IBU OLIVIA") via similarity Levenshtein
    // — cuma blok kalau namanya BENAR-BENAR beda customer (di bawah 70% mirip).
    {
      const targetOrder = (ordersData || []).find(o => o.id === inv.job_id);
      if (targetOrder) {
        const norm = (s) => (s || "").trim().toUpperCase().replace(/\s+/g, " ");
        const a = norm(targetOrder.customer), b = norm(inv.customer);
        const maxLen = Math.max(a.length, b.length) || 1;
        const similarity = 1 - levenshtein(a, b) / maxLen;
        if (similarity < 0.7) {
          reportError("invoice.approve.jobMismatch", new Error("invoice job_id mismatch"), {
            invoiceId: inv.id, jobId: inv.job_id, invoiceCustomer: inv.customer, orderCustomer: targetOrder.customer, similarity,
          });
          showNotif(
            `❌ Invoice ${inv.id} (customer: ${inv.customer}) menunjuk ke job ${inv.job_id} yang di database `
            + `milik customer "${targetOrder.customer}". Approve dibatalkan untuk mencegah status order salah sasaran — cek job_id invoice ini dulu.`
          );
          return null;
        }
        if (a !== b) {
          addAgentLog("INVOICE_APPROVE_NAME_DIFF",
            `Invoice ${inv.id}: nama "${inv.customer}" beda tipis dari order "${targetOrder.customer}" (job ${inv.job_id}, similarity ${Math.round(similarity * 100)}%) — dilanjutkan, cek typo kalau perlu`,
            "WARNING");
        }
      }
    }

    const today = getLocalDate();
    const due = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const approvedAt = getLocalISOString(); // Indonesia timezone (UTC+7)
    const sentAt = getLocalISOString(); // When invoice sent/approved timestamp
    setInvoicesData(prev => prev.map(i =>
      i.id === inv.id ? { ...i, status: "UNPAID", sent: sentAt, due } : i
    ));
    setOrdersData(prev => prev.map(o =>
      // Multi-hari: propagate ke parent + semua child multi-day
      (o.id === inv.job_id || (o.parent_job_id === inv.job_id && o.is_multi_day))
        ? { ...o, invoice_id: inv.id, status: "INVOICE_APPROVED" } : o
    ));
    // Sync ke DB untuk child multi-day juga
    {
      const childIds = (ordersData || [])
        .filter(o => o.parent_job_id === inv.job_id && o.is_multi_day)
        .map(o => o.id);
      if (childIds.length > 0) {
        supabase.from("orders").update({ invoice_id: inv.id, status: "INVOICE_APPROVED" }).in("id", childIds);
      }
    }
    // GAP 4: simpan approved_by, trigger DB akan catat audit_log
    await setAuditUser();
    // Update invoice — try full, fallback minimal
    {
      const { error: apErr } = await updateInvoice(supabase, inv.id, {
        status: "UNPAID", sent: true, due,
        approved_by: currentUser?.name || null,
        approved_at: approvedAt,
      }, auditUserName());
      if (apErr) {
        console.warn("invoice approve full failed:", apErr.message);
        const { error: apErr2 } = await updateInvoice(supabase, inv.id, { status: "UNPAID" }, auditUserName());
        if (apErr2) reportError("invoice.approve.minimalFailed", apErr2, { invoiceId: inv.id });
      }
    }
    // Update order status — with fallback
    {
      const { error: oErr } = await updateOrderStatus(supabase, inv.job_id, "INVOICE_APPROVED", auditUserName(), { invoice_id: inv.id });
      if (oErr) {
        console.warn("orders INVOICE_APPROVED failed:", oErr.message);
        await updateOrderStatus(supabase, inv.job_id, "COMPLETED", auditUserName());
      }
    }
    addAgentLog("INVOICE_APPROVED", `Invoice ${inv.id} approve oleh ${currentUser?.name || "—"} — ${inv.customer} ${fmt(inv.total)}`, "SUCCESS");

    // Retro-match: cari bukti bayar yang sudah masuk sebelum invoice di-approve
    retroMatchPayment(inv).catch(e => console.warn("[RETRO_MATCH] fire-and-forget error:", e.message));

    return due; // kembalikan due date untuk dipakai caller
}
