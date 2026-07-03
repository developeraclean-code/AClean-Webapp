import { useState, useEffect } from "react";
import { cs } from "../theme/cs.js";

const inp = {
  width: "100%", background: cs.card, border: "1px solid " + cs.border,
  borderRadius: 8, padding: "9px 12px", color: cs.text,
  fontSize: 13, outline: "none", boxSizing: "border-box",
};

const MATERIAL_TYPES = [
  ["freon", "❄️ Freon"],
  ["pipa", "🔧 Pipa"],
  ["kabel", "⚡ Kabel"],
  ["sparepart", "🔩 Sparepart"],
  ["other", "📦 Lainnya"],
];

const UNITS = ["pcs", "kg", "m", "roll", "botol", "set", "liter", "unit"];

const EMPTY_ADD = { name: "", code: "", unit: "pcs", price: "", stock: "", reorder: "", min_alert: "", material_type: "other" };
const EMPTY_EDIT = { stock: "", tambah: "", price: "", reorder: "", min_alert: "" };

function computeStockStatusLocal(stock, reorder) {
  if (stock <= 0) return "OUT";
  if (stock <= (reorder * 0.5)) return "CRITICAL";
  if (stock < reorder) return "LOW";
  return "OK";
}

const isFreonItem = (item) => item && (item.material_type === "freon" || (item.name || "").toLowerCase().includes("freon") || (item.name || "").toLowerCase().includes("r32") || (item.name || "").toLowerCase().includes("r22") || (item.name || "").toLowerCase().includes("r410"));

