// Modal "Tautkan ke Stok" — mengubah satu nota pembelian (expenses) jadi restock nyata:
// stok bertambah, HPP item ikut ter-update dengan rata-rata bergerak.
//
// Kenapa manual, bukan otomatis (keputusan Owner 28 Agu 2026): AI nota bisa salah baca
// nama/qty, dan banyak nota isinya barang yang LANGSUNG dipakai di job — bukan masuk gudang.
// Menambah stok otomatis dari nota = stok hantu yang sulit dibalik.
//
// Anti dobel-restock: nota yang sudah pernah ditautkan punya `stock_linked_at` terisi dan
// tombolnya hilang dari ExpensesView. Kolom itu juga yang membuat autosum biaya material
// (src/lib/hpp.js) melewati nota ini — biayanya sudah terhitung lewat pemakaian stok.
import { useEffect, useMemo, useState } from "react";
import { cs } from "../theme/cs.js";
import { movingAvgCost, unitCostFromPack, qtyFromPack, hppLabel } from "../lib/hpp.js";

const inp = {
  width: "100%", background: cs.card, border: "1px solid " + cs.border,
  borderRadius: 8, padding: "9px 12px", color: cs.text,
  fontSize: 13, outline: "none", boxSizing: "border-box",
};

const rp = (n) => "Rp" + Number(n || 0).toLocaleString("id-ID", { maximumFractionDigits: 2 });

function computeStockStatus(stock, reorder) {
  if (stock <= 0) return "OUT";
  if (stock <= (reorder * 0.5)) return "CRITICAL";
  if (stock < reorder) return "LOW";
  return "OK";
}

// Tebak item inventori dari nama bebas di nota ("Kabel 3x1,5" → SKU025).
// Sengaja hanya PREFILL — admin tetap harus memilih; nama nota terlalu berantakan
// untuk dipercaya ("B. Hoda", "D. Non", "pipa 3/8 5/8").
function tebakItem(namaNota, inventory) {
  const n = String(namaNota || "").toLowerCase().replace(/[,\s-]/g, "");
  if (n.length < 3) return null;
  let best = null;
  for (const it of inventory) {
    const c = String(it.name || "").toLowerCase().replace(/[,\s-]/g, "");
    if (!c) continue;
    if (c === n) return it;
    if ((n.length >= 5 && c.includes(n)) || (c.length >= 5 && n.includes(c))) {
      if (!best || c.length > String(best.name).length) best = it;
    }
  }
  return best;
}

