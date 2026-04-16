import { cs } from "../theme/cs.js";
import { displayStock } from "../lib/inventory.js";

export default function MatTrackView({ inventoryData, invUnitsData, setInvUnitsData, invTxData, matTrackFilter, setMatTrackFilter, matTrackSearch, setMatTrackSearch, matTrackDateFrom, setMatTrackDateFrom, matTrackDateTo, setMatTrackDateTo, setModalStok, supabase, fetchInventoryUnits, showNotif }) {
// Item prioritas yang perlu ditrack (freon, pipa, kabel)
const TRACK_ITEMS = inventoryData.filter(item =>
  item.material_type === "freon" ||
  item.material_type === "pipa" ||
  item.material_type === "kabel"
);

// Helper: reload units dari DB
const reloadUnits = async () => {
  const { data } = await fetchInventoryUnits(supabase);
  if (data) setInvUnitsData(data);
};

// Helper: tambah unit baru
const addUnit = async (invCode, label, capacity, minVisible) => {
  const { error } = await supabase.from("inventory_units").insert({
    inventory_code: invCode,
    unit_label: label,
    stock: capacity,   // stok awal = kapasitas penuh
    capacity: capacity,
    min_visible: minVisible,
    is_active: true,
  });
  if (!error) { await reloadUnits(); showNotif("✅ Unit " + label + " ditambahkan"); }
  else showNotif("❌ " + error.message);
};

// Helper: update stok unit
const updateUnitStock = async (unitId, newStock) => {
  const { error } = await supabase.from("inventory_units")
    .update({ stock: newStock, updated_at: new Date().toISOString() })
    .eq("id", unitId);
  if (!error) {
    setInvUnitsData(prev => prev.map(u => u.id === unitId ? { ...u, stock: newStock } : u));
    showNotif("✅ Stok unit diupdate");
  }
};

// Helper: toggle aktif/nonaktif unit
const toggleUnit = async (unitId, isActive) => {
  await supabase.from("inventory_units").update({ is_active: isActive }).eq("id", unitId);
  setInvUnitsData(prev => prev.map(u => u.id === unitId ? { ...u, is_active: isActive } : u));
};

// Filter inventory_transactions
let txFiltered = [...invTxData].filter(tx => tx.qty < 0); // hanya keluar (usage)
if (matTrackFilter !== "Semua") {
  if (matTrackFilter === "Freon") txFiltered = txFiltered.filter(tx =>
    ["R22", "R32", "R410"].some(f => (tx.inventory_name || "").toUpperCase().includes(f.replace("-", "")))
  );
  else if (matTrackFilter === "Pipa") txFiltered = txFiltered.filter(tx =>
    (tx.inventory_name || "").toLowerCase().includes("pipa")
  );
  else if (matTrackFilter === "Kabel") txFiltered = txFiltered.filter(tx =>
    (tx.inventory_name || "").toLowerCase().includes("kabel")
  );
  else txFiltered = txFiltered.filter(tx => tx.inventory_code === matTrackFilter);
}
if (matTrackSearch.trim()) {
  const q = matTrackSearch.toLowerCase();
  txFiltered = txFiltered.filter(tx =>
    (tx.inventory_name || "").toLowerCase().includes(q) ||
    (tx.customer_name || "").toLowerCase().includes(q) ||
    (tx.teknisi_name || "").toLowerCase().includes(q) ||
    (tx.order_id || "").toLowerCase().includes(q)
  );
}
if (matTrackDateFrom) txFiltered = txFiltered.filter(tx => (tx.job_date || tx.created_at?.slice(0, 10) || "") >= matTrackDateFrom);
if (matTrackDateTo) txFiltered = txFiltered.filter(tx => (tx.job_date || tx.created_at?.slice(0, 10) || "") <= matTrackDateTo);
txFiltered.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

// Summary per item (penggunaan total)
const usageByItem = {};
invTxData.filter(tx => tx.qty < 0).forEach(tx => {
  const k = tx.inventory_code || tx.inventory_name;
  if (!usageByItem[k]) usageByItem[k] = { name: tx.inventory_name, code: tx.inventory_code, totalUsed: 0, txCount: 0 };
  usageByItem[k].totalUsed += Math.abs(tx.qty);
  usageByItem[k].txCount++;
});

return (
  <div style={{ display: "grid", gap: 16 }}>
    {/* Header */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 18, color: cs.text }}>🧮 Stok & Tracking Material</div>
        <div style={{ fontSize: 12, color: cs.muted }}>Pemakaian material per job · Auto-deduct dari laporan teknisi</div>
      </div>
      <button onClick={() => setModalStok(true)}
        style={{
          background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#fff",
          padding: "9px 16px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13
        }}>
        + Stok Material Baru
      </button>
    </div>

    {/* Kartu stok item prioritas */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10 }}>
      {TRACK_ITEMS.map(item => {
        const tot = invTxData.filter(tx => tx.qty < 0 && tx.inventory_code === item.code)
          .reduce((s, tx) => s + Math.abs(tx.qty), 0);
        const col = item.status === "OUT" ? "#ef4444" : item.status === "CRITICAL" ? cs.yellow : item.status === "WARNING" ? "#f97316" : cs.green;
        return (
          <div key={item.id}
            onClick={() => { setMatTrackFilter(item.code); }}
            style={{
              background: cs.card, border: "1px solid " + (matTrackFilter === item.code ? cs.accent : col) + "44",
              borderRadius: 10, padding: "10px 12px", cursor: "pointer",
              borderLeft: "3px solid " + col
            }}>
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
              <div style={{
                height: "100%", background: col, borderRadius: 99,
                width: item.min_alert > 0 ? Math.min(100, Math.round(item.stock / item.min_alert * 50)) + "%" : "30%"
              }} />
            </div>
          </div>
        );
      })}
    </div>

    {/* ── Unit Fisik per Item (Tabung / Roll) — Owner/Admin only ── */}
    <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: cs.text }}>📦 Unit Fisik (Tabung & Roll)</div>
          <div style={{ fontSize: 11, color: cs.muted }}>Stok per unit · Teknisi lihat unit sisa &ge; batas minimum</div>
        </div>
      </div>
      {TRACK_ITEMS.map(item => {
        const units = invUnitsData.filter(u => u.inventory_code === item.code);
        const totalStok = units.reduce((s, u) => s + (u.stock || 0), 0);
        return (
          <div key={item.code} style={{ marginBottom: 12, background: cs.surface, borderRadius: 10, padding: "10px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>{item.name}</span>
                <span style={{ fontSize: 11, color: cs.muted, marginLeft: 8 }}>[{item.code}]</span>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: cs.green }}>{totalStok} {item.unit} total</span>
                <button onClick={() => {
                  const label = prompt("Label unit baru (contoh: Roll 1PK-B):");
                  if (!label) return;
                  const cap = parseFloat(prompt("Kapasitas (meter/kg, contoh: 30):") || "0");
                  const minV = parseFloat(prompt("Batas minimum untuk teknisi (contoh: 3):") || "3");
                  if (cap > 0) addUnit(item.code, label, cap, minV);
                }}
                  style={{
                    fontSize: 11, padding: "3px 10px", borderRadius: 7, background: cs.accent + "22",
                    border: "1px solid " + cs.accent + "44", color: cs.accent, cursor: "pointer", fontWeight: 600
                  }}>
                  + Tambah Unit
                </button>
              </div>
            </div>
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
                return (
                  <div key={unit.id} style={{
                    display: "flex", alignItems: "center", gap: 10,
                    opacity: unit.is_active ? 1 : 0.5,
                    background: cs.card, borderRadius: 8, padding: "7px 10px",
                    border: "1px solid " + col + "33"
                  }}>
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
                        <span>{unit.stock} {item.unit} sisa</span>
                        <span>{unit.capacity || "?"} {item.unit} kapasitas</span>
                      </div>
                      <div style={{ height: 6, background: cs.border, borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: pct + "%", background: col, borderRadius: 99, transition: "width .3s" }} />
                      </div>
                    </div>
                    {/* Edit stok */}
                    <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                      <button onClick={() => {
                        const ns = parseFloat(prompt("Stok baru untuk " + unit.unit_label + " (" + item.unit + "):", unit.stock));
                        if (!isNaN(ns) && ns >= 0) updateUnitStock(unit.id, ns);
                      }}
                        style={{
                          fontSize: 11, padding: "3px 8px", borderRadius: 6, background: cs.yellow + "22",
                          border: "1px solid " + cs.yellow + "44", color: cs.yellow, cursor: "pointer"
                        }}>
                        ✏️ Ubah
                      </button>
                      <button onClick={() => toggleUnit(unit.id, !unit.is_active)}
                        style={{
                          fontSize: 11, padding: "3px 8px", borderRadius: 6,
                          background: unit.is_active ? cs.red + "22" : cs.green + "22",
                          border: "1px solid " + (unit.is_active ? cs.red : cs.green) + "44",
                          color: unit.is_active ? cs.red : cs.green, cursor: "pointer"
                        }}>
                        {unit.is_active ? "⏸️" : "▶️"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>

    {/* Filter pills */}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {[["Semua", "📋"], ["Freon", "❄️"], ["Pipa", "🔧"], ["Kabel", "⚡"]].map(([f, ic]) => (
        <button key={f} onClick={() => { setMatTrackFilter(f); }}
          style={{
            padding: "5px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
            border: "1px solid " + (matTrackFilter === f ? cs.accent : cs.border),
            background: matTrackFilter === f ? cs.accent + "22" : cs.surface,
            color: matTrackFilter === f ? cs.accent : cs.muted, fontWeight: matTrackFilter === f ? 700 : 400
          }}>
          {ic} {f}
        </button>
      ))}
      <span style={{ width: 1, height: 16, background: cs.border }} />
      <input type="date" value={matTrackDateFrom}
        onChange={e => { setMatTrackDateFrom(e.target.value); }}
        style={{
          background: cs.card, border: "1px solid " + cs.border, borderRadius: 7,
          padding: "4px 8px", fontSize: 12, color: cs.text, colorScheme: "dark"
        }}
      />
      <span style={{ color: cs.muted }}>–</span>
      <input type="date" value={matTrackDateTo}
        onChange={e => { setMatTrackDateTo(e.target.value); }}
        style={{
          background: cs.card, border: "1px solid " + cs.border, borderRadius: 7,
          padding: "4px 8px", fontSize: 12, color: cs.text, colorScheme: "dark"
        }}
      />
      {(matTrackDateFrom || matTrackDateTo) && (
        <button onClick={() => { setMatTrackDateFrom(""); setMatTrackDateTo(""); }}
          style={{
            fontSize: 11, padding: "3px 10px", borderRadius: 99, background: cs.red + "22",
            border: "1px solid " + cs.red + "44", color: cs.red, cursor: "pointer"
          }}>✕ Reset</button>
      )}
    </div>

    {/* Search */}
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: cs.muted }}>🔍</span>
      <input value={matTrackSearch} onChange={e => setMatTrackSearch(e.target.value)}
        placeholder="Cari item, customer, teknisi, job ID..."
        style={{
          width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10,
          padding: "10px 14px 10px 36px", color: cs.text, fontSize: 13
        }} />
    </div>

    {/* Tabel pemakaian */}
    {txFiltered.length === 0 ? (
      <div style={{ background: cs.card, borderRadius: 14, padding: 32, textAlign: "center", color: cs.muted }}>
        Belum ada data pemakaian{matTrackFilter !== "Semua" ? " untuk filter ini" : ""}
      </div>
    ) : (
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
        <div style={{
          padding: "10px 16px", borderBottom: "1px solid " + cs.border,
          display: "grid", gridTemplateColumns: "1fr 1fr 100px 80px 100px", gap: 8,
          fontSize: 11, fontWeight: 700, color: cs.muted
        }}>
          <div>Item</div><div>Customer · Job</div><div>Teknisi</div>
          <div style={{ textAlign: "right" }}>Qty</div><div style={{ textAlign: "right" }}>Tanggal</div>
        </div>
        {txFiltered.slice(0, 100).map((tx, i) => (
          <div key={tx.id || i}
            style={{
              padding: "9px 16px", borderBottom: "1px solid " + cs.border + "55",
              display: "grid", gridTemplateColumns: "1fr 1fr 100px 80px 100px", gap: 8,
              background: i % 2 === 0 ? "transparent" : cs.surface, fontSize: 12
            }}>
            <div>
              <div style={{ fontWeight: 600, color: cs.text }}>{tx.inventory_name || "—"}</div>
              <div style={{ fontSize: 10, color: cs.muted }}>{tx.inventory_code}</div>
            </div>
            <div>
              <div style={{ color: cs.text }}>{tx.customer_name || "—"}</div>
              <div style={{ fontSize: 10, color: cs.muted }}>{tx.order_id || tx.report_id || "—"}</div>
            </div>
            <div style={{ color: cs.accent, fontSize: 11 }}>{tx.teknisi_name || "—"}</div>
            <div style={{
              textAlign: "right", fontWeight: 700,
              color: tx.qty < 0 ? cs.red : cs.green
            }}>
              {tx.qty < 0 ? "-" : "+"}
              {Math.abs(tx.qty)} {tx.notes?.split(" ").pop() || ""}
            </div>
            <div style={{ textAlign: "right", color: cs.muted, fontSize: 11 }}>
              {(tx.job_date || tx.created_at || "").slice(0, 10)}
            </div>
          </div>
        ))}
        {txFiltered.length > 100 && (
          <div style={{ padding: "8px 16px", textAlign: "center", color: cs.muted, fontSize: 11 }}>
            Menampilkan 100 dari {txFiltered.length} transaksi
          </div>
        )}
      </div>
    )}
  </div>
);
}
