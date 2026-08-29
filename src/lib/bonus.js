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

// Jendela komplain yang membatalkan bonus (keputusan Owner 26 Agu 2026).
export const KOMPLAIN_VOID_HARI = 30;

// Job lintas hari TIDAK dapat bonus (keputusan Owner 26 Agu 2026): bonus hanya untuk
// pekerjaan yang selesai di hari yang sama. Ketiga penanda diperiksa karena diisi oleh
// jalur yang berbeda — is_multi_day di form Planning Order, parent_job_id/day_number saat
// job hari berikutnya dibuat. Cukup satu terisi untuk menggugurkan.
export function isMultiDayJob(order) {
  return Boolean(order?.is_multi_day) ||
         Boolean(order?.parent_job_id) ||
         Number(order?.day_number || 1) > 1;
}

// Dua order dianggap milik pelanggan yang sama. customer_id adalah pencocokan utama
// (tahan ganti nama); nama dipakai hanya untuk data lama yang belum punya customer_id.
function samaPelanggan(a, b) {
  if (a?.customer_id && b?.customer_id) return a.customer_id === b.customer_id;
  const na = String(a?.customer || "").trim().toUpperCase();
  const nb = String(b?.customer || "").trim().toUpperCase();
  return Boolean(na) && na === nb;
}

const hariAntara = (d1, d2) =>
  Math.round((new Date(d2 + "T00:00:00") - new Date(d1 + "T00:00:00")) / 86400000);

// Komplain pelanggan yang sama dalam 30 hari SESUDAH job. Hanya PERINGATAN — tidak
// membatalkan otomatis (keputusan Owner: order Complain tidak mencatat unit AC mana yang
// bermasalah, jadi pencocokan per-unit belum mungkin dan void otomatis bisa salah sasaran
// untuk pelanggan banyak unit). Owner/admin yang memutuskan void lewat tombol yang ada.
export function cariKomplain30Hari(order, semuaOrder = []) {
  if (!order?.date) return [];
  return semuaOrder
    .filter(c => c?.service === "Complain" && c.id !== order.id && c.date > order.date &&
                 hariAntara(order.date, c.date) <= KOMPLAIN_VOID_HARI && samaPelanggan(c, order))
    .map(c => ({ id: c.id, date: c.date, jarakHari: hariAntara(order.date, c.date) }))
    .sort((a, b) => a.jarakHari - b.jarakHari);
}

// Pelanggan yang sama muncul di hari berdampingan padahal TIDAK bertanda multi-hari —
// kemungkinan satu pekerjaan bersambung yang terlanjur dicatat sebagai dua job.
// Peringatan saja; penanda resmi tetap yang menentukan gugur/tidaknya.
export function cariJobBersambung(order, semuaOrder = []) {
  if (!order?.date || isMultiDayJob(order)) return [];
  return semuaOrder
    // Complain sengaja dikecualikan: kunjungan komplain di hari berikutnya BUKAN pekerjaan
    // bersambung, dan sudah punya peringatannya sendiri — kalau ikut, satu kartu dapat dua
    // peringatan untuk kejadian yang sama.
    .filter(o => o?.id !== order.id && o?.service !== "Complain" && samaPelanggan(o, order) &&
                 Math.abs(hariAntara(order.date, o.date)) === 1)
    .map(o => ({ id: o.id, date: o.date, service: o.service }));
}

// Apakah order layak masuk daftar review bonus? Return alasan juga supaya rekap cetak
// bisa menjelaskan "kenapa job ini TIDAK termasuk".
// Syarat gugur (mutlak): job lintas hari.
// Syarat layak (OR): omset besar, install multi-unit, atau ada material bonus khusus.
export function bonusCandidateInfo(order, invTotal, detected = [], semuaOrder = []) {
  const multiDay = isMultiDayJob(order);
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

  const komplain   = cariKomplain30Hari(order, semuaOrder);
  const bersambung = cariJobBersambung(order, semuaOrder);
  const warnings = [];
  if (komplain.length)
    warnings.push(`Komplain ${komplain[0].jarakHari} hari setelah job — periksa sebelum bayar`);
  if (bersambung.length)
    warnings.push("Pelanggan sama di hari berdampingan — pastikan bukan job bersambung");

  return {
    eligible: !multiDay && reasons.length > 0,
    reasons, warnings, komplain, bersambung, multiDay,
    // Alasan gugur ditulis eksplisit supaya rekap cetak bisa menjelaskannya.
    blockedReason: multiDay ? "Job lintas hari — bonus hanya untuk pekerjaan selesai 1 hari" : null,
    isOmsetBesar, isInstallMulti, special,
  };
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
