// Konstanta modul Project — di-share antar view.
export const CATS = ["Pemasangan + Pipa", "Ducting Split Duct", "Di luar Service Reguler"];
export const EXP_CATS = ["Material", "Alat / Sewa Alat", "Upah Harian", "Transport", "Konsumsi", "Lain-lain"];
export const MAT_SUBS = ["Pipa & Ducting", "Refrigerant & Kelistrikan", "Aksesoris & Bracket"];
export const DOC_TYPES = [
  "Surat Penerimaan Barang",
  "Surat Pengiriman Barang",
  "Berita Acara Pengerjaan",
  "Berita Acara Termin",
  "SPK / Surat Perjanjian Kerja",
  "Form Commissioning / Uji Fungsi",
  "Surat Tagihan / Reminder",
  "Kartu Garansi",
];

// Kolom tabel item per jenis dokumen. `w` = lebar (%) kolom data (kolom "No" terpisah, 8%). `sum:true` → ada baris Total.
const COLS_DEFAULT = [
  { key: "nama", label: "Detail", w: 50 },
  { key: "qty", label: "Qty", w: 20 },
  { key: "total", label: "Total", w: 22, align: "right", sum: true },
];
const COLS_COMMISSIONING = [
  { key: "nama", label: "Unit / Lokasi", w: 34 },
  { key: "ampere", label: "Ampere (A)", w: 16 },
  { key: "tekanan", label: "Tekanan (psi)", w: 18 },
  { key: "suhu", label: "Suhu (°C)", w: 14 },
  { key: "ket", label: "Hasil", w: 10 },
];
const COLS_GARANSI = [
  { key: "nama", label: "Cakupan / Komponen", w: 46 },
  { key: "qty", label: "Masa Garansi", w: 24 },
  { key: "ket", label: "Keterangan", w: 22 },
];
export const docColumns = (jenis = "") =>
  jenis.includes("Commissioning") || jenis.includes("Uji") ? COLS_COMMISSIONING
    : jenis.includes("Garansi") ? COLS_GARANSI
      : COLS_DEFAULT;

// Prefix nomor dokumen per jenis.
export const docPrefix = (j = "") =>
  j.includes("Termin") ? "BAT"
    : j.includes("Berita") ? "BA"
      : j.includes("Pengiriman") ? "SJ"
        : j.includes("Penerimaan") ? "TT"
          : j.includes("SPK") || j.includes("Perjanjian") ? "SPK"
            : j.includes("Commissioning") || j.includes("Uji") ? "CM"
              : j.includes("Tagihan") || j.includes("Reminder") ? "INV"
                : j.includes("Garansi") ? "GAR" : "DOC";

// Label bagian uraian (teks bebas) per jenis.
export const docUraianLabel = (j = "") =>
  j.includes("Berita") ? "Uraian Pekerjaan"
    : j.includes("SPK") || j.includes("Perjanjian") ? "Ruang Lingkup Pekerjaan"
      : j.includes("Garansi") ? "Syarat & Ketentuan Garansi"
        : j.includes("Commissioning") || j.includes("Uji") ? "Catatan Pengujian"
          : j.includes("Tagihan") || j.includes("Reminder") ? "Catatan Tagihan"
            : "Keterangan";

// Label tabel item per jenis.
export const docItemsLabel = (j = "") =>
  j.includes("Commissioning") || j.includes("Uji") ? "Hasil Uji Fungsi per Unit (isi seperti Excel)"
    : j.includes("Garansi") ? "Cakupan Garansi"
      : j.includes("Termin") ? "Rincian Termin Pembayaran"
        : j.includes("Tagihan") || j.includes("Reminder") ? "Rincian Tagihan"
          : j.includes("SPK") || j.includes("Perjanjian") ? "Ruang Lingkup & Nilai"
            : j.includes("Berita") ? "Rincian Pekerjaan (rekap)"
              : "Daftar Barang";

