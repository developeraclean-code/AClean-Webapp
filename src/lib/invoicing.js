// ─────────────────────────────────────────────────────────────────────────────
// invoicing.js — Single source of truth untuk RINGKASAN, KATEGORI & VALIDASI invoice.
//
// Prinsip (FSM): `materials_detail` (daftar line item) = sumber kebenaran.
// Field `labor`, `material`, `total` SELALU turunan dari line item.
//
// P0 — summarize() + checkInvoiceConsistency() + guard di submit/verify.
// P1 — kategori billing EKSPLISIT per baris (LABOR/FEE/PART/FREON/DISCOUNT)
//      menggantikan `keterangan` yang overloaded. lineCategory() memprioritaskan
//      `line.category`; bila kosong, infer dari keterangan+nama (backward compat).
// P3 — baris DISCOUNT (garansi waiver) & FREON adjustment (true-up MatTrack)
//      sebagai line item, bukan override total senyap.
// ─────────────────────────────────────────────────────────────────────────────

// Bucket kasar untuk kolom DB `labor` vs `material` (dipakai categoryOf — kompat lama).
export const LINE_CATEGORY = { LABOR: "LABOR", MATERIAL: "MATERIAL" };

// Kategori billing halus (P1). Kolom DB: labor = LABOR+FEE, material = PART+FREON.
export const BILLING_CATEGORY = {
  LABOR: "LABOR",      // jasa kerja (cleaning, repair labor, install labor)
  FEE: "FEE",          // biaya tetap (transport, biaya pengecekan)
  PART: "PART",        // sparepart / barang
  FREON: "FREON",      // refrigerant
  DISCOUNT: "DISCOUNT", // potongan (garansi waiver, voucher) — selalu mengurangi total
};

const FREON_RE = /freon|r-?22|r-?32|r-?410/i;
const FEE_RE = /transport|biaya\s*pengecekan|biaya\s*cek|pengecekan|biaya\s*panggil/i;
const DISCOUNT_KET = new Set(["diskon", "discount", "potongan", "voucher", "waiver"]);

function max0(n) { return Math.max(0, Number(n) || 0); }

// Subtotal sebuah baris — pakai `subtotal` bila valid, jika tidak hitung harga × jumlah.
export function lineSubtotal(line) {
  if (line == null) return 0;
  const raw = line.subtotal;
  const sub = Number(raw);
  if (Number.isFinite(sub) && raw !== "" && raw !== null) return sub;
  return (Number(line.harga_satuan) || 0) * (Number(line.jumlah) || 0);
}

// Kategori billing halus sebuah baris. Prioritas: `line.category` eksplisit (P1) →
// infer dari keterangan + nama (data lama tanpa category).
export function lineCategory(line) {
  const explicit = String((line && line.category) || "").trim().toUpperCase();
  if (BILLING_CATEGORY[explicit]) return explicit;

  const nama = String((line && line.nama) || "").toLowerCase();
  const ket = String((line && line.keterangan) || "").trim().toLowerCase();
  const sub = lineSubtotal(line);

  if (DISCOUNT_KET.has(ket) || sub < 0) return BILLING_CATEGORY.DISCOUNT;

  const isFreon = FREON_RE.test(nama);
  // freon yang diinput sbg jasa (vacum/kuras saat install) tetap jasa, bukan material
  if (isFreon && ket !== "jasa" && ket !== "repair") return BILLING_CATEGORY.FREON;

  if (ket === "jasa" || ket === "repair") {
    return FEE_RE.test(nama) ? BILLING_CATEGORY.FEE : BILLING_CATEGORY.LABOR;
  }
  if (ket === "barang") return BILLING_CATEGORY.PART;

  // keterangan kosong/null → infer dari nama
  if (isFreon) return BILLING_CATEGORY.FREON;
  if (FEE_RE.test(nama)) return BILLING_CATEGORY.FEE;
  return BILLING_CATEGORY.PART;
}

