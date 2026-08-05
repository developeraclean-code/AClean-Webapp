import { useState, useMemo, useEffect } from "react";
import { cs } from "../theme/cs.js";
import { normalizePhone } from "../lib/phone.js";
import { categoryFromCatalog, computePph23 } from "../lib/invoicing.js";

const fmt = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");

const BRAND_SHORTCUTS = ["Daikin", "Panasonic", "Sharp", "Samsung", "LG", "Mitsubishi", "Gree", "Haier", "Midea", "Hisense"];
const KAPASITAS_OPT   = ["0.5 PK", "0.75 PK", "1 PK", "1.5 PK", "2 PK", "2.5 PK", "3 PK", "3.5 PK", "4 PK", "5 PK", "6 PK"];
const TIPE_UNIT       = ["Split Standard", "Split Inverter", "Cassette", "Split Duct", "Floor Standing"];
const TRADE_IN_PRESETS = [250000, 300000];

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
  nama: "", brand: "", tipe: "Split Standard", kapasitas: "1 PK", model: "",
  qty: 1, harga_satuan: 0, subtotal: 0, _manual: true,
});

const SATUAN_OPT = ["Unit", "Meter", "Roll", "Set", "Pcs", "Lot", "Hari", "Jam"];
// Baris grid bebas ala-Excel (gabungan bekas "Paket & Jasa" + "Material Tambahan").
// category "jasa"/"material" menentukan default kena-PPh & bucket labor/material —
// auto-terisi via categoryFromCatalog() saat nama cocok price_list, tetap bisa
// dioverride manual per baris (checkbox pph).
const emptyGridRow = () => ({ _id: Date.now() + Math.random(), nama: "", qty: 1, satuan: "Unit", harga: 0, category: "material", pph: false });

