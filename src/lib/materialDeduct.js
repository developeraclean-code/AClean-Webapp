// Logika murni untuk potong stok dari Material Harian (Opsi A: confirm-gated deduct).
// terpakai per UNIT = dibawa (pagi) − sisa (pulang), dihitung per unit_id (tabung/roll).
// Dipakai saat Owner/Admin confirm di dashboard. Lihat materials harian flow + migrasi 088.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Ambil daftar unit dari satu item checkout (pipa/kabel/freon) → [{unit_id, qty, ...meta}].
function unitEntries(item) {
  if (!item || !item.material_type) return [];
  const cat = item.material_type;
  let arr;
  if (Array.isArray(item.units)) arr = item.units.map((u) => ({ unit_id: u.unit_id || null, qty: Number(u.qty) || 0, unit_label: u.label || null }));
  else if (cat === "freon" && Array.isArray(item.weight_kg)) arr = item.weight_kg.map((u) => ({ unit_id: u.unit_id || null, qty: Number(u.kg) || 0, unit_label: u.label || null }));
  else arr = [{ unit_id: null, qty: Number(item.qty) || 0, unit_label: null }];  // legacy: agregat tanpa unit
  // unit_label = nama tabung/roll fisiknya ("Tabung R32 - K"), BEDA dari label
  // material ("Freon R-32"). Wajib ikut terbawa: teknisi bisa membawa dua roll
  // dari material yang sama, dan tanpa ini keduanya tampil sebagai baris kembar
  // yang tak terbedakan — sekaligus bikin unit_label di transaksi stok salah isi.
  return arr.map((u) => ({ unit_id: u.unit_id, qty: u.qty, unit_label: u.unit_label, inventory_code: item.inventory_code || null, label: item.label || cat, material_type: cat }));
}

const keyOf = (e) => (e.unit_id ? "u:" + e.unit_id : "c:" + (e.inventory_code || e.label));

// computeDayDeduct(pagiItems, pulangItems) → baris deduct per unit:
//   [{unit_id, inventory_code, label, material_type, brought, returned, used, hanyaPulang}]
// used = max(0, brought − returned). Unit yang dibawa tapi tak ada di pulang → returned 0 (used = penuh).
//
// PENTING: baris juga diterbitkan untuk unit yang HANYA ada di sesi pulang (brought = 0),
// ditandai hanyaPulang. Dulu daftar ini dibangun murni dari sesi pagi, sehingga barang yang
// terlanjur ditulis di pulang saja LENYAP tanpa jejak — tidak tampil, tidak terpotong, tanpa
// peringatan (kasus nyata 29 Agu 2026: Freon Tabung R32-S 2,9 kg Bu Vessa, dan 4 Agu 2026:
// Roll 2.5PK-C1 3 m). used-nya tetap 0 karena bawa−sisa memang tak bisa dihitung, jadi
// deductLines()/usedByCode() yang menyaring used > 0 tidak ikut berubah; gunanya semata agar
// UI bisa memperingatkan dan menahan Confirm sampai sesi pagi dibetulkan.
export function computeDayDeduct(pagiItems, pulangItems) {
  const brought = new Map();
  const meta = new Map();
  const catat = (e) => {
    const k = keyOf(e);
    if (!meta.has(k)) meta.set(k, { unit_id: e.unit_id, inventory_code: e.inventory_code, label: e.label, unit_label: e.unit_label, material_type: e.material_type });
    return k;
  };
  for (const it of (Array.isArray(pagiItems) ? pagiItems : [])) {
    for (const e of unitEntries(it)) {
      const k = catat(e);
      brought.set(k, (brought.get(k) || 0) + e.qty);
    }
  }
  const returned = new Map();
  for (const it of (Array.isArray(pulangItems) ? pulangItems : [])) {
    for (const e of unitEntries(it)) {
      const k = catat(e);
      returned.set(k, (returned.get(k) || 0) + e.qty);
    }
  }
  const out = [];
  for (const [k, b] of brought) {
    const r = returned.get(k) || 0;
    const used = round2(b - r);
    out.push({ ...meta.get(k), brought: round2(b), returned: round2(r), used: used > 0 ? used : 0, hanyaPulang: false });
  }
  for (const [k, r] of returned) {
    if (brought.has(k)) continue;
    out.push({ ...meta.get(k), brought: 0, returned: round2(r), used: 0, hanyaPulang: true });
  }
  return out;
}

