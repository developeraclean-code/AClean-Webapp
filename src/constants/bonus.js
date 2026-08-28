// Default bonus categories — fallback bila app_settings.bonus_categories belum di-set.
// Mirror dari migrations/155_bonus_skema_insentif_2025.sql (BUKAN 075 — itu seed lama
// yang sudah usang). Owner bisa override via
// Tim Teknisi → Gaji → 🎯 Komisi Order → ⚙️ Setting Bonus (disimpan ke app_settings).
//
// Struktur tiap kategori:
//   id                  — key unik (dipakai sebagai bonus_type di order_bonuses)
//   label               — nama tampil
//   amount              — nominal default per tim (0 = isi manual)
//   detection_keywords  — keyword (AND-logic, lowercase) untuk auto-deteksi dari materials_detail invoice.
//                         Kosong = tidak auto-terdeteksi (mis. margin/install/manual ditentukan threshold lain).
//   exclude_keywords    — keyword pengecualian (OR-logic): satu cocok, item langsung dibuang.
//                         Dipakai untuk mempersempit tanpa merusak include — lihat detectBonusFromInvoice().
//
// Nominal mengikuti poster "SKEMA INSENTIF TERBARU 2025" (dikonfirmasi Owner 26 Agu 2026).

export const DEFAULT_BONUS_CATEGORIES = [
  // ── SERVICE AC + JASA LAIN (omset di luar harga sparepart/material) ──
  // CATATAN: ambang margin di repo ini masih 1jt/2jt/3jt. Poster "Skema Insentif 2025"
  // menulis 1jt/1,5jt/2,5jt per HARI — perbaikan itu dikerjakan di repo terpisah
  // (keputusan Owner 26 Agu 2026), jadi JANGAN diubah di sini tanpa instruksi baru.
  { id: "margin_1jt",  label: "Margin >1jt",         amount: 50000,  detection_keywords: [], exclude_keywords: [] },
  { id: "margin_2jt",  label: "Margin >2jt",         amount: 100000, detection_keywords: [], exclude_keywords: [] },
  { id: "margin_3jt",  label: "Margin >3jt",         amount: 200000, detection_keywords: [], exclude_keywords: [] },

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
