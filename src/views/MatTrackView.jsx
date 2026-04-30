import { memo, useState } from "react";
import { cs } from "../theme/cs.js";
import { displayStock, computeStockStatus } from "../lib/inventory.js";

function MatTrackView({ inventoryData, invUnitsData, setInvUnitsData, invTxData, setInvTxData, matTrackFilter, setMatTrackFilter, matTrackSearch, setMatTrackSearch, matTrackDateFrom, setMatTrackDateFrom, matTrackDateTo, setMatTrackDateTo, setModalStok, supabase, fetchInventoryUnits, showNotif, currentUser, setInventoryData }) {
const TRACK_ITEMS = inventoryData.filter(item =>
  item.material_type === "freon" ||
  item.material_type === "pipa" ||
  item.material_type === "kabel"
);

// ── State untuk inline mini-form unit fisik ──
const [addUnitFor, setAddUnitFor]   = useState(null); // inventory_code sedang tambah unit
const [addUnitForm, setAddUnitForm] = useState({ label: "", capacity: "", minVisible: "" });
const [editUnitId, setEditUnitId]   = useState(null); // unit.id sedang diedit stok
const [editUnitVal, setEditUnitVal] = useState("");   // nilai stok baru

// ── State untuk freon timbang adjustment ──
const [historyUnitId, setHistoryUnitId] = useState(null); // unit.id yang popup riwayatnya terbuka
const [timbangId, setTimbangId]     = useState(null);  // tx.id yang sedang di-adjust
const [timbangVal, setTimbangVal]   = useState("");    // nilai qty_actual input admin
const [timbangSaving, setTimbangSaving] = useState(false);

function isFreonTx(tx) {
  return ["r22","r32","r410","freon"].some(k => (tx.inventory_name||"").toLowerCase().includes(k));
}

async function saveActualQty(tx) {
  const actual = parseFloat(timbangVal);
  if (isNaN(actual) || actual < 0) { showNotif("❌ Nilai tidak valid", "error"); return; }
  setTimbangSaving(true);
  try {
    // 1. Simpan qty_actual ke transaksi asal
    const { error: e1 } = await supabase.from("inventory_transactions")
      .update({ qty_actual: -actual })
      .eq("id", tx.id);
    if (e1) throw e1;

    const diff = parseFloat((actual - Math.abs(tx.qty)).toFixed(1));
    if (Math.abs(diff) >= 0.001) {
      // 2. Insert adjustment transaction untuk koreksi selisih
      const { error: e2 } = await supabase.from("inventory_transactions").insert({
        inventory_code: tx.inventory_code,
        inventory_name: tx.inventory_name,
        order_id: tx.order_id || null,
        report_id: tx.report_id || null,
        qty: diff,
        qty_actual: diff,
        type: "adjustment",
        unit_id: tx.unit_id || null,
        unit_label: tx.unit_label || null,
        notes: `Koreksi timbang aktual dari ${Math.abs(tx.qty)} → ${actual} kg (job ${tx.order_id || tx.report_id || "?"})`,
        customer_name: tx.customer_name || null,
        teknisi_name: tx.teknisi_name || null,
        job_date: tx.job_date || null,
        created_by_name: currentUser?.name || "Admin",
      });
      if (e2) throw e2;

      // 3a. Update stok tabung spesifik di inventory_units (jika ada unit_id)
      if (tx.unit_id) {
        const { data: unitRow } = await supabase.from("inventory_units").select("stock").eq("id", tx.unit_id).single();
        if (unitRow) {
          const newUnitStock = parseFloat(((unitRow.stock || 0) + diff).toFixed(1));
          await supabase.from("inventory_units").update({ stock: newUnitStock, updated_at: new Date().toISOString() }).eq("id", tx.unit_id);
          if (setInvUnitsData) {
            setInvUnitsData(prev => prev.map(u => u.id === tx.unit_id ? { ...u, stock: newUnitStock } : u));
          }
        }
      }

      // 3b. Update stok global inventoryData
      if (setInventoryData) {
        setInventoryData(prev => prev.map(item => {
          if (item.code !== tx.inventory_code) return item;
          const newStock = parseFloat((item.stock + diff).toFixed(1));
          return { ...item, stock: newStock, status: computeStockStatus(newStock, item.reorder) };
        }));
      }
    }

    // 4. Update local invTxData
    if (setInvTxData) {
      setInvTxData(prev => prev.map(t => t.id === tx.id ? { ...t, qty_actual: -actual } : t));
      if (Math.abs(diff) >= 0.001) {
        // Add adjustment row to local state (approximate — no server id yet)
        setInvTxData(prev => [...prev, {
          id: "adj_" + Date.now(),
          inventory_code: tx.inventory_code,
          inventory_name: tx.inventory_name,
          order_id: tx.order_id,
          qty: diff,
          qty_actual: diff,
          type: "adjustment",
          notes: `Koreksi timbang: ${Math.abs(tx.qty)} → ${actual} kg`,
          customer_name: tx.customer_name,
          teknisi_name: tx.teknisi_name,
          job_date: tx.job_date,
          created_at: new Date().toISOString(),
        }]);
      }
    }

    showNotif(`✅ Timbang disimpan: ${actual} kg (selisih ${diff >= 0 ? "+" : ""}${diff.toFixed(1)} kg)`);
    setTimbangId(null);
    setTimbangVal("");
  } catch (err) {
    showNotif("❌ Gagal simpan: " + err.message, "error");
  } finally {
    setTimbangSaving(false);
  }
}

const reloadUnits = async () => {
  const { data } = await fetchInventoryUnits(supabase);
  if (data) setInvUnitsData(data);
};

const addUnit = async (invCode) => {
  const label = addUnitForm.label.trim();
  const cap   = parseFloat(addUnitForm.capacity) || 0;
  const minV  = parseFloat(addUnitForm.minVisible) || 3;
  if (!label) { showNotif("❌ Label unit harus diisi"); return; }
  if (cap <= 0) { showNotif("❌ Kapasitas harus > 0"); return; }
  const { error } = await supabase.from("inventory_units").insert({
    inventory_code: invCode,
    unit_label: label,
    stock: cap,
    capacity: cap,
    min_visible: minV,
    is_active: true,
  });
  if (!error) {
    await reloadUnits();
    showNotif("✅ Unit " + label + " ditambahkan");
    setAddUnitFor(null);
    setAddUnitForm({ label: "", capacity: "", minVisible: "" });
  } else showNotif("❌ " + error.message);
};

const updateUnitStock = async (unitId, newStock) => {
  const { error } = await supabase.from("inventory_units")
    .update({ stock: newStock, updated_at: new Date().toISOString() })
    .eq("id", unitId);
  if (!error) {
    setInvUnitsData(prev => prev.map(u => u.id === unitId ? { ...u, stock: newStock } : u));
    showNotif("✅ Stok unit diupdate");
    setEditUnitId(null);
    setEditUnitVal("");
  } else showNotif("❌ " + error.message);
};

const toggleUnit = async (unitId, isActive) => {
  await supabase.from("inventory_units").update({ is_active: isActive }).eq("id", unitId);
  setInvUnitsData(prev => prev.map(u => u.id === unitId ? { ...u, is_active: isActive } : u));
};

// Filter transaksi: usage (keluar) dan restock (masuk)
let txFiltered = [...invTxData];
// Filter berdasarkan tab: hanya usage
txFiltered = txFiltered.filter(tx => tx.qty < 0);
if (matTrackFilter !== "Semua") {
  if (matTrackFilter === "Freon") txFiltered = txFiltered.filter(tx => isFreonTx(tx));
  else if (matTrackFilter === "Pipa") txFiltered = txFiltered.filter(tx =>
    (tx.inventory_name || "").toLowerCase().includes("pipa") ||
    inventoryData.find(i => i.code === tx.inventory_code)?.material_type === "pipa"
  );
  else if (matTrackFilter === "Kabel") txFiltered = txFiltered.filter(tx =>
    (tx.inventory_name || "").toLowerCase().includes("kabel") ||
    inventoryData.find(i => i.code === tx.inventory_code)?.material_type === "kabel"
  );
  else txFiltered = txFiltered.filter(tx => tx.inventory_code === matTrackFilter);
}
if (matTrackSearch.trim()) {
  const q = matTrackSearch.toLowerCase();
  txFiltered = txFiltered.filter(tx =>
    (tx.inventory_name || "").toLowerCase().includes(q) ||
    (tx.customer_name || "").toLowerCase().includes(q) ||
    (tx.teknisi_name || "").toLowerCase().includes(q) ||
    (tx.order_id || "").toLowerCase().includes(q) ||
    (tx.unit_label || "").toLowerCase().includes(q)
  );
}
if (matTrackDateFrom) txFiltered = txFiltered.filter(tx => (tx.job_date || tx.created_at?.slice(0, 10) || "") >= matTrackDateFrom);
if (matTrackDateTo) txFiltered = txFiltered.filter(tx => (tx.job_date || tx.created_at?.slice(0, 10) || "") <= matTrackDateTo);
txFiltered.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

// Restock log (semua positif) — untuk tab riwayat
const restockLog = [...invTxData].filter(tx => tx.qty > 0).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

const isOwnerAdmin = currentUser?.role === "Owner" || currentUser?.role === "Admin";

return (
  <div style={{ display: "grid", gap: 16 }}>
    {/* Header */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 18, color: cs.text }}>🧮 Stok & Tracking Material</div>
        <div style={{ fontSize: 12, color: cs.muted }}>Pemakaian material per job · Auto-deduct dari laporan teknisi</div>
      </div>
      <button onClick={() => setModalStok(true)}
        style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#fff", padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
        + Material Baru
      </button>
    </div>

    {/* Kartu stok item prioritas */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10 }}>
      {TRACK_ITEMS.map(item => {
        const tot = invTxData.filter(tx => tx.qty < 0 && tx.inventory_code === item.code)
          .reduce((s, tx) => s + Math.abs(tx.qty), 0);
        const col = item.status === "OUT" ? "#ef4444" : item.status === "CRITICAL" ? cs.yellow : item.status === "WARNING" ? "#f97316" : cs.green;
        return (
          <div key={item.id} onClick={() => setMatTrackFilter(item.code)}
            style={{ background: cs.card, border: "1px solid " + (matTrackFilter === item.code ? cs.accent : col) + "44", borderRadius: 10, padding: "10px 12px", cursor: "pointer", borderLeft: "3px solid " + col }}>
            <div style={{ fontSize: 10, color: cs.muted, marginBottom: 2 }}>{item.code}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 6 }}>{item.name}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 800, color: col }}>{displayStock(item)}</div>
                <div style={{ fontSize: 10, color: cs.muted }}>{item.unit} tersisa</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: cs.muted }}>{tot.toFixed(1)}</div>
                <div style={{ fontSize: 9, color: cs.muted }}>{item.unit} terpakai</div>
              </div>
            </div>
            <div style={{ marginTop: 6, height: 4, background: cs.border, borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", background: col, borderRadius: 99, width: item.min_alert > 0 ? Math.min(100, Math.round(item.stock / item.min_alert * 50)) + "%" : "30%" }} />
            </div>
          </div>
        );
      })}
    </div>

    {/* ── Unit Fisik per Item (Tabung / Roll) — Owner/Admin only ── */}
    {isOwnerAdmin && (
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>📦 Unit Fisik (Tabung & Roll)</div>
            <div style={{ fontSize: 11, color: cs.muted }}>Stok per unit · Teknisi lihat unit sisa ≥ batas minimum</div>
          </div>
        </div>
        {TRACK_ITEMS.map(item => {
          const units = invUnitsData.filter(u => u.inventory_code === item.code);
          const totalStok = units.reduce((s, u) => s + (u.stock || 0), 0);
          const isAddingHere = addUnitFor === item.code;
          return (
            <div key={item.code} style={{ marginBottom: 12, background: cs.surface, borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>{item.name}</span>
                  <span style={{ fontSize: 11, color: cs.muted, marginLeft: 8 }}>[{item.code}]</span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: cs.green }}>{parseFloat(totalStok.toFixed(1))} {item.unit} total</span>
                  <button onClick={() => { setAddUnitFor(isAddingHere ? null : item.code); setAddUnitForm({ label: "", capacity: "", minVisible: "" }); }}
                    style={{ fontSize: 11, padding: "3px 10px", borderRadius: 7, background: isAddingHere ? cs.red + "22" : cs.accent + "22", border: "1px solid " + (isAddingHere ? cs.red : cs.accent) + "44", color: isAddingHere ? cs.red : cs.accent, cursor: "pointer", fontWeight: 600 }}>
                    {isAddingHere ? "✕ Batal" : "+ Tambah Unit"}
                  </button>
                </div>
              </div>

              {/* ── Inline form tambah unit baru ── */}
              {isAddingHere && (
                <div style={{ background: cs.accent + "08", border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: "12px 14px", marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent, marginBottom: 10 }}>➕ Tambah Unit Fisik Baru</div>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Label Unit</div>
                      <input type="text" placeholder="cth: Botol R32-A" value={addUnitForm.label}
                        onChange={e => setAddUnitForm(f => ({ ...f, label: e.target.value }))}
                        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "7px 10px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Kapasitas ({item.unit})</div>
                      <input type="number" min="0" step="0.1" placeholder="cth: 10" value={addUnitForm.capacity}
                        onChange={e => setAddUnitForm(f => ({ ...f, capacity: e.target.value }))}
                        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "7px 10px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Min Tampil</div>
                      <input type="number" min="0" step="0.1" placeholder="3" value={addUnitForm.minVisible}
                        onChange={e => setAddUnitForm(f => ({ ...f, minVisible: e.target.value }))}
                        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "7px 10px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: cs.muted, marginTop: 6 }}>Min Tampil: batas stok minimum agar unit terlihat oleh teknisi</div>
                  <button onClick={() => addUnit(item.code)}
                    style={{ marginTop: 10, background: cs.accent, border: "none", color: "#0a0f1e", padding: "8px 18px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
                    ✓ Simpan Unit
                  </button>
                </div>
              )}

              <div style={{ display: "grid", gap: 6 }}>
                {units.length === 0 ? (
                  <div style={{ fontSize: 11, color: cs.muted, textAlign: "center", padding: "8px 0" }}>
                    Belum ada unit fisik. Klik "+ Tambah Unit" untuk menambah.
                  </div>
                ) : units.map(unit => {
                  const pct = unit.capacity > 0 ? Math.min(100, Math.round(unit.stock / unit.capacity * 100)) : 0;
                  const col = !unit.is_active ? cs.muted
                    : unit.stock < (unit.min_visible || 3) ? cs.red
                      : unit.stock < (unit.capacity || 99) / 3 ? cs.yellow
                        : cs.green;
                  const hiddenFromTek = unit.stock < (unit.min_visible || 3);
                  const isEditingThis = editUnitId === unit.id;
                  return (
                    <div key={unit.id} style={{ display: "grid", gap: 6, opacity: unit.is_active ? 1 : 0.5, background: cs.card, borderRadius: 8, padding: "10px 12px", border: "1px solid " + col + "33" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {/* Label + status */}
                        <div style={{ minWidth: 120 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: cs.text }}>{unit.unit_label}</div>
                          <div style={{ fontSize: 10, color: cs.muted }}>
                            {hiddenFromTek && unit.is_active ? "👁️ Tersembunyi dari teknisi" : ""}
                            {!unit.is_active ? "⏸️ Nonaktif" : ""}
                          </div>
                        </div>
                        {/* Progress bar */}
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: cs.muted, marginBottom: 3 }}>
                            <span>{parseFloat((unit.stock || 0).toFixed(1))} {item.unit} sisa</span>
                            <span>{unit.capacity || "?"} {item.unit} kapasitas</span>
                          </div>
                          <div style={{ height: 6, background: cs.border, borderRadius: 99, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: pct + "%", background: col, borderRadius: 99, transition: "width .3s" }} />
                          </div>
                        </div>
                        {/* Tombol aksi */}
                        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                          <button onClick={() => setHistoryUnitId(historyUnitId === unit.id ? null : unit.id)}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: historyUnitId === unit.id ? cs.accent + "33" : cs.accent + "18", border: "1px solid " + cs.accent + (historyUnitId === unit.id ? "88" : "33"), color: cs.accent, cursor: "pointer", fontWeight: historyUnitId === unit.id ? 700 : 400 }}>
                            {historyUnitId === unit.id ? "✕ Tutup" : "📋 Riwayat"}
                          </button>
                          <button onClick={() => { setEditUnitId(isEditingThis ? null : unit.id); setEditUnitVal(String(unit.stock)); }}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: isEditingThis ? cs.red + "22" : cs.yellow + "22", border: "1px solid " + (isEditingThis ? cs.red : cs.yellow) + "44", color: isEditingThis ? cs.red : cs.yellow, cursor: "pointer" }}>
                            {isEditingThis ? "✕" : "✏️ Ubah"}
                          </button>
                          <button onClick={() => toggleUnit(unit.id, !unit.is_active)}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: unit.is_active ? cs.red + "22" : cs.green + "22", border: "1px solid " + (unit.is_active ? cs.red : cs.green) + "44", color: unit.is_active ? cs.red : cs.green, cursor: "pointer" }}>
                            {unit.is_active ? "⏸️" : "▶️"}
                          </button>
                        </div>
                      </div>
                      {/* ── Inline edit stok unit ── */}
                      {isEditingThis && (
                        <div style={{ background: cs.yellow + "08", border: "1px solid " + cs.yellow + "33", borderRadius: 8, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ fontSize: 12, color: cs.muted }}>Stok baru ({item.unit}):</div>
                          <input type="number" min="0" step="0.1" value={editUnitVal}
                            onChange={e => setEditUnitVal(e.target.value)}
                            autoFocus
                            style={{ width: 80, background: cs.card, border: "1px solid " + cs.yellow + "66", borderRadius: 7, padding: "6px 10px", color: cs.text, fontSize: 13, outline: "none" }} />
                          <button onClick={() => { const ns = parseFloat(editUnitVal); if (!isNaN(ns) && ns >= 0) updateUnitStock(unit.id, ns); else showNotif("❌ Nilai tidak valid"); }}
                            style={{ background: cs.yellow, border: "none", color: "#0a0f1e", padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>✓ Simpan</button>
                          <div style={{ fontSize: 11, color: cs.muted }}>Saat ini: {parseFloat((unit.stock || 0).toFixed(1))} {item.unit}</div>
                        </div>
                      )}
                      {/* ── Inline riwayat pemakaian unit ini ── */}
                      {historyUnitId === unit.id && (() => {
                        const unitTxs = invTxData
                          .filter(tx => tx.unit_id === unit.id || tx.unit_label === unit.unit_label)
                          .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
                        return (
                          <div style={{ background: cs.surface, border: "1px solid " + cs.accent + "33", borderRadius: 8, padding: "10px 12px" }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: cs.accent, marginBottom: 8 }}>
                              📋 Riwayat — {unit.unit_label} ({unitTxs.length} transaksi)
                            </div>
                            {unitTxs.length === 0 ? (
                              <div style={{ fontSize: 11, color: cs.muted, fontStyle: "italic" }}>Belum ada pemakaian tercatat.</div>
                            ) : (
                              <div style={{ display: "grid", gap: 5 }}>
                                {unitTxs.slice(0, 20).map((tx, ti) => {
                                  const isAdj = tx.type === "adjustment";
                                  const isUsage = tx.qty < 0 && !isAdj;
                                  return (
                                    <div key={tx.id || ti} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 6, alignItems: "center", fontSize: 11, padding: "5px 8px", background: isAdj ? cs.green + "0a" : cs.card, borderRadius: 6, border: "1px solid " + cs.border + "55" }}>
                                      <div>
                                        <div style={{ color: cs.text, fontWeight: 500 }}>{tx.customer_name || "—"}</div>
                                        <div style={{ color: cs.muted, fontSize: 10 }}>{tx.teknisi_name || ""} · {(tx.order_id || tx.report_id || "").slice(0, 14)}</div>
                                      </div>
                                      <div style={{ color: cs.muted, fontSize: 10 }}>{(tx.job_date || tx.created_at || "").slice(0, 10)}</div>
                                      <div style={{ fontWeight: 700, color: isAdj ? cs.green : isUsage ? cs.red : cs.green, textAlign: "right" }}>
                                        {tx.qty > 0 ? "+" : ""}{parseFloat(Math.abs(tx.qty).toFixed(1))} {item.unit}
                                        {isAdj && <div style={{ fontSize: 9, color: cs.green }}>KOREKSI</div>}
                                      </div>
                                      {tx.qty_actual != null && (
                                        <div style={{ fontSize: 10, color: cs.green }}>✓ {parseFloat(Math.abs(tx.qty_actual).toFixed(1))} aktual</div>
                                      )}
                                    </div>
                                  );
                                })}
                                {unitTxs.length > 20 && (
                                  <div style={{ fontSize: 10, color: cs.muted, textAlign: "center", padding: 4 }}>
                                    +{unitTxs.length - 20} transaksi lainnya — lihat di tabel bawah
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    )}

    {/* ── Banner freon belum ditimbang ── */}
    {isOwnerAdmin && (() => {
      const unweighed = invTxData.filter(tx => tx.qty < 0 && isFreonTx(tx) && tx.qty_actual == null);
      if (unweighed.length === 0) return null;
      return (
        <div style={{ background: cs.yellow + "12", border: "2px solid " + cs.yellow + "44", borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20 }}>⚖️</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13, color: cs.yellow }}>
                {unweighed.length} transaksi freon belum dikonfirmasi timbang
              </div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 1 }}>
                Stok sudah terpotong sementara pakai angka laporan teknisi. Klik ikon ⚖️ di baris untuk input aktual.
              </div>
            </div>
          </div>
          <button onClick={() => { setMatTrackFilter("Freon"); }}
            style={{ background: cs.yellow + "22", border: "1px solid " + cs.yellow + "44", color: cs.yellow, borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Lihat Freon →
          </button>
        </div>
      );
    })()}

    {/* Filter pills */}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {[["Semua", "📋"], ["Freon", "❄️"], ["Pipa", "🔧"], ["Kabel", "⚡"]].map(([f, ic]) => (
        <button key={f} onClick={() => setMatTrackFilter(f)}
          style={{ padding: "5px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer", border: "1px solid " + (matTrackFilter === f ? cs.accent : cs.border), background: matTrackFilter === f ? cs.accent + "22" : cs.surface, color: matTrackFilter === f ? cs.accent : cs.muted, fontWeight: matTrackFilter === f ? 700 : 400 }}>
          {ic} {f}
        </button>
      ))}
      <span style={{ width: 1, height: 16, background: cs.border }} />
      <input type="date" value={matTrackDateFrom} onChange={e => setMatTrackDateFrom(e.target.value)}
        style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "4px 8px", fontSize: 12, color: cs.text, colorScheme: "dark" }} />
      <span style={{ color: cs.muted }}>–</span>
      <input type="date" value={matTrackDateTo} onChange={e => setMatTrackDateTo(e.target.value)}
        style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "4px 8px", fontSize: 12, color: cs.text, colorScheme: "dark" }} />
      {(matTrackDateFrom || matTrackDateTo) && (
        <button onClick={() => { setMatTrackDateFrom(""); setMatTrackDateTo(""); }}
          style={{ fontSize: 11, padding: "3px 10px", borderRadius: 99, background: cs.red + "22", border: "1px solid " + cs.red + "44", color: cs.red, cursor: "pointer" }}>✕ Reset</button>
      )}
    </div>

    {/* Search */}
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: cs.muted }}>🔍</span>
      <input value={matTrackSearch} onChange={e => setMatTrackSearch(e.target.value)}
        placeholder="Cari item, customer, teknisi, job ID..."
        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px 10px 36px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
    </div>

    {/* Tabel pemakaian */}
    {txFiltered.length === 0 ? (
      <div style={{ background: cs.card, borderRadius: 14, padding: 32, textAlign: "center", color: cs.muted }}>
        Belum ada data pemakaian{matTrackFilter !== "Semua" ? " untuk filter ini" : ""}
      </div>
    ) : (
      <div data-riwayat="1" style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid " + cs.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>📤 Riwayat Pemakaian</div>
          <div style={{ fontSize: 11, color: cs.muted }}>{txFiltered.length} transaksi</div>
        </div>
        <div style={{ padding: "8px 16px", borderBottom: "1px solid " + cs.border, display: "grid", gridTemplateColumns: "1fr 1fr 100px 1fr 100px", gap: 8, fontSize: 11, fontWeight: 700, color: cs.muted }}>
          <div>Item</div><div>Customer · Job</div><div>Teknisi</div>
          <div style={{ textAlign: "right" }}>Qty</div><div style={{ textAlign: "right" }}>Tanggal</div>
        </div>
        {txFiltered.slice(0, 100).map((tx, i) => {
          const isFreon = isFreonTx(tx);
          const unweighed = isFreon && tx.qty < 0 && tx.qty_actual == null;
          const isTimbangOpen = timbangId === tx.id;
          const isAdj = tx.type === "adjustment";
          const txUnit = inventoryData.find(item => item.code === tx.inventory_code)?.unit || (isFreon ? "kg" : "pcs");
          return (
            <div key={tx.id || i} style={{ borderBottom: "1px solid " + cs.border + "55" }}>
              <div
                style={{ padding: "9px 16px", display: "grid", gridTemplateColumns: "1fr 1fr 100px 1fr 100px", gap: 8, background: unweighed ? cs.yellow + "08" : isAdj ? cs.green + "06" : i % 2 === 0 ? "transparent" : cs.surface, fontSize: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, color: cs.text }}>{tx.inventory_name || "—"}</div>
                  <div style={{ fontSize: 10, color: cs.muted }}>{tx.inventory_code}</div>
                  {tx.unit_label && <div style={{ fontSize: 10, color: cs.accent, marginTop: 1 }}>📦 {tx.unit_label}</div>}
                  {isAdj && <div style={{ fontSize: 9, color: cs.green, fontWeight: 700, marginTop: 1 }}>KOREKSI TIMBANG</div>}
                </div>
                <div>
                  <div style={{ color: cs.text }}>{tx.customer_name || "—"}</div>
                  <div style={{ fontSize: 10, color: cs.muted }}>{tx.order_id || tx.report_id || "—"}</div>
                </div>
                <div style={{ color: cs.accent, fontSize: 11 }}>{tx.teknisi_name || "—"}</div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, color: tx.qty < 0 ? cs.red : cs.green }}>
                    {tx.qty < 0 ? "-" : "+"}{parseFloat(Math.abs(tx.qty).toFixed(1))} {txUnit}
                  </div>
                  {isFreon && tx.qty_actual != null && (
                    <div style={{ fontSize: 10, color: cs.green, fontWeight: 600 }}>
                      ✓ {parseFloat(Math.abs(tx.qty_actual).toFixed(1))} {txUnit} aktual
                    </div>
                  )}
                  {unweighed && isOwnerAdmin && (
                    <button onClick={() => { setTimbangId(isTimbangOpen ? null : tx.id); setTimbangVal(String(Math.abs(tx.qty))); }}
                      title="Input qty aktual setelah timbang"
                      style={{ marginTop: 3, background: cs.yellow + "22", border: "1px solid " + cs.yellow + "55", color: cs.yellow, borderRadius: 5, padding: "2px 7px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>
                      ⚖️ Timbang
                    </button>
                  )}
                </div>
                <div style={{ textAlign: "right", color: cs.muted, fontSize: 11 }}>
                  {(tx.job_date || tx.created_at || "").slice(0, 10)}
                </div>
              </div>
              {/* Inline timbang form */}
              {isTimbangOpen && (
                <div style={{ padding: "10px 16px 12px", background: cs.yellow + "10", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: cs.muted }}>Laporan teknisi: <b style={{ color: cs.text }}>{Math.abs(tx.qty)} kg</b> →</span>
                  <span style={{ fontSize: 12, color: cs.muted }}>Aktual timbang (kg):</span>
                  <input type="number" min="0" step="0.1" value={timbangVal} onChange={e => setTimbangVal(e.target.value)} autoFocus
                    style={{ width: 80, background: cs.card, border: "1px solid " + cs.yellow + "88", borderRadius: 7, padding: "5px 10px", color: cs.text, fontSize: 13, outline: "none" }} />
                  <button onClick={() => saveActualQty(tx)} disabled={timbangSaving}
                    style={{ background: cs.yellow, border: "none", color: "#0a0f1e", padding: "6px 16px", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 12, opacity: timbangSaving ? 0.7 : 1 }}>
                    {timbangSaving ? "⏳" : "✓ Simpan"}
                  </button>
                  <button onClick={() => setTimbangId(null)}
                    style={{ background: "transparent", border: "1px solid " + cs.border, color: cs.muted, padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 12 }}>
                    Batal
                  </button>
                  {parseFloat(timbangVal) !== Math.abs(tx.qty) && timbangVal && (
                    <span style={{ fontSize: 11, color: parseFloat(timbangVal) < Math.abs(tx.qty) ? cs.green : cs.red }}>
                      {parseFloat(timbangVal) < Math.abs(tx.qty)
                        ? `↑ Stok +${(Math.abs(tx.qty) - parseFloat(timbangVal)).toFixed(1)} kg (lebih hemat)`
                        : `↓ Stok -${(parseFloat(timbangVal) - Math.abs(tx.qty)).toFixed(1)} kg (lebih boros)`}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {txFiltered.length > 100 && (
          <div style={{ padding: "8px 16px", textAlign: "center", color: cs.muted, fontSize: 11 }}>
            Menampilkan 100 dari {txFiltered.length} transaksi
          </div>
        )}
      </div>
    )}

    {/* ── Riwayat Restock (masuk) ── */}
    {restockLog.length > 0 && (
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "10px 16px", borderBottom: "1px solid " + cs.border, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>📥 Riwayat Restock / Masuk</div>
          <div style={{ fontSize: 11, color: cs.muted }}>{restockLog.length} entri</div>
        </div>
        <div style={{ padding: "8px 16px", borderBottom: "1px solid " + cs.border, display: "grid", gridTemplateColumns: "1fr 1fr 80px 100px", gap: 8, fontSize: 11, fontWeight: 700, color: cs.muted }}>
          <div>Item</div><div>Keterangan</div><div style={{ textAlign: "right" }}>Qty</div><div style={{ textAlign: "right" }}>Tanggal</div>
        </div>
        {restockLog.slice(0, 30).map((tx, i) => (
          <div key={tx.id || i}
            style={{ padding: "9px 16px", borderBottom: "1px solid " + cs.border + "55", display: "grid", gridTemplateColumns: "1fr 1fr 80px 100px", gap: 8, background: i % 2 === 0 ? "transparent" : cs.surface, fontSize: 12 }}>
            <div>
              <div style={{ fontWeight: 600, color: cs.text }}>{tx.inventory_name || "—"}</div>
              <div style={{ fontSize: 10, color: cs.muted }}>{tx.inventory_code}</div>
            </div>
            <div style={{ color: cs.muted, fontSize: 11 }}>{tx.notes || tx.type || "—"}</div>
            <div style={{ textAlign: "right", fontWeight: 700, color: cs.green }}>+{parseFloat(Math.abs(tx.qty).toFixed(1))}</div>
            <div style={{ textAlign: "right", color: cs.muted, fontSize: 11 }}>{(tx.created_at || "").slice(0, 10)}</div>
          </div>
        ))}
      </div>
    )}
  </div>
);
}

export default memo(MatTrackView);
