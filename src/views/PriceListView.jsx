import { cs } from "../theme/cs.js";
import { SERVICE_TYPES } from "../constants/services.js";

export default function PriceListView({ priceListData, setPriceListData, priceListSvcTab, setPriceListSvcTab, searchPriceList, setSearchPriceList, plEditItem, setPlEditItem, plEditForm, setPlEditForm, plAddModal, setPlAddModal, plNewForm, setPlNewForm, currentUser, setPriceListSyncedAt, showConfirm, showNotif, addAgentLog, fetchPriceList, fmt, buildPriceListFromDB, supabase, PRICE_LIST, setPRICE_LIST }) {
const SVC_TABS = ["Semua", "Cleaning", "Install", "Repair", "Complain"];
const svcColors = { Cleaning: "#22c55e", Install: "#3b82f6", Repair: "#f59e0b", Complain: "#ef4444" };

let filtered = [...priceListData];
if (priceListSvcTab !== "Semua") filtered = filtered.filter(r => r.service === priceListSvcTab);
if (searchPriceList.trim()) {
  const q = searchPriceList.trim().toLowerCase();
  filtered = filtered.filter(r =>
    (r.type || "").toLowerCase().includes(q) ||
    (r.service || "").toLowerCase().includes(q) ||
    (r.code || "").toLowerCase().includes(q) ||
    (r.notes || "").toLowerCase().includes(q) ||
    String(r.price || "").includes(searchPriceList.trim())
  );
}

const handleSavePrice = async () => {
  if (!plEditItem) return;
  const updated = { ...plEditItem, ...plEditForm, price: Number(plEditForm.price || plEditItem.price) };
  const { error } = await supabase.from("price_list").update({
    price: updated.price,
    type: updated.type,
    service: updated.service,
    notes: updated.notes || null,
    is_active: updated.is_active !== false,
  }).eq("id", updated.id);
  if (error) { showNotif("❌ Gagal update: " + error.message); return; }
  // Update local state & rebuild PRICE_LIST dari data terbaru
  const freshList = priceListData.map(r => r.id === updated.id ? { ...r, ...updated } : r);
  setPriceListData(freshList);
  // Rebuild PRICE_LIST dari freshList (bukan priceListData yang stale)
  setPRICE_LIST(buildPriceListFromDB(freshList.filter(r => r.is_active !== false)));
  setPriceListSyncedAt(new Date());
  console.log("✅ PRICE_LIST updated after save");
  setPlEditItem(null);
  showNotif("✅ Harga diperbarui — ARA langsung pakai harga baru");
  addAgentLog("PRICELIST_UPDATE", `Harga "${updated.type}" diupdate → Rp${fmt(updated.price)}`, "SUCCESS");
};

return (
  <div style={{ display: "grid", gap: 16 }}>
    {/* Header */}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
      <div>
        <div style={{ fontWeight: 800, fontSize: 18, color: cs.text }}>💰 Price List</div>
        <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>
          Harga dari Supabase — ARA & Invoice otomatis pakai harga ini
          <span style={{ marginLeft: 8, background: cs.accent + "22", color: cs.accent, fontSize: 10, padding: "2px 8px", borderRadius: 99, fontWeight: 700 }}>
            {priceListData.filter(r => r.is_active !== false).length} item aktif
          </span>
        </div>
      </div>
      {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={async () => {
            const { data } = await fetchPriceList(supabase);
            if (data) { setPriceListData(data); showNotif("✅ Price list di-refresh dari DB"); }
          }} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
            🔄 Refresh
          </button>
          <button onClick={() => { setPlNewForm({ service: "Cleaning", type: "", code: "", price: "", unit: "unit", notes: "", category: "" }); setPlAddModal(true); }}
            style={{ background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "8px 16px", borderRadius: 9, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
            + Tambah Item
          </button>
        </div>
      )}
    </div>

    {/* Search */}
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: cs.muted, fontSize: 14, pointerEvents: "none" }}>🔍</span>
      <input id="searchPriceList" value={searchPriceList} onChange={e => setSearchPriceList(e.target.value)}
        placeholder="Cari nama layanan, tipe AC, kode..."
        style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 14px 10px 36px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
      {searchPriceList && <button onClick={() => setSearchPriceList("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: cs.muted, cursor: "pointer", fontSize: 16 }}>✕</button>}
    </div>

    {/* Service tabs */}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {SVC_TABS.map(t => {
        const col = svcColors[t] || cs.accent;
        const cnt = t === "Semua" ? priceListData.length : priceListData.filter(r => r.service === t).length;
        return (
          <button key={t} onClick={() => setPriceListSvcTab(t)}
            style={{
              padding: "6px 14px", borderRadius: 99, border: "1px solid " + (priceListSvcTab === t ? col : cs.border),
              background: priceListSvcTab === t ? col + "22" : cs.card, color: priceListSvcTab === t ? col : cs.muted,
              cursor: "pointer", fontSize: 12, fontWeight: priceListSvcTab === t ? 700 : 500
            }}>
            {t} ({cnt})
          </button>
        );
      })}
    </div>

    {/* Table */}
    {filtered.length === 0 ? (
      <div style={{ background: cs.card, borderRadius: 14, padding: 40, textAlign: "center", color: cs.muted }}>
        {priceListData.length === 0
          ? "Price list belum dimuat. Pastikan tabel price_list sudah ada di Supabase."
          : "Tidak ada item ditemukan"}
      </div>
    ) : (
      <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: cs.surface, borderBottom: "1px solid " + cs.border }}>
              {["Layanan", "Tipe / Keterangan", "Harga", "Status", "Aksi"].map(h => (
                <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: cs.muted }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, idx) => {
              const col = svcColors[r.service] || cs.accent;
              const isEdit = plEditItem?.id === r.id;
              return (
                <tr key={r.id || idx} style={{ borderTop: "1px solid " + cs.border, background: idx % 2 === 0 ? "transparent" : cs.surface + "88" }}>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 99, background: col + "22", color: col, fontWeight: 700 }}>{r.service}</span>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {isEdit ? (
                      <input id="field_1" value={plEditForm.type || ""} onChange={e => setPlEditForm(f => ({ ...f, type: e.target.value }))}
                        style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "6px 10px", color: cs.text, fontSize: 12, width: "100%" }} />
                    ) : (
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: cs.text }}>{r.type}</div>
                        {r.notes && <div style={{ fontSize: 11, color: cs.muted }}>{r.notes}</div>}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {isEdit ? (
                      <input id="field_number_2" type="number" value={plEditForm.price || ""} onChange={e => setPlEditForm(f => ({ ...f, price: e.target.value }))}
                        style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "6px 10px", color: cs.text, fontSize: 13, fontWeight: 700, width: 110 }} />
                    ) : (
                      <div style={{ fontWeight: 700, fontSize: 13, color: cs.text, fontFamily: "monospace" }}>{fmt(r.price)}</div>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {isEdit ? (
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                        <input id="field_checkbox_3" type="checkbox" checked={plEditForm.is_active !== false} onChange={e => setPlEditForm(f => ({ ...f, is_active: e.target.checked }))} />
                        Aktif
                      </label>
                    ) : (
                      <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: r.is_active !== false ? cs.green + "22" : cs.red + "22", color: r.is_active !== false ? cs.green : cs.red, fontWeight: 700 }}>
                        {r.is_active !== false ? "Aktif" : "Non-aktif"}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {/* Edit: Admin & Owner */}
                      {(currentUser?.role === "Owner" || currentUser?.role === "Admin") && (
                        isEdit ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={handleSavePrice}
                              style={{ background: cs.green + "22", border: "1px solid " + cs.green + "44", color: cs.green, padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                              💾 Simpan
                            </button>
                            <button onClick={() => setPlEditItem(null)}
                              style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "5px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>
                              Batal
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => { setPlEditItem(r); setPlEditForm({ type: r.type, price: r.price, service: r.service, notes: r.notes || "", is_active: r.is_active !== false }); }}
                              style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "5px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                              ✏️ Edit
                            </button>
                            {currentUser?.role === "Owner" && (
                              <button onClick={async () => {
                                if (await showConfirm({
                                  icon: "🗑️", title: "Hapus Price List?", danger: true,
                                  message: "Hapus " + r.type + "? Tidak bisa dibatalkan.",

                                  confirmText: "Hapus"
                                })) {
                                  const { error: delErr } = await supabase.from("price_list").delete().eq("id", r.id);
                                  if (delErr) { showNotif("❌ Gagal hapus: " + delErr.message); }
                                  else {
                                    setPriceListData(prev => {
                                      const updated = prev.filter(p => p.id !== r.id);
                                      setPRICE_LIST(buildPriceListFromDB(updated.filter(r => r.is_active !== false)));
                                      return updated;
                                    });
                                    addAgentLog("PRICELIST_DELETE", `Hapus "${r.type}" (${r.service})`, "WARNING");
                                    showNotif("✅ Item dihapus dari database");
                                  }
                                }
                              }} style={{ background: cs.red + "22", border: "1px solid " + cs.red + "44", color: cs.red, padding: "5px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                                🗑️
                              </button>
                            )}
                          </div>
                        )
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}

    {/* Info box: ARA connection */}
    <div style={{ background: cs.accent + "10", border: "1px solid " + cs.accent + "33", borderRadius: 12, padding: "14px 18px", fontSize: 12, color: cs.muted }}>
      <div style={{ fontWeight: 700, color: cs.accent, marginBottom: 6 }}>🤖 Cara ARA Membaca Price List</div>
      <div>ARA membaca price list <b style={{ color: cs.text }}>langsung dari tabel Supabase</b> setiap kali app di-load. Tidak perlu update brain.md atau brain_customer.md manual.</div>
      <div style={{ marginTop: 6 }}>Saat ARA membuat invoice, kalkulasi otomatis pakai harga dari tabel ini. Update harga di sini → langsung berlaku di seluruh sistem.</div>
      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {SERVICE_TYPES.map(svc => (
          <span key={svc} style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "4px 10px", fontSize: 11 }}>
            {svc}: {priceListData.filter(r => r.service === svc && r.is_active !== false).length} item
          </span>
        ))}
      </div>
    </div>

    {/* ── Modal Tambah Item PriceList ── */}
    {plAddModal && (
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 16, padding: 24, width: "100%", maxWidth: 420 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: cs.text, marginBottom: 16 }}>➕ Tambah Item Harga Baru</div>
          {[
            { label: "Jenis Layanan", key: "service", type: "select", opts: SERVICE_TYPES },
            { label: "Kategori", key: "category", type: "select", opts: ["", "Jasa", "Barang"] },
            { label: "Tipe AC / Nama Item", key: "type", type: "text", ph: "contoh: AC 1 PK, AC 2 PK" },
            { label: "Kode", key: "code", type: "text", ph: "contoh: CLN-1PK" },
            { label: "Harga (Rp)", key: "price", type: "number", ph: "contoh: 150000" },
            { label: "Satuan", key: "unit", type: "text", ph: "contoh: unit, set, meter" },
            { label: "Catatan", key: "notes", type: "text", ph: "opsional" },
          ].map(({ label, key, type, ph, opts }) => (
            <div key={key} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>{label}</div>
              {type === "select" ? (
                <select value={plNewForm[key]} onChange={e => setPlNewForm(f => ({ ...f, [key]: e.target.value }))}
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 12px", color: cs.text, fontSize: 13 }}>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input id="field_4" type={type} value={plNewForm[key]} placeholder={ph || ""}
                  onChange={e => setPlNewForm(f => ({ ...f, [key]: e.target.value }))}
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button onClick={() => setPlAddModal(false)}
              style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "10px", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
              Batal
            </button>
            <button onClick={async () => {
              if (!plNewForm.type.trim()) { showNotif("❌ Tipe/Nama item wajib diisi"); return; }
              if (!plNewForm.price || isNaN(Number(plNewForm.price))) { showNotif("❌ Harga harus berupa angka"); return; }
              const newItem = {
                service: plNewForm.service,
                category: plNewForm.category || null,
                type: plNewForm.type.trim(),
                code: plNewForm.code.trim() || (plNewForm.service.slice(0, 3).toUpperCase() + "-" + Date.now().toString().slice(-4)),
                price: Number(plNewForm.price),
                unit: plNewForm.unit.trim() || "unit",
                notes: plNewForm.notes.trim(),
                is_active: true,
              };
              const { data, error } = await supabase.from("price_list").insert(newItem).select().single();
              if (error) { showNotif("❌ Gagal simpan: " + error.message); return; }
              setPriceListData(prev => [...prev, data || newItem]);
              setPriceListSyncedAt(new Date());
              addAgentLog("PRICELIST_ADD", `Item baru "${newItem.type}" (${newItem.service}) Rp${fmt(newItem.price)} ditambah oleh ${currentUser?.name}`, "SUCCESS");
              showNotif("✅ Item harga baru berhasil ditambah!");
              setPlAddModal(false);
            }}
              style={{ flex: 2, background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", color: "#0a0f1e", padding: "10px", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>
              💾 Simpan Item
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
);
}
