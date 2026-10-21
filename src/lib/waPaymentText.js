// Nominal pada teks bukti bank harus dibaca dari label mata uang, bukan angka
// pertama: tanggal dan nomor rekening sering muncul sebelum jumlah transfer.
const PAYMENT_CONTEXT = /\b(?:bayar|dibayar|transfer|tf|lunas|pembayaran|invoice|tagihan|qris)\b/i;
const RUPIAH_AMOUNT = /\brp\.?\s*([0-9][0-9.,]*)/gi;
const DIRECT_PAYMENT_AMOUNT = /\b(?:bayar|dibayar|transfer|tf)\s*(?:sebesar|senilai|nominal)?\s*:?[ \t]*([0-9][0-9.,]*)/gi;

export function parseRupiahAmount(value) {
  const raw = String(value || '').trim();
  if (!/^\d[\d.,]*$/.test(raw)) return null;
  const noCents = /[.,]\d{2}$/.test(raw) && (/\d[.,]\d{3}[.,]\d{2}$/.test(raw) || /[.,]00$/.test(raw))
    ? raw.slice(0, -3) : raw;
  const amount = Number(noCents.replace(/\D/g, ''));
  return Number.isSafeInteger(amount) && amount >= 10_000 ? amount : null;
}

export function rupiahAmountsInPaymentText(message) {
  return [...String(message || '').matchAll(RUPIAH_AMOUNT)]
    .map(match => parseRupiahAmount(match[1]))
    .filter(amount => amount !== null);
}

export function shouldInspectPaymentText(message) {
  const text = String(message || '');
  if (!PAYMENT_CONTEXT.test(text)) return false;
  if (rupiahAmountsInPaymentText(text).length) return true;
  // Keep older confirmations without "Rp", but only when the number follows
  // the payment verb directly. Never use an arbitrary date/account number.
  return [...text.matchAll(DIRECT_PAYMENT_AMOUNT)].some(match => parseRupiahAmount(match[1]) !== null);
}

export function normalizePaymentTextAmount(message, extractedAmount) {
  const explicitAmounts = [...new Set(rupiahAmountsInPaymentText(message))];
  // A single explicit Rp is stronger evidence for the amount than model OCR.
  // Multiple amounts (e.g. fee + transfer) remain for the AI/admin to resolve.
  if (explicitAmounts.length === 1) return explicitAmounts[0];
  const amount = Number(extractedAmount);
  return Number.isSafeInteger(amount) && amount >= 10_000 ? amount : null;
}
