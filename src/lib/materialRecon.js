// Material daily reconciliation — pure logic (no React, no Supabase).
//
// Lapisan AUDIT (cross-check) untuk fitur "Material Harian Teknisi":
//  - Pagi: teknisi catat material yang DIBAWA keluar kantor.
//  - Sore: catat yang DIKEMBALIKAN.
//  - used_implied (fisik) = dibawa − dikembalikan.
//  - used_reported = total pemakaian material di laporan job hari itu (inventory_transactions).
//  - selisih = used_implied − used_reported. Di luar toleransi → flag (indikasi bocor/kecurangan).
//
// CATATAN: ini TIDAK mengubah stok kantor (Keputusan Owner #3 — cross-check saja).
// Dipakai oleh MaterialCheckoutView, tab recon di MatTrackView, dan cron material-recon.
// Lihat unit test di __tests__/materialRecon.test.js.

// Toleransi default per tipe material. Pipa/kabel dalam meter, freon dalam kg.
// Bisa di-override dari app_settings.material_recon_tolerances (JSON).
export const RECON_TOLERANCE = { pipa: 1.0, kabel: 1.0, freon: 0.3, lain: 1 };

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Klasifikasi material dari nama (untuk baris inventory_transactions yang tak punya material_type).
export function classifyMaterial(name) {
  const n = String(name || "").toLowerCase();
  if (["freon", "r-22", "r-32", "r-410", "r22", "r32", "r410"].some(k => n.includes(k))) return "freon";
  if (n.includes("pipa")) return "pipa";
  if (n.includes("kabel")) return "kabel";
  return "lain";
}

// Kuantitas pembanding satu item checkout:
//  - freon → total kg (weight_kg bisa number atau array [{kg}]); fallback qty (jumlah tabung).
//  - lainnya → qty (meter/pcs).
export function comparableQty(item) {
  if (!item) return 0;
  if (item.material_type === "freon") {
    if (Array.isArray(item.weight_kg)) return round2(item.weight_kg.reduce((s, w) => s + (Number(w && w.kg) || 0), 0));
    if (item.weight_kg != null && item.weight_kg !== "") return Number(item.weight_kg) || 0;
    return Number(item.qty) || 0;
  }
  return Number(item.qty) || 0;
}

// Identitas material untuk pengelompokan. Pakai inventory_code bila ada. Tanpa code,
// freon di-merge jadi satu (semua tipe) agar tidak double-count terhadap byType.freon.
const itemKey = (it) =>
  it.inventory_code ||
  (it.material_type === "freon" ? "freon" : String(it.material_type || "lain") + ":" + String(it.label || it.unit_label || it.satuan || ""));

// Jumlahkan pemakaian yang DILAPORKAN dari baris inventory_transactions (type='usage').
// Untuk freon: pakai qty_actual bila tidak null; bila ADA baris freon yg qty_actual masih null
// → tandai freonUnknown (recon freon jadi MISSING_DATA, hindari false positive — R3).
export function sumReportedUsage(txRows) {
  const byCode = {};
  const byType = { pipa: 0, kabel: 0, freon: 0, lain: 0 };
  let freonUnknown = false;
  for (const t of (Array.isArray(txRows) ? txRows : [])) {
    if (String(t.type || "") !== "usage") continue;
    const type = classifyMaterial(t.inventory_name || t.inventory_code);
    const code = t.inventory_code || "";
    let val;
    if (type === "freon") {
      if (t.qty_actual == null) { freonUnknown = true; continue; }
      val = Math.abs(Number(t.qty_actual) || 0);
    } else {
      val = Math.abs(Number(t.qty) || 0);
    }
    if (code) byCode[code] = round2((byCode[code] || 0) + val);
    byType[type] = round2((byType[type] || 0) + val);
  }
  return { byCode, byType, freonUnknown };
}

function lookupReported(reportedUsage, row) {
  const ru = reportedUsage || { byCode: {}, byType: {}, freonUnknown: false };
  if (row.material_type === "freon" && ru.freonUnknown) return { known: false, value: null };
  // Baris ber-SKU spesifik → bandingkan PER-SKU. JANGAN jatuh ke byType: kalau SKU ini
  // tak ada di laporan, pemakaian dilaporkan = 0 (bukan total tipe). Mencegah satu SKU
  // "meminjam" total tipe & menutupi pemakaian SKU lain yang tak dilaporkan (false UNDER).
  if (row.inventory_code) {
    const has = ru.byCode && Object.prototype.hasOwnProperty.call(ru.byCode, row.inventory_code);
    return { known: true, value: has ? ru.byCode[row.inventory_code] : 0 };
  }
  // Baris tanpa code (entri generik/legacy/WA) → pakai agregat per tipe.
  if (ru.byType && Object.prototype.hasOwnProperty.call(ru.byType, row.material_type)) {
    return { known: true, value: ru.byType[row.material_type] };
  }
  return { known: true, value: 0 }; // tidak ada pemakaian dilaporkan = 0
}

// Inti reconciliation untuk satu teknisi+hari.
// pagiItems/pulangItems: array item checkout. reportedUsage: hasil sumReportedUsage().
// return array baris recon per identitas material.
export function reconcileDay(pagiItems, pulangItems, reportedUsage, tolerances = RECON_TOLERANCE) {
  const tol = tolerances || RECON_TOLERANCE;
  const map = new Map();
  const accumulate = (items, field) => {
    for (const it of (Array.isArray(items) ? items : [])) {
      if (!it || !it.material_type) continue;
      const key = itemKey(it);
      if (!map.has(key)) {
        map.set(key, {
          material_type: it.material_type,
          inventory_code: it.inventory_code || null,
          label: it.label || it.unit_label || it.material_type,
          satuan: it.satuan || (it.material_type === "freon" ? "kg" : ""),
          brought: 0, returned: 0,
        });
      }
      const row = map.get(key);
      row[field] = round2(row[field] + comparableQty(it));
      if (it.satuan && !row.satuan) row.satuan = it.satuan;
    }
  };
  accumulate(pagiItems, "brought");
  accumulate(pulangItems, "returned");

  const lines = [];
  for (const row of map.values()) {
    const used_implied = round2(row.brought - row.returned);
    const rep = lookupReported(reportedUsage, row);
    const tolerance = (tol[row.material_type] != null) ? tol[row.material_type] : (tol.lain != null ? tol.lain : 0);
    let flag, used_reported, selisih;
    if (!rep.known) {
      flag = "MISSING_DATA"; used_reported = null; selisih = null;
    } else {
      used_reported = rep.value;
      selisih = round2(used_implied - used_reported);
      if (Math.abs(selisih) <= tolerance) flag = "OK";
      else if (selisih > 0) flag = "OVER";   // fisik terpakai > dilaporkan → ada yg tak dilaporkan
      else flag = "UNDER";                    // dilaporkan > fisik terpakai → over-report
    }
    lines.push({
      material_type: row.material_type, inventory_code: row.inventory_code,
      label: row.label, satuan: row.satuan,
      brought: row.brought, returned: row.returned,
      used_implied, used_reported, selisih, tolerance, flag,
    });
  }
  return lines;
}

// Roll-up status untuk alert. OVER/UNDER → FLAGGED; hanya MISSING_DATA → WARNING; selain itu OK.
export function reconStatus(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  if (arr.some(l => l.flag === "OVER" || l.flag === "UNDER")) return "FLAGGED";
  if (arr.some(l => l.flag === "MISSING_DATA")) return "WARNING";
  return "OK";
}