export default function MaterialFormModal({
  open,
  mode,
  editItem,
  onClose,
  inventoryData,
  setInventoryData,
  currentUser,
  showNotif,
  addAgentLog,
  supabase,
}) {
  const [form, setForm] = useState(mode === "edit" ? EMPTY_EDIT : EMPTY_ADD);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && editItem) {
      setForm({ stock: editItem.stock ?? "", tambah: "", price: editItem.price ?? "", reorder: editItem.reorder ?? "", min_alert: editItem.min_alert ?? "" });
    } else {
      setForm(EMPTY_ADD);
    }
    setSaving(false);
  }, [open, mode, editItem]);

  if (!open) return null;

  const isF = mode === "edit" ? isFreonItem(editItem) : form.material_type === "freon";
  const parseStock = (v) => isF ? (parseFloat(v) || 0) : (parseInt(v) || 0);

  // ── COMPUTED (Edit mode) ──
  const tambah = parseStock(form.tambah);
  const stokBaru = mode === "edit" ? parseStock(form.stock ?? editItem?.stock) : 0;
  const stokFinal = mode === "edit" ? stokBaru + tambah : 0;
  const reorderEdit = parseInt(form.reorder ?? editItem?.reorder) || 5;
  const statusBaru = mode === "edit" ? computeStockStatusLocal(stokFinal, reorderEdit) : "";

  // ── COMPUTED (Add mode) ──
  const stokAdd = parseStock(form.stock);
  const reorderAdd = parseInt(form.reorder) || 5;
  const statusAdd = form.stock !== "" || form.reorder !== "" ? computeStockStatusLocal(stokAdd, reorderAdd) : null;
  const stCol = statusAdd === "OK" ? cs.green : statusAdd === "OUT" ? cs.red : cs.yellow;

  const handleClose = () => {
    setForm(mode === "edit" ? EMPTY_EDIT : EMPTY_ADD);
    onClose();
  };

  const handleSaveAdd = async () => {
    if (!form.name || form.name.trim().length < 2 || form.name.trim().length > 100) {
      showNotif("❌ Nama material harus 2-100 karakter"); return;
    }
    const stokAwal = parseStock(form.stock);
    if (stokAwal < 0) { showNotif("❌ Stok tidak boleh negatif"); return; }
    const price = parseInt(form.price) || 0;
    if (price < 0 || price > 100000000) { showNotif("❌ Harga tidak valid"); return; }
    const reorderPt = parseInt(form.reorder) || 5;
    const minAlert = parseInt(form.min_alert) || 2;
    const rawCode = (form.code || "").trim().toUpperCase();
    if (rawCode && inventoryData.some(i => i.code === rawCode)) {
      showNotif("❌ Kode " + rawCode + " sudah digunakan"); return;
    }
    const newCode = rawCode || ("MAT" + Date.now().toString(36).slice(-4).toUpperCase());
    const stokStatus = computeStockStatusLocal(stokAwal, reorderPt);
    const newItem = {
      code: newCode,
      name: form.name.trim(),
      unit: form.unit || "pcs",
      price,
      stock: stokAwal,
      reorder: reorderPt,
      min_alert: minAlert,
      status: stokStatus,
      material_type: form.material_type || "other",
    };
    setSaving(true);
    const insertPayload = { ...newItem };
    delete insertPayload.status;
    const { error: invErr } = await supabase.from("inventory").insert(insertPayload);
    if (invErr) {
      showNotif("❌ Gagal menyimpan material: " + invErr.message);
      setSaving(false);
      return;
    }
    // Update UI hanya setelah DB berhasil (cegah phantom item)
    setInventoryData(prev => [...prev, newItem]);
    if (stokAwal > 0) {
      // Insert sudah include stock; hanya perlu audit trail transaksi
      const { error: txErr } = await supabase.from("inventory_transactions").insert({
        inventory_code: newCode,
        inventory_name: newItem.name,
        qty: stokAwal,
        type: "restock",
        notes: "Stok awal (migrasi manual)",
        created_by: currentUser?.id || null,
        created_by_name: currentUser?.name || "",
      });
      if (txErr) console.error("[addMaterial] inventory_transactions:", txErr.message);
    }
    addAgentLog("STOCK_ADDED", `Material baru: ${newItem.name} [${newCode}] stok: ${stokAwal} ${newItem.unit}`, "SUCCESS");
    showNotif("✅ " + newItem.name + " ditambahkan [" + newCode + "]");
    setSaving(false);
    handleClose();
  };

  const handleSaveEdit = async () => {
    if (!editItem) return;
    if (stokFinal < 0) { showNotif("❌ Stok tidak boleh negatif"); return; }
    const hargaBaru = parseInt(form.price ?? editItem.price) || 0;
    const reorderBaru = parseInt(form.reorder ?? editItem.reorder) || 5;
    const updated = { ...editItem, stock: stokFinal, price: hargaBaru, reorder: reorderBaru, status: statusBaru };
    setSaving(true);
    setInventoryData(prev => prev.map(i => i.code === editItem.code ? updated : i));
    const deltaStok = stokFinal - editItem.stock;
    if (deltaStok !== 0) {
      await supabase.from("inventory_transactions").insert({
        inventory_code: editItem.code,
        inventory_name: editItem.name,
        qty: deltaStok,
        type: deltaStok > 0 ? "restock" : "correction",
        notes: `Update manual oleh ${currentUser?.name || "Admin"}`,
        created_by: currentUser?.id || null,
        created_by_name: currentUser?.name || "",
      });
    }
    const { error: eErr } = await supabase.from("inventory")
      .update({ stock: stokFinal, price: hargaBaru, reorder: reorderBaru, updated_at: new Date().toISOString() })
      .eq("code", editItem.code);
    if (eErr) showNotif("⚠️ Tersimpan lokal, sync DB gagal");
    else {
      addAgentLog("STOCK_UPDATED", `Stok ${editItem.name}: ${editItem.stock}→${stokFinal} ${editItem.unit} (${statusBaru})`, "SUCCESS");
      showNotif("✅ Stok " + editItem.name + " diupdate → " + stokFinal + " " + editItem.unit);
    }
    setSaving(false);
    handleClose();
  };

  const statusColor = (s) => s === "OK" ? cs.green : s === "OUT" ? cs.red : cs.yellow;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} onClick={handleClose}>
      <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: mode === "edit" ? 420 : 460, padding: 24, maxHeight: "90vh", overflowY: "auto" }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>
            {mode === "edit" ? `✏️ Edit Stok — ${editItem?.name}` : "📦 Tambah Material Baru"}
          </div>
          <button onClick={handleClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 10 }}>

          {/* ── ADD MODE ── */}
          {mode === "add" && (<>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Nama Material <span style={{ color: cs.red }}>*</span></div>
                <input type="text" placeholder="cth: Freon R32, Pipa 1/4" value={form.name || ""}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={inp} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Kode Manual</div>
                <input type="text" placeholder="cth: FRN-R32" value={form.code || ""}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9\-_]/g, "") }))}
                  style={{ ...inp, fontFamily: "monospace" }} />
                <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>Kosong = auto</div>
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 6 }}>Tipe Material</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {MATERIAL_TYPES.map(([val, lbl]) => (
                  <button key={val} onClick={() => setForm(f => ({ ...f, material_type: val }))}
                    style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: "1px solid " + (form.material_type === val ? cs.accent : cs.border), background: form.material_type === val ? cs.accent + "22" : cs.surface, color: form.material_type === val ? cs.accent : cs.muted, fontWeight: form.material_type === val ? 700 : 400 }}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Satuan</div>
                <select value={form.unit || "pcs"} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                  style={{ ...inp, padding: "9px 12px" }}>
                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Harga/Unit (Rp)</div>
                <input type="number" min="0" placeholder="0" value={form.price || ""}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))} style={inp} />
              </div>
            </div>

            <div style={{ background: cs.accent + "10", border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent, marginBottom: 6 }}>📥 Stok Aktual Saat Ini (migrasi dari manual)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Jumlah Stok Fisik</div>
                  <input type="number" min="0" step={form.material_type === "freon" ? "0.1" : "1"} placeholder="0"
                    value={form.stock || ""} onChange={e => setForm(f => ({ ...f, stock: e.target.value }))} style={inp} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Reorder Point</div>
                  <input type="number" min="0" placeholder="5" value={form.reorder || ""}
                    onChange={e => setForm(f => ({ ...f, reorder: e.target.value }))} style={inp} />
                </div>
              </div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 8 }}>
                Min Alert:
                <input type="number" min="0" placeholder="2" value={form.min_alert || ""}
                  onChange={e => setForm(f => ({ ...f, min_alert: e.target.value }))}
                  style={{ width: 60, background: cs.card, border: "1px solid " + cs.border, borderRadius: 6, padding: "4px 8px", color: cs.text, fontSize: 12, outline: "none", marginLeft: 6 }} />
                <span style={{ marginLeft: 8 }}>{form.unit || "pcs"} (kirim WA alert)</span>
              </div>
            </div>

            {statusAdd && (
              <div style={{ background: stCol + "12", border: "1px solid " + stCol + "33", borderRadius: 8, padding: "8px 12px", fontSize: 12, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontWeight: 700, color: stCol }}>{statusAdd}</span>
                <span style={{ color: cs.muted }}>Stok {stokAdd} {form.unit || "pcs"} · Reorder saat &lt; {reorderAdd}</span>
              </div>
            )}
          </>)}

          {/* ── EDIT MODE ── */}
          {mode === "edit" && editItem && (<>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>
                  Stok Saat Ini {isF && <span style={{ color: cs.accent, fontSize: 10 }}>(decimal kg)</span>}
                </div>
                <input type="number" min="0" step={isF ? "0.1" : "1"} value={form.stock ?? editItem.stock}
                  onChange={e => setForm(f => ({ ...f, stock: e.target.value }))} style={inp} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Tambah (+)</div>
                <input type="number" step={isF ? "0.1" : "1"} min="0" placeholder="0" value={form.tambah || ""}
                  onChange={e => setForm(f => ({ ...f, tambah: e.target.value }))} style={inp} />
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Harga/Unit</div>
                <input type="number" value={form.price ?? editItem.price}
                  onChange={e => setForm(f => ({ ...f, price: e.target.value }))} style={inp} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 4 }}>Reorder Point</div>
                <input type="number" value={form.reorder ?? editItem.reorder}
                  onChange={e => setForm(f => ({ ...f, reorder: e.target.value }))} style={inp} />
              </div>
            </div>

            <div style={{ background: stokFinal <= (editItem.min_alert || 0) ? cs.red + "12" : cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", fontSize: 12, color: cs.muted }}>
              Stok setelah update:{" "}
              <strong style={{ color: statusColor(statusBaru) }}>{stokFinal} {editItem.unit}</strong>
              {" "}· Status:{" "}
              <strong style={{ color: statusColor(statusBaru) }}>{statusBaru}</strong>
            </div>
          </>)}

          {/* Footer buttons */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10, marginTop: 4 }}>
            <button onClick={handleClose}
              style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "12px", borderRadius: 10, cursor: "pointer", fontWeight: 700 }}>
              Batal
            </button>
            <button onClick={mode === "edit" ? handleSaveEdit : handleSaveAdd} disabled={saving}
              style={{ background: saving ? cs.border : "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: saving ? cs.muted : "#0a0f1e", padding: "12px", borderRadius: 10, cursor: saving ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
              {saving ? "Menyimpan..." : mode === "edit" ? "✓ Simpan Perubahan" : "✓ Simpan Material"}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
