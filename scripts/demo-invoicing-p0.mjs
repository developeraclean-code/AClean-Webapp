// Demo P0 — bukti lib/invoicing.js bekerja terhadap data invoice NYATA.
// Jalankan: node scripts/demo-invoicing-p0.mjs
import { summarize, checkInvoiceConsistency, describeInconsistency } from "../src/lib/invoicing.js";

const rupiah = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");
const line = "─".repeat(72);
let pass = 0, fail = 0;
function expect(label, cond) {
  if (cond) { pass++; console.log("   ✅ " + label); }
  else { fail++; console.log("   ❌ " + label); }
}

console.log("\n" + line + "\nDEMO P0 — lib/invoicing.js terhadap data invoice nyata\n" + line);

// ── SKENARIO 1: state TERSIMPAN INV-20260617-0ZU4O (bug barang-drop) ──────────
console.log("\n[1] INV-20260617-0ZU4O — state lama yang TERSIMPAN di DB (bug)");
const inv0ZU4O_lama = {
  labor: 0, material: 1270000, total: 100000, discount: 0,
  materials_detail: [
    { nama: "Biaya Pengecekan AC", keterangan: "jasa", subtotal: 100000 },
  ],
};
const c1 = checkInvoiceConsistency(inv0ZU4O_lama);
console.log("   tersimpan: jasa", rupiah(inv0ZU4O_lama.labor), "| material", rupiah(inv0ZU4O_lama.material), "| total", rupiah(inv0ZU4O_lama.total));
console.log("   →", describeInconsistency(c1, "INV-...-0ZU4O"));
expect("guard MENANGKAP inkonsistensi (ok=false)", c1.ok === false);
expect("material phantom terdeteksi Δ" + rupiah(c1.diff.material), c1.diff.material === 1270000);

// ── SKENARIO 2: setelah FIX — barang masuk jadi line item ─────────────────────
console.log("\n[2] INV-20260617-0ZU4O — setelah fix (barang jadi line item)");
const detail0ZU4O_baru = [
  { nama: "Biaya Pengecekan AC", keterangan: "jasa", subtotal: 100000 },
  { nama: "Duct Tape Non Lem", keterangan: "barang", subtotal: 20000 },
  { nama: "Pipa AC Hoda 1PK", keterangan: "barang", subtotal: 600000 },
  { nama: "Kuras Vacum Freon R32/R410", keterangan: "barang", subtotal: 650000 },
];
const s2 = summarize(detail0ZU4O_baru);
console.log("   summarize → jasa", rupiah(s2.labor), "| material", rupiah(s2.material), "| total", rupiah(s2.total));
expect("total kini benar = " + rupiah(1370000) + " (bukan 100rb)", s2.total === 1370000);
expect("material = " + rupiah(1270000), s2.material === 1270000);
const c2 = checkInvoiceConsistency({ ...s2, materials_detail: detail0ZU4O_baru, total: s2.total });
expect("invoice hasil fix LOLOS guard (ok=true)", c2.ok === true);

// ── SKENARIO 3: INV-20260616-A2I2B (sudah PAID, kurang tagih 500rb) ────────────
console.log("\n[3] INV-20260616-A2I2B — PAID, material 500rb hilang dari total");
const a2i2b_lama = {
  labor: 480000, material: 500000, total: 480000, discount: 0,
  materials_detail: [{ nama: "Cleaning AC", keterangan: "jasa", subtotal: 480000 }],
};
const c3 = checkInvoiceConsistency(a2i2b_lama);
console.log("   →", describeInconsistency(c3, "INV-...-A2I2B"));
expect("guard menangkap (kurang tagih " + rupiah(500000) + ")", c3.ok === false && c3.diff.material === 500000);

// ── SKENARIO 4: VERIFY path — freon dulu tak ditagih, kini ikut ───────────────
console.log("\n[4] Verify path — freon dulu dikecualikan dari total, kini ikut");
const detailFreon = [
  { nama: "Cleaning 2PK", keterangan: "jasa", subtotal: 150000 },
  { nama: "Freon R-32", keterangan: "freon", subtotal: 350000 },
];
const s4 = summarize(detailFreon);
console.log("   summarize → jasa", rupiah(s4.labor), "| material", rupiah(s4.material), "| total", rupiah(s4.total));
expect("freon kini masuk material", s4.material === 350000);
expect("total termasuk freon = " + rupiah(500000), s4.total === 500000);

// ── SKENARIO 5: invoice SEHAT — tidak boleh false-positive ────────────────────
console.log("\n[5] Invoice sehat (Cleaning + diskon member) — guard harus DIAM");
const sehat = {
  labor: 1200000, material: 0, total: 1080000, discount: 120000,
  materials_detail: [{ nama: "Repair", keterangan: "jasa", subtotal: 1200000 }],
};
const c5 = checkInvoiceConsistency(sehat);
expect("ok=true (tidak false-positive)", c5.ok === true);

// ── SKENARIO 6: garansi waive jasa — perlu waiverAmount ───────────────────────
console.log("\n[6] Complain garansi — jasa ditanggung (waive), material tetap ditagih");
const garansi = {
  labor: 0, material: 500000, total: 500000, discount: 0,
  materials_detail: [
    { nama: "Jasa servis", keterangan: "jasa", subtotal: 200000 },
    { nama: "Sparepart", keterangan: "barang", subtotal: 500000 },
  ],
};
expect("tanpa waiver → terflag (benar, krn belum jadi baris diskon = P3)", checkInvoiceConsistency(garansi).ok === false);
expect("dengan waiverAmount=200rb → ok", checkInvoiceConsistency(garansi, { waiverAmount: 200000 }).ok === true);

console.log("\n" + line + "\nHASIL: " + pass + " lolos, " + fail + " gagal\n" + line + "\n");
process.exit(fail === 0 ? 0 : 1);