export default function QuotationModal({
  onClose, supabase, customersData, showNotif, setQuotationsData,
  getLocalDate, editData, priceListData,
  extraPriceOptions,    // opsional — harga deal khusus klien (price book maintenance) → opsi jasa/addon
  maintenanceClientId,  // opsional — link quotation ke maintenance client
  maintenancePrefill,   // opsional — { name, phone, address } untuk pre-fill customer
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
      return units.length > 0 ? units.map(u => ({ ...u, _id: Math.random(), _manual: true, nama: u.nama || u.description || "", harga_satuan: u.unit_price, subtotal: u.subtotal || u.unit_price * u.qty })) : [emptyUnit()];
    }
    return [emptyUnit()];
  });

  // ── Paket preset (data harga) — dipakai sbg salah satu opsi auto-detect di grid,
  // bukan lagi kartu pilihan terpisah. Tetap di-load dari app_settings (bisa dikustom).
  const [paketList, setPaketList] = useState(DEFAULT_PAKET);

  // ── Items: grid bebas ala-Excel (gabungan bekas "Paket & Jasa" + "Material
  // Tambahan"). Data lama (item_type paket/jasa/addon) tetap ke-load saat edit. ──
  const [gridItems, setGridItems] = useState(() => {
    if (isEdit) {
      return (editData.items || []).filter(i => i.item_type !== "unit_ac").map(i => ({
        _id: Math.random(), nama: i.description || "", qty: i.qty || 1,
        satuan: i.satuan || "Unit", harga: i.unit_price || 0,
        category: (i.item_type === "material" || i.item_type === "addon") ? "material" : "jasa",
        pph: !!i.pph,
      }));
    }
    return [];
  });

  // ── Diskon, Trade-In (preset + manual), PPh 23 ──
  const [diskon, setDiskon]       = useState(isEdit ? (editData.discount || 0) : 0);
  const [diskonPct, setDiskonPct] = useState(false);
  const [tradeIn, setTradeIn]     = useState(isEdit ? (editData.trade_in_amount > 0) : false);
  const [tradeInAmt, setTradeInAmt] = useState(isEdit && editData.trade_in_amount > 0 ? editData.trade_in_amount : TRADE_IN_PRESETS[0]);
  const [pph23On, setPph23On]     = useState(isEdit ? !!editData.pph23 : false);

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
          } catch { /* paket JSON rusak → pakai default */ }
        }
      });
  }, [supabase]);

  // ── Load ac_price_list untuk auto-fill harga unit ──
  const [acPriceList, setAcPriceList] = useState([]);
  useEffect(() => {
    if (!supabase) return;
    supabase.from("ac_price_list").select("brand,tipe,kapasitas,seri,nama_varian,harga_unit,harga_inc_pasang")
      .eq("is_active", true)
      .then(({ data }) => setAcPriceList(data || []));
  }, [supabase]);
  const [unitSearchQuo, setUnitSearchQuo]       = useState("");
  const [unitFilterBrandQuo, setUnitFilterBrandQuo] = useState("");
  const [unitFilterPKQuo, setUnitFilterPKQuo]   = useState("");

  // ── Inisialisasi customer saat edit atau pre-fill dari maintenance ──
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
    } else if (!isEdit && maintenancePrefill) {
      // Pre-fill dari maintenance client (buat quotation baru untuk perusahaan ini)
      setCustMode("baru");
      setNewCust({ name: maintenancePrefill.name || "", phone: maintenancePrefill.phone || "", area: "", alamat: maintenancePrefill.address || "" });
    }
  }, []);

  // ── Kalkulasi ──
  const totalUnitsCount = useMemo(() => acUnits.reduce((s, u) => s + (Number(u.qty) || 1), 0), [acUnits]);
  const totalUnitAC     = useMemo(() => withUnitAC ? acUnits.reduce((s, u) => s + (u.subtotal || 0), 0) : 0, [acUnits, withUnitAC]);
  // ── Grid bebas: total gabungan + subtotal jasa-saja (basis PPh 23) ──
  const totalItems      = useMemo(() => gridItems.reduce((s, r) => s + ((Number(r.qty) || 0) * (Number(r.harga) || 0)), 0), [gridItems]);
  const jasaSubtotal     = useMemo(() => gridItems.filter(r => r.pph).reduce((s, r) => s + ((Number(r.qty) || 0) * (Number(r.harga) || 0)), 0), [gridItems]);

  const diskonNominal   = diskonPct
    ? Math.round((totalUnitAC + totalItems) * (parseFloat(diskon) / 100))
    : (parseFloat(diskon) || 0);
  const tradeInNominal  = tradeIn ? (Number(tradeInAmt) || 0) : 0;
  // grandTotal = nilai yang DITERIMA AClean (receivable) — PPh 23 TIDAK mengubah ini,
  // hanya informasi DPP+potongan yang tampil di PDF (mirror invoices.pph23_amount).
  const grandTotal      = Math.max(0, totalUnitAC + totalItems - diskonNominal - tradeInNominal);
  const omsetAClean     = totalItems - diskonNominal - tradeInNominal;
  const pph23Info       = pph23On ? computePph23(jasaSubtotal) : { amount: 0, dpp: 0 };

  // ── Customer display ──
  const custDisplay = custMode === "existing"
    ? selectedCust
    : (newCust.name ? { name: newCust.name, phone: newCust.phone, area: newCust.area } : null);

  const filteredCust = (customersData || []).filter(c =>
    !custSearch ||
    (c.name || "").toLowerCase().includes(custSearch.toLowerCase()) ||
    (c.phone || "").includes(custSearch)
  );

  // ── Price list options utk grid (harga deal klien + paket preset + katalog global) ──
  const priceOptions = useMemo(() => {
    const clientOpts = (extraPriceOptions || []).map(p => ({ nama: p.nama, satuan: p.satuan || "Unit", harga: Number(p.harga) || 0, _client: true }));
    const paketOpts = (paketList || []).map(p => ({ nama: p.label, satuan: "Paket", harga: Number(p.harga) || 0, _forceCategory: "jasa", _include: p.include }));
    const globalOpts = (priceListData || [])
      .filter(p => p.is_active !== false)
      .map(p => ({ nama: p.type, satuan: p.unit || "Unit", harga: Number(p.price) || 0 }))
      .sort((a, b) => a.nama.localeCompare(b.nama));
    return [...clientOpts, ...paketOpts, ...globalOpts];
  }, [priceListData, extraPriceOptions, paketList]);

  // ── Grid row helpers: auto-detect kategori (jasa/material) + auto-fill harga/satuan ──
  const updateGridRow = (idx, field, val) => {
    setGridItems(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const up = { ...r, [field]: val };
      if (field === "nama") {
        const hit = priceOptions.find(p => p.nama.toLowerCase() === String(val).trim().toLowerCase());
        const isJasa = hit?._forceCategory
          ? hit._forceCategory === "jasa"
          : ["LABOR", "FEE"].includes(categoryFromCatalog(val, priceListData));
        up.category = isJasa ? "jasa" : "material";
        up.pph = isJasa;
        if (hit) { up.harga = hit.harga; up.satuan = hit.satuan; }
      }
      return up;
    }));
  };

  // ── Unit helpers ──
  const updateUnit = (idx, field, val) => {
    setAcUnits(prev => prev.map((u, i) => {
      if (i !== idx) return u;
      const up = { ...u, [field]: val };
      // Auto-fill harga dari ac_price_list saat brand/tipe/kapasitas berubah
      if (field === "brand" || field === "tipe" || field === "kapasitas") {
        const match = acPriceList.find(p =>
          p.brand === up.brand && p.tipe === up.tipe && p.kapasitas === up.kapasitas
        );
        if (match && (up.harga_satuan === 0 || !up.harga_satuan)) {
          up.harga_satuan = match.harga_unit;
          up._priceHint = match;
        } else if (match) {
          up._priceHint = match;
        } else {
          up._priceHint = null;
        }
      }
      if (field === "qty" || field === "harga_satuan")
        up.subtotal = (Number(up.qty) || 0) * (Number(up.harga_satuan) || 0);
      if ((field === "brand" || field === "tipe" || field === "kapasitas") && up.harga_satuan > 0)
        up.subtotal = (Number(up.qty) || 1) * up.harga_satuan;
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
          description: (u.nama || "").trim() || [u.brand, u.tipe, u.kapasitas, u.model].filter(Boolean).join(" ") || "Unit AC",
          qty: Number(u.qty) || 1,
          unit_price: Number(u.harga_satuan) || 0,
          subtotal: u.subtotal || 0,
          is_passthrough: true,
        });
      });
    }
    gridItems.forEach(r => {
      if (r.nama && r.harga > 0) {
        const paketHit = paketList.find(p => p.label === r.nama);
        items.push({
          item_type: r.category === "jasa" ? "jasa" : "material",
          description: r.nama,
          qty: Number(r.qty) || 1,
          unit_price: Number(r.harga) || 0,
          subtotal: (Number(r.qty) || 1) * (Number(r.harga) || 0),
          satuan: r.satuan || "Unit",
          pph: !!r.pph,
          ...(paketHit?.include ? { include: paketHit.include } : {}),
        });
      }
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
          await supabase.from("customers").upsert(row, { onConflict: "phone,name", ignoreDuplicates: true });
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
        labor:           jasaSubtotal,
        material:        Math.max(0, totalItems - jasaSubtotal),
        discount:        diskonNominal,
        trade_in_amount: tradeInNominal,
        pph23:           pph23On,
        pph23_amount:    pph23Info.amount,
        valid_until:     validUntil,
        notes:           notes || null,
        updated_at:      new Date().toISOString(),
        ...(maintenanceClientId ? { maintenance_client_id: maintenanceClientId } : {}),
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
                {withUnitAC && (() => {
                  const brandsAvailQ = [...new Set(acPriceList.map(p => p.brand))].sort();
                  const pksAvailQ    = [...new Set(acPriceList.map(p => p.kapasitas))].sort((a, b) => parseFloat(a) - parseFloat(b));
                  const filteredPLQ  = acPriceList.filter(p => {
                    const q = unitSearchQuo.toLowerCase();
                    const matchQ = !q || p.brand.toLowerCase().includes(q) || (p.seri || "").toLowerCase().includes(q) || (p.nama_varian || "").toLowerCase().includes(q) || p.kapasitas.toLowerCase().includes(q);
                    return matchQ && (!unitFilterBrandQuo || p.brand === unitFilterBrandQuo) && (!unitFilterPKQuo || p.kapasitas === unitFilterPKQuo);
                  });
                  return (
                    <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                      {/* Unit yang sudah dipilih */}
                      {acUnits.some(u => !u._manual && u.brand && u.harga_satuan > 0) && (
                        <div style={{ display: "grid", gap: 6 }}>
                          {acUnits.map((u, idx) => !u._manual && u.brand && u.harga_satuan > 0 && (
                            <div key={u._id} style={{ background: cs.surface, border: "2px solid #f59e0b55", borderRadius: 9, padding: "9px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: cs.text }}>{u.brand} {u.tipe} {u.kapasitas}</div>
                                <div style={{ fontSize: 11, color: cs.muted }}>{u.model || u.seri || ""}</div>
                                <div style={{ fontSize: 12, color: "#f59e0b", fontFamily: "monospace", fontWeight: 700 }}>{fmt(u.harga_satuan)} / unit</div>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                <button onClick={() => updateUnit(idx, "qty", Math.max(1, u.qty - 1))} style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid " + cs.border, background: cs.card, color: cs.text, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                                <span style={{ fontSize: 13, fontWeight: 700, minWidth: 16, textAlign: "center" }}>{u.qty}</span>
                                <button onClick={() => updateUnit(idx, "qty", u.qty + 1)} style={{ width: 24, height: 24, borderRadius: 5, border: "1px solid " + cs.border, background: cs.card, color: cs.text, cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                              </div>
                              <div style={{ fontSize: 12, color: "#f59e0b", fontFamily: "monospace", fontWeight: 700, minWidth: 85, textAlign: "right" }}>{fmt(u.subtotal)}</div>
                              <button onClick={() => setAcUnits(p => p.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 14 }}>✕</button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Lookup pricelist */}
                      <div style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted }}>Cari dari Pricelist</div>
                        <input value={unitSearchQuo} onChange={e => setUnitSearchQuo(e.target.value)} placeholder="🔍 Cari brand, seri, varian..."
                          style={{ ...inp, fontSize: 12 }} />
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {["", ...brandsAvailQ].map(b => (
                            <button key={b || "all"} onClick={() => setUnitFilterBrandQuo(b)}
                              style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, cursor: "pointer", background: unitFilterBrandQuo === b ? "#f59e0b" : cs.surface, border: "1px solid " + (unitFilterBrandQuo === b ? "#f59e0b" : cs.border), color: unitFilterBrandQuo === b ? "#000" : cs.text }}>
                              {b || "Semua Brand"}
                            </button>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {["", ...pksAvailQ].map(k => (
                            <button key={k || "all"} onClick={() => setUnitFilterPKQuo(k)}
                              style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, cursor: "pointer", background: unitFilterPKQuo === k ? "#f59e0b" : cs.surface, border: "1px solid " + (unitFilterPKQuo === k ? "#f59e0b" : cs.border), color: unitFilterPKQuo === k ? "#000" : cs.text }}>
                              {k || "Semua PK"}
                            </button>
                          ))}
                        </div>
                        <div style={{ maxHeight: 200, overflowY: "auto", display: "grid", gap: 4 }}>
                          {filteredPLQ.length === 0 && <div style={{ fontSize: 11, color: cs.muted, padding: "8px 0" }}>Tidak ada unit ditemukan</div>}
                          {filteredPLQ.map((p, i) => {
                            const alreadyAdded = acUnits.some(u => u.model === p.seri && u.brand === p.brand && u.harga_satuan > 0);
                            return (
                              <div key={i} onClick={() => {
                                if (alreadyAdded) return;
                                const newU = { _id: Date.now() + i, brand: p.brand, tipe: p.tipe, kapasitas: p.kapasitas, model: p.seri || "", qty: 1, harga_satuan: p.harga_unit, subtotal: p.harga_unit, is_passthrough: true, _priceHint: p };
                                setAcUnits(prev => {
                                  const emptyIdx = prev.findIndex(u => !u.brand || u.harga_satuan === 0);
                                  if (emptyIdx >= 0) return prev.map((u, ii) => ii === emptyIdx ? newU : u);
                                  return [...prev, newU];
                                });
                              }} style={{ padding: "8px 10px", borderRadius: 7, border: "1px solid " + (alreadyAdded ? "#16a34a44" : cs.border), background: alreadyAdded ? "#16a34a10" : cs.surface, cursor: alreadyAdded ? "default" : "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, opacity: alreadyAdded ? 0.7 : 1 }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: cs.text }}>{p.brand} <span style={{ color: cs.muted, fontWeight: 400 }}>{p.tipe}</span> · {p.kapasitas}</div>
                                  <div style={{ fontSize: 10, color: cs.muted }}>{p.seri}{p.nama_varian ? ` · ${p.nama_varian}` : ""}</div>
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b", fontFamily: "monospace", flexShrink: 0 }}>{fmt(p.harga_unit)}</div>
                                <div style={{ fontSize: 16, color: alreadyAdded ? "#16a34a" : "#f59e0b", flexShrink: 0 }}>{alreadyAdded ? "✓" : "+"}</div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Input manual untuk unit tidak ada di pricelist */}
                      <button onClick={() => setAcUnits(p => [...p, emptyUnit()])}
                        style={{ padding: "8px 12px", borderRadius: 8, background: cs.surface, border: "1px dashed " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 11, textAlign: "left" }}>
                        ✏️ Input manual — unit tidak ada di pricelist
                      </button>
                      {acUnits.filter(u => u._manual).map((u) => {
                        const idx = acUnits.findIndex(x => x._id === u._id);
                        return (
                          <div key={u._id} style={{ background: cs.surface, border: "1px dashed #f59e0b55", borderRadius: 9, padding: 10, display: "grid", gap: 8 }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: cs.muted }}>Unit Manual #{idx + 1}</span>
                              {acUnits.length > 1 && <button onClick={() => setAcUnits(p => p.filter((_, i) => i !== idx))} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 12 }}>Hapus</button>}
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                              <div style={{ gridColumn: "span 2" }}>
                                <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>Nama / Deskripsi Unit</div>
                                <input value={u.nama || ""} onChange={e => updateUnit(idx, "nama", e.target.value)} style={inp} placeholder="cth: AC Cassette 5PK Daikin" />
                                <div style={{ fontSize: 10, color: cs.muted, marginTop: 3 }}>Teks bebas. Jika kosong, dipakai gabungan Brand + Tipe + Kapasitas.</div>
                              </div>
                              <div>
                                <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>Brand</div>
                                <input value={u.brand} onChange={e => updateUnit(idx, "brand", e.target.value)} style={inp} placeholder="cth: LG, Samsung..." />
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
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Item & Jasa — grid bebas ala-Excel (gabungan bekas Paket & Jasa + Material Tambahan) */}
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: cs.text, marginBottom: 2 }}>🔧 Item & Jasa</div>
                <div style={{ fontSize: 11, color: cs.muted, marginBottom: 10 }}>
                  Ketik nama → auto-detect dari Price List (jasa/material/paket pemasangan). Manual tetap bisa.
                </div>
                <datalist id="quo-item-catalog">
                  {priceOptions.map((p, i) => <option key={i} value={p.nama} />)}
                </datalist>
                <div style={{ display: "grid", gap: 6 }}>
                  {gridItems.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 46px 72px 92px 92px 32px auto", gap: 6, fontSize: 10, fontWeight: 700, color: cs.muted, padding: "0 2px" }}>
                      <span>Nama Item</span><span>Qty</span><span>Satuan</span><span>Harga</span><span>Subtotal</span>
                      <span title="Kena PPh 23? (kategori Jasa)">PPh?</span><span />
                    </div>
                  )}
                  {gridItems.map((r, idx) => {
                    const subtotal = (Number(r.qty) || 0) * (Number(r.harga) || 0);
                    return (
                      <div key={r._id} style={{ display: "grid", gridTemplateColumns: "1fr 46px 72px 92px 92px 32px auto", gap: 6, alignItems: "center" }}>
                        <input list="quo-item-catalog" value={r.nama} onChange={e => updateGridRow(idx, "nama", e.target.value)}
                          style={inp} placeholder="Nama item... (auto-detect atau manual)" />
                        <input type="number" min="1" value={r.qty} onChange={e => setGridItems(p => p.map((x, i) => i === idx ? { ...x, qty: Number(e.target.value) } : x))} style={inp} />
                        <select value={r.satuan || "Unit"} onChange={e => setGridItems(p => p.map((x, i) => i === idx ? { ...x, satuan: e.target.value } : x))} style={inp}>
                          {SATUAN_OPT.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        <input type="number" min="0" value={r.harga || ""} onChange={e => setGridItems(p => p.map((x, i) => i === idx ? { ...x, harga: Number(e.target.value) } : x))} style={inp} placeholder="Harga" />
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: cs.text, textAlign: "right", paddingRight: 4 }}>{subtotal > 0 ? fmt(subtotal) : "—"}</div>
                        <label style={{ display: "flex", justifyContent: "center", cursor: "pointer" }}
                          title={r.category === "jasa" ? "Jasa — kena PPh 23 kalau diaktifkan" : "Material — biasanya tidak kena PPh 23"}>
                          <input type="checkbox" checked={!!r.pph} onChange={e => setGridItems(p => p.map((x, i) => i === idx ? { ...x, pph: e.target.checked } : x))} />
                        </label>
                        <button onClick={() => setGridItems(p => p.filter((_, i) => i !== idx))}
                          style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer", fontSize: 16 }}>×</button>
                      </div>
                    );
                  })}
                  <button onClick={() => setGridItems(p => [...p, emptyGridRow()])} style={btn(cs.accent)}>+ Tambah Baris</button>
                </div>
              </div>

              {/* Diskon, Trade-in, PPh 23 */}
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: 14, display: "grid", gap: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: cs.text }}>🏷️ Diskon & Potongan</div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
                  <div>
                    <div style={{ fontSize: 11, color: cs.muted, marginBottom: 3 }}>Diskon {diskonPct ? "(%)" : "(Rp)"}</div>
                    <input type="number" min="0" value={diskon || ""} onChange={e => setDiskon(e.target.value)} style={inp} placeholder="0" />
                  </div>
                  <label style={{ fontSize: 12, color: cs.muted, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    <input type="checkbox" checked={diskonPct} onChange={e => setDiskonPct(e.target.checked)} />
                    <span>%</span>
                  </label>
                </div>

                <div>
                  <label style={{ fontSize: 12, color: cs.muted, cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={tradeIn} onChange={e => setTradeIn(e.target.checked)} />
                    Trade-in AC lama
                  </label>
                  {tradeIn && (
                    <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {TRADE_IN_PRESETS.map(v => (
                        <button key={v} onClick={() => setTradeInAmt(v)}
                          style={{ fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 7, cursor: "pointer",
                            background: tradeInAmt === v ? cs.accent : cs.surface,
                            border: "1px solid " + (tradeInAmt === v ? cs.accent : cs.border),
                            color: tradeInAmt === v ? "#fff" : cs.muted }}>
                          {fmt(v)}
                        </button>
                      ))}
                      <input type="number" min="0" value={tradeInAmt || ""} onChange={e => setTradeInAmt(Number(e.target.value))} style={{ ...inp, maxWidth: 140 }} />
                      <span style={{ fontSize: 10, color: cs.muted }}>bisa diketik manual sesuai kesepakatan customer</span>
                    </div>
                  )}
                </div>

                <div>
                  <label style={{ fontSize: 12, color: cs.muted, cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={pph23On} onChange={e => setPph23On(e.target.checked)} />
                    PPh 23 (2,5%) — dari baris Jasa saja, ditambah ke DPP
                  </label>
                  <div style={{ fontSize: 10, color: cs.muted, marginTop: 4, maxWidth: "48ch", lineHeight: 1.5 }}>
                    Dihitung dari baris ber-centang "PPh?" di grid atas (kategori Jasa, termasuk Cleaning semua tipe/PK) — Material &amp; Unit AC tidak kena.
                    Gross-up (Total = Jasa ÷ 0,975): tidak mengurangi omset kita — cuma info DPP di PDF supaya customer transfer sesuai harga normal setelah mereka potong PPh.
                  </div>
                  {pph23On && jasaSubtotal > 0 && (
                    <div style={{ marginTop: 6, fontSize: 12, color: cs.accent, fontWeight: 700 }}>
                      PPh 23: {fmt(pph23Info.amount)} (dari jasa {fmt(jasaSubtotal)})
                    </div>
                  )}
                </div>
              </div>

              {/* Notes — opsional, untuk catatan khusus saja. T&C standar otomatis di PDF */}
              <div>
                <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Catatan Khusus (opsional)</div>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
                  style={{ ...inp, resize: "vertical" }} placeholder="Catatan khusus untuk quotation ini saja. Syarat & Ketentuan standar sudah otomatis tampil di PDF." />
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
                {totalItems > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 13, color: cs.text }}>Item & Jasa</span>
                    <span style={{ fontSize: 13, color: cs.text }}>{fmt(totalItems)}</span>
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
                {pph23On && pph23Info.amount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                    <span style={{ fontSize: 11.5, color: "#94a3b8" }}>PPh 23 (info DPP di PDF, tidak ubah total ini)</span>
                    <span style={{ fontSize: 11.5, color: "#94a3b8" }}>{fmt(pph23Info.amount)}</span>
                  </div>
                )}
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
