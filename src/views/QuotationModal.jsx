import { useState, useMemo, useEffect } from "react";
import { cs } from "../theme/cs.js";
import { normalizePhone } from "../lib/phone.js";

const fmt = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");

const BRAND_SHORTCUTS = ["Daikin", "Panasonic", "Sharp", "Samsung", "LG", "Mitsubishi", "Gree", "Haier", "Midea", "Hisense"];
const KAPASITAS_OPT   = ["0.5 PK", "0.75 PK", "1 PK", "1.5 PK", "2 PK", "2.5 PK", "3 PK", "4 PK", "5 PK"];
const TIPE_UNIT       = ["Split Standard", "Split Inverter", "Cassette", "Split Duct", "Floor Standing"];
const TRADE_IN_AMOUNT = 250000;

const PRESET_NOTES = `Catatan Pekerjaan :
1. Jasa Kami tidak termasuk Jasa Perapian Tembok / Plafon / Dan Sebagainya.
2. Penambahan Material / Jasa diluar Pekerjaan Quotation ini.
3. Apabila ditemukan kerusakan Sparepart lain / Pekerjaan lain Maka akan diberikan penawaran tambahan

Catatan Term Of Payment:
1. Payment : Cash / Bank Transfer 100%
2. Instalation : 1~14 Days, After Payment
3. Price Include Shipment
4. Validation : 15 Days
5. Transfer BCA : 8830-8830-11 ( Malda Retta )`;

const DEFAULT_PAKET = [
  { key: "paket_05_1pk", label: "Paket Pemasangan 0,5PK – 1PK", harga: 1400000,
    include: [
      { nama: "Jasa Pemasangan Unit", satuan: "Unit", qty: 1 },
      { nama: "Pipa AC Hoda 1PK", satuan: "Meter", qty: 4 },
      { nama: "Kabel Control 3×1,5", satuan: "Meter", qty: 4 },
      { nama: "Breket Outdoor", satuan: "Set", qty: 1 },
      { nama: "Jasa Vacum AC", satuan: "Unit", qty: 1 },
      { nama: "Duct Tape", satuan: "Roll", qty: 1 },
    ]},
  { key: "paket_15_2pk", label: "Paket Pemasangan 1,5PK – 2PK", harga: 1600000,
    include: [
      { nama: "Jasa Pemasangan Unit", satuan: "Unit", qty: 1 },
      { nama: "Pipa AC Hoda 2PK", satuan: "Meter", qty: 4 },
      { nama: "Kabel Control 3×2,5", satuan: "Meter", qty: 4 },
      { nama: "Breket Outdoor", satuan: "Set", qty: 1 },
      { nama: "Jasa Vacum AC", satuan: "Unit", qty: 1 },
      { nama: "Duct Tape", satuan: "Roll", qty: 1 },
    ]},
  { key: "paket_25pk", label: "Paket Pemasangan 2,5PK", harga: 2000000,
    include: [
      { nama: "Jasa Pemasangan Unit", satuan: "Unit", qty: 1 },
      { nama: "Pipa AC Hoda 2,5PK", satuan: "Meter", qty: 4 },
      { nama: "Kabel Control 3×2,5", satuan: "Meter", qty: 4 },
      { nama: "Breket Outdoor", satuan: "Set", qty: 1 },
      { nama: "Jasa Vacum AC", satuan: "Unit", qty: 1 },
      { nama: "Duct Tape", satuan: "Roll", qty: 1 },
    ]},
];

const TABS = [
  { key: "customer", label: "1 · Customer" },
  { key: "items",    label: "2 · Items" },
  { key: "ringkasan",label: "3 · Ringkasan" },
  { key: "aksi",     label: "4 · Aksi" },
];

const emptyUnit = () => ({
  _id: Date.now() + Math.random(),
  brand: "", tipe: "Split Standard", kapasitas: "1 PK", model: "",
  qty: 1, harga_satuan: 0, subtotal: 0,
});

const emptyJasa = () => ({ _id: Date.now() + Math.random(), nama: "", qty: 1, harga: 0 });
const emptyMat  = () => ({ _id: Date.now() + Math.random(), nama: "", qty: 1, harga: 0, satuan: "Unit" });

