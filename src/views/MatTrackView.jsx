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
const [showArchived, setShowArchived] = useState(false); // tampilkan unit archived
const [archiveReason, setArchiveReason] = useState(""); // alasan archive (optional)
const [confirmArchiveId, setConfirmArchiveId] = useState(null); // unit.id yang menunggu konfirmasi archive

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

const archiveUnit = async (unitId, reason) => {
  const { error } = await supabase.from("inventory_units").update({
    archived: true,
    archived_at: new Date().toISOString(),
    archived_reason: reason || null,
    is_active: false,
  }).eq("id", unitId);
  if (!error) {
    setInvUnitsData(prev => prev.map(u => u.id === unitId
      ? { ...u, archived: true, archived_at: new Date().toISOString(), archived_reason: reason || null, is_active: false }
      : u
    ));
    showNotif("🗄️ Unit diarsipkan — data tetap tersimpan");
  } else {
    showNotif("❌ Gagal arsipkan: " + error.message);
  }
  setConfirmArchiveId(null);
  setArchiveReason("");
};

const unarchiveUnit = async (unitId) => {
  const { error } = await supabase.from("inventory_units").update({
    archived: false,
    archived_at: null,
    archived_reason: null,
    is_active: false,
  }).eq("id", unitId);
  if (!error) {
    setInvUnitsData(prev => prev.map(u => u.id === unitId
      ? { ...u, archived: false, archived_at: null, archived_reason: null }
      : u
    ));
    showNotif("✅ Unit dikembalikan dari arsip");
  } else {
    showNotif("❌ Gagal: " + error.message);
  }
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
        <div style={{ fontSize: 12, color: cs.muted }}>Stok per tabung/roll · Auto-deduct dari laporan teknisi</div>
      </div>
      <button onClick={() => setModalStok(true)}
        style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#fff", padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
        + Material Baru
      </button>
    </div>

    {/* ── Daftar Material — satu card per item ── */}
    {TRACK_ITEMS.map(item => {
      const units = invUnitsData.filter(u => u.inventory_code === item.code);
      const activeUnits = units.filter(u => !u.archived);
      const archivedUnits = units.filter(u => u.archived);
      const totalStok = activeUnits.reduce((s, u) => s + (u.stock || 0), 0);
      const totalKap  = activeUnits.reduce((s, u) => s + (u.capacity || 0), 0);
      const usedAll   = invTxData.filter(tx => tx.qty < 0 && tx.inventory_code === item.code).reduce((s,tx) => s + Math.abs(tx.qty), 0);
      const isAddingHere = addUnitFor === item.code;
      const itemCol = item.status === "OUT" ? "#ef4444" : item.status === "CRITICAL" ? "#f59e0b" : item.status === "WARNING" ? "#f97316" : cs.green;
      const statusLabel = item.status === "OUT" ? "Habis" : item.status === "CRITICAL" ? "Kritis" : item.status === "WARNING" ? "Menipis" : "Aman";
      const pctTotal = totalKap > 0 ? Math.min(100, Math.round(totalStok / totalKap * 100)) : 0;

      return (
        <div key={item.code} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 16, overflow: "hidden" }}>

          {/* ── Header item ── */}
          <div style={{ padding: "14px 18px", borderBottom: "1px solid " + cs.border, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            {/* Nama + kode */}
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>{item.name}</span>
                <span style={{ fontSize: 10, color: cs.muted, fontFamily: "monospace", background: cs.surface, padding: "1px 6px", borderRadius: 4 }}>{item.code}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: itemCol + "22", color: itemCol }}>{statusLabel}</span>
              </div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 3 }}>
                {activeUnits.length} unit aktif · Terpakai total: <b style={{ color: cs.text }}>{usedAll.toFixed(1)} {item.unit}</b>
              </div>
            </div>
            {/* Stok total + bar */}
            <div style={{ minWidth: 180 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: itemCol }}>{totalStok.toFixed(1)} <span style={{ fontSize: 12, fontWeight: 400, color: cs.muted }}>{item.unit}</span></span>
                <span style={{ color: cs.muted, fontSize: 11 }}>/ {totalKap.toFixed(0)} {item.unit} kap.</span>
              </div>
              <div style={{ height: 8, background: cs.surface, borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: pctTotal + "%", background: itemCol, borderRadius: 99, transition: "width .4s" }} />
              </div>
            </div>
            {/* Tombol + tambah */}
            {isOwnerAdmin && (
              <button onClick={() => { setAddUnitFor(isAddingHere ? null : item.code); setAddUnitForm({ label: "", capacity: "", minVisible: "" }); }}
                style={{ fontSize: 12, padding: "6px 14px", borderRadius: 8, background: isAddingHere ? cs.red + "22" : cs.accent + "22", border: "1px solid " + (isAddingHere ? cs.red : cs.accent) + "55", color: isAddingHere ? cs.red : cs.accent, cursor: "pointer", fontWeight: 700, whiteSpace: "nowrap" }}>
                {isAddingHere ? "✕ Batal" : "+ Tambah Unit"}
              </button>
            )}
          </div>

          {/* ── Inline form tambah unit baru ── */}
          {isAddingHere && (
            <div style={{ padding: "14px 18px", borderBottom: "1px solid " + cs.accent + "33", background: cs.accent + "06" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent, marginBottom: 10 }}>➕ Tambah Unit Fisik Baru</div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, alignItems: "flex-end" }}>
                <div>
                  <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Label Unit</div>
                  <input type="text" placeholder="cth: Tabung R32-A" value={addUnitForm.label}
                    onChange={e => setAddUnitForm(f => ({ ...f, label: e.target.value }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Kapasitas ({item.unit})</div>
                  <input type="number" min="0" step="0.1" placeholder="13.6" value={addUnitForm.capacity}
                    onChange={e => setAddUnitForm(f => ({ ...f, capacity: e.target.value }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Min Tampil</div>
                  <input type="number" min="0" step="0.1" placeholder="3" value={addUnitForm.minVisible}
                    onChange={e => setAddUnitForm(f => ({ ...f, minVisible: e.target.value }))}
                    style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
                </div>
                <button onClick={() => addUnit(item.code)}
                  style={{ background: cs.accent, border: "none", color: "#0a0f1e", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12, whiteSpace: "nowrap" }}>
                  ✓ Simpan
                </button>
              </div>
              <div style={{ fontSize: 10, color: cs.muted, marginTop: 6 }}>Min Tampil: stok minimum agar unit masih terlihat oleh teknisi saat input laporan</div>
            </div>
          )}

          {/* ── Grid unit aktif ── */}
          <div style={{ padding: "12px 18px", display: "grid", gap: 8 }}>
            {activeUnits.length === 0 ? (
              <div style={{ fontSize: 12, color: cs.muted, textAlign: "center", padding: "16px 0" }}>
                Belum ada unit fisik. {isOwnerAdmin ? "Klik \"+ Tambah Unit\" untuk menambah." : ""}
              </div>
            ) : activeUnits.map(unit => {
              const pct = unit.capacity > 0 ? Math.min(100, Math.round(unit.stock / unit.capacity * 100)) : 0;
              const col = !unit.is_active ? cs.muted
                : unit.stock <= 0 ? "#ef4444"
                  : unit.stock < (unit.min_visible || 3) ? "#f97316"
                    : unit.stock < (unit.capacity || 99) / 3 ? "#f59e0b"
                      : cs.green;
              const hiddenFromTek = unit.stock < (unit.min_visible || 3);
              const isEditingThis = editUnitId === unit.id;
              const isConfirmingArchive = confirmArchiveId === unit.id;
              return (
                <div key={unit.id} style={{ background: cs.surface, borderRadius: 10, border: "1px solid " + (isEditingThis ? cs.yellow : col) + "33", opacity: unit.is_active ? 1 : 0.55 }}>
                  {/* Baris utama unit */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px" }}>
                    {/* Nama + tag */}
                    <div style={{ minWidth: 130 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{unit.unit_label}</div>
                      <div style={{ fontSize: 10, color: hiddenFromTek && unit.is_active ? "#f97316" : cs.muted, marginTop: 1 }}>
                        {!unit.is_active ? "⏸ Nonaktif" : hiddenFromTek ? "Tersembunyi teknisi" : "Aktif"}
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: cs.muted, marginBottom: 5 }}>
                        <span style={{ fontWeight: 700, color: col, fontSize: 13 }}>{parseFloat((unit.stock || 0).toFixed(1))} {item.unit}</span>
                        <span>{unit.capacity || "?"} {item.unit} kapasitas · {pct}%</span>
                      </div>
                      <div style={{ height: 8, background: cs.card, borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: pct + "%", background: col, borderRadius: 99, transition: "width .3s" }} />
                      </div>
                    </div>
                    {/* Tombol aksi */}
                    {isOwnerAdmin && (
                      <div style={{ display: "flex", gap: 5, alignItems: "center", flexShrink: 0 }}>
                        <button onClick={() => setHistoryUnitId(historyUnitId === unit.id ? null : unit.id)}
                          style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: historyUnitId === unit.id ? cs.accent + "33" : cs.accent + "15", border: "1px solid " + cs.accent + "44", color: cs.accent, cursor: "pointer", fontWeight: historyUnitId === unit.id ? 700 : 400 }}>
                          {historyUnitId === unit.id ? "✕" : "Riwayat"}
                        </button>
                        <button onClick={() => { setEditUnitId(isEditingThis ? null : unit.id); setEditUnitVal(String(unit.stock)); }}
                          style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: isEditingThis ? cs.red + "22" : cs.yellow + "18", border: "1px solid " + (isEditingThis ? cs.red : cs.yellow) + "44", color: isEditingThis ? cs.red : cs.yellow, cursor: "pointer" }}>
                          {isEditingThis ? "✕" : "Ubah"}
                        </button>
                        <button onClick={() => toggleUnit(unit.id, !unit.is_active)}
                          style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: unit.is_active ? cs.red + "18" : cs.green + "18", border: "1px solid " + (unit.is_active ? cs.red : cs.green) + "44", color: unit.is_active ? cs.red : cs.green, cursor: "pointer" }}>
                          {unit.is_active ? "Nonaktif" : "Aktifkan"}
                        </button>
                        <button onClick={() => { setConfirmArchiveId(isConfirmingArchive ? null : unit.id); setArchiveReason(""); }}
                          style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: isConfirmingArchive ? cs.red + "33" : "#64748b18", border: "1px solid " + (isConfirmingArchive ? cs.red : "#64748b") + "44", color: isConfirmingArchive ? cs.red : "#94a3b8", cursor: "pointer" }}
                          title="Arsipkan — unit dibuang fisik, data tetap tersimpan">
                          Arsip
                        </button>
                      </div>
                    )}
                  </div>
                  {/* ── Konfirmasi archive ── */}
                  {isConfirmingArchive && (
                        <div style={{ padding: "10px 14px", background: cs.red + "08", borderTop: "1px solid " + cs.red + "22" }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: cs.red, marginBottom: 6 }}>Arsipkan {unit.unit_label}?</div>
                          <div style={{ fontSize: 11, color: cs.muted, marginBottom: 8 }}>Unit dibuang fisik — data pemakaian tetap tersimpan.</div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                            <input type="text" placeholder="Alasan (opsional)" value={archiveReason}
                              onChange={e => setArchiveReason(e.target.value)}
                              style={{ flex: 1, minWidth: 160, background: cs.card, border: "1px solid " + cs.border, borderRadius: 7, padding: "6px 10px", color: cs.text, fontSize: 11, outline: "none" }} />
                            <button onClick={() => archiveUnit(unit.id, archiveReason)}
                              style={{ background: cs.red, border: "none", color: "#fff", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 11 }}>
                              Ya, Arsipkan
                            </button>
                            <button onClick={() => { setConfirmArchiveId(null); setArchiveReason(""); }}
                              style={{ background: "none", border: "1px solid " + cs.border, color: cs.muted, padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>
                              Batal
                            </button>
                          </div>
                        </div>
                      )}
                      {/* ── Inline edit stok ── */}
                      {isEditingThis && (
                        <div style={{ padding: "10px 14px", background: cs.yellow + "08", borderTop: "1px solid " + cs.yellow + "22", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 12, color: cs.muted }}>Stok baru ({item.unit}):</span>
                          <input type="number" min="0" step="0.1" value={editUnitVal} onChange={e => setEditUnitVal(e.target.value)} autoFocus
                            style={{ width: 80, background: cs.card, border: "1px solid " + cs.yellow + "66", borderRadius: 7, padding: "6px 10px", color: cs.text, fontSize: 13, outline: "none" }} />
                          <button onClick={() => { const ns = parseFloat(editUnitVal); if (!isNaN(ns) && ns >= 0) updateUnitStock(unit.id, ns); else showNotif("❌ Nilai tidak valid"); }}
                            style={{ background: cs.yellow, border: "none", color: "#0a0f1e", padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>✓ Simpan</button>
                          <span style={{ fontSize: 11, color: cs.muted }}>Saat ini: {parseFloat((unit.stock || 0).toFixed(1))} {item.unit}</span>
                        </div>
                      )}
                      {/* ── Riwayat pemakaian unit ── */}
                      {historyUnitId === unit.id && (() => {
                        const unitTxs = invTxData
                          .filter(tx => tx.unit_id === unit.id || tx.unit_label === unit.unit_label)
                          .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
                        return (
                          <div style={{ borderTop: "1px solid " + cs.accent + "22", padding: "12px 14px", background: cs.surface }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: cs.accent, marginBottom: 8 }}>Riwayat — {unit.unit_label} ({unitTxs.length} transaksi)</div>
                            {unitTxs.length === 0 ? (
                              <div style={{ fontSize: 11, color: cs.muted, fontStyle: "italic" }}>Belum ada pemakaian tercatat.</div>
                            ) : (
                              <div style={{ display: "grid", gap: 4 }}>
                                {unitTxs.slice(0, 20).map((tx, ti) => {
                                  const isAdj = tx.type === "adjustment";
                                  const isUsage = tx.qty < 0 && !isAdj;
                                  return (
                                    <div key={tx.id || ti} style={{ display: "grid", gridTemplateColumns: "1fr 90px auto auto", gap: 8, alignItems: "center", fontSize: 11, padding: "6px 8px", background: isAdj ? cs.green + "0a" : ti % 2 === 0 ? cs.card : "transparent", borderRadius: 6 }}>
                                      <div>
                                        <div style={{ color: cs.text, fontWeight: 500 }}>{tx.customer_name || "—"}</div>
                                        <div style={{ color: cs.muted, fontSize: 10 }}>{tx.teknisi_name || ""} · {(tx.order_id || tx.report_id || "").slice(0, 14)}</div>
                                      </div>
                                      <div style={{ color: cs.muted, fontSize: 10 }}>{(tx.job_date || tx.created_at || "").slice(0, 10)}</div>
                                      <div style={{ fontWeight: 700, color: isAdj ? cs.green : isUsage ? cs.red : cs.green, textAlign: "right" }}>
                                        {tx.qty > 0 ? "+" : ""}{parseFloat(Math.abs(tx.qty).toFixed(1))} {item.unit}
                                        {isAdj && <div style={{ fontSize: 9, color: cs.green }}>KOREKSI</div>}
                                      </div>
                                      <div style={{ fontSize: 10, color: cs.green }}>{tx.qty_actual != null ? "✓ " + parseFloat(Math.abs(tx.qty_actual).toFixed(1)) + " aktual" : ""}</div>
                                    </div>
                                  );
                                })}
                                {unitTxs.length > 20 && <div style={{ fontSize: 10, color: cs.muted, textAlign: "center", padding: 4 }}>+{unitTxs.length - 20} lainnya</div>}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
          </div>

          {/* ── Unit Archived ── */}
          {archivedUnits.length > 0 && isOwnerAdmin && (
            <div style={{ borderTop: "1px solid " + cs.border, padding: "8px 18px" }}>
              <button onClick={() => setShowArchived(v => !v)}
                style={{ fontSize: 11, color: cs.muted, background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                {showArchived ? "▲" : "▼"} {archivedUnits.length} unit diarsipkan
              </button>
              {showArchived && (
                <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                  {archivedUnits.map(unit => {
                    const unitTxs = invTxData.filter(tx => tx.unit_id === unit.id || tx.unit_label === unit.unit_label).sort((a,b) => (b.created_at||"").localeCompare(a.created_at||""));
                    const isShowingHistory = historyUnitId === unit.id;
                    return (
                      <div key={unit.id} style={{ background: cs.surface, borderRadius: 8, border: "1px solid #64748b22", opacity: 0.7 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: cs.muted }}>🗄 {unit.unit_label}</div>
                            <div style={{ fontSize: 10, color: cs.muted }}>Diarsipkan {unit.archived_at ? new Date(unit.archived_at).toLocaleDateString("id-ID") : ""}{unit.archived_reason ? " · " + unit.archived_reason : ""}</div>
                          </div>
                          <span style={{ fontSize: 11, color: cs.muted }}>{parseFloat((unit.stock||0).toFixed(1))} {item.unit}</span>
                          <button onClick={() => setHistoryUnitId(isShowingHistory ? null : unit.id)}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: cs.accent + "15", border: "1px solid " + cs.accent + "33", color: cs.accent, cursor: "pointer" }}>
                            {isShowingHistory ? "✕" : "Riwayat" + (unitTxs.length > 0 ? " (" + unitTxs.length + ")" : "")}
                          </button>
                          <button onClick={() => unarchiveUnit(unit.id)}
                            style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: cs.green + "15", border: "1px solid " + cs.green + "33", color: cs.green, cursor: "pointer" }}>
                            Pulihkan
                          </button>
                        </div>
                        {isShowingHistory && (
                          <div style={{ borderTop: "1px solid #64748b22", padding: "10px 14px", background: cs.card, borderRadius: "0 0 8px 8px" }}>
                            {unitTxs.length === 0 ? <div style={{ fontSize: 11, color: cs.muted }}>Belum ada pemakaian.</div> : (
                              <div style={{ display: "grid", gap: 4 }}>
                                {unitTxs.slice(0,15).map((tx,ti) => {
                                  const isAdj = tx.type === "adjustment";
                                  return (
                                    <div key={tx.id||ti} style={{ display: "grid", gridTemplateColumns: "1fr 90px auto", gap: 8, fontSize: 11, padding: "4px 0" }}>
                                      <div style={{ color: cs.text }}>{tx.customer_name || "—"} <span style={{ color: cs.muted, fontSize: 10 }}>· {tx.teknisi_name || ""}</span></div>
                                      <div style={{ color: cs.muted, fontSize: 10 }}>{(tx.job_date||tx.created_at||"").slice(0,10)}</div>
                                      <div style={{ fontWeight: 700, color: isAdj ? cs.green : tx.qty < 0 ? cs.red : cs.green, textAlign: "right" }}>{tx.qty > 0 ? "+" : ""}{parseFloat(Math.abs(tx.qty).toFixed(1))} {item.unit}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      );
    })}

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