// Baris yang ada di sesi pulang tapi tidak pernah dibawa pagi — wajib dibereskan sebelum
// Confirm, karena angkanya mustahil ditafsirkan: "sisa" dari barang yang tak pernah dibawa.
export function barisHanyaPulang(lines) {
  return (lines || []).filter((l) => l?.hanyaPulang);
}

export function pesanHanyaPulang(lines) {
  const b = barisHanyaPulang(lines);
  if (!b.length) return "";
  const rinci = b.map((l) => `${l.unit_label || l.label} (${l.returned})`).join(", ");
  return `Ada di sesi pulang tapi tidak dibawa pagi: ${rinci}. ` +
         `Betulkan sesi pagi teknisi dulu — kalau tidak, barang ini tidak akan terpotong dari stok.`;
}

// Hanya baris yang benar-benar terpakai (used > 0) — yang perlu dipotong dari stok.
export function deductLines(pagiItems, pulangItems) {
  return computeDayDeduct(pagiItems, pulangItems).filter((l) => l.used > 0);
}

// Total terpakai per inventory_code (utk ringkasan).
export function usedByCode(pagiItems, pulangItems) {
  const m = {};
  for (const l of computeDayDeduct(pagiItems, pulangItems)) {
    if (l.used <= 0) continue;
    const c = l.inventory_code || l.label;
    m[c] = round2((m[c] || 0) + l.used);
  }
  return m;
}

// ── Koreksi admin atas hasil bawa−sisa ──────────────────────────────────────
// Angka "terpakai" dihitung otomatis dari selisih bawa−sisa yang dilaporkan
// teknisi. Kadang laporannya meleset (sisa salah ukur / lupa dicatat), jadi
// Admin/Owner boleh mengoreksi sebelum stok dipotong — dengan jejak audit.
// Lihat MaterialConfirmTab + migrasi 146 (kolom admin_adjustments).

export const lineKey = (l) => (l?.unit_id ? "u:" + l.unit_id : "c:" + (l?.inventory_code || l?.label));

// Batas aman: tidak boleh minus, dan tidak boleh melebihi yang dibawa —
// mustahil memakai lebih banyak dari isi roll/tabung yang dibawa hari itu.
export function clampUsed(nilai, brought) {
  const n = Number(nilai);
  if (!Number.isFinite(n) || n < 0) return 0;
  const maks = Number(brought);
  if (Number.isFinite(maks) && maks >= 0 && n > maks) return round2(maks);
  return round2(n);
}

// Terapkan koreksi admin ke baris hasil computeDayDeduct.
// overrides = { [lineKey]: qtyTerpakaiBaru }
// → { lines, changes } — changes hanya berisi baris yang benar-benar berubah,
//   dipakai untuk catatan audit & isi kolom admin_adjustments.
export function applyAdminOverrides(baseLines, overrides) {
  const ov = overrides || {};
  const changes = [];
  const lines = (Array.isArray(baseLines) ? baseLines : []).map((l) => {
    const k = lineKey(l);
    if (!Object.prototype.hasOwnProperty.call(ov, k)) return l;
    const semula = round2(l.used);
    const jadi = clampUsed(ov[k], l.brought);
    if (jadi === semula) return l;
    changes.push({
      key: k, unit_id: l.unit_id || null, label: l.label,
      inventory_code: l.inventory_code || null,
      brought: round2(l.brought), returned: round2(l.returned),
      dari: semula, jadi,
    });
    return { ...l, used: jadi, used_asli: semula, dikoreksi: true };
  });
  return { lines, changes };
}

