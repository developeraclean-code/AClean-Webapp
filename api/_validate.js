// api/_validate.js — Validation & sanitization helpers bersama untuk semua handler API.
// Dipindah apa adanya dari api/[route].js (Batch 1 pemecahan router, Jul 2026).

// Normalisasi nomor untuk target Fonnte.
// - Indonesia: 08xx / 62xx / 8xx → 628xxx (kanonik, tanpa "+")
// - Internasional: diawali "+" ATAU kode negara asing (mis. 49.., 60.., 971..)
//   → literal apa adanya (digit), TIDAK dipaksa jadi 62. Fonnte kirim ke nomor
//   itu langsung (param countryCode hanya berlaku utk nomor berawalan "0").
// Konsisten dgn normalizePhone di src/lib/phone.js (penyimpanan frontend).
export function validateAndNormalizePhone(phone) {
  if (!phone) return null;
  const s = String(phone).trim();
  const intl = s.startsWith("+"); // penanda internasional eksplisit
  let d = s.replace(/[^0-9]/g, "");
  if (!d) return null;

  if (intl) {
    // Internasional literal (termasuk +62 = Indonesia). Jangan paksa 62.
    return /^\d{8,15}$/.test(d) ? d : null;
  }
  if (d.startsWith("0")) d = "62" + d.slice(1);       // 08xx → 628xx (lokal ID)
  else if (d.startsWith("62")) { /* ID sudah kanonik */ }
  else if (d.startsWith("8")) d = "62" + d;           // 8xx → 628xx (mobile ID tanpa prefix)
  // else: kode negara asing tersimpan tanpa "+" (49.., 60.., 971..) → biarkan as-is

  // Valid = 8-15 digit (ID 628xxx maupun internasional)
  if (!/^\d{8,15}$/.test(d)) return null;
  return d;
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

// ── Jaring pengaman: cocokkan nomor yang beda SATU digit ────────────────────
// MIRROR dari src/lib/phoneFuzzy.js (backend Vercel tidak import lintas folder
// src/). Parity dijaga test src/lib/__tests__/phoneFuzzy.test.js — kalau ubah
// di sini, ubah juga di sana.
//
// Kasus nyata: bukti bayar Bapak Ricky tidak pernah nyambung ke invoice karena
// nomor di DB kehilangan 1 digit (628121047006 → 62812047006). buildPhoneVariants
// hanya menangani beda format, bukan beda digit.
const NEAR_PHONE_MIN_LEN = 10;

export function isNearPhone(a, b) {
  const x = String(a || "").replace(/[^\d]/g, "");
  const y = String(b || "").replace(/[^\d]/g, "");
  if (!x || !y || x === y) return false;
  if (x.length < NEAR_PHONE_MIN_LEN || y.length < NEAR_PHONE_MIN_LEN) return false;
  if (!x.startsWith("62") || !y.startsWith("62")) return false;

  const diff = x.length - y.length;
  if (Math.abs(diff) > 1) return false;

  if (diff === 0) {
    let salah = 0;
    for (let i = 0; i < x.length; i++) {
      if (x[i] !== y[i] && ++salah > 1) return false;
    }
    return salah === 1;
  }

  const [panjang, pendek] = diff > 0 ? [x, y] : [y, x];
  let i = 0, j = 0, dibuang = 0;
  while (i < panjang.length && j < pendek.length) {
    if (panjang[i] === pendek[j]) { i++; j++; continue; }
    if (++dibuang > 1) return false;
    i++;
  }
  return true;
}

// Aman dipakai otomatis HANYA karena tiga syarat sekaligus: nominal sama persis,
// nomor beda maks 1 digit, dan kandidatnya tepat satu (2+ → menyerah, biar manual).
export function findNearPhoneInvoice(senderPhone, invoices, amount) {
  const nominal = Number(amount) || 0;
  if (!nominal || !senderPhone || !Array.isArray(invoices)) return null;
  const cocok = invoices.filter(inv =>
    Number(inv?.total) === nominal && isNearPhone(senderPhone, inv?.phone)
  );
  return cocok.length === 1 ? cocok[0] : null;
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
