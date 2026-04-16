import { memo } from "react";
import { cs } from "../theme/cs.js";
import { displayStock } from "../lib/inventory.js";

const INV_PAGE_SIZE = 15;

function InventoryView({
  inventoryData, searchInventory, setSearchInventory, inventoryPage, setInventoryPage,
  currentUser, supabase, fmt, showConfirm, showNotif,
  setModalStok, setEditStokItem, setNewStokForm, setModalEditStok, setInventoryData,
}) {
  const filteredInvt = inventoryData.filter(item =>
    !searchInventory ||
    (item.name || "").toLowerCase().includes(searchInventory.toLowerCase()) ||
    (item.code || "").toLowerCase().includes(searchInventory.toLowerCase()) ||
    (item.unit || "").toLowerCase().includes(searchInventory.toLowerCase()) ||
    (item.status || "").toLowerCase().includes(searchInventory.toLowerCase()) ||
    String(item.price || "").includes(searchInventory) ||
    String(item.stock || "").includes(searchInventory)
  );
  const totPgInv = Math.ceil(filteredInvt.length / INV_PAGE_SIZE) || 1;
  const curPgInv = Math.min(inventoryPage, totPgInv);
  const pageInvt = filteredInvt.slice((curPgInv - 1) * INV_PAGE_SIZE, curPgInv * INV_PAGE_SIZE);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 18, color: cs.text }}>📦 Inventori Material</div>
        <button onClick={() => setModalStok(true)} style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "9px 18px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>+ Tambah Material</button>
      </div>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, color: cs.muted, pointerEvents: "none" }}>🔍</span>
        <input id="searchInventory" value={searchInventory} onChange={e => { setSearchInventory(e.target.value); setInventoryPage(1); }}
          placeholder="Cari nama barang atau kode material..."
          style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px 10px 36px", color: cs.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
        {searchInventory && <button onClick={() => { setSearchInventory(""); setInventoryPage(1); }} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>}
      </div>
      <div style={{ fontSize: 12, color: cs.muted }}>{searchInventory ? <>Ditemukan <b style={{ color: cs.accent }}>{filteredInvt.length}</b> dari {inventoryData.length} item</> : <><b style={{ color: cs.accent }}>{inventoryData.length}</b> item total</>}</div>
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: cs.surface, borderBottom: "1px solid " + cs.border }}>
              {["Kode", "Nama Material", "Satuan", "Harga/Unit", "Stok", "Reorder", "Status", "Aksi"].map(h => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: cs.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageInvt.map((item, i) => {
              const stC = item.status === "OUT" ? cs.red : item.status === "CRITICAL" ? cs.red : item.status === "WARNING" ? cs.yellow : cs.green;
              return (
                <tr key={item.code} style={{ borderTop: "1px solid " + cs.border, background: i % 2 === 0 ? "transparent" : cs.surface + "80" }}>
                  <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 11, color: cs.muted }}>{item.code}</td>
                  <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600, color: cs.text }}>{item.name}</td>
                  <td style={{ padding: "9px 12px", fontSize: 12, color: cs.muted }}>{item.unit}</td>
                  <td style={{ padding: "9px 12px", fontSize: 12, color: cs.muted, fontFamily: "monospace" }}>{fmt(item.price)}</td>
                  <td style={{ padding: "9px 12px", fontSize: 13, fontWeight: 700, color: stC }}>{displayStock(item)}</td>
                  <td style={{ padding: "9px 12px", fontSize: 12, color: cs.muted }}>{item.reorder}</td>
                  <td style={{ padding: "9px 12px" }}>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: stC + "22", color: stC, border: "1px solid " + stC + "44", fontWeight: 700 }}>{item.status}</span>
                  </td>
                  <td style={{ padding: "9px 12px" }}>
                    <div style={{ display: "flex", gap: 4 }}>
                      {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                        <button onClick={() => { setEditStokItem({ ...item }); setNewStokForm({ name: item.name, unit: item.unit, price: item.price, stock: item.stock, reorder: item.reorder, min_alert: item.min_alert }); setModalEditStok(true); }} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>✏️ Edit</button>
                      )}
                      {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                        <button onClick={async () => {
                          if (!await showConfirm({
                            icon: "🗑️", title: "Hapus Material?", danger: true,
                            message: "Hapus material " + item.name + "? Tidak bisa dibatalkan.",
                            confirmText: "Hapus"
                          })) return;
                          const delQuery = item.id && !String(item.id).startsWith("INV")
                            ? supabase.from("inventory").delete().eq("id", item.id)
                            : supabase.from("inventory").delete().eq("code", item.code);
                          const { error } = await delQuery;
                          if (!error) {
                            setInventoryData(prev => prev.filter(i => i.id ? i.id !== item.id : i.code !== item.code));
                            showNotif("🗑️ Material " + item.name + " dihapus dari DB");
                          } else showNotif("❌ Gagal hapus: " + error.message);
                        }} style={{ background: cs.red + "22", border: "1px solid " + cs.red + "44", color: cs.red, padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>🗑️</button>
                      )}
                      {currentUser?.role !== "Owner" && currentUser?.role !== "Admin" && (
                        <span style={{ fontSize: 10, color: cs.muted, fontStyle: "italic" }}>—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totPgInv > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0" }}>
          <button onClick={() => setInventoryPage(p => Math.max(1, p - 1))} disabled={curPgInv === 1}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgInv === 1 ? cs.surface : cs.card, color: curPgInv === 1 ? cs.muted : cs.text, cursor: curPgInv === 1 ? "not-allowed" : "pointer", fontSize: 12 }}>← Prev</button>
          <span style={{ fontSize: 12, color: cs.text }}>Hal {curPgInv}/{totPgInv}</span>
          <button onClick={() => setInventoryPage(p => Math.min(totPgInv, p + 1))} disabled={curPgInv === totPgInv}
            style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid " + cs.border, background: curPgInv === totPgInv ? cs.surface : cs.card, color: curPgInv === totPgInv ? cs.muted : cs.text, cursor: curPgInv === totPgInv ? "not-allowed" : "pointer", fontSize: 12 }}>Next →</button>
          <span style={{ fontSize: 11, color: cs.muted }}>{filteredInvt.length} item</span>
        </div>
      )}
    </div>
  );
}

export default memo(InventoryView);