// Label tanda tangan kiri/kanan per jenis.
export const docSig = (j = "", company = "AClean Service") =>
  j.includes("SPK") || j.includes("Perjanjian") ? { lRole: "Pihak Pertama,", lName: company, rRole: "Pihak Kedua," }
    : j.includes("Tagihan") || j.includes("Reminder") ? { lRole: "Hormat kami,", lName: company, rRole: "Diterima oleh," }
      : j.includes("Garansi") ? { lRole: "Diterbitkan oleh,", lName: company, rRole: "Pelanggan," }
        : { lRole: "Diserahkan oleh,", lName: "Teknisi AClean", rRole: "Diterima oleh," };

export const DOC_PRESETS = {
  "Surat Pengiriman Barang": [
    { nama: "AC Split 1PK", qty: "1 unit", total: "" },
    { nama: "Pipa set 3/8-5/8", qty: "1 set", total: "" },
    { nama: "Bracket outdoor", qty: "1 pcs", total: "" },
    { nama: "Kabel power 3x2.5", qty: "5 m", total: "" },
    { nama: "Drat / fitting", qty: "1 pcs", total: "" },
  ],
  "Surat Penerimaan Barang": [
    { nama: 'Pipa tembaga 3/8"', qty: "10 m", total: "" },
    { nama: "Freon R32", qty: "1 tabung", total: "" },
    { nama: "Bracket gantungan", qty: "4 pcs", total: "" },
    { nama: "Mesin (pinjam pakai)", qty: "1 unit", total: "" },
  ],
  "Berita Acara Pengerjaan": [
    { nama: "Pemasangan unit indoor + outdoor", qty: "1 unit", total: "" },
    { nama: "Instalasi pipa & kabel", qty: "", total: "" },
    { nama: "Vakum & isi freon", qty: "", total: "" },
    { nama: "Running test", qty: "", total: "" },
  ],
  "Berita Acara Termin": [
    { nama: "Termin 1 — DP", qty: "30%", total: "" },
    { nama: "Termin 2 — Progres", qty: "40%", total: "" },
    { nama: "Termin 3 — Pelunasan", qty: "30%", total: "" },
  ],
  "SPK / Surat Perjanjian Kerja": [
    { nama: "Pemasangan AC + instalasi pipa", qty: "", total: "" },
    { nama: "Material (pipa, kabel, bracket)", qty: "", total: "" },
    { nama: "Termin pembayaran (DP / pelunasan)", qty: "", total: "" },
  ],
  "Form Commissioning / Uji Fungsi": [
    { nama: "Indoor 1 — Ruang …", ampere: "", tekanan: "", suhu: "", ket: "OK" },
    { nama: "Indoor 2 — Ruang …", ampere: "", tekanan: "", suhu: "", ket: "OK" },
  ],
  "Surat Tagihan / Reminder": [
    { nama: "Sisa tagihan project", qty: "", total: "" },
  ],
  "Kartu Garansi": [
    { nama: "Jasa pemasangan", qty: "3 bulan", ket: "Kebocoran / hasil instalasi" },
    { nama: "Unit AC (pabrik)", qty: "1 tahun", ket: "Sesuai kartu garansi unit" },
    { nama: "Kompresor (pabrik)", qty: "3–5 tahun", ket: "Sesuai brand" },
  ],
};
export const BA_CHECK_PRESET = [
  "Pekerjaan sesuai spesifikasi",
  "Uji fungsi / running test",
  "Tidak ada kebocoran",
  "Area kerja bersih",
  "Dokumentasi foto lengkap",
];

// Jumlahkan kolom Total (teks bebas spt "Rp 150.000" / "150000") → angka. 0 kalau tak ada yg numerik.
export const sumDocTotal = (items = []) =>
  items.reduce((s, it) => s + (parseInt(String(it.total || "").replace(/[^\d]/g, ""), 10) || 0), 0);

// GPS palsu per project (untuk stempel foto demo). Project baru fallback ke koord default.
export const GPS_FALLBACK = "-6.2,106.9";

export const fmtRp = (n) => "Rp " + (n || 0).toLocaleString("id-ID");
export const esc = (s) => (s || "").toString().replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
