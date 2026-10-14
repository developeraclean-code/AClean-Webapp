// Default bonus categories — fallback bila app_settings.bonus_categories belum di-set.
// Nominal mengikuti skema insentif 2025; batas margin diperbarui menjadi
// 1jt/1,5jt/2,5jt dan bisa diubah Owner melalui Setting Bonus.
// Owner bisa override via
// Tim Teknisi → Gaji → 🎯 Komisi Order → ⚙️ Setting Bonus (disimpan ke app_settings).
//
// Struktur tiap kategori:
//   id                  — key unik (dipakai sebagai bonus_type di order_bonuses)
//   label               — nama tampil
//   amount              — nominal default per tim (0 = isi manual)
//   threshold           — batas margin dalam rupiah, khusus kategori margin
//   detection_keywords  — keyword (AND-logic, lowercase) untuk auto-deteksi dari materials_detail invoice.
//                         Kosong = tidak auto-terdeteksi (mis. margin/install/manual ditentukan threshold lain).
//   exclude_keywords    — keyword pengecualian (OR-logic): satu cocok, item langsung dibuang.
//                         Dipakai untuk mempersempit tanpa merusak include — lihat detectBonusFromInvoice().
//
// Nominal mengikuti poster "SKEMA INSENTIF TERBARU 2025" (dikonfirmasi Owner 26 Agu 2026).

export const DEFAULT_BONUS_CATEGORIES = [
  // ── SERVICE AC + JASA LAIN (omset di luar harga sparepart/material) ──
  // ID lama dipertahankan agar entri bonus historis tetap tertaut ke kategori sama.
  { id: "margin_1jt",  label: "Margin >1jt",   threshold: 1000000, amount: 50000,  detection_keywords: [], exclude_keywords: [] },
  { id: "margin_2jt",  label: "Margin >1,5jt", threshold: 1500000, amount: 100000, detection_keywords: [], exclude_keywords: [] },
  { id: "margin_3jt",  label: "Margin >2,5jt", threshold: 2500000, amount: 200000, detection_keywords: [], exclude_keywords: [] },

  // ── SPAREPART (nominal per poster "Skema Insentif Terbaru 2025") ──
  // Satu keyword saja: SEMUA item yang memuat "freon" masuk kategori ini — "Tambah Freon",
  // "Kuras Vacum Freon", "Kuras Vacum + Isi Freon", maupun "Freon R-32" (dikonfirmasi Owner
  // 26 Agu 2026: ketiganya memang kategori freon). JANGAN tambah keyword include: pencocokan
  // ber-logika DAN, jadi menambah keyword justru MEMPERSEMPIT. "vacum" juga TIDAK boleh —
  // ada 120 item "Jasa Vacum AC" (vacuum saat instalasi, bukan isi freon) yang akan salah dapat bonus.
  // exclude "pengisian" membuang "Jasa Pengisian Freon" — freon milik customer, teknisi hanya jasa isi.
  { id: "freon",       label: "Isi Freon",           amount: 20000,  detection_keywords: ["freon"],     exclude_keywords: ["pengisian"] },
  // Satu keyword, alasan sama dgn freon. Menangkap "Sparepart Kapasitor Fan Outdoor",
  // "Jasa Pergantian Kapasitor Fan Indoor", "Kapasitor AC 0.5-1.5PK + Pasang", dll.
  // Poster memisah Outdoor 40rb / Indoor 25rb, TAPI 53 dari 62 job tidak menyebut posisinya
  // di nama item — jadi tetap SATU kategori (keputusan Owner 26 Agu 2026).
  // exclude "dari customer" membuang "Jasa pasang Sparepart kapasitor ( Kapasitor dari customer )".
  { id: "kapasitor",   label: "Kapasitor",           amount: 40000,  detection_keywords: ["kapasitor"], exclude_keywords: ["dari customer"] },
  { id: "thermis",     label: "Sparepart Thermis",   amount: 25000,  detection_keywords: ["thermis"],   exclude_keywords: [] },

  // ── PEMASANGAN AC (akumulasi unit per hari per tim → getInstallCumulative) ──
  // Ambang: >=2 unit, >=3 unit, >=4 unit. Pasang 1 unit = tidak ada bonus (tanpa kategori).
  { id: "install_2",   label: "Pasang 2 Unit/hari",  amount: 50000,  detection_keywords: [], exclude_keywords: [] },
  { id: "install_3",   label: "Pasang 3 Unit/hari",  amount: 150000, detection_keywords: [], exclude_keywords: [] },
  { id: "install_4",   label: "Pasang 4 Unit/hari",  amount: 300000, detection_keywords: [], exclude_keywords: [] },

  { id: "manual",      label: "Bonus Manual",        amount: 0,      detection_keywords: [], exclude_keywords: [] },
];
