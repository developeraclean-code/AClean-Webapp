// Normalisasi: 08xxx / +62xxx / 628xxx / 8xxx → 628xxx
// - Buang semua karakter selain digit (spasi, strip, kurung, plus, titik)
// - Auto-prefix 62 untuk format Indonesia
export const normalizePhone = (p) => {
  if (!p) return "";
  // Strip semua selain digit (handle paste dari format lain seperti "+62 812-3456-7890")
  const d = p.toString().replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("08")) return "62" + d.slice(1);
  if (d.startsWith("62")) return d;
  if (d.startsWith("8")) return "62" + d;
  // Edge: digit lain (mis. nomor luar negeri) — kembalikan as-is digits only
  return d;
};

// Validasi nomor Indonesia: harus 628xxxxxxxxx (10-15 digit)
export const isValidIDPhone = (p) => {
  const n = normalizePhone(p);
  return /^628\d{8,12}$/.test(n);
};

export const samePhone = (a, b) => {
  if (!a || !b) return false;
  return normalizePhone(a) === normalizePhone(b);
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
