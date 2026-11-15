import { levenshtein } from "./stringSimilarity.js";
import { fsmCommand } from "./fsmCommand.js";

// Commit invoice approval and its owning order together; no optimistic success.
export async function approveInvoiceCore(inv, {
  addAgentLog, auditUserName, currentUser, fmt, ordersData, reportError,
  retroMatchPayment, setInvoicesData, setOrdersData, showNotif, supabase,
} = {}) {
  if (!inv?.id?.trim()) { showNotif("❌ Invoice ID tidak valid"); return null; }
  // Preserve the operator-facing mismatch guard; the RPC also checks actual links.
  const target = (ordersData || []).find(o => o.id === inv.job_id);
  if (target) {
    const norm = value => String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
    const a = norm(target.customer), b = norm(inv.customer);
    const similarity = 1 - levenshtein(a, b) / (Math.max(a.length, b.length) || 1);
    if (similarity < 0.7) {
      showNotif(`❌ Customer invoice ${inv.id} berbeda dari order; periksa relasi sebelum approval.`);
      return null;
    }
  }
  let result;
  try {
    const { data, error } = await fsmCommand(supabase, "approve_invoice_atomic", {
      p_invoice_id: inv.id, p_expected_updated_at: inv.updated_at || null,
    });
    if (error) throw error;
    if (!data?.invoice || data.invoice.id !== inv.id || !data.due
        || !["PAID", "PARTIAL_PAID", "UNPAID", "OVERDUE"].includes(data.invoice.status)) {
      throw new Error("Hasil approval belum terkonfirmasi; muat ulang invoice");
    }
    result = data;
  } catch (error) {
    reportError("invoice.approve.atomicFailed", error, { invoiceId: inv.id });
    showNotif(`❌ Approval belum terkonfirmasi: ${error.message || "layanan tidak tersedia"}. Muat ulang saldo sebelum mencoba lagi.`);
    return null;
  }
  const saved = result.invoice;
  setInvoicesData(prev => prev.map(row => row.id === saved.id ? { ...row, ...saved } : row));
  if (result.order) {
    setOrdersData(prev => prev.map(row => row.id === result.order.id ? { ...row, ...result.order } : row));
  }
  addAgentLog("INVOICE_APPROVED",
    `Invoice ${saved.id} approve oleh ${currentUser?.name || auditUserName?.() || "—"} — ${saved.customer} ${fmt(saved.total)}`, "SUCCESS");
  if (saved.status !== "PAID" && retroMatchPayment) {
    Promise.resolve().then(() => retroMatchPayment({ ...inv, ...saved }))
      .catch(error => reportError("invoice.approve.retroMatchFailed", error, { invoiceId: saved.id }));
  }
  return result.due;
}
