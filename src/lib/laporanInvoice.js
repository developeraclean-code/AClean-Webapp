// Pure invoice-detail builder untuk submitLaporan — diekstrak dari App.jsx (behavior-preserving).
// Hanya KOMPUTASI baris invoice (mDetail). TANPA efek samping: tidak ada DB, setState, addAgentLog,
// showNotif, atau early-return orkestrasi. Itu semua tetap di submitLaporan App.jsx.
//
// mDetail = "single source of truth" baris invoice. Ringkasan (labor/material/total) diturunkan
// dari mDetail via summarize() di lib/invoicing.js.
import { hargaPerUnitFromTipe, getBracketKey } from "./pricing.js";
import { categoryFromCatalog, summarize, buildWarrantyDiscountLine } from "./invoicing.js";

const FREON_KEYS = ["freon", "r-22", "r-32", "r-410", "r22", "r32", "r410"];

/**
 * Bangun mDetail (array baris invoice) dari hasil laporan teknisi.
 *
 * @param {object} p
 * @param {object} p.order            - laporanModal (service, type, id, units, ...)
 * @param {Array}  p.units            - laporanUnits
 * @param {Array}  p.jasaItems        - laporanJasaItems
 * @param {Array}  p.repairItems      - laporanRepairItems
 * @param {Array}  p.barangItems      - laporanBarangItems
 * @param {Array}  p.effectiveMaterials - material efektif (dipakai untuk Install)
 * @param {Array}  p.cleaningInRepair - laporanCleaningInRepair (array unit_no)
 * @param {number} p.finalLabor       - labor final (untuk inject biaya cek Complain)
 * @param {boolean} p.isRepairGratis  - repair gratis (skip biaya cek)
 * @param {object|null} p.prevGaransiActive - invoice garansi aktif (Complain) untuk baris diskon
 * @param {Array}  p.priceListData
 * @param {function} p.lookupHargaGlobal - (nama, satuanHint) => harga (helper component-local)
 * @param {function} p.hitungLabor       - (service, type, units) => labor (helper component-local)
 * @returns {{ mDetail: Array }}
 */
