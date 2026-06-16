// Helper kalkulasi keuangan & status untuk modul Project.
import { EXP_CATS } from "./constants.js";

export const pName = (db, id) => (db.projects.find((p) => p.id === id) || {}).nama || "(umum)";

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
  const aktualBiaya = Object.values(byCat).reduce((s, v) => s + v, 0);
  return {
    p, dpList, dpTotal,
    sisaTagihan: p.nilai - dpTotal,
    byCat, aktualBiaya,
    estProfit: p.nilai - p.rab,
    aktualProfit: p.nilai - aktualBiaya,
  };
}

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