export default function QuotationModal({
  onClose, supabase, customersData, showNotif, setQuotationsData,
  getLocalDate, editData, priceListData,
}) {
  const isEdit = !!editData;
  const [activeTab, setActiveTab] = useState("customer");
  const [saving, setSaving] = useState(false);

  // ── Customer ──
  const [custMode, setCustMode]         = useState("existing");
  const [custSearch, setCustSearch]     = useState(isEdit ? (editData.customer || "") : "");
  const [selectedCust, setSelectedCust] = useState(null);
  const [newCust, setNewCust]           = useState({ name: "", phone: "", area: "", alamat: "" });

  // ── Items: Unit AC (opsional) ──
  const [withUnitAC, setWithUnitAC] = useState(isEdit ? (editData.items || []).some(i => i.item_type === "unit_ac") : false);
  const [acUnits, setAcUnits]       = useState(() => {
    if (isEdit) {
      const units = (editData.items || []).filter(i => i.item_type === "unit_ac");
      return units.length > 0 ? units.map(u => ({ ...u, _id: Math.random(), harga_satuan: u.unit_price, subtotal: u.subtotal || u.unit_price * u.qty })) : [emptyUnit()];
    }
    return [emptyUnit()];
  });

  // ── Items: Paket Pemasangan ──
  const [paketList, setPaketList]         = useState(DEFAULT_PAKET);
  const [selectedPaket, setSelectedPaket] = useState(() => {
    if (isEdit) {
      const paketItem = (editData.items || []).find(i => i.item_type === "paket");
      return paketItem ? { label: paketItem.description, harga: paketItem.unit_price, include: [] } : null;
    }
    return null;
  });
  const [useTanpaPaket, setUseTanpaPaket] = useState(() => {
    if (isEdit) return !(editData.items || []).some(i => i.item_type === "paket");
    return false;
  });

  // ── Items: Jasa manual (jika tanpa paket) ──
  const [jasaItems, setJasaItems] = useState(() => {
    if (isEdit) {
      const items = (editData.items || []).filter(i => i.item_type === "jasa");
      return items.length > 0 ? items.map(j => ({ _id: Math.random(), nama: j.description, qty: j.qty, harga: j.unit_price })) : [];
    }
    return [];
  });

  // ── Items: Material/Addon ──
  const [addonItems, setAddonItems]       = useState(() => {
    if (isEdit) {
      const items = (editData.items || []).filter(i => i.item_type === "addon");
      return items.length > 0 ? items.map(a => ({ _id: Math.random(), nama: a.description, qty: a.qty, harga: a.unit_price, satuan: a.satuan || "Unit" })) : [];
    }
    return [];
  });
  const [addonSearch, setAddonSearch]       = useState("");
  const [showAddonPicker, setShowAddonPicker] = useState(false);
  const [jasaSearch, setJasaSearch]         = useState("");
  const [showJasaPicker, setShowJasaPicker] = useState(false);

  // ── Diskon & Trade-In ──
  const [diskon, setDiskon]       = useState(isEdit ? (editData.discount || 0) : 0);
  const [diskonPct, setDiskonPct] = useState(false);
  const [tradeIn, setTradeIn]     = useState(isEdit ? (editData.trade_in_amount > 0) : false);

  // ── Notes ──
  const [notes, setNotes] = useState(isEdit ? (editData.notes || "") : "");

  // ── Aksi tab: save as ──
  const [saveAs, setSaveAs] = useState("DRAFT");

  // ── Load paket dari Supabase ──
  useEffect(() => {
    if (!supabase) return;
    supabase.from("app_settings").select("value").eq("key", "ac_paket_list").single()
      .then(({ data }) => {
        if (data?.value) {
          try {
            const parsed = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
            if (Array.isArray(parsed) && parsed.length > 0) setPaketList(parsed);
          } catch (_) {}
        }
      });
  }, [supabase]);

  // ── Inisialisasi customer saat edit ──
  useEffect(() => {
    if (isEdit && editData.customer && customersData) {
      const found = customersData.find(c =>
        c.name === editData.customer || c.phone === editData.phone
      );
      if (found) {
        setSelectedCust(found);
        setCustSearch(found.name);
        setCustMode("existing");
      } else {
        setCustMode("baru");
        setNewCust({ name: editData.customer || "", phone: editData.phone || "", area: editData.area || "", alamat: editData.address || "" });
      }
    }
  }, []);

  // ── Kalkulasi ──
  const totalUnitsCount = useMemo(() => acUnits.reduce((s, u) => s + (Number(u.qty) || 1), 0), [acUnits]);
  const totalUnitAC     = useMemo(() => withUnitAC ? acUnits.reduce((s, u) => s + (u.subtotal || 0), 0) : 0, [acUnits, withUnitAC]);
  const totalPaket      = useMemo(() => {
    if (useTanpaPaket) return jasaItems.reduce((s, j) => s + (j.qty * j.harga), 0);
    return (selectedPaket?.harga || 0) * (withUnitAC ? totalUnitsCount : 1);
  }, [useTanpaPaket, jasaItems, selectedPaket, withUnitAC, totalUnitsCount]);
  const totalAddon      = useMemo(() => addonItems.reduce((s, a) => s + (a.qty * a.harga), 0), [addonItems]);

  const diskonNominal   = diskonPct
    ? Math.round((totalUnitAC + totalPaket + totalAddon) * (parseFloat(diskon) / 100))
    : (parseFloat(diskon) || 0);
  const tradeInNominal  = tradeIn ? TRADE_IN_AMOUNT : 0;
  const grandTotal      = Math.max(0, totalUnitAC + totalPaket + totalAddon - diskonNominal - tradeInNominal);
  const omsetAClean     = totalPaket + totalAddon - diskonNominal - tradeInNominal;

  // ── Customer display ──
  const custDisplay = custMode === "existing"
    ? selectedCust
    : (newCust.name ? { name: newCust.name, phone: newCust.phone, area: newCust.area } : null);

  const filteredCust = (customersData || []).filter(c =>
    !custSearch ||
    (c.name || "").toLowerCase().includes(custSearch.toLowerCase()) ||
    (c.phone || "").includes(custSearch)
  );

  // ── Price list options ──
  const priceOptions = useMemo(() => (priceListData || [])
    .filter(p => p.is_active !== false)
    .map(p => ({ nama: p.type, satuan: p.unit || "Unit", harga: Number(p.price) || 0 }))
    .sort((a, b) => a.nama.localeCompare(b.nama)),
  [priceListData]);

  const filteredAddon = addonSearch
    ? priceOptions.filter(p => p.nama.toLowerCase().includes(addonSearch.toLowerCase()))
    : priceOptions;

  const filteredJasa = jasaSearch
    ? priceOptions.filter(p => p.nama.toLowerCase().includes(jasaSearch.toLowerCase()))
    : priceOptions;

  // ── Unit helpers ──
  const updateUnit = (idx, field, val) => {
    setAcUnits(prev => prev.map((u, i) => {
      if (i !== idx) return u;
      const up = { ...u, [field]: val };
      if (field === "qty" || field === "harga_satuan")
        up.subtotal = (Number(up.qty) || 0) * (Number(up.harga_satuan) || 0);
      return up;
    }));
  };

  // ── Tab nav ──
  const tabIdx = TABS.findIndex(t => t.key === activeTab);
  const goNext = () => setActiveTab(TABS[Math.min(tabIdx + 1, TABS.length - 1)].key);
  const goPrev = () => setActiveTab(TABS[Math.max(tabIdx - 1, 0)].key);

  // ── Build items array untuk simpan ──
  const buildItems = () => {
    const items = [];
    if (withUnitAC) {
      acUnits.forEach(u => {
        if (u.harga_satuan > 0) items.push({
          item_type: "unit_ac",
          description: [u.brand, u.tipe, u.kapasitas, u.model].filter(Boolean).join(" "),
          qty: Number(u.qty) || 1,
          unit_price: Number(u.harga_satuan) || 0,
          subtotal: u.subtotal || 0,
          is_passthrough: true,
        });
      });
    }
    if (!useTanpaPaket && selectedPaket) {
      const paketQty = withUnitAC ? totalUnitsCount : 1;
      items.push({
        item_type: "paket",
        description: selectedPaket.label,
        qty: paketQty,
        unit_price: selectedPaket.harga,
        subtotal: selectedPaket.harga * paketQty,
        include: selectedPaket.include || [],
      });
    }
    jasaItems.forEach(j => {
      if (j.nama && j.harga > 0) items.push({
        item_type: "jasa",
        description: j.nama,
        qty: Number(j.qty) || 1,
        unit_price: Number(j.harga) || 0,
        subtotal: (Number(j.qty) || 1) * (Number(j.harga) || 0),
      });
    });
    addonItems.forEach(a => {
      if (a.nama && a.harga > 0) items.push({
        item_type: "addon",
        description: a.nama,
        qty: Number(a.qty) || 1,
        unit_price: Number(a.harga) || 0,
        subtotal: (Number(a.qty) || 1) * (Number(a.harga) || 0),
        satuan: a.satuan || "Unit",
      });
    });
    return items;
  };

  // ── Simpan Quotation ──
  const handleSave = async (statusOverride) => {
    if (!supabase) return;
    if (!custDisplay) { showNotif?.("⚠️ Pilih customer dahulu"); return; }
    const items = buildItems();
    if (items.length === 0) { showNotif?.("⚠️ Tambahkan minimal 1 item"); return; }

    setSaving(true);
    try {
      const today = getLocalDate?.() || new Date().toISOString().slice(0, 10);
      const targetStatus = statusOverride || saveAs;

      // Upsert customer baru
      if (custMode === "baru" && newCust.name) {
        const phoneNorm = normalizePhone(newCust.phone || "");
        const row = { name: newCust.name.trim(), phone: phoneNorm || null, area: newCust.area || null, address: newCust.alamat || null };
        if (phoneNorm) {
          await supabase.from("customers").upsert(row, { onConflict: "phone", ignoreDuplicates: false });
        } else {
          await supabase.from("customers").insert(row);
        }
      }

      // Valid until: 15 hari dari hari ini (untuk baru) atau pertahankan (untuk edit)
      const validUntil = isEdit && editData.valid_until
        ? editData.valid_until
        : (() => { const d = new Date(); d.setDate(d.getDate() + 15); return d.toISOString().slice(0, 10); })();

      const phoneNorm = normalizePhone(custDisplay.phone || "");
      const payload = {
        customer:        custDisplay.name,
        phone:           phoneNorm || null,
        address:         custMode === "existing" ? (selectedCust?.address || "") : (newCust.alamat || ""),
        area:            custMode === "existing" ? (selectedCust?.area || "") : (newCust.area || ""),
        status:          targetStatus,
        items:           items,
        total:           grandTotal,
        unit_ac_amount:  totalUnitAC,
        labor:           totalPaket,
        material:        totalAddon,
        discount:        diskonNominal,
        trade_in_amount: tradeInNominal,
        valid_until:     validUntil,
        notes:           notes || null,
        updated_at:      new Date().toISOString(),
      };

      if (isEdit) {
        const { error } = await supabase.from("quotations").update(payload).eq("id", editData.id);
        if (error) throw error;
        setQuotationsData?.(prev => prev.map(q => q.id === editData.id ? { ...q, ...payload } : q));
        showNotif?.(`✅ Quotation ${editData.id} diperbarui`);
      } else {
        const quoId = "QUO-" + today.replace(/-/g, "") + "-" + Math.random().toString(36).toUpperCase().slice(2, 7);
        const { error } = await supabase.from("quotations").insert({ id: quoId, ...payload, created_at: new Date().toISOString() });
        if (error) throw error;
        setQuotationsData?.(prev => [{ id: quoId, ...payload, created_at: new Date().toISOString() }, ...prev]);
        showNotif?.(`✅ Quotation ${quoId} dibuat (${targetStatus})`);
      }
      onClose();
    } catch (err) {
      showNotif?.("❌ Gagal simpan: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  // ── Input style helper ──
  const inp = { width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13, boxSizing: "border-box" };
  const btn = (color) => ({ padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontWeight: 600, fontSize: 12, border: "1px solid " + color + "44", background: color + "22", color });

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 640, maxHeight: "94vh", overflowY: "auto", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ padding: "16px 20px 0", borderBottom: "1px solid " + cs.border + "55" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>📋 {isEdit ? "Edit Quotation" : "Buat Quotation Baru"}</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
                {custDisplay ? `${custDisplay.name} · ${custDisplay.phone || ""}` : "Pilih customer dahulu"}
              </div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 20, cursor: "pointer" }}>×</button>
          </div>
          {/* Tab bar */}
          <div style={{ display: "flex", gap: 4, marginTop: 12, overflowX: "auto" }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                style={{ padding: "6px 12px", borderRadius: "8px 8px 0 0", border: "none", cursor: "pointer", fontSize: 12, fontWeight: activeTab === t.key ? 700 : 500,
                  background: activeTab === t.key ? cs.accent + "22" : "transparent",
                  color: activeTab === t.key ? cs.accent : cs.muted, whiteSpace: "nowrap" }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 20, flex: 1, display: "flex", flexDirection: "column", gap: 14 }}>

          {/* ── Tab 1: Customer ── */}
          {activeTab === "customer" && (
            <>
              <div style={{ display: "flex", gap: 8 }}>
                {["existing", "baru"].map(m => (
                  <button key={m} onClick={() => { setCustMode(m); setSelectedCust(null); setCustSearch(""); }}
                    style={{ flex: 1, padding: "9px 0", borderRadius: 10, border: "1px solid " + (custMode === m ? cs.accent : cs.border),
                      background: custMode === m ? cs.accent + "22" : cs.card, color: custMode === m ? cs.accent : cs.muted, cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
                    {m === "existing" ? "👤 Customer Lama" : "+ Customer Baru"}
                  </button>
                ))}
              </div>
              {custMode === "existing" ? (
                <>
                  <input value={custSearch} onChange={e => { setCustSearch(e.target.value); setSelectedCust(null); }}
                    placeholder="Cari nama atau no HP..." autoFocus style={inp} />
                  <div style={{ maxHeight: 220, overflowY: "auto", display: "grid", gap: 6 }}>
                    {filteredCust.map(c => (
                      <div key={c.id} onClick={() => { setSelectedCust(c); setCustSearch(c.name); }}
                        style={{ padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                          background: selectedCust?.id === c.id ? cs.accent + "22" : cs.card,
                          border: "1px solid " + (selectedCust?.id === c.id ? cs.accent : cs.border),
                          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: cs.muted }}>{c.phone} · {c.area}</div>
                        </div>
                        {selectedCust?.id === c.id && <span style={{ color: cs.accent }}>✓</span>}
                      </div>
                    ))}
                    {filteredCust.length === 0 && custSearch && (
                      <div style={{ padding: 12, color: cs.muted, fontSize: 12, textAlign: "center" }}>
                        Tidak ditemukan —
                        <button onClick={() => { setCustMode("baru"); setNewCust(p => ({ ...p, name: custSearch })); }}
                          style={{ marginLeft: 6, color: cs.accent, background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Buat baru?</button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {[["name","Nama Customer *"], ["phone","No. HP (628xxx)"], ["area","Area/Kota"], ["alamat","Alamat Lengkap"]].map(([f, lbl]) => (
                    <div key={f}>
                      <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>{lbl}</div>
                      <input value={newCust[f]} onChange={e => setNewCust(p => ({ ...p, [f]: e.target.value }))}
                        onBlur={f === "phone" ? e => setNewCust(p => ({ ...p, phone: normalizePhone(e.target.value) })) : undefined}
                        style={inp} placeholder={f === "phone" ? "auto-format 628xxx" : ""} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Tab 2: Items ── */}
          {activeTab === "items" && (
            <>
              {/* Toggle Unit AC */}
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>🖥️ Unit AC (Passthrough)</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: cs.muted }}>
                    <input type="checkbox" checked={withUnitAC} onChange={e => setWithUnitAC(e.target.checked)} />
                    Sertakan unit AC
                  </label>
                </div>
                {withUnitAC && (
                  <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                    {acUnits.map((u, idx) => (
                      <div key={u._id} style={{ background: cs.surface, border: "1px solid " + cs.border + "66", borderRadius: 10, padding: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>Unit #{idx + 1}</span>
                          {acUnits.length > 1 && (
                            <button onClick={() => setAcUnits(p => p.filter((_, i) => i !== idx))}
                              style={{ background: "none", border: "none", color: cs.danger || "#f87171", cursor: "pointer", fontSize: 12 }}>Hapus</button>
                          )}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <div>
                            <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>Brand</div>
                            <input value={u.brand} onChange={e => updateUnit(idx, "brand", e.target.value)} style={inp} placeholder="Daikin, Sharp..." />
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                              {BRAND_SHORTCUTS.map(b => (
                                <button key={b} onClick={() => updateUnit(idx, "brand", b)}
                                  style={{ padding: "2px 8px", fontSize: 10, borderRadius: 6, border: "1px solid " + cs.border, background: u.brand === b ? cs.accent + "22" : cs.card, color: u.brand === b ? cs.accent : cs.muted, cursor: "pointer" }}>{b}</button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>Kapasitas</div>
                            <select value={u.kapasitas} onChange={e => updateUnit(idx, "kapasitas", e.target.value)} style={inp}>
                              {KAPASITAS_OPT.map(k => <option key={k}>{k}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>Tipe</div>
                            <select value={u.tipe} onChange={e => updateUnit(idx, "tipe", e.target.value)} style={inp}>
                              {TIPE_UNIT.map(t => <option key={t}>{t}</option>)}
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>Qty</div>
                            <input type="number" min="1" value={u.qty} onChange={e => updateUnit(idx, "qty", e.target.value)} style={inp} />
                          </div>
                          <div style={{ gridColumn: "span 2" }}>
                            <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>Harga Satuan (passthrough)</div>
                            <input type="number" min="0" value={u.harga_satuan || ""} onChange={e => updateUnit(idx, "harga_satuan", Number(e.target.value))} style={inp} placeholder="0" />
                            {u.subtotal > 0 && <div style={{ fontSize: 11, color: cs.muted, marginTop: 4 }}>Subtotal: {fmt(u.subtotal)}</div>}
                          </div>
                        </div>
                      </div>
                    ))}
                    <button onClick={() => setAcUnits(p => [...p, emptyUnit()])}
                      style={{ ...btn(cs.accent), width: "100%", textAlign: "center" }}>+ Tambah Unit AC</button>
                  </div>
                )}
              </div>

              {/* Paket Pemasangan */}
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>🔧 Paket & Jasa</div>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: cs.muted, cursor: "pointer" }}>
                    <input type="checkbox" checked={useTanpaPaket} onChange={e => { setUseTanpaPaket(e.target.checked); setSelectedPaket(null); }} />
                    Input manual
                  </label>
                </div>
                {!useTanpaPaket ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {paketList.map(p => (
                      <div key={p.key} onClick={() => setSelectedPaket(p)}
                        style={{ padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                          background: selectedPaket?.key === p.key ? cs.accent + "22" : cs.surface,
                          border: "1px solid " + (selectedPaket?.key === p.key ? cs.accent : cs.border) }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{p.label}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: cs.accent }}>{fmt(p.harga)}</span>
                        </div>
                        {selectedPaket?.key === p.key && p.include?.length > 0 && (
                          <div style={{ marginTop: 6, display: "grid", gap: 2 }}>
                            {p.include.map((inc, i) => (
                              <div key={i} style={{ fontSize: 11, color: cs.muted }}>✓ {inc.nama} {inc.qty} {inc.satuan}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {withUnitAC && selectedPaket && totalUnitsCount > 1 && (
                      <div style={{ fontSize: 12, color: cs.muted, padding: "4px 8px", background: cs.accent + "11", borderRadius: 6 }}>
                        {totalUnitsCount} unit × {fmt(selectedPaket.harga)} = {fmt(selectedPaket.harga * totalUnitsCount)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {/* Price list lookup untuk jasa */}
                    <div>
                      <input value={jasaSearch} onChange={e => { setJasaSearch(e.target.value); setShowJasaPicker(true); }}
                        onFocus={() => setShowJasaPicker(true)}
                        placeholder="Cari jasa dari price list..." style={{ ...inp, marginBottom: 6 }} />
                      {showJasaPicker && (
                        <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid " + cs.border, borderRadius: 8, background: cs.surface, marginBottom: 6 }}>
                          {filteredJasa.slice(0, 20).map((p, i) => (
                            <div key={i} onClick={() => {
                              setJasaItems(prev => [...prev, { _id: Math.random(), nama: p.nama, qty: 1, harga: p.harga }]);
                              setJasaSearch(""); setShowJasaPicker(false);
                            }} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, color: cs.text, borderBottom: "1px solid " + cs.border + "33" }}>
                              {p.nama} — {fmt(p.harga)}/{p.satuan}
                            </div>
                          ))}
                          {filteredJasa.length === 0 && (
                            <div style={{ padding: 10, color: cs.muted, fontSize: 12 }}>Tidak ditemukan di price list</div>
                          )}
                        </div>
                      )}
                    </div>
                    {jasaItems.map((j, idx) => (
                      <div key={j._id} style={{ display: "grid", gridTemplateColumns: "1fr 60px 120px auto", gap: 6, alignItems: "center" }}>
                        <input value={j.nama} onChange={e => setJasaItems(p => p.map((x, i) => i === idx ? { ...x, nama: e.target.value } : x))}
                          style={inp} placeholder="Nama jasa..." />
                        <input type="number" min="1" value={j.qty} onChange={e => setJasaItems(p => p.map((x, i) => i === idx ? { ...x, qty: Number(e.target.value) } : x))}
                          style={inp} />
                        <input type="number" min="0" value={j.harga || ""} onChange={e => setJasaItems(p => p.map((x, i) => i === idx ? { ...x, harga: Number(e.target.value) } : x))}
                          style={inp} placeholder="Harga" />
                        <button onClick={() => setJasaItems(p => p.filter((_, i) => i !== idx))}
                          style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16 }}>×</button>
                      </div>
                    ))}
                    <button onClick={() => setJasaItems(p => [...p, emptyJasa()])} style={btn(cs.accent)}>+ Manual</button>
                  </div>
                )}
              </div>

              {/* Material Tambahan */}
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: cs.text, marginBottom: 10 }}>📦 Material Tambahan</div>

                {/* Price list picker */}
                <div style={{ marginBottom: 10 }}>
                  <input value={addonSearch} onChange={e => { setAddonSearch(e.target.value); setShowAddonPicker(true); }}
                    onFocus={() => setShowAddonPicker(true)}
                    placeholder="Cari dari price list..." style={{ ...inp, marginBottom: 6 }} />
                  {showAddonPicker && (
                    <div style={{ maxHeight: 160, overflowY: "auto", border: "1px solid " + cs.border, borderRadius: 8, background: cs.surface }}>
                      {filteredAddon.slice(0, 20).map((p, i) => (
                        <div key={i} onClick={() => {
                          setAddonItems(prev => [...prev, { _id: Math.random(), nama: p.nama, qty: 1, harga: p.harga, satuan: p.satuan }]);
                          setAddonSearch(""); setShowAddonPicker(false);
                        }} style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, color: cs.text, borderBottom: "1px solid " + cs.border + "33" }}>
                          {p.nama} — {fmt(p.harga)}/{p.satuan}
                        </div>
                      ))}
                      {filteredAddon.length === 0 && (
                        <div style={{ padding: 10, color: cs.muted, fontSize: 12 }}>Tidak ditemukan di price list</div>
                      )}
                    </div>
                  )}
                </div>

                {/* Item rows */}
                <div style={{ display: "grid", gap: 6 }}>
                  {addonItems.map((a, idx) => (
                    <div key={a._id} style={{ display: "grid", gridTemplateColumns: "1fr 60px 120px auto", gap: 6, alignItems: "center" }}>
                      <input value={a.nama} onChange={e => setAddonItems(p => p.map((x, i) => i === idx ? { ...x, nama: e.target.value } : x))}
                        style={inp} placeholder="Material..." />
                      <input type="number" min="1" value={a.qty} onChange={e => setAddonItems(p => p.map((x, i) => i === idx ? { ...x, qty: Number(e.target.value) } : x))}
                        style={inp} />
                      <input type="number" min="0" value={a.harga || ""} onChange={e => setAddonItems(p => p.map((x, i) => i === idx ? { ...x, harga: Number(e.target.value) } : x))}
                        style={inp} placeholder="Harga" />
                      <button onClick={() => setAddonItems(p => p.filter((_, i) => i !== idx))}
                        style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16 }}>×</button>
                    </div>
                  ))}
                  <button onClick={() => setAddonItems(p => [...p, emptyMat()])} style={btn(cs.muted)}>+ Manual</button>
                </div>
              </div>

              {/* Diskon & Trade-in */}
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: cs.text, marginBottom: 10 }}>🏷️ Diskon & Potongan</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>Diskon {diskonPct ? "(%)" : "(Rp)"}</div>
                    <input type="number" min="0" value={diskon || ""} onChange={e => setDiskon(e.target.value)} style={inp} placeholder="0" />
                  </div>
                  <label style={{ fontSize: 12, color: cs.muted, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <input type="checkbox" checked={diskonPct} onChange={e => setDiskonPct(e.target.checked)} />
                    <span>%</span>
                  </label>
                  <label style={{ fontSize: 12, color: cs.muted, cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={tradeIn} onChange={e => setTradeIn(e.target.checked)} />
                    Trade-in AC lama ({fmt(TRADE_IN_AMOUNT)})
                  </label>
                </div>
              </div>

              {/* Notes */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontSize: 11, color: cs.muted }}>Catatan / Scope Pekerjaan</div>
                  <button onClick={() => setNotes(PRESET_NOTES)}
                    style={{ fontSize: 11, color: cs.accent, background: cs.accent + "11", border: "1px solid " + cs.accent + "33", borderRadius: 6, padding: "2px 10px", cursor: "pointer", fontWeight: 600 }}>
                    📋 Isi Preset
                  </button>
                </div>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={6}
                  style={{ ...inp, resize: "vertical" }} placeholder="Deskripsi pekerjaan, syarat & ketentuan..." />
              </div>
            </>
          )}

          {/* ── Tab 3: Ringkasan ── */}
          {activeTab === "ringkasan" && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: cs.text, marginBottom: 12 }}>📋 Ringkasan Quotation</div>

                {/* Customer */}
                <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid " + cs.border + "44" }}>
                  <div style={{ fontSize: 12, color: cs.muted }}>Customer</div>
                  <div style={{ fontWeight: 700, color: cs.text }}>{custDisplay?.name || "—"}</div>
                  <div style={{ fontSize: 12, color: cs.muted }}>{custDisplay?.phone} · {custDisplay?.area || selectedCust?.area || newCust.area}</div>
                </div>

                {/* Items breakdown */}
                {withUnitAC && totalUnitAC > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: "#94a3b8" }}>Unit AC (Passthrough)</span>
                    <span style={{ fontSize: 13, color: "#94a3b8" }}>{fmt(totalUnitAC)}</span>
                  </div>
                )}
                {totalPaket > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: cs.text }}>Paket & Jasa</span>
                    <span style={{ fontSize: 13, color: cs.text }}>{fmt(totalPaket)}</span>
                  </div>
                )}
                {totalAddon > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: cs.text }}>Material Tambahan</span>
                    <span style={{ fontSize: 13, color: cs.text }}>{fmt(totalAddon)}</span>
                  </div>
                )}
                {diskonNominal > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: "#fbbf24" }}>Diskon</span>
                    <span style={{ fontSize: 13, color: "#fbbf24" }}>-{fmt(diskonNominal)}</span>
                  </div>
                )}
                {tradeInNominal > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: "#fbbf24" }}>Trade-in AC lama</span>
                    <span style={{ fontSize: 13, color: "#fbbf24" }}>-{fmt(tradeInNominal)}</span>
                  </div>
                )}

                <div style={{ borderTop: "1px solid " + cs.border, marginTop: 10, paddingTop: 10, display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>TOTAL PENAWARAN</span>
                  <span style={{ fontWeight: 800, fontSize: 15, color: cs.accent }}>{fmt(grandTotal)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <span style={{ fontSize: 12, color: cs.muted }}>Omset AClean</span>
                  <span style={{ fontSize: 12, color: cs.green || "#4ade80" }}>{fmt(Math.max(0, omsetAClean))}</span>
                </div>
              </div>

              {/* Valid until */}
              <div style={{ background: "#fbbf2411", border: "1px solid #fbbf2444", borderRadius: 10, padding: 12, fontSize: 13, color: "#fbbf24" }}>
                ⏰ Penawaran berlaku <strong>15 hari</strong> dari tanggal pembuatan
              </div>

              {/* Notes preview */}
              {notes && (
                <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Catatan</div>
                  <div style={{ fontSize: 13, color: cs.text, whiteSpace: "pre-wrap" }}>{notes}</div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab 4: Aksi ── */}
          {activeTab === "aksi" && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: cs.text, marginBottom: 14 }}>💾 Simpan sebagai</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {[
                    { key: "DRAFT", label: "📝 Draft", desc: "Simpan dulu, belum dikirim ke customer" },
                    { key: "SENT",  label: "📤 Sent",  desc: "Tandai sudah dikirim ke customer via WA/email" },
                  ].map(opt => (
                    <div key={opt.key} onClick={() => setSaveAs(opt.key)}
                      style={{ padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                        background: saveAs === opt.key ? cs.accent + "22" : cs.surface,
                        border: "1px solid " + (saveAs === opt.key ? cs.accent : cs.border) }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>{opt.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: cs.text, marginBottom: 8 }}>📊 Summary</div>
                <div style={{ fontSize: 13, color: cs.muted }}>Customer: <strong style={{ color: cs.text }}>{custDisplay?.name || "—"}</strong></div>
                <div style={{ fontSize: 13, color: cs.muted }}>Total: <strong style={{ color: cs.accent }}>{fmt(grandTotal)}</strong></div>
                <div style={{ fontSize: 13, color: cs.muted }}>Items: <strong style={{ color: cs.text }}>{buildItems().length} item</strong></div>
                {withUnitAC && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>* Unit AC tidak masuk omset (passthrough)</div>}
              </div>

              <button onClick={() => handleSave(saveAs)} disabled={saving || !custDisplay}
                style={{ padding: "14px 0", borderRadius: 12, border: "none", cursor: saving || !custDisplay ? "not-allowed" : "pointer",
                  background: !custDisplay ? cs.border : cs.accent, color: "#fff", fontWeight: 800, fontSize: 14, opacity: saving ? 0.7 : 1 }}>
                {saving ? "Menyimpan..." : `💾 Simpan Quotation (${saveAs})`}
              </button>
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid " + cs.border + "55", display: "flex", justifyContent: "space-between" }}>
          <button onClick={tabIdx === 0 ? onClose : goPrev}
            style={{ ...btn(cs.muted), padding: "8px 20px" }}>
            {tabIdx === 0 ? "Batal" : "← Kembali"}
          </button>
          {tabIdx < TABS.length - 1 && (
            <button onClick={goNext}
              style={{ ...btn(cs.accent), padding: "8px 20px" }}>
              Lanjut →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