export default function TautkanStokModal({
  open, expense, inventoryData, onClose, onLinked,
  supabase, currentUser, showNotif, addAgentLog,
}) {
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("");
  const [perPack, setPerPack] = useState(false);
  const [saving, setSaving] = useState(false);

  const item = useMemo(() => inventoryData.find(i => i.code === code) || null, [inventoryData, code]);

  useEffect(() => {
    if (!open || !expense) return;
    const tebakan = expense.inventory_code
      ? inventoryData.find(i => i.code === expense.inventory_code)
      : tebakItem(expense.item_name || expense.description, inventoryData);
    setCode(tebakan?.code || "");
    setQty(expense.qty ? String(expense.qty) : "");
    setPerPack(false);
    setSaving(false);
  }, [open, expense, inventoryData]);

  if (!open || !expense) return null;

  const amount = Number(expense.amount) || 0;
  const packSize = Number(item?.pack_size) || 0;
  const packUnit = item?.pack_unit || "kemasan";
  const pakaiPack = perPack && packSize > 0;

  const qtyInput = parseFloat(qty) || 0;
  const qtyDasar = pakaiPack ? qtyFromPack(qtyInput, packSize) : qtyInput;
  // Harga satuan diturunkan dari nota: total ÷ qty. Inilah yang selama ini hilang —
  // nota cuma menyimpan total rupiah, tanpa qty tidak ada harga per meter/kg.
  const unitCost = qtyDasar > 0 ? Math.round((amount / qtyDasar) * 100) / 100 : 0;

  const hppLama = Number(item?.purchase_price) || 0;
  const stokLama = Number(item?.stock) || 0;
  const hppBaru = movingAvgCost({ stokLama, hppLama, qtyMasuk: qtyDasar, hargaMasuk: unitCost });
  const bisaSimpan = !!item && qtyDasar > 0 && unitCost > 0 && !saving;

  const simpan = async () => {
    if (!bisaSimpan) return;
    setSaving(true);
    const now = new Date().toISOString();
    const stokBaru = Math.round((stokLama + qtyDasar) * 100) / 100;

    // 1. Tandai notanya dulu — kalau langkah ini gagal, jangan sampai stok terlanjur naik
    //    tanpa penanda (nota tanpa penanda bisa ditautkan lagi = stok dobel).
    //    `.is("stock_linked_at", null)` = klaim atomik: kalau tab lain sudah menautkan nota
    //    ini duluan, filternya tidak kena baris apa pun. UPDATE yang tidak kena baris TIDAK
    //    mengembalikan error — jadi jumlah baris WAJIB diperiksa lewat .select(), bukan
    //    hanya `error`. Tanpa ini, klik dobel = stok bertambah dua kali.
    const { data: claimed, error: expErr } = await supabase.from("expenses").update({
      inventory_code: item.code,
      qty: qtyDasar,
      unit: item.unit,
      unit_cost: unitCost,
      stock_linked_at: now,
      stock_linked_by: currentUser?.name || "Owner",
      last_changed_by: currentUser?.name || "Owner",
    }).eq("id", expense.id).is("stock_linked_at", null).select("id");

    if (expErr) {
      showNotif("❌ Gagal menandai nota: " + expErr.message);
      setSaving(false);
      return;
    }
    if (!claimed || claimed.length === 0) {
      showNotif("⚠️ Nota ini sudah pernah ditautkan ke stok — dibatalkan supaya stok tidak dobel.");
      setSaving(false);
      onClose();
      return;
    }

    // 2. Ledger stok + harga saat transaksi
    const { error: txErr } = await supabase.from("inventory_transactions").insert({
      inventory_code: item.code,
      inventory_name: item.name,
      qty: qtyDasar,
      type: "restock",
      unit_cost: unitCost,
      total_cost: amount,
      expense_id: expense.id,
      notes: `Tautan nota: ${expense.item_name || expense.subcategory || "pembelian"} (${expense.date})`,
      created_by: currentUser?.id || null,
      created_by_name: currentUser?.name || "",
    });
    if (txErr) console.error("[tautkan-stok] inventory_transactions:", txErr.message);

    // 3. Stok + HPP
    const patch = {
      stock: stokBaru,
      purchase_price: hppBaru,
      purchase_price_last: unitCost,
      purchase_price_source: "nota",
      purchase_price_updated_at: now,
      updated_at: now,
    };
    const { error: invErr } = await supabase.from("inventory").update(patch).eq("code", item.code);
    if (invErr) {
      showNotif("⚠️ Nota ditandai & ledger tercatat, tapi stok gagal di-update: " + invErr.message);
      setSaving(false);
      return;
    }

    onLinked?.({
      expensePatch: {
        inventory_code: item.code, qty: qtyDasar, unit: item.unit,
        unit_cost: unitCost, stock_linked_at: now, stock_linked_by: currentUser?.name || "Owner",
      },
      inventoryPatch: { code: item.code, ...patch, status: computeStockStatus(stokBaru, item.reorder) },
    });

    addAgentLog?.("EXPENSE_STOCK_LINK",
      `Nota ${expense.item_name || expense.subcategory} ${rp(amount)} → ${item.name} +${qtyDasar} ${item.unit} · HPP ${rp(hppLama)} → ${rp(hppBaru)}`,
      "SUCCESS");
    showNotif(`✅ ${item.name} +${qtyDasar} ${item.unit} · HPP ${rp(hppBaru)} ${hppLabel(item.unit)}`);
    setSaving(false);
    onClose();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 220, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={onClose}>
      <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 460, padding: 24, maxHeight: "92vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>🔗 Tautkan Nota ke Stok</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>
              Stok bertambah & harga beli item ikut ter-update.
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        {/* Isi nota */}
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px", marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: cs.muted }}>{expense.date} · {expense.subcategory}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: cs.text, marginTop: 2 }}>{expense.item_name || expense.description || "—"}</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: cs.red, marginTop: 4 }}>{rp(amount)}</div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>
              Item Inventori <span style={{ color: cs.red }}>*</span>
            </div>
            <select value={code} onChange={e => { setCode(e.target.value); setPerPack(false); }} style={{ ...inp, cursor: "pointer" }}>
              <option value="">— pilih item —</option>
              {inventoryData.map(i => <option key={i.code} value={i.code}>{i.name} ({i.unit})</option>)}
            </select>
            {!expense.inventory_code && code && (
              <div style={{ fontSize: 10, color: cs.muted, marginTop: 3 }}>Tebakan dari nama nota — pastikan benar sebelum simpan.</div>
            )}
          </div>

          {item && packSize > 0 && (
            <div style={{ display: "flex", gap: 6, background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: 4 }}>
              {[{ v: false, label: `Per ${item.unit}` }, { v: true, label: `Per ${packUnit} (${packSize} ${item.unit})` }].map(o => (
                <button key={String(o.v)} onClick={() => setPerPack(o.v)}
                  style={{ flex: 1, padding: "7px 8px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700,
                    background: perPack === o.v ? cs.accent + "22" : "transparent",
                    color: perPack === o.v ? cs.accent : cs.muted }}>{o.label}</button>
              ))}
            </div>
          )}

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>
              Jumlah yang dibeli ({pakaiPack ? packUnit : (item?.unit || "satuan")}) <span style={{ color: cs.red }}>*</span>
            </div>
            <input type="number" min="0" step="0.1" placeholder="0" value={qty}
              onChange={e => setQty(e.target.value)}
              style={{ ...inp, border: "1px solid " + cs.green + "66", fontWeight: 700 }} />
            {expense.qty > 0 && (
              <div style={{ fontSize: 10, color: cs.accent, marginTop: 3 }}>Terbaca AI dari nota: {expense.qty} {expense.unit || ""}</div>
            )}
          </div>

          {/* Harga satuan hasil bagi — inti yang selama ini hilang dari nota */}
          <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px", display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: cs.muted }}>Harga beli hasil nota</span>
              <span style={{ fontFamily: "monospace", color: unitCost > 0 ? cs.text : cs.muted }}>
                {unitCost > 0 ? `${rp(amount)} ÷ ${qtyDasar} = ${rp(unitCost)} ${hppLabel(item?.unit)}` : "—"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: cs.muted }}>HPP sekarang</span>
              <span style={{ fontFamily: "monospace", color: hppLama > 0 ? cs.text : cs.red }}>
                {hppLama > 0 ? rp(hppLama) : "belum ada"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700 }}>
              <span style={{ color: cs.muted }}>HPP setelah tautan</span>
              <span style={{ fontFamily: "monospace", color: unitCost > 0 ? cs.green : cs.muted }}>
                {unitCost > 0 ? rp(hppBaru) : "—"}
              </span>
            </div>
            {item && (
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                <span style={{ color: cs.muted }}>Stok</span>
                <span style={{ color: cs.green }}>{stokLama} → {Math.round((stokLama + qtyDasar) * 100) / 100} {item.unit}</span>
              </div>
            )}
          </div>

          <div style={{ background: cs.yellow + "10", border: "1px solid " + cs.yellow + "33", borderRadius: 10, padding: "9px 12px", fontSize: 11, color: cs.muted }}>
            Tautkan hanya kalau barangnya <b>masuk gudang</b>. Barang yang langsung dipakai di
            lokasi jangan ditautkan — cukup tautkan notanya ke job lewat tombol Edit, biar
            terhitung sebagai biaya job tanpa menambah stok.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 2 }}>
            <button onClick={onClose}
              style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>Batal</button>
            <button onClick={simpan} disabled={!bisaSimpan}
              style={{ background: bisaSimpan ? "linear-gradient(135deg," + cs.green + ",#10b981)" : cs.border, border: "none", color: bisaSimpan ? "#fff" : cs.muted, padding: "12px", borderRadius: 10, cursor: bisaSimpan ? "pointer" : "not-allowed", fontWeight: 800, fontSize: 14 }}>
              {saving ? "Menyimpan..." : "🔗 Tautkan & Tambah Stok"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