// ── Pembalikan potongan stok (buka koreksi sesi yang sudah dikonfirmasi) ─────
// Owner/Admin perlu bisa membuka sesi beberapa hari lalu untuk membetulkan qty
// aktual & pembagian jobnya. Alih-alih menyunting transaksi lama (yang merusak
// jejak), potongannya DIBALIK dengan transaksi lawan bertipe 'adjustment', lalu
// sesinya kembali PENDING sehingga admin mengonfirmasi ulang lewat jalur normal.
// Pola yang sama dipakai saat laporan dihapus (LaporanTimView) — sudah terbukti.
export function buildReversalRow(tx, { oleh, alasan } = {}) {
  if (!tx) return null;
  const qty = Math.abs(Number(tx.qty) || 0);
  if (!(qty > 0)) return null;
  return {
    inventory_code: tx.inventory_code,
    inventory_name: tx.inventory_name,
    order_id: tx.order_id || null,
    report_id: tx.report_id || null,
    unit_id: tx.unit_id || null,
    unit_label: tx.unit_label || null,
    qty,
    qty_actual: Math.abs(Number(tx.qty_actual ?? tx.qty) || 0),
    type: "adjustment",
    teknisi_name: tx.teknisi_name || null,
    customer_name: tx.customer_name || null,
    job_date: tx.job_date || null,
    notes: `Buka koreksi Material Harian — stok dikembalikan${oleh ? " oleh " + oleh : ""}${alasan ? " (" + alasan + ")" : ""}`,
    created_by_name: oleh || "",
  };
}

// Berapa yang harus dikembalikan ke tiap unit fisik (tabung/roll) saat dibalik.
// → { [unit_id]: qty }
export function reversalByUnit(txs) {
  const m = {};
  for (const tx of (txs || [])) {
    if (!tx?.unit_id) continue;
    const qty = Math.abs(Number(tx.qty) || 0);
    if (!(qty > 0)) continue;
    m[tx.unit_id] = round2((m[tx.unit_id] || 0) + qty);
  }
  return m;
}

// ── Penjaga stok minus (migrasi 152) ────────────────────────────────────────
// Sebelum ini kelebihan pakai disembunyikan dua kali: Math.max(0,...) di aplikasi
// dan GREATEST(0,...) di trigger DB. Klaim 30 m dari roll berisi 2 m lewat tanpa
// jejak. Sekarang angka ditulis apa adanya dan dijaga CHECK stock >= 0, jadi
// aplikasi WAJIB memeriksa lebih dulu supaya admin dapat pesan yang bisa dibaca,
// bukan error database mentah.
//
// stokPerUnit = { [unit_id]: sisa stok sekarang }
// → daftar baris yang qty-nya melebihi stok, untuk ditampilkan ke admin.
export function hitungKekuranganStok(lines, stokPerUnit) {
  const stok = stokPerUnit || {};
  const perUnit = new Map();
  for (const l of (Array.isArray(lines) ? lines : [])) {
    if (!l?.unit_id) continue;                       // non-tracked: tak punya unit
    const q = round2(l.used ?? l.qty ?? 0);
    if (!(q > 0)) continue;
    const p = perUnit.get(l.unit_id) || { unit_id: l.unit_id, label: l.label, unit_label: l.unit_label, diminta: 0 };
    p.diminta = round2(p.diminta + q);
    perUnit.set(l.unit_id, p);
  }
  const kurang = [];
  for (const p of perUnit.values()) {
    const tersedia = round2(Number(stok[p.unit_id]) || 0);
    if (p.diminta > tersedia) kurang.push({ ...p, tersedia, selisih: round2(p.diminta - tersedia) });
  }
  return kurang;
}

// Pesan siap tampil untuk admin.
export function pesanKekuranganStok(kurang) {
  return (kurang || [])
    .map((k) => `${k.unit_label || k.label}: diminta ${k.diminta}, tersedia ${k.tersedia} (kurang ${k.selisih})`)
    .join(" · ");
}
