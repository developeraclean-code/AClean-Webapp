// Constants & utility functions untuk LaporanTeknisiModal dan submitLaporan
// Exported untuk dipakai oleh App.jsx (openLaporanModal, submitLaporan) dan LaporanTeknisiModal.jsx

export const KONDISI_SBL = [
  "AC Normal",
  "AC Tidak Dingin",
  "AC Bau Tidak Sedap",
  "AC Bocor Air",
  "AC Mampet Karna Lendir / Lumut",
  "AC Bunyi Berisik",
  "AC Tidak Menyala",
  "Freon Habis/Kurang",
  "Kompresor Bermasalah",
  "AC Error",
];

export const KONDISI_SDH = [
  "AC Dingin Kembali",
  "AC Masih Terkendala",
  "Perlu Pergantian Sparepart",
  "AC Rusak Perlu Pergantian Unit",
  "Semua Fungsi Normal",
  "Perlu Test Press",
  "Perlu Pengisian / Tambah Freon",
  "Perlu Service Besar",
  "Tidak Melakukan Cek Freon",
  "Tidak Melakukan Cek Ampere",
];

const PEKERJAAN_BY_SERVICE = {
  Cleaning: [
    "Service Cleaning",
    "Deep Cleaning (Service Besar)",
    "Cleaning Indoor dan Outdoor",
    "Kuras Vacum Freon",
    "Penambahan Freon",
    "Bersihkan Drain / Talang",
    "Pemasangan Sparepart",
    "Pekerjaan Lainnya",
  ],
  Install: [
    "Pemasangan Unit",
    "Bongkar Pasang Unit",
    "Pasang Unit Indoor",
    "Pasang Unit Outdoor",
    "Pasang Bracket",
    "Instalasi Pipa",
    "Instalasi Kabel",
    "Uji Coba Unit",
    "Pekerjaan Lainnya",
  ],
  Repair: [
    "Service Cleaning",
    "Kuras Vacum Freon",
    "Penambahan Freon",
    "Bersihkan Drain / Talang",
    "Pemasangan Sparepart",
    "Ganti Kapasitor",
    "Ganti Relay / Thermostat",
    "Ganti PCB / Modul",
    "Perbaiki Pipa Bocor",
    "Pekerjaan Lainnya",
  ],
  Complain: [
    "Service Cleaning",
    "Penambahan Freon",
    "Bersihkan Drain / Talang",
    "Pemasangan Sparepart",
    "Pengecekan Ulang",
    "Cek Instalasi Pipa",
    "Cek Kelistrikan",
    "Follow Up Komplain",
    "Garansi Servis",
    "Pekerjaan Lainnya",
  ],
};
export const PEKERJAAN_OPT = (svc) => PEKERJAAN_BY_SERVICE[svc] || PEKERJAAN_BY_SERVICE["Cleaning"];

export const MATERIAL_PRESET = {
  Cleaning: [
    { nama: "Freon R-22", satuan: "KG" },
    { nama: "Freon R-32", satuan: "KG" },
    { nama: "Freon R-410A", satuan: "KG" },
    { nama: "Sparepart Kapasitor Fan", satuan: "Piece" },
    { nama: "Thermis Indoor", satuan: "Piece" },
  ],
  Repair: [
    { nama: "Freon R-22", satuan: "KG" },
    { nama: "Freon R-32", satuan: "KG" },
    { nama: "Freon R-410A", satuan: "KG" },
    { nama: "Sparepart Kapasitor Fan", satuan: "Piece" },
    { nama: "Thermis Indoor", satuan: "Piece" },
    { nama: "Remote AC Multi", satuan: "Unit" },
    { nama: "REMOTE AC DAIKIN", satuan: "Piece" },
    { nama: "Steker Colokan", satuan: "Piece" },
  ],
  Complain: [
    { nama: "Freon R-22", satuan: "KG" },
    { nama: "Freon R-32", satuan: "KG" },
    { nama: "Freon R-410A", satuan: "KG" },
  ],
};

