// Data awal in-memory untuk modul Project (akan diganti Supabase nanti).
// Tanggal acuan demo: 2026-05-29.
export const TODAY = "2026-05-29";

export const initialData = () => ({
  projects: [
    { id: "p1", nama: "Ducting RS Harapan Bunda", kategori: "Ducting Split Duct", lokasi: "Bekasi", status: "BERJALAN", progress: 72, mulai: "2026-05-12", target: "2026-06-10", nilai: 145000000, rab: 100000000, pic: "Rian", tim: ["Rian", "Budi", "Joko (Helper)"], gps: "-6.241,107.001" },
    { id: "p2", nama: "Instalasi Pipa Tower B Grand City", kategori: "Pemasangan + Pipa", lokasi: "Jakarta Selatan", status: "BERJALAN", progress: 45, mulai: "2026-05-20", target: "2026-06-18", nilai: 98000000, rab: 70000000, pic: "Dedi", tim: ["Dedi", "Anton", "Sahrul (Helper)"], gps: "-6.263,106.781" },
    { id: "p3", nama: "Pemasangan 18 Unit Hotel Senja", kategori: "Pemasangan + Pipa", lokasi: "Depok", status: "FINISHING", progress: 90, mulai: "2026-05-02", target: "2026-05-27", nilai: 122000000, rab: 88000000, pic: "Agus", tim: ["Agus", "Wawan", "Doni (Helper)"], gps: "-6.402,106.794" },
    { id: "p4", nama: "Relokasi Cold Storage Gudang Mega", kategori: "Di luar Service Reguler", lokasi: "Cikarang", status: "SELESAI", progress: 100, mulai: "2026-04-10", target: "2026-04-28", nilai: 47500000, rab: 30000000, pic: "Rian", tim: ["Rian", "Budi"], gps: "-6.305,107.151" },
  ],
  dp: [
    { projectId: "p1", tanggal: "2026-05-13", jumlah: 72500000, ket: "DP 50% (kontrak)" },
    { projectId: "p1", tanggal: "2026-05-28", jumlah: 36250000, ket: "Termin 2 (25%)" },
    { projectId: "p2", tanggal: "2026-05-21", jumlah: 49000000, ket: "DP 50%" },
    { projectId: "p3", tanggal: "2026-05-03", jumlah: 61000000, ket: "DP 50%" },
    { projectId: "p3", tanggal: "2026-05-25", jumlah: 36600000, ket: "Termin 2" },
    { projectId: "p4", tanggal: "2026-04-11", jumlah: 23750000, ket: "DP 50%" },
    { projectId: "p4", tanggal: "2026-04-29", jumlah: 23750000, ket: "Pelunasan" },
  ],
  materials: [
    { id: "m1", nama: "Pipa ducting BJLS 0.6", sub: "Pipa & Ducting", satuan: "m", gudang: 120, min: 100, harga: 60000 },
    { id: "m2", nama: 'Flexible duct 8"', sub: "Pipa & Ducting", satuan: "m", gudang: 35, min: 40, harga: 60000 },
    { id: "m5", nama: "Isolasi glasswool", sub: "Pipa & Ducting", satuan: "lbr", gudang: 40, min: 20, harga: 85000 },
    { id: "m3", nama: 'Pipa tembaga 3/8"', sub: "Refrigerant & Kelistrikan", satuan: "m", gudang: 8, min: 30, harga: 150000 },
    { id: "m6", nama: "Kabel NYM 3x2.5", sub: "Refrigerant & Kelistrikan", satuan: "m", gudang: 150, min: 50, harga: 12000 },
    { id: "m4", nama: "Bracket gantungan", sub: "Aksesoris & Bracket", satuan: "pcs", gudang: 200, min: 100, harga: 10000 },
  ],
  alokasi: [
    { materialId: "m1", projectId: "p1", qty: 120 },
    { materialId: "m4", projectId: "p1", qty: 120 },
    { materialId: "m3", projectId: "p2", qty: 20 },
    { materialId: "m6", projectId: "p2", qty: 60 },
    { materialId: "m2", projectId: "p3", qty: 30 },
  ],
  usage: [
    { tanggal: "2026-05-29", projectId: "p1", material: "Pipa ducting BJLS 0.6", qty: "40 m", oleh: "Rian" },
    { tanggal: "2026-05-29", projectId: "p1", material: "Bracket gantungan", qty: "24 pcs", oleh: "Rian" },
    { tanggal: "2026-05-28", projectId: "p2", material: 'Pipa tembaga 3/8"', qty: "15 m", oleh: "Dedi" },
    { tanggal: "2026-05-27", projectId: "p3", material: 'Flexible duct 8"', qty: "12 m", oleh: "Agus" },
  ],
  tools: [
    { id: "t1", nama: "Mesin roll ducting", jumlah: 1, status: "di lokasi", lokasi: "p1" },
    { id: "t2", nama: "Rivet gun", jumlah: 3, status: "tersedia", lokasi: "" },
    { id: "t3", nama: "Mesin las pipa", jumlah: 1, status: "di lokasi", lokasi: "p2" },
    { id: "t4", nama: "Tangga 6m", jumlah: 2, status: "tersedia", lokasi: "" },
    { id: "t5", nama: "Vacuum pump", jumlah: 1, status: "servis", lokasi: "" },
  ],
  expenses: [
    { tanggal: "2026-05-29", projectId: "p1", kategori: "Konsumsi", ket: "Makan siang tim (4)", nominal: 160000, oleh: "Rian" },
    { tanggal: "2026-05-29", projectId: "p1", kategori: "Transport", ket: "BBM + tol", nominal: 220000, oleh: "Admin" },
    { tanggal: "2026-05-28", projectId: "p2", kategori: "Upah Harian", ket: "Helper lepas 2 org", nominal: 300000, oleh: "Admin" },
    { tanggal: "2026-05-28", projectId: "p1", kategori: "Alat / Sewa Alat", ket: "Scaffolding 1 hari", nominal: 450000, oleh: "Admin" },
    { tanggal: "2026-05-26", projectId: "p3", kategori: "Upah Harian", ket: "Tukang borongan finishing", nominal: 18000000, oleh: "Admin" },
    { tanggal: "2026-04-20", projectId: "p4", kategori: "Upah Harian", ket: "Tim borongan relokasi", nominal: 5000000, oleh: "Admin" },
    { tanggal: "2026-04-22", projectId: "p4", kategori: "Transport", ket: "Sewa truk + crane", nominal: 2000000, oleh: "Admin" },
  ],
  purchases: [
    { tanggal: "2026-05-27", projectId: "p1", jenis: "Material", item: "Pipa ducting BJLS 0.6", qty: "200 m", total: 12000000, nota: true },
    { tanggal: "2026-05-25", projectId: "", jenis: "Alat", item: "Rivet gun (2)", qty: "2 pcs", total: 1800000, nota: true },
    { tanggal: "2026-05-22", projectId: "p2", jenis: "Material", item: 'Pipa tembaga 3/8"', qty: "60 m", total: 9000000, nota: true },
    { tanggal: "2026-05-20", projectId: "p1", jenis: "Material", item: "Glasswool + bracket", qty: "lot", total: 6400000, nota: false },
    { tanggal: "2026-05-18", projectId: "p3", jenis: "Material", item: "Unit + pipa set", qty: "18 set", total: 42000000, nota: true },
    { tanggal: "2026-05-24", projectId: "p3", jenis: "Material", item: "Tambahan bracket + kabel", qty: "lot", total: 30000000, nota: true },
    { tanggal: "2026-04-15", projectId: "p4", jenis: "Material", item: "Pipa + fitting cold storage", qty: "lot", total: 23000000, nota: true },
  ],
  harian: [
    { id: "h1", tanggal: "2026-05-29", projectId: "p1", oleh: "Rian", pagi: { jam: "07:40", material: "Pipa ducting 50m, Bracket 30pcs", alat: "Mesin roll, Rivet gun, Tangga 6m", foto: 4 }, sore: { jam: "16:30", progress: "Main duct lantai 3 selesai, mulai cabang ke ruang OK. Akses plafon ICU sempit.", material: "Pipa sisa 10m, Bracket 6pcs", alat: "Tangga 6m (pulang)", foto: 6 }, status: "SUBMITTED" },
    { id: "h2", tanggal: "2026-05-28", projectId: "p2", oleh: "Dedi", pagi: { jam: "08:00", material: "Pipa tembaga 20m", alat: "Mesin las, Manifold", foto: 3 }, sore: { jam: "17:00", progress: "Riser pipa lantai 5-7 selesai, tes tekanan OK.", material: "Tembaga sisa 5m", alat: "-", foto: 5 }, status: "VERIFIED" },
    { id: "h3", tanggal: "2026-05-27", projectId: "p3", oleh: "Agus", pagi: { jam: "07:30", material: "Bracket outdoor 18pcs", alat: "Bor, Vacuum pump", foto: 2 }, sore: { jam: "16:00", progress: "15 dari 18 unit terpasang, sisa 3 menunggu bracket tambahan.", material: "-", alat: "Vacuum pump (pulang)", foto: 7 }, status: "VERIFIED" },
  ],
  documents: [
    { id: "d1", jenis: "Berita Acara Pengerjaan", projectId: "p1", tanggal: "2026-05-29", nomor: "BA/AC/2026/05/012", kepada: "RS Harapan Bunda — Bag. Umum", periode: "12–29 Mei 2026 (progress)", uraian: "Pemasangan main duct lantai 3 dan instalasi cabang menuju ruang OK. Pekerjaan berjalan 72%, sisa cabang ICU.", items: [], foto: 6, ttdTeknisi: "Rian", ttdCustomer: "(belum)", ttdCustomerImg: null, checklist: [{ item: "Main duct lantai 3 terpasang", done: true }, { item: "Cabang ruang OK", done: true }, { item: "Cabang ICU", done: false }, { item: "Tes kebocoran & balancing", done: false }, { item: "Bersih-bersih area kerja", done: false }] },
    { id: "d2", jenis: "Surat Pengiriman Barang", projectId: "p3", tanggal: "2026-05-18", nomor: "SJ/AC/2026/05/045", kepada: "Hotel Senja — Engineering", periode: "", uraian: "", items: [{ nama: "AC Split 1PK", qty: "18", satuan: "unit" }, { nama: "Pipa set 3/8-5/8", qty: "18", satuan: "set" }, { nama: "Bracket outdoor", qty: "18", satuan: "pcs" }], foto: 0, ttdTeknisi: "Agus", ttdCustomer: "(belum)", ttdCustomerImg: null, checklist: [] },
    { id: "d3", jenis: "Surat Penerimaan Barang", projectId: "p2", tanggal: "2026-05-21", nomor: "TT/AC/2026/05/033", kepada: "Grand City Tower B", periode: "", uraian: "Barang diterima dalam kondisi baik dan lengkap.", items: [{ nama: 'Pipa tembaga 3/8"', qty: "60", satuan: "m" }, { nama: "Mesin las (pinjam pakai)", qty: "1", satuan: "unit" }], foto: 0, ttdTeknisi: "Dedi", ttdCustomer: "Pak Hadi", ttdCustomerImg: null, checklist: [] },
  ],
});
