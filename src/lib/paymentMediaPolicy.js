// Payment evidence is not inferred from an open invoice or a customer name.
export function isPaymentEvidenceClassification(classification) {
  return classification?.category === "bukti_transfer";
}

// Older broad fallbacks remain in the database for audit, not in the payment inbox.
// Do not age-filter real receipts: an old unpaid bill still needs its evidence.
export function isPaymentInboxSuggestion(row) {
  if (row?.match_source !== "wa_image_review" && row?.match_source !== "wa_image_ai_pending") return true;
  if (/AI mengategorikan media sebagai (?:kerusakan_ac|tidak_relevan|dokumen)\b/.test(row.raw_message || "")) return false;
  if (Number(row.amount) > 0) return true;
  return /^Bukti transfer terdeteksi AI\./.test(row.raw_message || "")
    || /^Media WA perlu review manual: Bukti pembayaran teridentifikasi\b/.test(row.raw_message || "");
}
