// Normalisasi nomor telepon.
// - Nomor Indonesia: 08xxx / +62xxx / 628xxx / 8xxx → 628xxx (kanonik, TANPA "+")
// - Nomor internasional: diawali "+" → literal (digit apa adanya, TANPA prefix 62).
//   Contoh: "+49 176 123" → "49176123", "+81 90 123" → "8190123" (Jepang, awalan 8
//   tidak ikut jadi 62 karena user menandai "+").
// Penanda "+" adalah sinyal eksplisit "ini internasional, jangan diutak-atik".
export const normalizePhone = (p) => {
  if (!p) return "";
  const raw = p.toString().trim();
  const intl = raw.startsWith("+"); // penanda internasional eksplisit
  // Strip semua selain digit — pakai [^\d] agar Unicode soft-hyphen (U+2011), invisible chars, dll ikut terhapus
  const d = raw.replace(/[^\d]/g, "");
  if (!d) return "";
  if (intl) return d; // internasional literal — jangan prefix 62
  if (d.startsWith("08")) return "62" + d.slice(1);
  if (d.startsWith("62")) return d;
  if (d.startsWith("8")) return "62" + d;
  // Edge: digit lain (mis. nomor luar negeri tanpa "+") — kembalikan as-is digits only
  return d;
};

// Pembersih input LIVE (dipakai di onChange field HP): pertahankan "+" di awal
// bila ada, buang karakter lain. Ini menjaga sinyal internasional selama user
// masih mengetik (jangan langsung normalizePhone di onChange — itu melucuti "+"
// dan membuat nomor kode negara berawalan 8 mis. +81/+86 salah jadi 628xxx).
// normalizePhone dipanggil saat SAVE/blur.
export const cleanPhoneInput = (val) => {
  if (val == null) return "";
  const s = val.toString();
  const plus = s.trimStart().startsWith("+") ? "+" : "";
  return plus + s.replace(/[^\d]/g, "");
};

// Validasi nomor Indonesia: harus 628xxxxxxxxx (10-15 digit)
export const isValidIDPhone = (p) => {
  const n = normalizePhone(p);
  return /^628\d{8,12}$/.test(n);
};

// Validasi longgar untuk simpan (ID maupun internasional): 8–15 digit.
export const isValidPhone = (p) => {
  const n = normalizePhone(p);
  return /^\d{8,15}$/.test(n);
};

export const samePhone = (a, b) => {
  if (!a || !b) return false;
  return normalizePhone(a) === normalizePhone(b);
};

// Kode negara 3-digit yang umum (untuk pemenggalan tampilan yang rapi).
const CC3 = new Set([
  "971", "974", "966", "968", "965", "973", "852", "853", "886", "880",
  "855", "856", "673", "977", "960", "962", "963", "964", "967", "970",
  "972", "975", "976", "998", "992", "993", "994", "995", "996", "998",
]);
// Kode negara 1-digit.
const CC1 = new Set(["1", "7"]);

// Pisahkan digit → [kodeNegara, sisa]. Indonesia (62) diprioritaskan.
const splitCountryCode = (d) => {
  if (d.startsWith("62")) return ["62", d.slice(2)];
  const c3 = d.slice(0, 3);
  if (CC3.has(c3)) return [c3, d.slice(3)];
  const c1 = d.slice(0, 1);
  if (CC1.has(c1)) return [c1, d.slice(1)];
  return [d.slice(0, 2), d.slice(2)]; // default kode negara 2-digit
};

// Tampilan SERAGAM internasional (E.164): "+62 812-3456-7890", "+49 151-7284-3757".
// HANYA untuk tampilan ke user — JANGAN dipakai untuk kirim WA / query DB
// (pakai nilai tersimpan / normalizePhone untuk itu).
export const formatPhone = (p) => {
  if (!p) return "";
  const d = normalizePhone(p); // kanonikalisasi dulu (08→628, +→literal)
  if (!d) return "";
  const [cc, rest] = splitCountryCode(d);
  if (!rest) return "+" + cc;
  // Kelompokkan sisa: blok pertama 3 digit, lalu blok 4-digit.
  const groups = [rest.slice(0, 3)];
  let r = rest.slice(3);
  while (r.length) { groups.push(r.slice(0, 4)); r = r.slice(4); }
  return "+" + cc + " " + groups.filter(Boolean).join("-");
};

// Auto-format search input: jika input terlihat seperti nomor HP (0812, +62, 628, 8xxx),
// kembalikan versi normalized 628xxx agar search langsung cocok.
// Jika bukan nomor HP (ada huruf, dll) kembalikan string asli.
export const smartSearchNormalize = (val) => {
  if (!val) return val;
  const stripped = val.replace(/[\s\-().+]/g, "");
  if (/^\d{5,}$/.test(stripped)) return normalizePhone(stripped);
  return val;
};

// Ambil semua nomor telepon yang tertulis di TEKS BEBAS (mis. customers.notes:
// "PIC kontrak: Bapak Alief Aji (6287820958051). Nomor utama 6285714121850").
// customers hanya punya SATU kolom phone, jadi nomor PIC/alternatif disimpan di
// notes. Fungsi ini yang membuatnya tetap bisa dikenali — dipakai soft-warning di
// Planning Order saat admin menempel nomor alternatif (biar tidak bikin customer
// duplikat). Hanya deret 9-15 digit yang dianggap nomor, jadi potongan alamat
// seperti "RT 014 RW 003" tidak ikut terjaring.
export const extractPhones = (text) => {
  if (!text) return [];
  const out = [];
  const seen = new Set();
  for (const m of String(text).matchAll(/\+?\d[\d\s.\-()]{7,}\d/g)) {
    const n = normalizePhone(m[0].trim());
    if (/^\d{9,15}$/.test(n) && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
};
