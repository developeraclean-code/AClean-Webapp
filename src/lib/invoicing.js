// ─────────────────────────────────────────────────────────────────────────────
// invoicing.js — Single source of truth untuk RINGKASAN & VALIDASI invoice.
//
// Prinsip (FSM): `materials_detail` (daftar line item) = sumber kebenaran.
// Field `labor`, `material`, dan `total` SELALU turunan dari line item — bukan
// dihitung dari variabel terpisah. Dulu tiap jalur (submit laporan, verify,
// edit nilai, gabungan, ARA) menghitung sendiri-sendiri → desync senyap
// (mis. item Barang masuk `material` tapi hilang dari `total`).
//
// P0 = sentralisasi ringkasan + guard invarian + tes. Penyatuan penuh aturan
// inject (transport, biaya pengecekan, per-unit cleaning) menyusul di tahap
// berikutnya; modul ini sengaja TIDAK mengubah cara line item dibangun.
// ─────────────────────────────────────────────────────────────────────────────

export const LINE_CATEGORY = { LABOR: "LABOR", MATERIAL: "MATERIAL" };

// Kategori penagihan sebuah baris berdasarkan `keterangan`.
// "jasa"/"repair" → LABOR. Selainnya (barang/freon/null/""/catatan) → MATERIAL.
// Catatan: skema `keterangan` saat ini overloaded (kategori + teks bebas);
// normalisasi penuh ke kolom `category` eksplisit = P1.
export function categoryOf(line) {
  const ket = String((line && line.keterangan) || "").trim().toLowerCase();
  if (ket === "jasa" || ket === "repair") return LINE_CATEGORY.LABOR;
  return LINE_CATEGORY.MATERIAL;
}

// Subtotal sebuah baris — pakai `subtotal` bila valid, jika tidak hitung dari
// harga_satuan × jumlah. Tahan terhadap field kosong/string.
export function lineSubtotal(line) {
  if (line == null) return 0;
  const sub = Number(line.subtotal);
  if (Number.isFinite(sub) && line.subtotal !== "" && line.subtotal !== null) return sub;
  return (Number(line.harga_satuan) || 0) * (Number(line.jumlah) || 0);
}

// Ringkas line item → { labor, material, lineTotal, total }.
// labor & material = GROSS (sebelum diskon). total = lineTotal − discount − tradeIn (≥ 0).
export function summarize(lines, opts = {}) {
  const discount = Math.max(0, Number(opts.discount) || 0);
  const tradeIn = Math.max(0, Number(opts.tradeIn) || 0);
  const arr = Array.isArray(lines) ? lines : [];
  let labor = 0;
  let material = 0;
  for (const l of arr) {
    const sub = lineSubtotal(l);
    if (categoryOf(l) === LINE_CATEGORY.LABOR) labor += sub;
    else material += sub;
  }
  const lineTotal = labor + material;
  const total = Math.max(0, lineTotal - discount - tradeIn);
  return { labor, material, lineTotal, total };
}

// Validasi invarian invoice (NON-throwing, observasional).
// Bandingkan field tersimpan (labor/material/total) dengan turunan dari line item.
// `waiverAmount` = nilai yang sengaja di-waive (mis. jasa ditanggung garansi) yang
//   belum dimodelkan sebagai baris diskon — dikurangkan dari ekspektasi total.
// Mengembalikan { ok, expected, actual, diff }. `ok` true bila total, labor, dan
// material cocok dalam toleransi pembulatan.
export function checkInvoiceConsistency(inv = {}, options = {}) {
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 1;
  const waiverAmount = Math.max(0, Number(options.waiverAmount) || 0);

  const lines = Array.isArray(inv.lines)
    ? inv.lines
    : Array.isArray(inv.materials_detail)
      ? inv.materials_detail
      : [];
  const discount = Math.max(0, Number(inv.discount) || 0);
  const tradeIn = Math.max(0, Number(inv.trade_in_amount != null ? inv.trade_in_amount : inv.tradeIn) || 0);

  const sum = summarize(lines, { discount, tradeIn });
  const expectedTotal = Math.max(0, sum.lineTotal - discount - tradeIn - waiverAmount);
  const expectedLabor = Math.max(0, sum.labor - waiverAmount);

  const actualTotal = Number(inv.total) || 0;
  const actualLabor = Number(inv.labor) || 0;
  const actualMaterial = Number(inv.material) || 0;

  const diff = {
    total: actualTotal - expectedTotal,
    labor: actualLabor - expectedLabor,
    material: actualMaterial - sum.material,
  };
  const ok =
    Math.abs(diff.total) <= tolerance &&
    Math.abs(diff.labor) <= tolerance &&
    Math.abs(diff.material) <= tolerance;

  return {
    ok,
    expected: { labor: expectedLabor, material: sum.material, total: expectedTotal, lineTotal: sum.lineTotal },
    actual: { labor: actualLabor, material: actualMaterial, total: actualTotal },
    diff,
  };
}

// Ringkas hasil check jadi satu baris pesan untuk log/telemetri.
export function describeInconsistency(check, invId = "") {
  if (!check || check.ok) return "";
  const d = check.diff;
  return (
    `Invoice ${invId} tidak konsisten — ` +
    `total: ${check.actual.total} (harusnya ${check.expected.total}, Δ${d.total}); ` +
    `jasa: ${check.actual.labor} (harusnya ${check.expected.labor}, Δ${d.labor}); ` +
    `material: ${check.actual.material} (harusnya ${check.expected.material}, Δ${d.material})`
  );
}