export const INSTALL_ITEMS = [
  { key: "jasa_ganti_instalasi",    label: "Jasa Pergantian Instalasi AC",       satuan: "Unit",  default: 0 },
  { key: "pasang_05_1pk",           label: "Pemasangan AC Baru 0,5PK - 1PK",     satuan: "Unit",  default: 0 },
  { key: "pasang_15_2pk",           label: "Pemasangan AC Baru 1,5PK - 2PK",     satuan: "Unit",  default: 0 },
  { key: "bongkar_05_1pk",          label: "Jasa Bongkar Unit AC 0,5PK - 1PK",   satuan: "Unit",  default: 0 },
  { key: "bongkar_15_25pk",         label: "Jasa Bongkar Unit AC 1,5PK - 2,5PK", satuan: "Unit",  default: 0 },
  { key: "bongkar_pasang_indoor",   label: "Jasa Bongkar Pasang Indoor",          satuan: "Unit",  default: 0 },
  { key: "bongkar_pasang_outdoor",  label: "Jasa Bongkar Pasang Outdoor",         satuan: "Unit",  default: 0 },
  { key: "vacum_05_25pk",           label: "Jasa Vacum AC 0,5PK - 2,5PK",        satuan: "Unit",  default: 0 },
  { key: "pipa_1pk",                label: "Pipa AC Hoda 1PK",                    satuan: "Meter", default: 0 },
  { key: "pipa_2pk",                label: "Pipa AC Hoda 2PK",                    satuan: "Meter", default: 0 },
  { key: "pipa_25pk",               label: "Pipa AC Hoda 2,5PK",                 satuan: "Meter", default: 0 },
  { key: "pipa_3pk",                label: "Pipa AC Hoda 3PK",                   satuan: "Meter", default: 0 },
  { key: "kabel_15",                label: "Kabel Listrik 3x1,5",                satuan: "Meter", default: 0 },
  { key: "kabel_25",                label: "Kabel Listrik 3x2,5",                satuan: "Meter", default: 0 },
  { key: "ducttape_biasa",          label: "Duct Tape Non Lem",                  satuan: "Piece", default: 0 },
  { key: "ducttape_lem",            label: "Duct Tape Lem",                       satuan: "Piece", default: 0 },
  { key: "jasa_pipa_ac",            label: "Jasa Penarikan Pipa AC",              satuan: "Meter", default: 0 },
  { key: "jasa_pipa_ruko",          label: "Jasa Penarikan Pipa Ruko",            satuan: "Meter", default: 0 },
  { key: "dinabolt",                label: "DINABOLT Set",                        satuan: "Set",   default: 0 },
  { key: "karet_mounting",          label: "KARET MOUNTING",                      satuan: "Set",   default: 0 },
  { key: "breket_outdoor",          label: "Breket Outdoor Inc Dinabolt",         satuan: "Piece", default: 0 },
  { key: "paralon",                 label: "Paralon",                             satuan: "Meter", default: 0 },
  { key: "selang_flexibel_drain",   label: "Selang Flexibel Drain",               satuan: "Meter", default: 0 },
  { key: "kuras_vacum_r32",         label: "Kuras Vacum Freon R32/R410",         satuan: "Unit",  default: 0 },
  { key: "kuras_vacum_r22",         label: "Kuras Vacum Freon R22",               satuan: "Unit",  default: 0 },
  { key: "freon_r22",               label: "Freon R-22",                          satuan: "KG",    default: 0 },
  { key: "freon_r32",               label: "Freon R-32",                          satuan: "KG",    default: 0 },
  { key: "freon_r410",              label: "Freon R-410A",                        satuan: "KG",    default: 0 },
  // Cleaning sekalian saat Install/ganti instalasi. label = nama di invoice (deskriptif);
  // priceKey = nama baris price list yang SUDAH ADA (hindari baris harga duplikat).
  { key: "cleaning_split_05_1pk",   label: "Cleaning AC Split Wall 0,5PK - 1PK",   satuan: "Unit",  default: 0, priceKey: "AC Split 0.5-1PK" },
  { key: "cleaning_split_15_25pk",  label: "Cleaning AC Split Wall 1,5PK - 2,5PK", satuan: "Unit",  default: 0, priceKey: "AC Split 1.5-2.5PK" },
];

