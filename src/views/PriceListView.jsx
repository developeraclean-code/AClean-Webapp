import { memo, useState, useEffect } from "react";
import { cs } from "../theme/cs.js";

const BRAND_LIST = ["Daikin", "Panasonic", "Sharp", "Gree", "Samsung", "LG", "Mitsubishi", "Haier", "Midea", "Hisense"];
const TIPE_LIST  = ["Split Standard", "Split Inverter", "Cassette", "Split Duct", "Floor Standing"];
const KAP_LIST   = ["0.5 PK", "0.75 PK", "1 PK", "1.5 PK", "2 PK", "2.5 PK", "3 PK"];
const KAP_ORDER  = { "0.5 PK": 1, "0.75 PK": 2, "1 PK": 3, "1.5 PK": 4, "2 PK": 5, "2.5 PK": 6, "3 PK": 7, "4 PK": 8, "5 PK": 9 };

function AcPriceTab({ supabase, currentUser, showNotif, showConfirm, fmt }) {
  const [rows, setRows]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [filterBrand, setFilterBrand] = useState("Semua");
  const [filterTipe, setFilterTipe]   = useState("Semua");
  const [search, setSearch]       = useState("");
  const [editId, setEditId]       = useState(null);
  const [editForm, setEditForm]   = useState({});
  const [addModal, setAddModal]   = useState(false);
  const [addForm, setAddForm]     = useState({ brand: "Daikin", tipe: "Split Standard", kapasitas: "1 PK", seri: "", nama_varian: "", harga_unit: "", harga_inc_pasang: "" });
  const [saving, setSaving]       = useState(false);

  const canEdit = currentUser?.role === "Owner";

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("ac_price_list").select("*").eq("is_active", true).order("brand").order("tipe").order("kapasitas");
    if (error) showNotif("❌ Gagal load harga AC: " + error.message);
    else setRows(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const brands  = ["Semua", ...[...new Set(rows.map(r => r.brand))].sort((a, b) => { const ai = BRAND_LIST.indexOf(a); const bi = BRAND_LIST.indexOf(b); return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi); })];
  const tipes   = ["Semua", ...TIPE_LIST.filter(t => rows.some(r => r.tipe === t))];

  let filtered = rows.filter(r => {
    if (filterBrand !== "Semua" && r.brand !== filterBrand) return false;
    if (filterTipe  !== "Semua" && r.tipe  !== filterTipe)  return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return r.brand.toLowerCase().includes(q) || r.tipe.toLowerCase().includes(q) || r.kapasitas.toLowerCase().includes(q)
        || (r.seri || "").toLowerCase().includes(q) || (r.nama_varian || "").toLowerCase().includes(q);
    }
    return true;
  });
  filtered = [...filtered].sort((a, b) => {
    if (a.brand !== b.brand) return a.brand.localeCompare(b.brand);
    if (a.tipe  !== b.tipe)  return a.tipe.localeCompare(b.tipe);
    return (KAP_ORDER[a.kapasitas] || 99) - (KAP_ORDER[b.kapasitas] || 99);
  });

  const handleSave = async () => {
    if (!editId) return;
    const hu = Number(editForm.harga_unit) || 0;
    const hip = Number(editForm.harga_inc_pasang) || 0;
    if (hip > 0 && hip < hu) { showNotif("⚠️ Harga Inc. Pasang tidak boleh lebih kecil dari Harga Unit"); return; }
    setSaving(true);
    const { error } = await supabase.from("ac_price_list").update({
      brand: editForm.brand,
      tipe:  editForm.tipe,
      kapasitas: editForm.kapasitas,
      seri: editForm.seri || "",
      nama_varian: editForm.nama_varian || "",
      harga_unit:       Number(editForm.harga_unit) || 0,
      harga_inc_pasang: Number(editForm.harga_inc_pasang) || 0,
      updated_at: new Date().toISOString(),
    }).eq("id", editId);
    setSaving(false);
    if (error) { showNotif("❌ Gagal simpan: " + error.message); return; }
    setRows(prev => prev.map(r => r.id === editId ? { ...r, ...editForm, harga_unit: Number(editForm.harga_unit), harga_inc_pasang: Number(editForm.harga_inc_pasang) } : r));
    setEditId(null);
    showNotif("✅ Harga AC diperbarui");
  };

  const handleAdd = async () => {
    if (!addForm.brand || !addForm.tipe || !addForm.kapasitas) { showNotif("❌ Brand, tipe, dan kapasitas wajib diisi"); return; }
    if (!addForm.harga_unit || isNaN(Number(addForm.harga_unit))) { showNotif("❌ Harga unit harus berupa angka"); return; }
    const hu = Number(addForm.harga_unit);
    const hip = Number(addForm.harga_inc_pasang) || 0;
    if (hip > 0 && hip < hu) { showNotif("⚠️ Harga Inc. Pasang tidak boleh lebih kecil dari Harga Unit"); return; }
    // Cek duplikat brand+tipe+kapasitas+seri
    const seriKey = addForm.seri.trim().toLowerCase();
    const isDupe = rows.some(r =>
      r.brand === addForm.brand && r.tipe === addForm.tipe &&
      r.kapasitas === addForm.kapasitas && (r.seri || "").toLowerCase() === seriKey
    );
    if (isDupe) { showNotif(`⚠️ Item ${addForm.brand} ${addForm.tipe} ${addForm.kapasitas}${addForm.seri ? " (" + addForm.seri + ")" : ""} sudah ada`); return; }
    setSaving(true);
    const payload = {
      brand: addForm.brand.trim(),
      tipe:  addForm.tipe.trim(),
      kapasitas: addForm.kapasitas.trim(),
      seri: addForm.seri.trim() || "",
      nama_varian: addForm.nama_varian.trim() || "",
      harga_unit:       Number(addForm.harga_unit) || 0,
      harga_inc_pasang: Number(addForm.harga_inc_pasang) || 0,
      is_active: true,
    };
    const { data, error } = await supabase.from("ac_price_list").insert(payload).select().single();
    setSaving(false);
    if (error) { showNotif("❌ Gagal tambah: " + error.message); return; }
    setRows(prev => [...prev, data || payload]);
    setAddModal(false);
    setAddForm({ brand: "Daikin", tipe: "Split Standard", kapasitas: "1 PK", seri: "", nama_varian: "", harga_unit: "", harga_inc_pasang: "" });
    showNotif("✅ Item harga AC ditambahkan");
  };

  const handleDelete = async (row) => {
    if (!await showConfirm({ icon: "🗑️", title: "Hapus harga AC?", danger: true, message: `Hapus ${row.brand} ${row.tipe} ${row.kapasitas}?`, confirmText: "Hapus" })) return;
    const { error } = await supabase.from("ac_price_list").update({ is_active: false }).eq("id", row.id);
    if (error) { showNotif("❌ Gagal hapus: " + error.message); return; }
    setRows(prev => prev.filter(r => r.id !== row.id));
    showNotif("✅ Item dihapus");
  };

  const inputStyle = { background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "5px 8px", color: cs.text, fontSize: 12, width: "100%" };
  const selStyle   = { ...inputStyle, cursor: "pointer" };

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 Cari brand, seri, varian..."
          style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 12px", color: cs.text, fontSize: 12, minWidth: 180 }} />
        <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}
          style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 12px", color: cs.text, fontSize: 12, cursor: "pointer" }}>
          {brands.map(b => <option key={b}>{b}</option>)}
        </select>
        <select value={filterTipe} onChange={e => setFilterTipe(e.target.value)}
          style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 12px", color: cs.text, fontSize: 12, cursor: "pointer" }}>
          {tipes.map(t => <option key={t}>{t}</option>)}
        </select>
        <button onClick={load} style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 700 }}>🔄</button>
        {canEdit && (
          <button onClick={() => setAddModal(true)}
            style={{ marginLeft: "auto", background: "linear-gradient(135deg,#f59e0b,#d97706)", border: "none", color: "#000", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontWeight: 700, fontSize: 12 }}>
            + Tambah Unit AC
          </button>
        )}
      </div>

      {/* Stats strip */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {BRAND_LIST.filter(b => rows.some(r => r.brand === b)).map(b => (
          <button key={b} onClick={() => setFilterBrand(filterBrand === b ? "Semua" : b)}
            style={{ background: filterBrand === b ? "#f59e0b22" : cs.card, border: "1px solid " + (filterBrand === b ? "#f59e0b" : cs.border), color: filterBrand === b ? "#f59e0b" : cs.muted, borderRadius: 99, padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
            {b} ({rows.filter(r => r.brand === b).length})
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, color: cs.muted }}>Memuat data...</div>
      ) : filtered.length === 0 ? (
        <div style={{ background: cs.card, borderRadius: 14, padding: 40, textAlign: "center", color: cs.muted }}>Tidak ada item ditemukan</div>
      ) : (
        <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 14, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 750 }}>
            <thead>
              <tr style={{ background: cs.surface, borderBottom: "1px solid " + cs.border }}>
                {["Brand", "Seri / Varian", "Tipe", "Kapasitas", "Harga Unit", "Inc. Pasang", canEdit ? "Aksi" : ""].filter(Boolean).map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, color: cs.muted, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => {
                const isEdit = editId === r.id;
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid " + cs.border, background: idx % 2 === 0 ? "transparent" : cs.surface + "66" }}>
                    <td style={{ padding: "9px 14px" }}>
                      {isEdit
                        ? <select value={editForm.brand} onChange={e => setEditForm(f => ({ ...f, brand: e.target.value }))} style={selStyle}>{BRAND_LIST.map(b => <option key={b}>{b}</option>)}<option value={editForm.brand}>{editForm.brand}</option></select>
                        : <span style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>{r.brand}</span>}
                    </td>
                    <td style={{ padding: "9px 14px", minWidth: 160 }}>
                      {isEdit ? (
                        <div style={{ display: "grid", gap: 4 }}>
                          <input value={editForm.seri || ""} onChange={e => setEditForm(f => ({ ...f, seri: e.target.value }))}
                            placeholder="Seri (contoh: FTKQ)" style={{ ...inputStyle }} />
                          <input value={editForm.nama_varian || ""} onChange={e => setEditForm(f => ({ ...f, nama_varian: e.target.value }))}
                            placeholder="Nama varian" style={{ ...inputStyle }} />
                        </div>
                      ) : (
                        <div>
                          {r.seri && <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent, fontFamily: "monospace" }}>{r.seri}</div>}
                          {r.nama_varian && <div style={{ fontSize: 11, color: cs.muted }}>{r.nama_varian}</div>}
                          {!r.seri && !r.nama_varian && <span style={{ fontSize: 11, color: cs.border }}>—</span>}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "9px 14px" }}>
                      {isEdit
                        ? <select value={editForm.tipe} onChange={e => setEditForm(f => ({ ...f, tipe: e.target.value }))} style={selStyle}>{TIPE_LIST.map(t => <option key={t}>{t}</option>)}</select>
                        : <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 99, background: r.tipe.includes("Inverter") ? "#3b82f622" : "#64748b22", color: r.tipe.includes("Inverter") ? "#3b82f6" : cs.muted, fontWeight: 600 }}>{r.tipe}</span>}
                    </td>
                    <td style={{ padding: "9px 14px" }}>
                      {isEdit
                        ? <select value={editForm.kapasitas} onChange={e => setEditForm(f => ({ ...f, kapasitas: e.target.value }))} style={selStyle}>{KAP_LIST.map(k => <option key={k}>{k}</option>)}</select>
                        : <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>{r.kapasitas}</span>}
                    </td>
                    <td style={{ padding: "9px 14px" }}>
                      {isEdit
                        ? <input type="number" value={editForm.harga_unit} onChange={e => setEditForm(f => ({ ...f, harga_unit: e.target.value }))} style={{ ...inputStyle, width: 110 }} />
                        : <span style={{ fontWeight: 700, fontSize: 13, color: cs.text, fontFamily: "monospace" }}>{fmt(r.harga_unit)}</span>}
                    </td>
                    <td style={{ padding: "9px 14px" }}>
                      {isEdit
                        ? <input type="number" value={editForm.harga_inc_pasang} onChange={e => setEditForm(f => ({ ...f, harga_inc_pasang: e.target.value }))} style={{ ...inputStyle, width: 110 }} />
                        : <span style={{ fontWeight: 700, fontSize: 13, color: "#22c55e", fontFamily: "monospace" }}>{fmt(r.harga_inc_pasang)}</span>}
                    </td>
                    {canEdit && (
                      <td style={{ padding: "9px 14px" }}>
                        {isEdit ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={handleSave} disabled={saving}
                              style={{ background: "#22c55e22", border: "1px solid #22c55e44", color: "#22c55e", padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700 }}>
                              {saving ? "..." : "💾 Simpan"}
                            </button>
                            <button onClick={() => setEditId(null)}
                              style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>
                              Batal
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={() => { setEditId(r.id); setEditForm({ brand: r.brand, tipe: r.tipe, kapasitas: r.kapasitas, seri: r.seri || "", nama_varian: r.nama_varian || "", harga_unit: r.harga_unit, harga_inc_pasang: r.harga_inc_pasang }); }}
                              style={{ background: cs.accent + "22", border: "1px solid " + cs.accent + "44", color: cs.accent, padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
                              ✏️ Edit
                            </button>
                            {currentUser?.role === "Owner" && (
                              <button onClick={() => handleDelete(r)}
                                style={{ background: "#ef444422", border: "1px solid #ef444444", color: "#ef4444", padding: "5px 10px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>
                                🗑️
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div style={{ display: "flex", gap: 16, fontSize: 11, color: cs.muted }}>
        <span><span style={{ color: cs.text, fontWeight: 700 }}>Harga Unit</span> — harga unit AC saja (tanpa jasa pasang)</span>
        <span><span style={{ color: "#22c55e", fontWeight: 700 }}>Inc. Pasang</span> — harga unit + paket pemasangan standar</span>
      </div>

      {/* Modal Tambah */}
      {addModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
          onClick={() => setAddModal(false)}>
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 420, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ padding: "16px 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid " + cs.border + "55", flexShrink: 0 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>🖥️ Tambah Harga Unit AC</div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Brand, spesifikasi, dan harga unit</div>
              </div>
              <button onClick={() => setAddModal(false)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 0 0 12px", flexShrink: 0 }}>×</button>
            </div>
            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Card 1 — Spesifikasi */}
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: cs.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>Spesifikasi</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[{ label: "Brand", key: "brand", opts: BRAND_LIST }, { label: "Tipe", key: "tipe", opts: TIPE_LIST }, { label: "Kapasitas", key: "kapasitas", opts: KAP_LIST }].map(({ label, key, opts }) => (
                    <div key={key}>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4, fontWeight: 600 }}>{label}</div>
                      <select value={addForm[key]} onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))}
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13 }}>
                        {opts.map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
              {/* Card 2 — Identifikasi */}
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: cs.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>Identifikasi <span style={{ fontSize: 9, fontWeight: 400 }}>(opsional)</span></div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[{ label: "Seri", key: "seri", ph: "contoh: FTKQ, CS-LN, AH-X6" }, { label: "Nama Varian", key: "nama_varian", ph: "contoh: Flash Inverter, Low Watt" }].map(({ label, key, ph }) => (
                    <div key={key}>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4, fontWeight: 600 }}>{label}</div>
                      <input type="text" value={addForm[key]} placeholder={ph}
                        onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))}
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                  ))}
                </div>
              </div>
              {/* Card 3 — Harga */}
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 14px" }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: cs.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>Harga</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[{ label: "Harga Unit (Rp) *", key: "harga_unit", ph: "4100000" }, { label: "Harga Inc. Pasang (Rp)", key: "harga_inc_pasang", ph: "5500000" }].map(({ label, key, ph }) => (
                    <div key={key}>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4, fontWeight: 600 }}>{label}</div>
                      <input type="number" value={addForm[key]} placeholder={ph}
                        onChange={e => setAddForm(f => ({ ...f, [key]: e.target.value }))}
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                  ))}
                  <div style={{ background: cs.surface, border: "1px solid " + cs.border + "88", borderRadius: 8, padding: "7px 10px", fontSize: 10, color: cs.muted }}>
                    ℹ️ Inc. Pasang tidak boleh lebih kecil dari Harga Unit
                  </div>
                </div>
              </div>
            </div>
            {/* Footer */}
            <div style={{ borderTop: "1px solid " + cs.border + "55", padding: "12px 20px", display: "flex", gap: 10, flexShrink: 0 }}>
              <button onClick={() => setAddModal(false)}
                style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                Batal
              </button>
              <button onClick={handleAdd} disabled={saving}
                style={{ flex: 2, background: saving ? "#f59e0b88" : "linear-gradient(135deg,#f59e0b,#d97706)", border: "none", color: "#fff", padding: "11px", borderRadius: 10, cursor: saving ? "not-allowed" : "pointer", fontWeight: 800, fontSize: 13, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Menyimpan..." : "💾 Simpan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PriceListView({ priceListData, setPriceListData, priceListSvcTab, setPriceListSvcTab, searchPriceList, setSearchPriceList, plEditItem, setPlEditItem, plEditForm, setPlEditForm, plAddModal, setPlAddModal, plNewForm, setPlNewForm, currentUser, setPriceListSyncedAt, showConfirm, showNotif, addAgentLog, fetchPriceList, fmt, buildPriceListFromDB, supabase, PRICE_LIST, setPRICE_LIST }) {
  const [mainTab, setMainTab] = useState("jasa");

  const SVC_TABS = ["Semua", "Cleaning", "Install", "Material", "Repair", "Maintenance", "Complain"];
  const svcColors = { Cleaning: "#22c55e", Install: "#3b82f6", Material: "#8b5cf6", Repair: "#f59e0b", Maintenance: "#06b6d4", Complain: "#ef4444" };

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
    const freshList = priceListData.map(r => r.id === updated.id ? { ...r, ...updated } : r);
    setPriceListData(freshList);
    setPRICE_LIST(buildPriceListFromDB(freshList.filter(r => r.is_active !== false)));
    setPriceListSyncedAt(new Date());
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
        {mainTab === "jasa" && currentUser?.role === "Owner" && (
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

      {/* Main Tab: Jasa/Material vs Unit AC */}
      <div style={{ display: "flex", gap: 4, background: cs.card, borderRadius: 12, padding: 4, width: "fit-content", border: "1px solid " + cs.border }}>
        {[{ key: "jasa", label: "🛠️ Jasa & Material" }, { key: "unit_ac", label: "🖥️ Unit AC" }].map(({ key, label }) => (
          <button key={key} onClick={() => setMainTab(key)}
            style={{
              padding: "8px 20px", borderRadius: 9, border: "none", cursor: "pointer", fontWeight: 700, fontSize: 13,
              background: mainTab === key ? cs.accent : "transparent",
              color: mainTab === key ? "#0a0f1e" : cs.muted,
              transition: "all 0.15s",
            }}>
            {label}
          </button>
        ))}
      </div>

      {/* ── TAB: Jasa & Material ── */}
      {mainTab === "jasa" && (<>
        {/* Search */}
        <div style={{ position: "relative" }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: cs.muted, fontSize: 14, pointerEvents: "none" }}>🔍</span>
          <input value={searchPriceList} onChange={e => setSearchPriceList(e.target.value)}
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
            {priceListData.length === 0 ? "Price list belum dimuat." : "Tidak ada item ditemukan"}
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
                          <input value={plEditForm.type || ""} onChange={e => setPlEditForm(f => ({ ...f, type: e.target.value }))}
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
                          <input type="number" value={plEditForm.price || ""} onChange={e => setPlEditForm(f => ({ ...f, price: e.target.value }))}
                            style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "6px 10px", color: cs.text, fontSize: 13, fontWeight: 700, width: 110 }} />
                        ) : (
                          <div style={{ fontWeight: 700, fontSize: 13, color: cs.text, fontFamily: "monospace" }}>{fmt(r.price)}</div>
                        )}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        {isEdit ? (
                          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
                            <input type="checkbox" checked={plEditForm.is_active !== false} onChange={e => setPlEditForm(f => ({ ...f, is_active: e.target.checked }))} />
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
                          {currentUser?.role === "Owner" && (
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
                                    if (await showConfirm({ icon: "🗑️", title: "Hapus Price List?", danger: true, message: "Hapus " + r.type + "? Tidak bisa dibatalkan.", confirmText: "Hapus" })) {
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

        {/* Info box ARA */}
        <div style={{ background: cs.accent + "10", border: "1px solid " + cs.accent + "33", borderRadius: 12, padding: "14px 18px", fontSize: 12, color: cs.muted }}>
          <div style={{ fontWeight: 700, color: cs.accent, marginBottom: 6 }}>🤖 Cara ARA Membaca Price List</div>
          <div>ARA membaca price list <b style={{ color: cs.text }}>langsung dari tabel Supabase</b> setiap kali app di-load.</div>
          <div style={{ marginTop: 6 }}>Saat ARA membuat invoice, kalkulasi otomatis pakai harga dari tabel ini. Update harga di sini → langsung berlaku di seluruh sistem.</div>
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {SVC_TABS.filter(t => t !== "Semua").map(svc => (
              <span key={svc} style={{ background: cs.surface, border: "1px solid " + (svcColors[svc] || cs.border), borderRadius: 8, padding: "4px 10px", fontSize: 11, color: svcColors[svc] || cs.text }}>
                {svc}: {priceListData.filter(r => r.service === svc && r.is_active !== false).length} item
              </span>
            ))}
          </div>
        </div>

        {/* Modal Tambah Item PriceList */}
        {plAddModal && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.78)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
            onClick={() => setPlAddModal(false)}>
            <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 440, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
              onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div style={{ padding: "16px 20px 14px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "1px solid " + cs.border + "55", flexShrink: 0 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>➕ Tambah Item Harga</div>
                  <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Jasa atau material dengan harga satuan</div>
                </div>
                <button onClick={() => setPlAddModal(false)} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 0 0 12px", flexShrink: 0 }}>×</button>
              </div>
              {/* Body */}
              <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Card 1 — Tipe & Layanan */}
                <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: cs.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>Tipe & Layanan</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4, fontWeight: 600 }}>Jenis Layanan</div>
                      <select value={plNewForm.service} onChange={e => setPlNewForm(f => ({ ...f, service: e.target.value }))}
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13 }}>
                        {SVC_TABS.filter(t => t !== "Semua").map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4, fontWeight: 600 }}>Kategori</div>
                      <select value={plNewForm.category} onChange={e => setPlNewForm(f => ({ ...f, category: e.target.value }))}
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13 }}>
                        {["", "Jasa", "Barang"].map(o => <option key={o} value={o}>{o || "— Pilih —"}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4, fontWeight: 600 }}>Tipe AC / Nama Item <span style={{ color: cs.red }}>*</span></div>
                      <input type="text" value={plNewForm.type} placeholder="contoh: AC 1 PK, AC 2 PK"
                        onChange={e => setPlNewForm(f => ({ ...f, type: e.target.value }))}
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4, fontWeight: 600 }}>Kode <span style={{ fontWeight: 400 }}>(opsional)</span></div>
                      <input type="text" value={plNewForm.code || ""} placeholder="contoh: CLN-1PK"
                        onChange={e => setPlNewForm(f => ({ ...f, code: e.target.value }))}
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                  </div>
                </div>
                {/* Card 2 — Harga & Satuan */}
                <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: cs.muted, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 }}>Harga & Satuan</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4, fontWeight: 600 }}>Harga (Rp) <span style={{ color: cs.red }}>*</span></div>
                      <input type="number" value={plNewForm.price} placeholder="contoh: 150000"
                        onChange={e => setPlNewForm(f => ({ ...f, price: e.target.value }))}
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4, fontWeight: 600 }}>Satuan</div>
                      <input type="text" value={plNewForm.unit} placeholder="contoh: unit, set, meter"
                        onChange={e => setPlNewForm(f => ({ ...f, unit: e.target.value }))}
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4, fontWeight: 600 }}>Catatan <span style={{ fontWeight: 400 }}>(opsional)</span></div>
                      <input type="text" value={plNewForm.notes} placeholder="opsional"
                        onChange={e => setPlNewForm(f => ({ ...f, notes: e.target.value }))}
                        style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
                    </div>
                  </div>
                </div>
              </div>
              {/* Footer */}
              <div style={{ borderTop: "1px solid " + cs.border + "55", padding: "12px 20px", display: "flex", gap: 10, flexShrink: 0 }}>
                <button onClick={() => setPlAddModal(false)}
                  style={{ flex: 1, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
                  Batal
                </button>
                <button onClick={async () => {
                  if (!plNewForm.type.trim()) { showNotif("❌ Tipe/Nama item wajib diisi"); return; }
                  if (!plNewForm.price || isNaN(Number(plNewForm.price))) { showNotif("❌ Harga harus berupa angka"); return; }
                  const typeTrimmed = plNewForm.type.trim();
                  const duplikat = priceListData.find(r => r.service === plNewForm.service && r.type.trim().toLowerCase() === typeTrimmed.toLowerCase());
                  if (duplikat) { showNotif(`❌ Item "${typeTrimmed}" di layanan ${plNewForm.service} sudah ada. Edit item tersebut jika ingin ubah harga.`); return; }
                  const newItem = { service: plNewForm.service, category: plNewForm.category || null, type: typeTrimmed, price: Number(plNewForm.price), unit: plNewForm.unit.trim() || "unit", notes: plNewForm.notes.trim() || null, is_active: true };
                  const { data, error } = await supabase.from("price_list").insert(newItem).select().single();
                  if (error) { showNotif("❌ Gagal simpan: " + (error.message || error.code)); return; }
                  setPriceListData(prev => [...prev, data || newItem]);
                  setPriceListSyncedAt(new Date());
                  addAgentLog("PRICELIST_ADD", `Item baru "${newItem.type}" (${newItem.service}) Rp${fmt(newItem.price)} ditambah oleh ${currentUser?.name}`, "SUCCESS");
                  showNotif("✅ Item harga baru berhasil ditambah!");
                  setPlAddModal(false);
                }}
                  style={{ flex: 2, background: `linear-gradient(135deg,${cs.accent},#3b82f6)`, border: "none", color: "#fff", padding: "11px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 13 }}>
                  💾 Simpan Item
                </button>
              </div>
            </div>
          </div>
        )}
      </>)}

      {/* ── TAB: Unit AC ── */}
      {mainTab === "unit_ac" && (
        <AcPriceTab supabase={supabase} currentUser={currentUser} showNotif={showNotif} showConfirm={showConfirm} fmt={fmt} />
      )}
    </div>
  );
}

export default memo(PriceListView);