export function buildInvoiceDetail({
  order,
  units = [],
  jasaItems = [],
  repairItems = [],
  barangItems = [],
  effectiveMaterials = [],
  cleaningInRepair = [],
  finalLabor = 0,
  isRepairGratis = false,
  prevGaransiActive = null,
  priceListData = [],
  lookupHargaGlobal,
  hitungLabor,
}) {
  const svc = order?.service;
  const isInstallSvc = svc === "Install";
  const isComplainSvc = svc === "Complain";

  const lookupHarga = (nama, satuanHint) => (lookupHargaGlobal ? lookupHargaGlobal(nama, satuanHint) : 0);
  const mkRow = (nama, jumlah, satuan, hSat, ket) => {
    const nama2 = (nama || "").toLowerCase();
    const isF = FREON_KEYS.some(k => nama2.includes(k));
    const rawQ = parseFloat(jumlah) || 0;
    const qty = isF ? Math.max(1, Math.ceil(rawQ)) : rawQ;
    const h = parseFloat(hSat) || 0 || lookupHarga(nama, satuan);
    const ketFin = ket || (isF && rawQ !== qty ? `Aktual: ${rawQ} kg → dibulatkan ${qty} kg` : "");
    return { nama, jumlah: qty, satuan: satuan || (isF ? "kg" : "pcs"), harga_satuan: h, subtotal: h * qty, keterangan: ketFin, category: categoryFromCatalog(nama, priceListData) };
  };

  const mDetail = [];

  // A. Jasa rows (dari [+] Tambah Jasa form) — keterangan: "jasa"
  jasaItems.filter(j => j.nama && j.nama !== "__manual__" && parseFloat(j.jumlah || 0) > 0).forEach(j => {
    mDetail.push(mkRow(j.nama, j.jumlah || 1, j.satuan || "pcs", j.harga_satuan || 0, "jasa"));
  });

  // B. Repair rows (dari [+] Tambah Repair form) — keterangan: "repair"
  repairItems.filter(r => r.nama && parseFloat(r.jumlah || 0) > 0).forEach(r => {
    mDetail.push(mkRow(r.nama, r.jumlah || 1, r.satuan || "pcs", r.harga_satuan || 0, "repair"));
  });

  // C. Barang/Sparepart rows (section "📦 Sparepart & Material") — keterangan: "barang"
  barangItems.filter(b => b.nama && parseFloat(b.jumlah || 0) > 0).forEach(b => {
    mDetail.push(mkRow(b.nama, b.jumlah || 1, b.satuan || "pcs", b.harga_satuan || 0, "barang"));
  });

  // D. Install rows — build dari effectiveMaterials dengan keterangan yang benar
  if (isInstallSvc) {
    mDetail.length = 0;
    const INSTALL_JASA_KEYS = ["pasang", "vacum", "bongkar", "kuras"];
    effectiveMaterials.filter(m => m.nama && parseFloat(m.jumlah || 0) > 0).forEach(m => {
      const n = (m.nama || "").toLowerCase();
      const isJasa = INSTALL_JASA_KEYS.some(k => n.includes(k));
      const isFreon = FREON_KEYS.some(k => n.includes(k));
      const ket = m.keterangan || (isJasa ? "jasa" : isFreon ? "freon" : "");
      mDetail.push(mkRow(m.nama, m.jumlah, m.satuan || "pcs", m.harga_satuan || 0, ket));
    });
  }

  // E. AUTO-INJECT per-service
  if (!isInstallSvc) {
    const hasRepairItems = mDetail.some(m => m.keterangan === "repair");
    const isRepairSvc = svc === "Repair";
    const isComplainSvc2 = svc === "Complain";
    const isCleaningOrMaint = svc === "Cleaning" || svc === "Maintenance";

    // ── Cleaning & Maintenance: per-unit base labor dari Card 1/4 tipe ──
    const alreadyHasCleaningRow = mDetail.some(m => {
      if (m.keterangan !== "jasa") return false;
      const n = (m.nama || "").toLowerCase();
      return n.includes("cleaning") || n.includes("maintenance") || n.includes("cuci");
    });
    if (isCleaningOrMaint && !alreadyHasCleaningRow) {
      const unitsWithTipe = (units || []).filter(u => u && u.tipe);
      if (unitsWithTipe.length > 0) {
        [...unitsWithTipe].reverse().forEach((u) => {
          const hargaUnit = hargaPerUnitFromTipe(svc, u.tipe, priceListData);
          if (hargaUnit > 0) {
            const unitLabel = u.label || u.merk || ("Unit " + (u.unit_no || "?"));
            const bracketLabel = getBracketKey(svc, u.tipe) || u.tipe;
            const namaJasa = (svc || "") + " " + bracketLabel + " (" + unitLabel + ")";
            mDetail.unshift({
              nama: namaJasa, jumlah: 1, satuan: "unit",
              harga_satuan: hargaUnit, subtotal: hargaUnit, keterangan: "jasa"
            });
          }
        });
      } else {
        const svcFee = hitungLabor(svc, order.type, units.length);
        if (svcFee > 0) {
          const unitCount = units.length || 1;
          const hPerUnit = Math.round(svcFee / unitCount);
          [...units].reverse().forEach((u, idx) => {
            const unitLabel = u.label || u.merk || ("Unit " + (u.unit_no || (unitCount - idx)));
            const namaJasa = (svc || "") + (order.type ? " - " + order.type : "") + " (" + unitLabel + ")";
            mDetail.unshift({ nama: namaJasa, jumlah: 1, satuan: "unit", harga_satuan: hPerUnit, subtotal: hPerUnit, keterangan: "jasa" });
          });
        }
      }
    }

    // ── Cleaning 1 unit: inject "Biaya Transport Bila 1 Unit" otomatis ──
    const sudahAdaTransport = mDetail.some(m => (m.nama || "").toLowerCase().includes("transport"));
    if (svc === "Cleaning" && (units || []).length === 1 && !sudahAdaTransport) {
      const transportItem = priceListData.find(
        r => r.service === "Cleaning" && r.type === "Biaya Transport Bila 1 Unit" && r.is_active !== false
      );
      if (transportItem && transportItem.price > 0) {
        mDetail.push({
          nama: "Biaya Transport Bila 1 Unit", jumlah: 1, satuan: "unit",
          harga_satuan: transportItem.price, subtotal: transportItem.price, keterangan: "jasa"
        });
      }
    }

    // ── Repair: Cleaning-in-Repair checkbox → append per unit yg dicentang ──
    if (isRepairSvc && Array.isArray(cleaningInRepair) && cleaningInRepair.length > 0) {
      const checkedUnits = (units || []).filter(u => u && u.tipe && cleaningInRepair.includes(u.unit_no));
      checkedUnits.forEach((u) => {
        const hargaUnit = hargaPerUnitFromTipe("Cleaning", u.tipe, priceListData);
        if (hargaUnit > 0) {
          const unitLabel = u.label || u.merk || ("Unit " + (u.unit_no || "?"));
          const bracketLabel = getBracketKey("Cleaning", u.tipe) || u.tipe;
          mDetail.push({
            nama: "Cleaning " + bracketLabel + " (" + unitLabel + ") [+Repair]",
            jumlah: 1, satuan: "unit",
            harga_satuan: hargaUnit, subtotal: hargaUnit, keterangan: "jasa"
          });
        }
      });
    }

    // ── Repair card 3/4 kosong: inject "Biaya Pengecekan" ──
    if (isRepairSvc && !isRepairGratis && !hasRepairItems && !mDetail.some(m => m.keterangan === "jasa")) {
      const biayaCekItem = priceListData.find(r2 => r2.service === "Repair" && r2.type === "Biaya Pengecekan AC");
      const biayaCek = (biayaCekItem && biayaCekItem.price > 0) ? biayaCekItem.price : 0;
      const cekQty = Math.max(1, (units || []).length || 1); // biaya pengecekan PER UNIT
      mDetail.unshift({ nama: "Biaya Pengecekan AC", jumlah: cekQty, satuan: "unit", harga_satuan: biayaCek, subtotal: biayaCek * cekQty, keterangan: "jasa" });
    }

    // ── Complain biaya cek: inject dari finalLabor (tanpa garansi) ──
    if (isComplainSvc2 && finalLabor > 0 && finalLabor <= 200000 && !mDetail.some(m => m.keterangan === "jasa")) {
      mDetail.unshift({ nama: "Biaya Pengecekan (Tanpa Garansi)", jumlah: 1, satuan: "unit", harga_satuan: finalLabor, subtotal: finalLabor, keterangan: "jasa" });
    }
  }

  // ── P3: Complain dalam garansi → jasa ditanggung = baris DISKON (paritas dgn verify) ──
  if (isComplainSvc && prevGaransiActive) {
    const _g = summarize(mDetail);
    if (_g.labor > 0) mDetail.push(buildWarrantyDiscountLine(_g.labor, prevGaransiActive.id));
  }

  return { mDetail };
}
