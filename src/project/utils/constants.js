// Konstanta modul Project — di-share antar view.
export const CATS = ["Pemasangan + Pipa", "Ducting Split Duct", "Di luar Service Reguler"];
export const EXP_CATS = ["Material", "Alat / Sewa Alat", "Upah Harian", "Transport", "Konsumsi", "Lain-lain"];
export const MAT_SUBS = ["Pipa & Ducting", "Refrigerant & Kelistrikan", "Aksesoris & Bracket"];
export const DOC_TYPES = ["Surat Penerimaan Barang", "Surat Pengiriman Barang", "Berita Acara Pengerjaan"];

export const DOC_PRESETS = {
  "Surat Pengiriman Barang": [
    { nama: "AC Split 1PK", qty: "", satuan: "unit" },
    { nama: "Pipa set 3/8-5/8", qty: "", satuan: "set" },
    { nama: "Bracket outdoor", qty: "", satuan: "pcs" },
    { nama: "Kabel power 3x2.5", qty: "", satuan: "m" },
    { nama: "Drat / fitting", qty: "", satuan: "pcs" },
  ],
  "Surat Penerimaan Barang": [
    { nama: 'Pipa tembaga 3/8"', qty: "", satuan: "m" },
    { nama: "Freon R32", qty: "", satuan: "tabung" },
    { nama: "Bracket gantungan", qty: "", satuan: "pcs" },
    { nama: "Mesin (pinjam pakai)", qty: "", satuan: "unit" },
  ],
};
export const BA_CHECK_PRESET = [
  "Pekerjaan sesuai spesifikasi",
  "Uji fungsi / running test",
  "Tidak ada kebocoran",
  "Area kerja bersih",
  "Dokumentasi foto lengkap",
];

// GPS palsu per project (untuk stempel foto demo). Project baru fallback ke koord default.
export const GPS_FALLBACK = "-6.2,106.9";

export const fmtRp = (n) => "Rp " + (n || 0).toLocaleString("id-ID");
export const esc = (s) => (s || "").toString().replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
