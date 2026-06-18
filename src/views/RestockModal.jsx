import { useState, useEffect } from "react";
import { cs } from "../theme/cs.js";

const inp = {
  width: "100%", background: cs.card, border: "1px solid " + cs.border,
  borderRadius: 8, padding: "9px 12px", color: cs.text,
  fontSize: 13, outline: "none", boxSizing: "border-box",
};

const isFreonItem = (item) => item && (
  item.material_type === "freon" ||
  (item.name || "").toLowerCase().includes("freon") ||
  (item.name || "").toLowerCase().includes("r32") ||
  (item.name || "").toLowerCase().includes("r22") ||
  (item.name || "").toLowerCase().includes("r410")
);

function computeStockStatus(stock, reorder) {
  if (stock <= 0) return "OUT";
  if (stock <= (reorder * 0.5)) return "CRITICAL";
  if (stock < reorder) return "LOW";
  return "OK";
}

const EMPTY_FORM = { qty: "", harga: "", tanggal: "", keterangan: "", catetBiaya: true };

export default function RestockModal({
  open,
  item,
  onClose,
  setInventoryData,
  currentUser,
  showNotif,
  addAgentLog,
  supabase,
  TODAY,
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, tanggal: TODAY });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && item) {
      setForm({ ...EMPTY_FORM, tanggal: TODAY, harga: item.price ? String(item.price) : "" });
      setSaving(false);
    }
  }, [open, item, TODAY]);

  if (!open || !item) return null;

  const isF = isFreonItem(item);
  const qtyNum = isF ? parseFloat(form.qty) || 0 : parseInt(form.qty) || 0;
  const hargaNum = parseInt(form.harga) || 0;
  const totalBeli = qtyNum * hargaNum;
  const stokBaru = item.stock + qtyNum;

  const handleClose = () => {
    setForm({ ...EMPTY_FORM, tanggal: TODAY });
    onClose();
  };

  const handleSave = async () => {
    if (qtyNum <= 0) { showNotif("❌ Qty harus lebih dari 0"); return; }
    setSaving(true);

    const newStatus = computeStockStatus(stokBaru, item.reorder);
    setInventoryData(prev => prev.map(i => i.code === item.code ? { ...i, stock: stokBaru, status: newStatus } : i));

    await supabase.from("inventory_transactions").insert({
      inventory_code: item.code,
      inventory_name: item.name,
      qty: qtyNum,
      type: "restock",
      notes: form.keterangan || ("Restock manual oleh " + (currentUser?.name || "Owner")),
      created_by: currentUser?.id || null,
      created_by_name: currentUser?.name || "",
    }).then(() => {});

    const { error: invErr } = await supabase.from("inventory")
      .update({ stock: stokBaru, updated_at: new Date().toISOString() })
      .eq("code", item.code);

    if (invErr) showNotif("⚠️ Stok tersimpan lokal, sync DB gagal: " + invErr.message);

    if (form.catetBiaya && hargaNum > 0 && totalBeli > 0) {
      const subcat = isFreonItem(item)
        ? "Freon"
        : item.material_type === "pipa" ? "Pipa AC"
        : item.material_type === "kabel" ? "Kabel"
        : "Material Lain";
      const { error: expErr } = await supabase.from("expenses").insert({
        category: "material_purchase",
        subcategory: subcat,
        amount: totalBeli,
        date: form.tanggal || TODAY,
        description: form.keterangan || `Restock ${item.name} ${qtyNum} ${item.unit}`,
        item_name: item.name + " " + qtyNum + " " + item.unit,
        freon_type: isFreonItem(item)
          ? (item.name.includes("R22") ? "R22" : item.name.includes("R410") ? "R410A" : "R32")
          : null,
        created_by: currentUser?.name || "Owner",
        last_changed_by: currentUser?.name || "Owner",
      });
      if (expErr) showNotif("⚠️ Stok berhasil, expense gagal: " + expErr.message);
      else addAgentLog("RESTOCK_EXPENSE", `Restock ${item.name} +${qtyNum} ${item.unit} — Rp${totalBeli.toLocaleString("id-ID")} dicatat ke biaya`, "SUCCESS");
    }

    addAgentLog("STOCK_RESTOCK", `Restock ${item.name}: +${qtyNum} → ${stokBaru} ${item.unit}`, "SUCCESS");
    showNotif("✅ Restock " + item.name + " +" + qtyNum + " " + item.unit + (form.catetBiaya && totalBeli > 0 ? " · biaya Rp" + totalBeli.toLocaleString("id-ID") + " dicatat" : ""));
    setSaving(false);
    handleClose();
  };

  const stokColor = item.status === "OUT" ? cs.red : item.status === "CRITICAL" ? cs.yellow : cs.green;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={handleClose}>
      <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 440, padding: 24 }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>📥 Restock Material</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>
              {item.name} <span style={{ fontFamily: "monospace", fontSize: 10 }}>[{item.code}]</span>
            </div>
          </div>
          <button onClick={handleClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        {/* Stok sekarang */}
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 11, color: cs.muted }}>Stok Sekarang</div>
            <div style={{ fontWeight: 800, fontSize: 18, color: stokColor }}>{item.stock} {item.unit}</div>
          </div>
          {qtyNum > 0 && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 11, color: cs.muted }}>Setelah Restock</div>
              <div style={{ fontWeight: 800, fontSize: 18, color: cs.green }}>+{qtyNum} → {stokBaru} {item.unit}</div>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>
                Qty Masuk ({item.unit}) <span style={{ color: cs.red }}>*</span>
              </div>
              <input type="number" min="0" step={isF ? "0.1" : "1"} autoFocus placeholder="0"
                value={form.qty} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                style={{ ...inp, border: "1px solid " + cs.green + "66", fontSize: 14, fontWeight: 700 }} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Harga Beli/Unit (Rp)</div>
              <input type="number" min="0" placeholder={item.price || "0"}
                value={form.harga} onChange={e => setForm(f => ({ ...f, harga: e.target.value }))} style={inp} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Tanggal Beli</div>
              <input type="date" value={form.tanggal} onChange={e => setForm(f => ({ ...f, tanggal: e.target.value }))}
                style={{ ...inp, colorScheme: "dark" }} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Total Beli</div>
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", fontSize: 14, fontWeight: 800, color: totalBeli > 0 ? cs.green : cs.muted }}>
                {totalBeli > 0 ? "Rp" + totalBeli.toLocaleString("id-ID") : "—"}
              </div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Keterangan (opsional)</div>
            <input type="text" placeholder="cth: Beli di Toko Sejahtera, no faktur 001"
              value={form.keterangan} onChange={e => setForm(f => ({ ...f, keterangan: e.target.value }))} style={inp} />
          </div>

          {/* Toggle catat biaya */}
          <div style={{ background: cs.green + "10", border: "1px solid " + cs.green + "33", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.green }}>💳 Catat ke Biaya Otomatis</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Akan buat expense material_purchase sekaligus</div>
            </div>
            <button onClick={() => setForm(f => ({ ...f, catetBiaya: !f.catetBiaya }))}
              style={{ width: 44, height: 24, borderRadius: 99, border: "none", cursor: "pointer", background: form.catetBiaya ? cs.green : cs.border, transition: "background .2s", position: "relative", flexShrink: 0 }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: form.catetBiaya ? 23 : 3, transition: "left .2s" }} />
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 4 }}>
            <button onClick={handleClose}
              style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>
              Batal
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ background: saving ? cs.border : "linear-gradient(135deg," + cs.green + ",#10b981)", border: "none", color: saving ? cs.muted : "#fff", padding: "12px", borderRadius: 10, cursor: saving ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
              {saving ? "Menyimpan..." : "📥 Simpan Restock" + (form.catetBiaya && totalBeli > 0 ? " + Catat Biaya" : "")}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
