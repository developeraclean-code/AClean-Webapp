// Helper bonus/komisi order — dipindah dari views/TeknisiAdminView.jsx agar bisa dipakai
// bersama panel review komisi DAN builder rekap bulanan (src/lib/bonusRekap.js).
// Satu sumber kebenaran: kalau kriteria berubah, panel review & rekap cetak ikut berubah.

// Kategori bonus yang terdeteksi otomatis dari item invoice (bukan margin/install/manual).
export const SPECIAL_BONUS_IDS = ["freon", "kapasitor", "thermis"];

// Threshold omset "job besar" — non-Install >= 1jt, Install >= 1,5jt.
export const OMSET_THRESHOLD_DEFAULT = 1000000;
export const OMSET_THRESHOLD_INSTALL = 1500000;

// Normalisasi daftar keyword dari app_settings: boleh array ATAU string dipisah koma
// (kolom di UI Setting Bonus menyimpan teks). Selalu lowercase + trim + buang yang kosong.
function normKeywords(v) {
  const arr = Array.isArray(v) ? v : String(v || "").split(",");
  return arr.map(k => String(k || "").toLowerCase().trim()).filter(Boolean);
}

// Deteksi kategori bonus dari materials_detail invoice.
//   detection_keywords → logika DAN: SEMUA kata harus ada. Menambah kata MEMPERSEMPIT.
//   exclude_keywords   → logika ATAU: SATU kata saja cocok, item langsung dibuang.
// Pemisahan ini disengaja: memperluas cakupan = kurangi include; mempersempit = tambah exclude.
// Contoh (keputusan Owner 26 Agu 2026, skema insentif 2025): kategori "freon" memakai
// include ["freon"] + exclude ["pengisian"], supaya "Jasa Pengisian Freon" (freon milik
// customer, teknisi hanya jasa isi) tidak ikut dapat bonus.
// Return { detected: [categoryId], names: { categoryId: [namaItem] } }
export function detectBonusFromInvoice(materialsDetail, orderService = "", bonusCategories = []) {
  const keywordMap = {};
  bonusCategories.forEach(cat => {
    const include = normKeywords(cat.detection_keywords);
    if (include.length > 0) keywordMap[cat.id] = { include, exclude: normKeywords(cat.exclude_keywords) };
  });

  const result = { detected: [], names: {} };
  try {
    const items = JSON.parse(materialsDetail || "[]");
    for (const item of items) {
      const nama = (item.nama || "").toLowerCase().trim();
      for (const [categoryId, { include, exclude }] of Object.entries(keywordMap)) {
        // SEMUA keyword harus ada di nama item (AND logic)
        if (!include.every(kw => nama.includes(kw))) continue;
        // SATU keyword pengecualian sudah cukup untuk membatalkan (OR logic)
        if (exclude.some(kw => nama.includes(kw))) continue;
        if (!result.detected.includes(categoryId)) result.detected.push(categoryId);
        (result.names[categoryId] = result.names[categoryId] || []).push(item.nama);
      }
    }
  } catch (err) { console.error("Material detection error:", err); }
  return result;
}

// Apakah order layak masuk daftar review bonus? Return alasan juga supaya rekap cetak
// bisa menjelaskan "kenapa job ini TIDAK termasuk".
// 3 kriteria (OR): omset besar, install multi-unit, atau ada material bonus khusus.
export function bonusCandidateInfo(order, invTotal, detected = []) {
  const total = Number(invTotal || 0);
  const isInstall = order?.service === "Install";
  const isOmsetBesar   = (!isInstall && total >= OMSET_THRESHOLD_DEFAULT) ||
                         (isInstall && total >= OMSET_THRESHOLD_INSTALL);
  const isInstallMulti = isInstall && Number(order?.units) >= 2;
  const special        = detected.filter(cid => SPECIAL_BONUS_IDS.includes(cid));

  const reasons = [];
  if (isOmsetBesar)   reasons.push(isInstall ? "Omset Install ≥1,5jt" : "Omset ≥1jt");
  if (isInstallMulti) reasons.push(`Install ${Number(order?.units) || 0} unit`);
  if (special.length) reasons.push("Material: " + special.join(", "));

  return { eligible: reasons.length > 0, reasons, isOmsetBesar, isInstallMulti, special };
}

// Nama tim lengkap dari kolom order (teknisi1-3 / helper1-3).
export function orderTeknisi(o) { return [o?.teknisi, o?.teknisi2, o?.teknisi3].filter(Boolean); }
export function orderHelper(o)  { return [o?.helper, o?.helper2, o?.helper3].filter(Boolean); }

// Komisi PENDING → ELIGIBLE otomatis setelah 30 hari (derive di UI, tak tergantung cron DB).
export function daysSinceBonusDate(dateStr) {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr + "T00:00:00").getTime()) / 86400000);
}
export function effBonusStatus(b) {
  if (b?.status === "PENDING" && daysSinceBonusDate(b.order_date) >= 30) return "ELIGIBLE";
  return b?.status;
}
