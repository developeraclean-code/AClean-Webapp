import { samePhone } from "./phone.js";

// A pending proof is a review candidate, never a payment confirmation.
// An explicit invoice link takes priority. Without one, require both the
// customer phone and exact invoice amount to avoid suggesting another job's
// payment for a customer with multiple open invoices.
export function pendingProofsForInvoice(suggestions, invoice) {
  if (!invoice?.id) return [];
  return (suggestions || []).filter(suggestion => {
    if (suggestion.status !== "PENDING" || suggestion.validation_status !== "PENDING" || !suggestion.image_url) return false;
    if (suggestion.invoice_id) return suggestion.invoice_id === invoice.id;
    return !!suggestion.phone && !!invoice.phone && samePhone(suggestion.phone, invoice.phone)
      && Number(suggestion.amount) > 0 && Number(suggestion.amount) === Number(invoice.total);
  }).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

// Old banner dismissals kept validation_status=PENDING. Show them separately
// as a warning; never turn them into an automatic payment candidate.
export function dismissedProofsForInvoice(suggestions, invoice) {
  if (!invoice?.id) return [];
  return (suggestions || []).filter(suggestion =>
    suggestion.status === "DISMISSED" && suggestion.validation_status === "PENDING"
    && !!suggestion.image_url && suggestion.invoice_id === invoice.id
  ).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

export function invoiceProofAction(invoice) {
  if (!invoice) return "unavailable";
  const proof = String(invoice.payment_proof_url || "").trim();
  if (proof && !["verified-no-proof", "verified-manual-no-proof"].includes(proof)) return "already_attached";
  if (invoice.status === "PAID") return "attach_only";
  return ["UNPAID", "OVERDUE", "PARTIAL_PAID"].includes(invoice.status) ? "settle" : "unavailable";
}
