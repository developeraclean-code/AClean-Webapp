// Default bonus categories — fallback bila app_settings.bonus_categories belum di-set.
// Mirror dari migrations/075_bonus_categories.sql. Owner bisa override via
// Tim Teknisi → Gaji → 🎯 Komisi Order → ⚙️ Setting Bonus (disimpan ke app_settings).
//
// Struktur tiap kategori:
//   id                  — key unik (dipakai sebagai bonus_type di order_bonuses)
//   label               — nama tampil
//   amount              — nominal default per tim (0 = isi manual)
//   detection_keywords  — keyword (AND-logic, lowercase) untuk auto-deteksi dari materials_detail invoice.
//                         Kosong = tidak auto-terdeteksi (mis. margin/install/manual ditentukan threshold lain).

export const DEFAULT_BONUS_CATEGORIES = [
  { id: "margin_1jt",  label: "Margin >1jt",          amount: 50000,  detection_keywords: [] },
  { id: "margin_2jt",  label: "Margin >2jt",          amount: 100000, detection_keywords: [] },
  { id: "margin_3jt",  label: "Margin >3jt",          amount: 200000, detection_keywords: [] },
  { id: "freon",       label: "Isi Freon",            amount: 25000,  detection_keywords: ["freon", "kuras vacum"] },
  { id: "kapasitor",   label: "Kapasitor",            amount: 35000,  detection_keywords: ["kapasitor ac"] },
  { id: "thermis",     label: "Sparepart Thermis",    amount: 35000,  detection_keywords: ["thermis"] },
  { id: "install_2",   label: "Pasang >2 Unit/hari",  amount: 100000, detection_keywords: [] },
  { id: "install_3",   label: "Pasang >3 Unit/hari",  amount: 200000, detection_keywords: [] },
  { id: "install_4",   label: "Pasang >4 Unit/hari",  amount: 300000, detection_keywords: [] },
  { id: "manual",      label: "Bonus Manual",         amount: 0,      detection_keywords: [] },
];
