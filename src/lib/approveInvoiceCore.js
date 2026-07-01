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
