import { levenshtein } from "./stringSimilarity.js";

// approveInvoiceCore — approve invoice (core, tanpa kirim WA): set UNPAID + update
// order + retro-match bayar. Diekstrak dari App.jsx (Fase 3, pola ctx).
export async function approveInvoiceCore(inv, {
  addAgentLog, auditUserName, currentUser, fmt, getLocalDate, getLocalISOString,
  ordersData, reportError, retroMatchPayment, setAuditUser, setInvoicesData,
  setOrdersData, showNotif, supabase, updateInvoice, updateOrderStatus, validatePositiveNumber,
} = {}) {
    // Ambil saldo terbaru dari DB. DP quotation dapat diterapkan oleh trigger setelah
    // invoice dibuat, sehingga object React yang masih terbuka bisa belum membawa
    // paid_amount terbaru. Approval tidak boleh menimpa saldo tersebut menjadi UNPAID.
    const { data: latestInvoice, error: latestError } = await supabase
      .from("invoices")
      .select("id,total,paid_amount,remaining_amount,status,quotation_id")
      .eq("id", inv.id)
      .maybeSingle();
    if (latestError) {
      reportError("invoice.approve.latestBalanceFailed", latestError, { invoiceId: inv.id });
      showNotif("❌ Saldo pembayaran terbaru gagal dimuat. Approval dibatalkan agar DP tidak tertimpa.");
      return null;
    }
    const effectiveInv = latestInvoice ? { ...inv, ...latestInvoice } : inv;
    // Input validation
    if (!inv.id || inv.id.trim().length === 0) {
      showNotif("❌ Invoice ID tidak valid");
      return null;
    }
    // Allow Rp 0 for repair_gratis (free repairs), but require positive for regular invoices
    if (!effectiveInv.repair_gratis && !validatePositiveNumber(effectiveInv.total)) {
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
          // Tampilkan juga sebagai notif visible (bukan cuma tercatat di Monitoring) —
          // supaya yang approve LANGSUNG sadar saat itu juga, bisa cek/benerin via
          // "Edit Nilai" sebelum invoice terkirim ke customer. Insiden nyata: invoice
          // ke-generate 0,6 detik sebelum order-nya dibetulkan typo-nya (05 Agu 2026).
          showNotif(`⚠️ Invoice ${inv.id} tetap di-approve, tapi nama "${inv.customer}" beda tipis dari order "${targetOrder.customer}" — cek "Edit Nilai" kalau perlu dibetulkan.`);
        }
      }
    }

    const today = getLocalDate();
    const due = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const approvedAt = getLocalISOString(); // Indonesia timezone (UTC+7)
    const paidAmount = Math.max(0, Number(effectiveInv.paid_amount) || 0);
    const remainingAmount = Math.max(0, Number(effectiveInv.total || 0) - paidAmount);
    const approvedStatus = paidAmount >= Number(effectiveInv.total || 0) && Number(effectiveInv.total || 0) > 0
      ? "PAID"
      : paidAmount > 0 ? "PARTIAL_PAID" : "UNPAID";
    let finalApprovedStatus = approvedStatus;
    let finalPaidAmount = paidAmount;
    let finalRemainingAmount = remainingAmount;
    setInvoicesData(prev => prev.map(i =>
      i.id === inv.id ? { ...i, paid_amount: paidAmount, remaining_amount: remainingAmount, status: approvedStatus, due } : i
    ));
    // 1 order = 1 invoice (termasuk multi-hari, kebijakan Owner 11 Agu 2026): approve
    // HANYA menyentuh order pemilik invoice ini. Dulu status ikut di-propagate ke semua
    // child multi-hari karena 1 invoice induk mewakili seluruh hari — sekarang tiap hari
    // punya invoice sendiri, jadi propagasi itu akan menimpa invoice_id anak dan merusak
    // pasangan 1:1-nya.
    setOrdersData(prev => prev.map(o =>
      o.id === inv.job_id ? { ...o, invoice_id: inv.id, status: approvedStatus === "PAID" ? "PAID" : "INVOICE_APPROVED" } : o
    ));
    // GAP 4: simpan approved_by, trigger DB akan catat audit_log
    await setAuditUser();
    // Update invoice — try full, fallback minimal
    {
      const { error: apErr } = await updateInvoice(supabase, inv.id, {
        // Saldo tidak ditulis ulang di sini. Trigger deposit/ledger adalah sumber
        // kebenaran dan akan merekonsiliasi status bila ada DP masuk bersamaan.
        status: approvedStatus, due,
        ...(approvedStatus === "PAID" ? { paid_at: getLocalDate() } : {}),
        approved_by: currentUser?.name || null,
        approved_at: approvedAt,
      }, auditUserName());
      if (apErr) {
        console.warn("invoice approve full failed:", apErr.message);
        const { error: apErr2 } = await updateInvoice(supabase, inv.id, {
          status: approvedStatus,
        }, auditUserName());
        if (apErr2) reportError("invoice.approve.minimalFailed", apErr2, { invoiceId: inv.id });
      }
    }
    // Trigger DP berjalan di transaksi UPDATE di atas. Baca hasil akhirnya sebelum
    // menyetel status order agar race "DP masuk saat tombol Approve ditekan" aman.
    const { data: reconciledInvoice, error: reconcileReadError } = await supabase
      .from("invoices").select("status,paid_amount,remaining_amount").eq("id", inv.id).maybeSingle();
    if (reconcileReadError) {
      reportError("invoice.approve.reconcileReadFailed", reconcileReadError, { invoiceId: inv.id });
    } else if (reconciledInvoice) {
      finalApprovedStatus = reconciledInvoice.status || approvedStatus;
      finalPaidAmount = Number(reconciledInvoice.paid_amount) || 0;
      finalRemainingAmount = Math.max(0, Number(reconciledInvoice.remaining_amount) || 0);
      setInvoicesData(prev => prev.map(i => i.id === inv.id
        ? { ...i, status: finalApprovedStatus, paid_amount: finalPaidAmount, remaining_amount: finalRemainingAmount, due }
        : i));
      setOrdersData(prev => prev.map(o => o.id === inv.job_id
        ? { ...o, invoice_id: inv.id, status: finalApprovedStatus === "PAID" ? "PAID" : "INVOICE_APPROVED" }
        : o));
    }
    // Update order status — with fallback
    {
      const orderStatus = finalApprovedStatus === "PAID" ? "PAID" : "INVOICE_APPROVED";
      const { error: oErr } = await updateOrderStatus(supabase, inv.job_id, orderStatus, auditUserName(), { invoice_id: inv.id });
      if (oErr) {
        console.warn("orders INVOICE_APPROVED failed:", oErr.message);
        await updateOrderStatus(supabase, inv.job_id, "COMPLETED", auditUserName());
      }
    }
    addAgentLog("INVOICE_APPROVED", `Invoice ${inv.id} approve oleh ${currentUser?.name || "—"} — ${inv.customer} ${fmt(inv.total)}`, "SUCCESS");

    // Retro-match: cari bukti bayar yang sudah masuk sebelum invoice di-approve
    if (finalApprovedStatus !== "PAID") {
      retroMatchPayment({ ...inv, paid_amount: finalPaidAmount, remaining_amount: finalRemainingAmount, status: finalApprovedStatus })
        .catch(e => console.warn("[RETRO_MATCH] fire-and-forget error:", e.message));
    }

    return due; // kembalikan due date untuk dipakai caller
}
