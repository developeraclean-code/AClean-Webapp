// api/_validate.js — Validation & sanitization helpers bersama untuk semua handler API.
// Dipindah apa adanya dari api/[route].js (Batch 1 pemecahan router, Jul 2026).

export function validateAndNormalizePhone(phone) {
  if (!phone) return null;
  let normalized = String(phone).replace(/[^0-9+]/g, "");
  if (normalized.startsWith("+62")) normalized = normalized.substring(1);
  if (normalized.startsWith("0")) normalized = "62" + normalized.substring(1);
  if (!normalized.startsWith("62")) normalized = "62" + normalized;

  // Must be valid Indonesian phone: 62 + 9-12 digits (total 11-14 digits)
  if (!/^62\d{9,12}$/.test(normalized)) return null;
  return normalized;
}

// Semua format phone yang mungkin tersimpan di DB — untuk query OR matching
export function buildPhoneVariants(normalized) {
  // normalized = "628xxx" (output dari validateAndNormalizePhone)
  if (!normalized || !normalized.startsWith("62")) return [normalized];
  const digits = normalized.slice(2); // hilangkan "62"
  return [
    normalized,            // 628xxx  (Fonnte format)
    "0" + digits,          // 08xxx   (format lokal)
    "+" + normalized,      // +628xxx (format internasional)
  ];
}

export function validateMessage(msg, maxLen = 4096) {
  if (!msg || typeof msg !== "string") return null;
  const trimmed = msg.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) return null;
  return trimmed;
}

export function sanitizeName(s) {
  return (s||"").replace(/[\r\n\t]/g, " ").slice(0, 100);
}

// M-05: bersihkan teks dari DB/user sebelum masuk prompt LLM.
// Buang karakter yang sering dipakai prompt-injection (kurung/blok/bintang/backtick)
// + newline, supaya tidak bisa "memecah" struktur prompt atau menyisipkan instruksi.
export function sanitizeForPrompt(s, max = 80) {
  return (s || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[[\]{}*`<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