export const TIPE_AC_OPT = [
  "AC Split 0.5PK", "AC Split 0.75PK", "AC Split 1PK", "AC Split 1.5PK",
  "AC Split 2PK", "AC Split 2.5PK", "AC Split 3PK",
  "AC Cassette 2PK", "AC Cassette 2.5PK", "AC Cassette 3PK", "AC Cassette 3.5PK",
  "AC Cassette 4PK", "AC Cassette 4.5PK", "AC Cassette 5PK", "AC Cassette 6PK",
  "AC Floor Standing 2PK", "AC Floor Standing 2.5PK", "AC Floor Standing 3PK",
  "AC Floor Standing 3.5PK", "AC Floor Standing 4PK", "AC Floor Standing 4.5PK",
  "AC Floor Standing 5PK",
  "AC Split Duct 2PK", "AC Split Duct 2.5PK", "AC Split Duct 3PK",
  "AC Split Duct 3.5PK", "AC Split Duct 4PK", "AC Split Duct 5PK", "AC Split Duct 6PK",
];

export const SATUAN_OPT = ["pcs", "kg", "liter", "meter", "set", "titik", "roll"];

// Map satu unit maintenance → bentuk "hist" untuk mkUnit
export const maintUnitToHist = (mu) => {
  const AC_TYPE_BASE = {
    cassette: "AC Cassette", split: "AC Split",
    ducted: "AC Split Duct", standing: "AC Floor Standing",
  };
  const base = AC_TYPE_BASE[mu.ac_type] || "AC Split";
  const pkNum = mu.capacity_pk != null && String(mu.capacity_pk).trim() !== "" ? String(mu.capacity_pk).trim() : "1";
  const candidate = `${base} ${pkNum}PK`;
  return {
    label: `${mu.unit_code} — ${mu.location || ""}`.replace(/— $/, "").trim(),
    tipe: TIPE_AC_OPT.includes(candidate) ? candidate : "",
    merk: mu.brand || "",
    pk: `${pkNum}PK`,
    model: mu.serial_no || "",
    from_history_job_id: null,
    maint_unit_id: mu.id,
  };
};

// Map satu unit registry AC (ac_units) → bentuk "hist" untuk mkUnit (registry customer reguler).
// lokasi = label posisi (kunci identitas). pk fallback ke kapasitas (legacy migrasi 018).
export const acUnitToHist = (au) => ({
  label: au.lokasi || "",
  tipe: TIPE_AC_OPT.includes(au.tipe) ? au.tipe : "",
  merk: au.merk || "",
  pk: au.pk || au.kapasitas || "1PK",
  model: au.serial_number || "",
  from_history_job_id: null,
  ac_unit_id: au.id,
});

export const mkUnit = (no, hist = null) => {
  if (hist) {
    return {
      unit_no: no,
      label: hist.label || "",
      tipe: TIPE_AC_OPT.includes(hist.tipe) ? hist.tipe : "",
      merk: hist.merk || "",
      pk: hist.pk || "1PK",
      model: hist.model || "",
      kondisi_sebelum: [],
      kondisi_setelah: [],
      pekerjaan: [],
      freon_ditambah: "",
      ampere_akhir: "",
      catatan_unit: "",
      from_history_job_id: hist.from_history_job_id || null,
      maint_unit_id: hist.maint_unit_id || null,
      ac_unit_id: hist.ac_unit_id || null,
    };
  }
  return {
    unit_no: no, label: "", tipe: "", merk: "", pk: "1PK", model: "",
    kondisi_sebelum: [], kondisi_setelah: [], pekerjaan: [],
    freon_ditambah: "", ampere_akhir: "", catatan_unit: "",
    from_history_job_id: null, maint_unit_id: null, ac_unit_id: null,
  };
};

// Step 2 — unit dianggap selesai jika ada pekerjaan + minimal 1 kondisi
export const isUnitDone = (u) =>
  u.pekerjaan.length > 0 && (u.kondisi_sebelum.length > 0 || u.kondisi_setelah.length > 0);