// Kategori dari KATALOG price_list (anti tebak-nama). Cocokkan `nama` ke `price_list.type`,
// petakan `price_list.category` ("Jasa"/"Barang"/"Freon…") ke BILLING_CATEGORY.
// Fallback ke heuristik nama (lineCategory) bila item tak ada di katalog.
// priceList = array baris price_list ({ type, category, ... }).
export function categoryFromCatalog(nama, priceList) {
  const n = String(nama || "").trim().toLowerCase();
  if (!n) return lineCategory({ nama });
  const arr = Array.isArray(priceList) ? priceList : [];
  const norm = (s) => String(s || "").trim().toLowerCase();
  const hit =
    arr.find(p => norm(p.type) === n) ||
    arr.find(p => { const t = norm(p.type); return t && (n.includes(t) || t.includes(n)); });
  if (hit) {
    const cat = norm(hit.category);
    if (cat.startsWith("freon")) return BILLING_CATEGORY.FREON;
    if (cat === "barang") return FREON_RE.test(n) ? BILLING_CATEGORY.FREON : BILLING_CATEGORY.PART;
    if (cat === "jasa") return FEE_RE.test(n) ? BILLING_CATEGORY.FEE : BILLING_CATEGORY.LABOR;
  }
  return lineCategory({ nama });
}

// Bucket kasar (kompat lama): jasa/fee → LABOR, sisanya → MATERIAL.
export function categoryOf(line) {
  const c = lineCategory(line);
  return (c === BILLING_CATEGORY.LABOR || c === BILLING_CATEGORY.FEE)
    ? LINE_CATEGORY.LABOR
    : LINE_CATEGORY.MATERIAL;
}

// Ringkas line item. Kolom DB: labor (=LABOR+FEE), material (=PART+FREON).
// total = (labor+material) − diskonBaris − discount(opts) − tradeIn (≥ 0).
export function summarize(lines, opts = {}) {
  const optDiscount = max0(opts.discount);
  const tradeIn = max0(opts.tradeIn);
  const arr = Array.isArray(lines) ? lines : [];

  let laborOnly = 0, fee = 0, part = 0, freon = 0, lineDiscount = 0;
  for (const l of arr) {
    const sub = lineSubtotal(l);
    switch (lineCategory(l)) {
      case BILLING_CATEGORY.LABOR: laborOnly += sub; break;
      case BILLING_CATEGORY.FEE: fee += sub; break;
      case BILLING_CATEGORY.PART: part += sub; break;
      case BILLING_CATEGORY.FREON: freon += sub; break;
      case BILLING_CATEGORY.DISCOUNT: lineDiscount += Math.abs(sub); break;
      default: part += sub; break;
    }
  }
  const labor = laborOnly + fee;        // kolom DB `labor`
  const material = part + freon;        // kolom DB `material`
  const grossTotal = labor + material;
  const total = Math.max(0, grossTotal - lineDiscount - optDiscount - tradeIn);

  return {
    labor, material, fee, part, freon, lineDiscount,
    grossTotal, lineTotal: grossTotal, total,
  };
}

