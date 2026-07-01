// Helper kalkulasi keuangan & status untuk modul Project.
import { EXP_CATS } from "./constants.js";

export const pName = (db, id) => (db.projects.find((p) => p.id === id) || {}).nama || "(umum)";

// Angka murni dari string bebas ("5 m" / "12,5" / "Rp 3.000") → number. 0 kalau kosong.
export const parseNum = (v) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// Biaya 1 baris pemakaian stok (COGS). Pakai qty numerik + snapshot harga saat pemakaian;
// fallback ke harga material terkini bila baris lama belum punya snapshot.
export const usageCost = (db, u) => {
  const qty = u.qtyNum != null ? Number(u.qtyNum) : parseNum(u.qty);
  const mat = u.materialId ? db.materials.find((m) => m.id === u.materialId) : null;
  const harga = u.harga != null && u.harga !== 0 ? Number(u.harga) : (mat ? mat.harga || 0 : 0);
  return (qty || 0) * (harga || 0);
};

export function calc(db, pid) {
  const p = db.projects.find((x) => x.id === pid);
  if (!p) return null;
  const dpList = db.dp.filter((d) => d.projectId === pid);
  const dpTotal = dpList.reduce((s, d) => s + d.jumlah, 0);
  const byCat = {};
  EXP_CATS.forEach((c) => (byCat[c] = 0));
  db.purchases
    .filter((x) => x.projectId === pid)
    .forEach((x) => (byCat[x.jenis === "Alat" ? "Alat / Sewa Alat" : "Material"] += x.total));
  db.expenses
    .filter((x) => x.projectId === pid)
    .forEach((x) => (byCat[x.kategori] = (byCat[x.kategori] || 0) + x.nominal));
  // COGS material dari gudang project (pemakaian stok ber-materialId). Pembelian on-site
  // (manual, tanpa materialId) tidak dibebankan di sini — sudah masuk lewat Pembelian.
  const stokBiaya = db.usage
    .filter((u) => u.projectId === pid && u.materialId)
    .reduce((s, u) => s + usageCost(db, u), 0);
  if (stokBiaya > 0) byCat["Material (stok gudang)"] = (byCat["Material (stok gudang)"] || 0) + stokBiaya;
  const aktualBiaya = Object.values(byCat).reduce((s, v) => s + v, 0);
  return {
    p, dpList, dpTotal,
    sisaTagihan: p.nilai - dpTotal,
    byCat, aktualBiaya, stokBiaya,
    estProfit: p.nilai - p.rab,
    aktualProfit: p.nilai - aktualBiaya,
  };
}

// Profit yang benar per konteks:
// - SELESAI → aktual (nilai − biaya realisasi).
// - Berjalan + RAB terisi → estimasi (nilai − RAB).
// - Berjalan + RAB 0/kosong → "berjalan" (nilai − biaya terpakai sejauh ini) + tandai RAB kosong.
export function profitInfo(db, pid) {
  const k = calc(db, pid); if (!k) return { value: 0, label: "-", kind: "none", rabMissing: false };
  const p = k.p;
  if (p.status === "SELESAI") return { value: k.aktualProfit, label: "Aktual profit (final)", kind: "aktual", rabMissing: false };
  if (p.rab > 0) return { value: k.estProfit, label: "Estimasi profit (RAB)", kind: "estimasi", rabMissing: false };
  return { value: p.nilai - k.aktualBiaya, label: "Profit berjalan (RAB belum diisi)", kind: "berjalan", rabMissing: true };
}

// Rekonsiliasi material per project: dialokasikan vs terpakai vs sisa (harus balance).
// alokasi.qty menyimpan SISA alokasi (usage sudah menguranginya) → dialokasikan = sisa + terpakai.
export function matRecon(db, pid) {
  const rows = db.alokasi
    .filter((a) => a.projectId === pid)
    .map((a) => {
      const m = db.materials.find((x) => x.id === a.materialId) || {};
      const terpakai = db.usage
        .filter((u) => u.projectId === pid && u.materialId === a.materialId)
        .reduce((s, u) => s + (u.qtyNum != null ? Number(u.qtyNum) : parseNum(u.qty)), 0);
      const sisa = Number(a.qty) || 0;
      return {
        materialId: a.materialId, nama: m.nama || "(?)", satuan: m.satuan || "",
        harga: m.harga || 0, dialokasikan: sisa + terpakai, terpakai, sisa,
        nilaiSisa: sisa * (m.harga || 0),
      };
    });
  const totalSisa = rows.reduce((s, r) => s + r.sisa, 0);
  return { rows, totalSisa };
}

// Alat yang masih tercatat di lokasi project (belum dikembalikan ke gudang).
export const toolsAtProject = (db, pid) => db.tools.filter((t) => t.lokasi === pid);

export function budget(db, pid) {
  const k = calc(db, pid); if (!k) return { ratio: 0, warn: false, crit: false };
  const p = k.p;
  const ratio = p.rab ? k.aktualBiaya / p.rab : 0;
  const aktif = p.status !== "SELESAI" && p.status !== "HOLD";
  return { ratio, warn: aktif && ratio >= 0.85 && ratio < 1, crit: aktif && ratio >= 1, k };
}

export const overBudgetProjects = (db) => db.projects.filter((p) => { const b = budget(db, p.id); return b.warn || b.crit; });

export function daysLate(p, today) {
  if (p.status === "SELESAI" || p.status === "HOLD") return 0;
  const d = (new Date(today) - new Date(p.target)) / 86400000;
  return d > 0 ? Math.round(d) : 0;
}

export const isLocked = (db, pid, tgl) =>
  db.harian.some((h) => h.projectId === pid && h.tanggal === tgl && h.status === "VERIFIED");

export const matTotal = (db, m) => m.gudang + db.alokasi.filter((a) => a.materialId === m.id).reduce((s, a) => s + a.qty, 0);
export const matAlloc = (db, m) => db.alokasi.filter((a) => a.materialId === m.id);

export function docSeqNext(db, prefix) {
  const nums = db.documents.filter((d) => (d.nomor || "").startsWith(prefix + "/")).map((d) => parseInt(d.nomor.split("/").pop()) || 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  return `${prefix}/AC/${yyyy}/${mm}/${String(next).padStart(3, "0")}`;
}

export const ttdStatus = (d) => (d.ttdCustomer && d.ttdCustomer !== "(belum)" ? "lengkap" : "belum");

export function weekSummary(db, pid, today) {
  const d = new Date(today); d.setDate(d.getDate() - 6);
  const ws = d.toISOString().slice(0, 10);
  const biaya =
    db.expenses.filter((e) => e.projectId === pid && e.tanggal >= ws).reduce((s, e) => s + e.nominal, 0) +
    db.purchases.filter((x) => x.projectId === pid && x.tanggal >= ws).reduce((s, x) => s + x.total, 0);
  const har = db.harian.filter((h) => h.projectId === pid && h.tanggal >= ws);
  const foto = har.reduce((s, h) => s + (h.pagi ? h.pagi.foto : 0) + (h.sore ? h.sore.foto : 0), 0);
  const progress = har.filter((h) => h.sore && h.sore.progress).map((h) => ({ tgl: h.tanggal.slice(5), txt: h.sore.progress }));
  return { ws, biaya, foto, progress };
}

export const statusColor = (s) => {
  const map = { BERJALAN: "accent", FINISHING: "yellow", SELESAI: "green", HOLD: "gray", DRAFT: "gray", SUBMITTED: "yellow", VERIFIED: "green", REVISI: "red" };
  return map[s] || "gray";
};