// Validasi invarian invoice (NON-throwing, observasional).
// `waiverAmount` = jasa yg di-waive tapi BELUM jadi baris diskon (kompat P0/garansi lama).
export function checkInvoiceConsistency(inv = {}, options = {}) {
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 1;
  const waiverAmount = max0(options.waiverAmount);

  const lines = Array.isArray(inv.lines)
    ? inv.lines
    : Array.isArray(inv.materials_detail) ? inv.materials_detail : [];
  const discount = max0(inv.discount);
  const tradeIn = max0(inv.trade_in_amount != null ? inv.trade_in_amount : inv.tradeIn);

  const sum = summarize(lines, { discount, tradeIn });
  const expectedTotal = Math.max(0, sum.total - waiverAmount);
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

// ── P1: normalisasi baris — set `category` eksplisit + pindahkan catatan ke `note` ──
// Dipakai builder agar invoice baru menyimpan kategori eksplisit (bukan tebak nama saat baca).
export function normalizeLine(line) {
  if (line == null) return line;
  const category = lineCategory(line);
  const out = { ...line, category };
  // keterangan yang berisi teks bebas (mis. "Aktual: 0.5 kg → dibulatkan 1 kg")
  // dipindah ke `note`; keterangan distandarkan ke tag kategori lama agar PDF/komponen
  // existing tetap jalan.
  const ket = String(line.keterangan || "").trim();
  const isTag = ["jasa", "repair", "barang", "freon", "diskon"].includes(ket.toLowerCase());
  if (ket && !isTag) {
    out.note = line.note || ket;
    out.keterangan = {
      LABOR: "jasa", FEE: "jasa", PART: "barang", FREON: "barang", DISCOUNT: "diskon",
    }[category] || "barang";
  }
  return out;
}

export function normalizeLines(lines) {
  return (Array.isArray(lines) ? lines : []).map(normalizeLine);
}

// ── P3: builder baris khusus ──────────────────────────────────────────────────
// Baris diskon garansi (jasa ditanggung) — subtotal NEGATIF, kategori DISCOUNT.
export function buildWarrantyDiscountLine(amount, refInvoiceId = "") {
  const amt = max0(amount);
  return {
    nama: "Garansi — jasa ditanggung" + (refInvoiceId ? ` (ref ${refInvoiceId})` : ""),
    jumlah: 1, satuan: "unit", harga_satuan: -amt, subtotal: -amt,
    keterangan: "diskon", category: BILLING_CATEGORY.DISCOUNT,
  };
}

// Baris penyesuaian freon dari berat aktual (true-up MatTrack). delta bisa +/-.
export function buildFreonAdjustmentLine(deltaRp, note = "") {
  const delta = Math.round(Number(deltaRp) || 0);
  return {
    nama: "Penyesuaian Freon (timbang aktual)" + (note ? ` — ${note}` : ""),
    jumlah: 1, satuan: "kg", harga_satuan: delta, subtotal: delta,
    keterangan: delta < 0 ? "diskon" : "barang",
    category: delta < 0 ? BILLING_CATEGORY.DISCOUNT : BILLING_CATEGORY.FREON,
  };
}

// ── P2: audit massal — daftar invoice yang melanggar invarian ─────────────────
export function auditInvoices(invoices, options = {}) {
  const arr = Array.isArray(invoices) ? invoices : [];
  const out = [];
  for (const inv of arr) {
    if (options.skipCancelled && String(inv.status || "").toUpperCase() === "CANCELLED") continue;
    let md = inv.materials_detail;
    if (typeof md === "string") { try { md = JSON.parse(md); } catch { md = []; } }
    const check = checkInvoiceConsistency({ ...inv, materials_detail: Array.isArray(md) ? md : [] });
    if (!check.ok) {
      out.push({
        id: inv.id, customer: inv.customer, service: inv.service, status: inv.status,
        total: Number(inv.total) || 0, ...check,
        hasLines: Array.isArray(md) && md.length > 0,
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.diff.total) - Math.abs(a.diff.total));
}

// ── P2/D: deviasi Invoice vs Quotation ───────────────────────────────────────
// Cocokkan quotation→invoice via quotation.invoice_id, fallback job_id. Flag bila
// total invoice menyimpang dari total quote di luar toleransi. Quote tanpa invoice
// (belum dikerjakan) di-skip. Tidak mengubah nilai apa pun — murni visibilitas.
export function auditQuoteDeviation(invoices, quotations, options = {}) {
  const tolerance = Number.isFinite(options.tolerance) ? options.tolerance : 1;
  const invArr = Array.isArray(invoices) ? invoices : [];
  const quoArr = Array.isArray(quotations) ? quotations : [];
  const notCancelled = (i) => String(i.status || "").toUpperCase() !== "CANCELLED";
  const out = [];
  for (const q of quoArr) {
    const qTotal = Number(q.total) || 0;
    if (qTotal <= 0) continue;
    let inv = q.invoice_id ? invArr.find(i => i.id === q.invoice_id) : null;
    let matchedBy = inv ? "invoice_id" : null;
    if (!inv && q.job_id) { inv = invArr.find(i => i.job_id === q.job_id && notCancelled(i)); if (inv) matchedBy = "job_id"; }
    if (!inv) continue;
    const iTotal = Number(inv.total) || 0;
    const diff = iTotal - qTotal;
    if (Math.abs(diff) > tolerance) {
      out.push({ quotationId: q.id, invoiceId: inv.id, customer: q.customer || inv.customer, status: inv.status, quoteTotal: qTotal, invoiceTotal: iTotal, diff, matchedBy });
    }
  }
  return out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}
