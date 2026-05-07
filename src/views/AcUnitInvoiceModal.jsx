import { useState, useMemo, useEffect } from "react";
import { cs } from "../theme/cs.js";

const fmt = (n) => "Rp " + (Number(n) || 0).toLocaleString("id-ID");

const BRAND_SHORTCUTS = [
  "Daikin", "Panasonic", "Sharp", "Samsung", "LG",
  "Mitsubishi", "Gree", "Haier", "Midea", "Hisense",
];
const KAPASITAS_OPT = ["0.5 PK", "0.75 PK", "1 PK", "1.5 PK", "2 PK", "2.5 PK", "3 PK", "4 PK", "5 PK"];
const TIPE_UNIT = ["Split Standard", "Split Inverter", "Cassette", "Split Duct", "Floor Standing"];

const DEFAULT_PAKET = [
  {
    key: "paket_05_1pk",
    label: "Paket Pemasangan 0,5PK – 1PK",
    harga: 1400000,
    include: [
      { nama: "Jasa Pemasangan Unit", satuan: "Unit", qty: 1 },
      { nama: "Pipa AC Hoda 1PK", satuan: "Meter", qty: 4 },
      { nama: "Kabel Control 3×1,5", satuan: "Meter", qty: 4 },
      { nama: "Breket Outdoor", satuan: "Set", qty: 1 },
      { nama: "Jasa Vacum AC", satuan: "Unit", qty: 1 },
      { nama: "Duct Tape", satuan: "Roll", qty: 1 },
    ],
  },
  {
    key: "paket_15_2pk",
    label: "Paket Pemasangan 1,5PK – 2PK",
    harga: 1600000,
    include: [
      { nama: "Jasa Pemasangan Unit", satuan: "Unit", qty: 1 },
      { nama: "Pipa AC Hoda 2PK", satuan: "Meter", qty: 4 },
      { nama: "Kabel Control 3×2,5", satuan: "Meter", qty: 4 },
      { nama: "Breket Outdoor", satuan: "Set", qty: 1 },
      { nama: "Jasa Vacum AC", satuan: "Unit", qty: 1 },
      { nama: "Duct Tape", satuan: "Roll", qty: 1 },
    ],
  },
  {
    key: "paket_25pk",
    label: "Paket Pemasangan 2,5PK",
    harga: 2000000,
    include: [
      { nama: "Jasa Pemasangan Unit", satuan: "Unit", qty: 1 },
      { nama: "Pipa AC Hoda 2,5PK", satuan: "Meter", qty: 4 },
      { nama: "Kabel Control 3×2,5", satuan: "Meter", qty: 4 },
      { nama: "Breket Outdoor", satuan: "Set", qty: 1 },
      { nama: "Jasa Vacum AC", satuan: "Unit", qty: 1 },
      { nama: "Duct Tape", satuan: "Roll", qty: 1 },
    ],
  },
];

const ADDON_PRESET = [
  { nama: "Pipa AC Hoda 1PK (tambahan)", satuan: "Meter", harga: 35000 },
  { nama: "Pipa AC Hoda 2PK (tambahan)", satuan: "Meter", harga: 45000 },
  { nama: "Kabel Control 3×1,5 (tambahan)", satuan: "Meter", harga: 18000 },
  { nama: "Kabel Control 3×2,5 (tambahan)", satuan: "Meter", harga: 22000 },
  { nama: "Duct Tape Lem", satuan: "Piece", harga: 12000 },
  { nama: "DINABOLT Set", satuan: "Set", harga: 15000 },
  { nama: "Karet Mounting", satuan: "Set", harga: 25000 },
  { nama: "Jasa Penarikan Pipa Tambahan", satuan: "Meter", harga: 25000 },
  { nama: "Freon R-32 (tambah)", satuan: "KG", harga: 120000 },
  { nama: "Freon R-22 (tambah)", satuan: "KG", harga: 95000 },
];

const TRADE_IN_AMOUNT = 250000;

const TABS = [
  { key: "customer", label: "1 · Customer" },
  { key: "unit",     label: "2 · Unit AC" },
  { key: "paket",    label: "3 · Paket & Add-on" },
  { key: "bayar",    label: "4 · Pembayaran" },
];

const emptyUnit = () => ({
  _id: Date.now() + Math.random(),
  brand: "", tipe: "Split Standard", kapasitas: "1 PK", model: "",
  qty: 1, harga_satuan: 0, subtotal: 0, is_passthrough: true,
});

export default function AcUnitInvoiceModal({ onClose, supabase, customersData, showNotif, setInvoicesData, getLocalDate }) {
  const [activeTab, setActiveTab] = useState("customer");
  const [saving, setSaving] = useState(false);

  // ── Customer ──
  const [custMode, setCustMode]         = useState("existing");
  const [custSearch, setCustSearch]     = useState("");
  const [selectedCust, setSelectedCust] = useState(null);
  const [newCust, setNewCust]           = useState({ name: "", phone: "", area: "", alamat: "" });

  // ── Unit AC ──
  const [acUnits, setAcUnits]               = useState([emptyUnit()]);
  const [showBrandPicker, setShowBrandPicker] = useState(null);

  // ── Paket pemasangan — di-load dari app_settings ──
  const [paketList, setPaketList]           = useState(DEFAULT_PAKET);
  const [paketLoading, setPaketLoading]     = useState(true);
  const [selectedPaket, setSelectedPaket]   = useState(null);
  const [showPaketDetail, setShowPaketDetail] = useState(false);
  const [useTanpaPaket, setUseTanpaPaket]   = useState(false);

  // ── Edit Paket modal ──
  const [editPaketOpen, setEditPaketOpen]     = useState(false);
  const [editingPaket, setEditingPaket]       = useState(null);
  const [editingPaketIdx, setEditingPaketIdx] = useState(null);
  const [savingPaket, setSavingPaket]         = useState(false);

  // Manual items (hanya aktif jika tanpa_paket)
  const [manualJasa, setManualJasa] = useState([]);
  const [manualMat, setManualMat]   = useState([]);

  // ── Add-on material (post-install) ──
  const [addonItems, setAddonItems]       = useState([]);
  const [showAddonPicker, setShowAddonPicker] = useState(false);
  const [addonSearch, setAddonSearch]     = useState("");

  // ── Diskon & Trade-In ──
  const [diskon, setDiskon]       = useState(0);
  const [diskonPct, setDiskonPct] = useState(false);
  const [tradeIn, setTradeIn]     = useState(false);

  // ── Pembayaran ──
  const [dpMode, setDpMode]       = useState("lunas");
  const [dpAmount, setDpAmount]   = useState("");
  const [payMethod, setPayMethod] = useState("Transfer Bank");
  const [notes, setNotes]         = useState("");

  // ── Load paket dari Supabase ──
  useEffect(() => {
    if (!supabase) { setPaketLoading(false); return; }
    supabase
      .from("app_settings")
      .select("value")
      .eq("key", "ac_paket_list")
      .single()
      .then(({ data, error }) => {
        if (!error && data?.value) {
          try {
            const parsed = typeof data.value === "string" ? JSON.parse(data.value) : data.value;
            if (Array.isArray(parsed) && parsed.length > 0) setPaketList(parsed);
          } catch (_) {}
        }
        setPaketLoading(false);
      });
  }, [supabase]);

  // ── Kalkulasi ──
  const totalUnitAC = useMemo(
    () => acUnits.reduce((s, u) => s + (u.subtotal || 0), 0), [acUnits]
  );

  const totalPaket = useTanpaPaket
    ? (manualJasa.reduce((s, j) => s + j.subtotal, 0) + manualMat.reduce((s, m) => s + m.subtotal, 0))
    : (selectedPaket?.harga || 0);

  const totalAddon = useMemo(
    () => addonItems.reduce((s, a) => s + a.qty * a.harga, 0), [addonItems]
  );

  const diskonNominal = diskonPct
    ? Math.round((totalUnitAC + totalPaket + totalAddon) * (parseFloat(diskon) / 100))
    : (parseFloat(diskon) || 0);

  const tradeInNominal = tradeIn ? TRADE_IN_AMOUNT : 0;
  const subtotalSebelumPotongan = totalUnitAC + totalPaket + totalAddon;
  const grandTotal = Math.max(0, subtotalSebelumPotongan - diskonNominal - tradeInNominal);

  // Omset AClean = paket + addon saja; unit AC passthrough tidak masuk
  const omsetAClean = totalPaket + totalAddon;

  const dpVal      = parseInt(String(dpAmount).replace(/\D/g, "")) || 0;
  const sisaBayar  = grandTotal - dpVal;
  const dpMelebihi = dpMode === "dp" && dpVal > grandTotal && grandTotal > 0;

  // ── Customer display ──
  const custDisplay = custMode === "existing"
    ? selectedCust
    : (newCust.name ? { name: newCust.name, phone: newCust.phone, area: newCust.area } : null);

  const filteredCust = (customersData || []).filter(c =>
    !custSearch ||
    (c.name || "").toLowerCase().includes(custSearch.toLowerCase()) ||
    (c.phone || "").includes(custSearch)
  );

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

  // ── Tab navigation ──
  const tabIdx = TABS.findIndex(t => t.key === activeTab);
  const goNext = () => setActiveTab(TABS[Math.min(tabIdx + 1, TABS.length - 1)].key);
  const goPrev = () => setActiveTab(TABS[Math.max(tabIdx - 1, 0)].key);

  const canNext = {
    customer: !!custDisplay,
    unit: acUnits.some(u => u.brand && u.harga_satuan > 0),
    paket: useTanpaPaket || !!selectedPaket,
    bayar: true,
  };

  // ── Simpan paket ke Supabase ──
  const handleSavePaket = async () => {
    if (!supabase) return;
    setSavingPaket(true);
    try {
      const { error } = await supabase
        .from("app_settings")
        .upsert({ key: "ac_paket_list", value: JSON.stringify(paketList) }, { onConflict: "key" });
      if (error) throw error;
      showNotif?.("✅ Daftar paket tersimpan");
      setEditPaketOpen(false);
      setEditingPaket(null);
      setEditingPaketIdx(null);
    } catch (err) {
      showNotif?.("❌ Gagal simpan: " + (err.message || err));
    } finally {
      setSavingPaket(false);
    }
  };

  // ── Buat invoice ke Supabase ──
  const handleBuatInvoice = async () => {
    if (!supabase) return;
    if (!custDisplay) { showNotif?.("⚠️ Pilih customer dahulu"); return; }
    if (!canNext.paket) { showNotif?.("⚠️ Pilih paket pemasangan"); return; }
    if (dpMelebihi) return;

    setSaving(true);
    try {
      const today = getLocalDate?.() || new Date().toISOString().slice(0, 10);
      const invoiceId = "INV-" + today.replace(/-/g, "") + "-" + Math.random().toString(36).toUpperCase().slice(2, 7);

      // Tentukan status pembayaran
      let status = "UNPAID";
      let paidAt = null;
      let paidAmount = 0;
      if (dpMode === "lunas") {
        status = "PAID";
        paidAt = today;
        paidAmount = grandTotal;
      } else if (dpMode === "dp" && dpVal > 0) {
        status = "PARTIAL_PAID";
        paidAmount = dpVal;
      }

      // Insert customer baru jika perlu (tidak ada FK ke invoices, tapi data customer tetap disimpan)
      if (custMode === "baru" && newCust.name) {
        const { error: custErr } = await supabase
          .from("customers")
          .insert({ name: newCust.name, phone: newCust.phone, area: newCust.area, address: newCust.alamat });
        if (custErr) console.warn("Gagal simpan customer baru:", custErr.message);
      }

      // Build invoice row — hanya kolom yang ada di tabel invoices
      const invoicePayload = {
        id:              invoiceId,
        invoice_type:    "ac_unit_sale",
        status,
        paid_at:         paidAt,
        paid_amount:     paidAmount,
        remaining_amount: grandTotal - paidAmount,
        customer:        custDisplay.name,
        phone:           custDisplay.phone || null,
        service:         "Install AC",
        total:           grandTotal,
        unit_ac_amount:  totalUnitAC,
        paket_pasang:    useTanpaPaket ? null : (selectedPaket || null),
        labor:           totalPaket,
        material:        totalAddon,
        discount:        diskonNominal,
        trade_in:        tradeIn,
        trade_in_amount: tradeInNominal,
        notes:           notes || null,
        paid_method:     dpMode !== "nanti" ? payMethod : null,
      };

      const { error: invErr } = await supabase
        .from("invoices")
        .insert(invoicePayload);
      if (invErr) throw invErr;

      // Build invoice_items rows — subtotal adalah generated column (qty*unit_price), jangan di-insert
      const items = [];

      // Unit AC rows (passthrough)
      acUnits.forEach(u => {
        if (!u.brand || u.harga_satuan <= 0) return;
        items.push({
          invoice_id:  invoiceId,
          item_type:   "unit_ac",
          description: `${u.brand} ${u.tipe} ${u.kapasitas}${u.model ? " " + u.model : ""}`,
          qty:         u.qty,
          unit_price:  u.harga_satuan,
        });
      });

      // Paket row
      if (!useTanpaPaket && selectedPaket) {
        items.push({
          invoice_id:  invoiceId,
          item_type:   "paket",
          description: selectedPaket.label,
          qty:         1,
          unit_price:  selectedPaket.harga,
        });
      }

      // Manual jasa rows (tanpa paket)
      manualJasa.forEach(j => {
        if (!j.nama || j.subtotal <= 0) return;
        items.push({
          invoice_id:  invoiceId,
          item_type:   "jasa",
          description: j.nama,
          qty:         1,
          unit_price:  j.subtotal,
        });
      });

      // Manual material rows (tanpa paket)
      manualMat.forEach(m => {
        if (!m.nama || m.subtotal <= 0) return;
        items.push({
          invoice_id:  invoiceId,
          item_type:   "material",
          description: m.nama,
          qty:         1,
          unit_price:  m.subtotal,
        });
      });

      // Add-on rows
      addonItems.forEach(a => {
        if (a.qty <= 0) return;
        items.push({
          invoice_id:  invoiceId,
          item_type:   "addon",
          description: `${a.nama} (${a.satuan})`,
          qty:         a.qty,
          unit_price:  a.harga,
        });
      });

      if (items.length > 0) {
        const { error: itemsErr } = await supabase.from("invoice_items").insert(items);
        if (itemsErr) throw itemsErr;
      }

      // Jika DP, catat payment row — kolom: invoice_id, amount, method, is_partial, paid_at, customer_name, customer_phone, invoice_ids, total_amount
      if (dpMode === "dp" && dpVal > 0) {
        await supabase.from("payments").insert({
          invoice_id:     invoiceId,
          invoice_ids:    [invoiceId],
          customer_name:  custDisplay.name,
          customer_phone: custDisplay.phone || null,
          amount:         dpVal,
          total_amount:   dpVal,
          method:         payMethod,
          is_partial:     true,
          paid_at:        today,
        });
      }

      showNotif?.(`✅ Invoice AC berhasil dibuat (${status})`);

      // Refresh invoice list di parent
      if (setInvoicesData) {
        const { data: fresh } = await supabase
          .from("invoices")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(300);
        if (fresh) setInvoicesData(fresh);
      }

      onClose();
    } catch (err) {
      showNotif?.("❌ Gagal buat invoice: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000c", zIndex: 500, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
      <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 620, maxHeight: "94vh", overflowY: "auto", display: "flex", flexDirection: "column" }}>

        {/* ── Header ── */}
        <div style={{ padding: "16px 20px 0", borderBottom: "1px solid " + cs.border + "55" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>🛒 Invoice Penjualan & Instalasi AC</div>
              <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>
                {custDisplay ? `${custDisplay.name} · ${custDisplay.phone || ""}` : "Pilih customer dahulu"}
              </div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>

          {/* Tab bar */}
          <div style={{ display: "flex", marginTop: 12, borderBottom: "2px solid " + cs.border }}>
            {TABS.map((t, i) => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={{
                flex: 1, padding: "8px 4px", fontSize: 11,
                fontWeight: activeTab === t.key ? 700 : 400,
                color: activeTab === t.key ? cs.accent : cs.muted,
                background: "transparent", border: "none",
                borderBottom: activeTab === t.key ? "2px solid " + cs.accent : "2px solid transparent",
                cursor: "pointer", marginBottom: -2
              }}>
                {t.label}
                {((i === 0 && canNext.customer) || (i === 1 && canNext.unit)) &&
                  <span style={{ marginLeft: 3, color: "#22c55e", fontSize: 10 }}>✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* ══════════════════════════════════════════
            TAB 1 — CUSTOMER
        ══════════════════════════════════════════ */}
        {activeTab === "customer" && (
          <div style={{ padding: "16px 20px", display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {[["existing", "👤 Customer Lama"], ["baru", "➕ Customer Baru"]].map(([m, lbl]) => (
                <button key={m} onClick={() => { setCustMode(m); setSelectedCust(null); setCustSearch(""); }}
                  style={{
                    flex: 1, padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 700, fontSize: 13,
                    background: custMode === m ? cs.accent : cs.card,
                    border: "1px solid " + (custMode === m ? cs.accent : cs.border),
                    color: custMode === m ? "#fff" : cs.text,
                  }}>{lbl}</button>
              ))}
            </div>

            {custMode === "existing" && (
              <>
                <input value={custSearch} onChange={e => { setCustSearch(e.target.value); setSelectedCust(null); }}
                  placeholder="Cari nama atau no HP..." autoFocus
                  style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "10px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
                <div style={{ maxHeight: 200, overflowY: "auto", display: "grid", gap: 6 }}>
                  {filteredCust.map(c => (
                    <div key={c.id} onClick={() => { setSelectedCust(c); setCustSearch(c.name); }}
                      style={{
                        padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                        background: selectedCust?.id === c.id ? cs.accent + "22" : cs.card,
                        border: "1px solid " + (selectedCust?.id === c.id ? cs.accent : cs.border),
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                      }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: cs.muted }}>{c.phone} · {c.area}</div>
                      </div>
                      {selectedCust?.id === c.id && <span style={{ color: cs.accent, fontSize: 16 }}>✓</span>}
                    </div>
                  ))}
                  {filteredCust.length === 0 && (
                    <div style={{ padding: 12, color: cs.muted, fontSize: 12, textAlign: "center" }}>
                      Tidak ditemukan —
                      <button onClick={() => { setCustMode("baru"); setNewCust(p => ({ ...p, name: custSearch })); }}
                        style={{ marginLeft: 6, color: cs.accent, background: "none", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>Buat baru?</button>
                    </div>
                  )}
                </div>
              </>
            )}

            {custMode === "baru" && (
              <div style={{ display: "grid", gap: 10 }}>
                {[
                  { key: "name", label: "Nama Lengkap *", ph: "Budi Santoso / PT Maju Jaya" },
                  { key: "phone", label: "No HP / WhatsApp *", ph: "0812-3456-7890" },
                  { key: "area", label: "Area / Wilayah", ph: "Kelapa Gading, Sunter..." },
                  { key: "alamat", label: "Alamat Lengkap", ph: "Jl. ... No. ..." },
                ].map(f => (
                  <div key={f.key}>
                    <label style={{ fontSize: 11, color: cs.muted, display: "block", marginBottom: 4 }}>{f.label}</label>
                    <input value={newCust[f.key]} onChange={e => setNewCust(p => ({ ...p, [f.key]: e.target.value }))}
                      placeholder={f.ph}
                      style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
                  </div>
                ))}
              </div>
            )}

            {custDisplay && (
              <div style={{ background: cs.accent + "15", border: "1px solid " + cs.accent + "44", borderRadius: 10, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: cs.accent, fontWeight: 700, marginBottom: 4 }}>✓ Customer</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: cs.text }}>{custDisplay.name}</div>
                <div style={{ fontSize: 11, color: cs.muted }}>{custDisplay.phone} · {custDisplay.area}</div>
              </div>
            )}

            <button onClick={goNext} disabled={!custDisplay}
              style={{ padding: "12px", borderRadius: 10, background: custDisplay ? cs.accent : cs.border, border: "none", color: custDisplay ? "#fff" : cs.muted, fontWeight: 700, fontSize: 14, cursor: custDisplay ? "pointer" : "not-allowed" }}>
              {custDisplay ? "Lanjut → Unit AC" : "Pilih customer dahulu"}
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════
            TAB 2 — UNIT AC
        ══════════════════════════════════════════ */}
        {activeTab === "unit" && (
          <div style={{ padding: "16px 20px", display: "grid", gap: 14 }}>
            <div style={{ background: "#f59e0b15", border: "1px solid #f59e0b44", borderRadius: 10, padding: "10px 14px", fontSize: 12, color: "#f59e0b" }}>
              Harga unit = passthrough toko (tidak masuk omset AClean). Isi harga sesuai harga toko kepada customer.
            </div>

            {acUnits.map((unit, idx) => (
              <div key={unit._id} style={{ background: cs.card, border: "2px solid #f59e0b44", borderRadius: 12, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#f59e0b" }}>Unit #{idx + 1}</div>
                  {acUnits.length > 1 && (
                    <button onClick={() => setAcUnits(p => p.filter((_, i) => i !== idx))}
                      style={{ background: "#ef444415", border: "none", color: "#ef4444", borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontSize: 11 }}>Hapus</button>
                  )}
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: cs.muted, display: "block", marginBottom: 4 }}>Brand *</label>
                  <input value={unit.brand} onChange={e => updateUnit(idx, "brand", e.target.value)}
                    onFocus={() => setShowBrandPicker(idx)}
                    onBlur={() => setTimeout(() => setShowBrandPicker(null), 150)}
                    placeholder="Ketik atau pilih brand..."
                    style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box" }} />
                  {showBrandPicker === idx && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                      {BRAND_SHORTCUTS.map(b => (
                        <button key={b} onMouseDown={() => updateUnit(idx, "brand", b)} style={{
                          fontSize: 11, padding: "3px 10px", borderRadius: 99, cursor: "pointer",
                          background: unit.brand === b ? "#f59e0b" : cs.surface,
                          border: "1px solid " + (unit.brand === b ? "#f59e0b" : cs.border),
                          color: unit.brand === b ? "#000" : cs.text,
                        }}>{b}</button>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: cs.muted, display: "block", marginBottom: 4 }}>Tipe</label>
                    <select value={unit.tipe} onChange={e => updateUnit(idx, "tipe", e.target.value)}
                      style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12 }}>
                      {TIPE_UNIT.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: cs.muted, display: "block", marginBottom: 4 }}>Kapasitas</label>
                    <select value={unit.kapasitas} onChange={e => updateUnit(idx, "kapasitas", e.target.value)}
                      style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12 }}>
                      {KAPASITAS_OPT.map(k => <option key={k}>{k}</option>)}
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: cs.muted, display: "block", marginBottom: 4 }}>Model / Seri <span style={{ fontWeight: 400 }}>(opsional)</span></label>
                  <input value={unit.model} onChange={e => updateUnit(idx, "model", e.target.value)}
                    placeholder="cth: FTNE25UAV4"
                    style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 12px", color: cs.text, fontSize: 12, boxSizing: "border-box" }} />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "75px 1fr", gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 11, color: cs.muted, display: "block", marginBottom: 4 }}>Qty</label>
                    <input type="number" min="1" value={unit.qty} onChange={e => updateUnit(idx, "qty", parseInt(e.target.value) || 1)}
                      style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px", color: cs.text, fontSize: 13, textAlign: "center", boxSizing: "border-box" }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: cs.muted, display: "block", marginBottom: 4 }}>Harga Unit (dari toko) *</label>
                    <input type="number" min="0" step="50000" value={unit.harga_satuan || ""}
                      onChange={e => updateUnit(idx, "harga_satuan", parseInt(e.target.value) || 0)}
                      placeholder="0"
                      style={{ width: "100%", background: cs.surface, border: "1px solid #f59e0b55", borderRadius: 8, padding: "8px 12px", color: "#f59e0b", fontSize: 14, fontFamily: "monospace", fontWeight: 700, boxSizing: "border-box" }} />
                  </div>
                </div>

                {unit.subtotal > 0 && (
                  <div style={{ marginTop: 8, textAlign: "right", fontSize: 12, color: "#f59e0b" }}>
                    Subtotal: <strong style={{ fontFamily: "monospace" }}>{fmt(unit.subtotal)}</strong>
                    <span style={{ marginLeft: 6, fontSize: 10, color: cs.muted }}>(passthrough)</span>
                  </div>
                )}
              </div>
            ))}

            <button onClick={() => setAcUnits(p => [...p, emptyUnit()])} style={{
              padding: "10px", borderRadius: 10, background: "#f59e0b15",
              border: "1px dashed #f59e0b88", color: "#f59e0b", cursor: "pointer", fontSize: 13, fontWeight: 700,
            }}>+ Tambah Unit Lagi</button>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={goPrev} style={{ flex: 1, padding: "11px", borderRadius: 10, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 13 }}>← Kembali</button>
              <button onClick={goNext} style={{ flex: 2, padding: "11px", borderRadius: 10, background: cs.accent, border: "none", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Lanjut → Paket & Add-on</button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════
            TAB 3 — PAKET & ADD-ON
        ══════════════════════════════════════════ */}
        {activeTab === "paket" && (
          <div style={{ padding: "16px 20px", display: "grid", gap: 14 }}>

            {/* ── Pilih Paket ── */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>📦 Paket Pemasangan</div>
                <button onClick={() => setEditPaketOpen(true)} style={{
                  fontSize: 11, background: cs.card, border: "1px solid " + cs.border,
                  color: cs.muted, borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontWeight: 600,
                }}>⚙️ Edit Paket & Harga</button>
              </div>

              {paketLoading ? (
                <div style={{ padding: 20, textAlign: "center", color: cs.muted, fontSize: 12 }}>Memuat daftar paket...</div>
              ) : (
                <div style={{ display: "grid", gap: 8 }}>
                  {paketList.map((p) => {
                    const isSelected = selectedPaket?.key === p.key && !useTanpaPaket;
                    return (
                      <div key={p.key} onClick={() => { setSelectedPaket(p); setUseTanpaPaket(false); setShowPaketDetail(false); }}
                        style={{
                          borderRadius: 12, cursor: "pointer", overflow: "hidden",
                          border: "2px solid " + (isSelected ? cs.accent : cs.border),
                          background: isSelected ? cs.accent + "12" : cs.card,
                        }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <div style={{
                              width: 18, height: 18, borderRadius: 99,
                              border: "2px solid " + (isSelected ? cs.accent : cs.border),
                              background: isSelected ? cs.accent : "transparent",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              {isSelected && <div style={{ width: 8, height: 8, borderRadius: 99, background: "#fff" }} />}
                            </div>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 700, color: isSelected ? cs.accent : cs.text }}>{p.label}</div>
                              <div style={{ fontSize: 10, color: cs.muted, marginTop: 1 }}>{p.include.length} item sudah include</div>
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 15, fontWeight: 800, color: isSelected ? cs.accent : cs.text, fontFamily: "monospace" }}>{fmt(p.harga)}</div>
                            {isSelected && (
                              <button onClick={e => { e.stopPropagation(); setShowPaketDetail(v => !v); }}
                                style={{ fontSize: 10, background: "none", border: "none", color: cs.muted, cursor: "pointer", padding: 0, marginTop: 2 }}>
                                {showPaketDetail ? "▲ Sembunyikan" : "▼ Lihat detail"}
                              </button>
                            )}
                          </div>
                        </div>

                        {isSelected && showPaketDetail && p.include.length > 0 && (
                          <div style={{ borderTop: "1px solid " + cs.border + "55", padding: "10px 14px 12px", background: cs.surface }}>
                            <div style={{ fontSize: 11, color: cs.muted, fontWeight: 700, marginBottom: 6 }}>SUDAH INCLUDE:</div>
                            {p.include.map((item, ii) => (
                              <div key={ii} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: cs.text, padding: "3px 0", borderBottom: ii < p.include.length - 1 ? "1px solid " + cs.border + "22" : "none" }}>
                                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ color: "#22c55e", fontSize: 10 }}>✓</span>{item.nama}
                                </span>
                                <span style={{ color: cs.muted }}>{item.qty} {item.satuan}</span>
                              </div>
                            ))}
                            <div style={{ marginTop: 8, fontSize: 11, color: "#f59e0b", background: "#f59e0b12", borderRadius: 6, padding: "5px 8px" }}>
                              💡 Material aktual diverifikasi dari laporan teknisi setelah install
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Tanpa Paket option */}
                  <div onClick={() => { setUseTanpaPaket(true); setSelectedPaket(null); }}
                    style={{
                      borderRadius: 12, cursor: "pointer", padding: "12px 14px",
                      border: "2px solid " + (useTanpaPaket ? cs.accent : cs.border),
                      background: useTanpaPaket ? cs.accent + "12" : cs.card,
                      display: "flex", alignItems: "center", gap: 10,
                    }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: 99,
                      border: "2px solid " + (useTanpaPaket ? cs.accent : cs.border),
                      background: useTanpaPaket ? cs.accent : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      {useTanpaPaket && <div style={{ width: 8, height: 8, borderRadius: 99, background: "#fff" }} />}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: useTanpaPaket ? cs.accent : cs.text }}>Tanpa Paket (input manual)</div>
                      <div style={{ fontSize: 10, color: cs.muted }}>Isi jasa & material secara bebas</div>
                    </div>
                  </div>
                </div>
              )}

              {!selectedPaket && !useTanpaPaket && (
                <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 6, padding: "6px 10px", background: "#f59e0b12", borderRadius: 6 }}>
                  ⚠️ Pilih paket pemasangan atau "Tanpa Paket"
                </div>
              )}
            </div>

            {/* ── UI untuk mode Tanpa Paket ── */}
            {useTanpaPaket && (
              <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px", display: "grid", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>🔧 Jasa & Material (input manual)</div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: cs.muted }}>Item Jasa</span>
                    <button onClick={() => setManualJasa(p => [...p, { _id: Date.now(), nama: "", subtotal: 0 }])}
                      style={{ fontSize: 11, background: cs.accent + "20", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 6, padding: "3px 9px", cursor: "pointer" }}>+ Jasa</button>
                  </div>
                  {manualJasa.map((j, ji) => (
                    <div key={j._id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 28px", gap: 5, marginBottom: 5, alignItems: "center" }}>
                      <input value={j.nama} onChange={e => setManualJasa(p => p.map((x, xi) => xi === ji ? { ...x, nama: e.target.value } : x))}
                        placeholder="Nama jasa..."
                        style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "6px 8px", color: cs.text, fontSize: 12 }} />
                      <input type="number" min="0" value={j.subtotal || ""} placeholder="Harga"
                        onChange={e => setManualJasa(p => p.map((x, xi) => xi === ji ? { ...x, subtotal: parseInt(e.target.value) || 0 } : x))}
                        style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "6px 8px", color: cs.accent, fontSize: 12, fontFamily: "monospace" }} />
                      <button onClick={() => setManualJasa(p => p.filter((_, xi) => xi !== ji))}
                        style={{ background: "#ef444415", border: "none", color: "#ef4444", borderRadius: 5, padding: "4px 6px", cursor: "pointer", fontSize: 12 }}>×</button>
                    </div>
                  ))}
                  {manualJasa.length === 0 && <div style={{ fontSize: 11, color: cs.muted, padding: "4px 0" }}>Belum ada item jasa</div>}
                </div>

                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: cs.muted }}>Item Material</span>
                    <button onClick={() => setManualMat(p => [...p, { _id: Date.now(), nama: "", subtotal: 0 }])}
                      style={{ fontSize: 11, background: cs.green + "20", border: "1px solid " + cs.green + "44", color: cs.green, borderRadius: 6, padding: "3px 9px", cursor: "pointer" }}>+ Material</button>
                  </div>
                  {manualMat.map((m, mi) => (
                    <div key={m._id} style={{ display: "grid", gridTemplateColumns: "1fr 110px 28px", gap: 5, marginBottom: 5, alignItems: "center" }}>
                      <input value={m.nama} onChange={e => setManualMat(p => p.map((x, xi) => xi === mi ? { ...x, nama: e.target.value } : x))}
                        placeholder="Nama material..."
                        style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "6px 8px", color: cs.text, fontSize: 12 }} />
                      <input type="number" min="0" value={m.subtotal || ""} placeholder="Harga"
                        onChange={e => setManualMat(p => p.map((x, xi) => xi === mi ? { ...x, subtotal: parseInt(e.target.value) || 0 } : x))}
                        style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 6, padding: "6px 8px", color: cs.green, fontSize: 12, fontFamily: "monospace" }} />
                      <button onClick={() => setManualMat(p => p.filter((_, xi) => xi !== mi))}
                        style={{ background: "#ef444415", border: "none", color: "#ef4444", borderRadius: 5, padding: "4px 6px", cursor: "pointer", fontSize: 12 }}>×</button>
                    </div>
                  ))}
                  {manualMat.length === 0 && <div style={{ fontSize: 11, color: cs.muted, padding: "4px 0" }}>Belum ada item material</div>}
                </div>

                {totalPaket > 0 && (
                  <div style={{ textAlign: "right", fontSize: 11, color: cs.muted }}>
                    Total manual: <strong style={{ color: cs.accent, fontFamily: "monospace" }}>{fmt(totalPaket)}</strong>
                  </div>
                )}
              </div>
            )}

            {/* ── Add-on Material (post-install) ── */}
            <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: cs.green }}>🔩 Add-on Material</div>
                  <div style={{ fontSize: 10, color: cs.muted }}>Material di luar paket standar — bisa ditambah setelah install</div>
                </div>
                <button onClick={() => setShowAddonPicker(p => !p)} style={{
                  fontSize: 11, background: cs.green + "20", border: "1px solid " + cs.green + "44",
                  color: cs.green, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 700,
                }}>
                  {showAddonPicker ? "✕ Tutup" : "+ Tambah"}
                </button>
              </div>

              {showAddonPicker && (
                <div style={{ marginBottom: 10 }}>
                  <input value={addonSearch} onChange={e => setAddonSearch(e.target.value)}
                    placeholder="Cari material add-on..."
                    autoFocus
                    style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12, marginBottom: 6, boxSizing: "border-box" }} />
                  <div style={{ maxHeight: 160, overflowY: "auto", background: cs.surface, borderRadius: 8, border: "1px solid " + cs.border }}>
                    {ADDON_PRESET.filter(a => !addonSearch || a.nama.toLowerCase().includes(addonSearch.toLowerCase())).map((a, ai) => (
                      <div key={ai} onClick={() => {
                        setAddonItems(p => [...p, { _id: Date.now() + ai, nama: a.nama, qty: 1, satuan: a.satuan, harga: a.harga }]);
                        setShowAddonPicker(false); setAddonSearch("");
                      }}
                        style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, color: cs.text, borderBottom: "1px solid " + cs.border + "33", display: "flex", justifyContent: "space-between" }}
                        onMouseEnter={e => e.currentTarget.style.background = cs.green + "10"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                        <span>{a.nama} <span style={{ color: cs.muted, fontSize: 10 }}>/{a.satuan}</span></span>
                        <span style={{ color: cs.green, fontFamily: "monospace", fontWeight: 700 }}>{fmt(a.harga)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {addonItems.length > 0 ? (
                <div style={{ display: "grid", gap: 5, marginBottom: 8 }}>
                  {addonItems.map((a, ai) => (
                    <div key={a._id} style={{ display: "grid", gridTemplateColumns: "1fr 60px 28px 100px 28px", gap: 5, alignItems: "center", padding: "6px 8px", background: cs.surface, borderRadius: 8 }}>
                      <span style={{ fontSize: 11, color: cs.text }}>{a.nama}</span>
                      <input type="number" min="0" step="0.5" value={a.qty}
                        onChange={e => setAddonItems(p => p.map((x, xi) => xi === ai ? { ...x, qty: parseFloat(e.target.value) || 0 } : x))}
                        style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 5, padding: "4px", color: cs.text, fontSize: 11, textAlign: "center" }} />
                      <span style={{ fontSize: 10, color: cs.muted, textAlign: "center" }}>{a.satuan}</span>
                      <span style={{ fontSize: 12, color: cs.green, fontFamily: "monospace", textAlign: "right" }}>{fmt(a.qty * a.harga)}</span>
                      <button onClick={() => setAddonItems(p => p.filter((_, xi) => xi !== ai))}
                        style={{ background: "#ef444415", border: "none", color: "#ef4444", borderRadius: 5, padding: "4px 6px", cursor: "pointer", fontSize: 12 }}>×</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: "10px", color: cs.muted, fontSize: 11 }}>
                  Belum ada add-on — tambah setelah laporan instalasi masuk
                </div>
              )}

              {addonItems.length > 0 && (
                <div style={{ textAlign: "right", fontSize: 11, color: cs.muted }}>
                  Total add-on: <strong style={{ color: cs.green, fontFamily: "monospace" }}>{fmt(totalAddon)}</strong>
                </div>
              )}
            </div>

            {/* ── Diskon & Trade-In ── */}
            <div style={{ background: cs.card, border: "1px solid #be123c33", borderRadius: 12, padding: "14px 16px", display: "grid", gap: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#f43f5e" }}>🏷️ Potongan Harga</div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <label style={{ fontSize: 12, color: cs.text, fontWeight: 600 }}>Diskon</label>
                  <div style={{ display: "flex", border: "1px solid " + cs.border, borderRadius: 6, overflow: "hidden" }}>
                    {[false, true].map(isPct => (
                      <button key={String(isPct)} onClick={() => { setDiskonPct(isPct); setDiskon(0); }}
                        style={{
                          padding: "4px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600,
                          background: diskonPct === isPct ? cs.accent : "transparent",
                          border: "none", color: diskonPct === isPct ? "#fff" : cs.muted,
                        }}>{isPct ? "%" : "Rp"}</button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="number" min="0"
                    max={diskonPct ? 100 : undefined}
                    value={diskon || ""}
                    onChange={e => setDiskon(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    style={{ flex: 1, background: cs.surface, border: "1px solid #be123c55", borderRadius: 8, padding: "9px 12px", color: "#f43f5e", fontSize: 14, fontFamily: "monospace", fontWeight: 700 }} />
                  <span style={{ fontSize: 12, color: cs.muted }}>{diskonPct ? "%" : "Rp"}</span>
                  {diskonNominal > 0 && (
                    <span style={{ fontSize: 13, color: "#f43f5e", fontFamily: "monospace", fontWeight: 700, minWidth: 100, textAlign: "right" }}>
                      − {fmt(diskonNominal)}
                    </span>
                  )}
                </div>
              </div>

              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 14px", borderRadius: 10,
                background: tradeIn ? "#f43f5e15" : cs.surface,
                border: "1px solid " + (tradeIn ? "#f43f5e55" : cs.border),
                cursor: "pointer",
              }} onClick={() => setTradeIn(p => !p)}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 4,
                    border: "2px solid " + (tradeIn ? "#f43f5e" : cs.border),
                    background: tradeIn ? "#f43f5e" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, color: "#fff",
                  }}>{tradeIn ? "✓" : ""}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: tradeIn ? "#f43f5e" : cs.text }}>Trade-In Unit Lama</div>
                    <div style={{ fontSize: 11, color: cs.muted }}>Potongan tukar tambah AC lama</div>
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#f43f5e", fontFamily: "monospace" }}>
                  − {fmt(TRADE_IN_AMOUNT)}
                </div>
              </div>

              {(diskonNominal > 0 || tradeIn) && (
                <div style={{ fontSize: 11, color: "#f43f5e", textAlign: "right" }}>
                  Total potongan: <strong style={{ fontFamily: "monospace" }}>{fmt(diskonNominal + tradeInNominal)}</strong>
                </div>
              )}
            </div>

            {/* ── Mini summary ── */}
            <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ display: "grid", gap: 5, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: cs.muted }}>Unit AC <span style={{ fontSize: 10, color: "#f59e0b" }}>(passthrough)</span></span>
                  <span style={{ color: "#f59e0b", fontFamily: "monospace" }}>{fmt(totalUnitAC)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: cs.muted }}>
                    {useTanpaPaket ? "Jasa & Material" : (selectedPaket?.label || "Paket belum dipilih")}
                  </span>
                  <span style={{ color: cs.accent, fontFamily: "monospace" }}>{fmt(totalPaket)}</span>
                </div>
                {totalAddon > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: cs.muted }}>Add-on Material</span>
                    <span style={{ color: cs.green, fontFamily: "monospace" }}>{fmt(totalAddon)}</span>
                  </div>
                )}
                {(diskonNominal > 0 || tradeIn) && (
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "#f43f5e" }}>Potongan</span>
                    <span style={{ color: "#f43f5e", fontFamily: "monospace" }}>− {fmt(diskonNominal + tradeInNominal)}</span>
                  </div>
                )}
                <div style={{ borderTop: "1px solid " + cs.border, paddingTop: 6, marginTop: 2, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 700, color: cs.text }}>Total Tagihan</span>
                  <span style={{ fontWeight: 800, fontSize: 15, color: cs.text, fontFamily: "monospace" }}>{fmt(grandTotal)}</span>
                </div>
                <div style={{ background: cs.accent + "15", border: "1px solid " + cs.accent + "44", borderRadius: 7, padding: "6px 10px", display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.accent }}>Omset AClean</div>
                    <div style={{ fontSize: 10, color: cs.muted }}>Paket + Add-on (tanpa unit)</div>
                  </div>
                  <span style={{ fontWeight: 800, color: cs.accent, fontFamily: "monospace" }}>{fmt(omsetAClean)}</span>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={goPrev} style={{ flex: 1, padding: "11px", borderRadius: 10, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 13 }}>← Kembali</button>
              <button onClick={goNext} style={{ flex: 2, padding: "11px", borderRadius: 10, background: cs.accent, border: "none", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>Lanjut → Pembayaran</button>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════
            TAB 4 — PEMBAYARAN
        ══════════════════════════════════════════ */}
        {activeTab === "bayar" && (
          <div style={{ padding: "16px 20px", display: "grid", gap: 14 }}>

            {/* Ringkasan */}
            <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 10 }}>📊 Ringkasan Invoice</div>
              <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: cs.muted }}>Unit AC <span style={{ fontSize: 10, color: "#f59e0b" }}>(passthrough)</span></span>
                  <span style={{ color: "#f59e0b", fontFamily: "monospace" }}>{fmt(totalUnitAC)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: cs.muted }}>{useTanpaPaket ? "Jasa & Material" : (selectedPaket?.label || "-")}</span>
                  <span style={{ color: cs.accent, fontFamily: "monospace" }}>{fmt(totalPaket)}</span>
                </div>
                {totalAddon > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: cs.muted }}>Add-on Material</span>
                  <span style={{ color: cs.green, fontFamily: "monospace" }}>{fmt(totalAddon)}</span>
                </div>}
                {(diskonNominal > 0 || tradeIn) && <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#f43f5e" }}>Potongan</span>
                  <span style={{ color: "#f43f5e", fontFamily: "monospace" }}>− {fmt(diskonNominal + tradeInNominal)}</span>
                </div>}
                <div style={{ borderTop: "1px solid " + cs.border, paddingTop: 8, marginTop: 2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: cs.text }}>Total Tagihan</span>
                    <span style={{ fontSize: 17, fontWeight: 800, fontFamily: "monospace", color: cs.text }}>{fmt(grandTotal)}</span>
                  </div>
                </div>
                <div style={{ background: cs.accent + "15", border: "1px solid " + cs.accent + "44", borderRadius: 8, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: cs.accent }}>Omset AClean</div>
                    <div style={{ fontSize: 10, color: cs.muted }}>Paket + Add-on saja</div>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 800, color: cs.accent, fontFamily: "monospace" }}>{fmt(omsetAClean)}</span>
                </div>
              </div>
            </div>

            {/* Opsi bayar */}
            <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.text, marginBottom: 10 }}>💳 Opsi Pembayaran</div>
              <div style={{ display: "grid", gap: 8 }}>
                {[
                  { key: "lunas", icon: "✅", label: "Lunas Sekarang", desc: "Customer bayar penuh saat ini" },
                  { key: "dp",    icon: "🔖", label: "DP / Uang Muka", desc: "Bayar sebagian, sisa setelah instalasi" },
                  { key: "nanti", icon: "📋", label: "Tagih Nanti", desc: "Invoice dibuat, belum ada pembayaran" },
                ].map(opt => (
                  <div key={opt.key} onClick={() => setDpMode(opt.key)} style={{
                    padding: "11px 14px", borderRadius: 10, cursor: "pointer",
                    background: dpMode === opt.key ? cs.accent + "18" : cs.surface,
                    border: "2px solid " + (dpMode === opt.key ? cs.accent : cs.border),
                    display: "flex", alignItems: "center", gap: 12,
                  }}>
                    <span style={{ fontSize: 18 }}>{opt.icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: dpMode === opt.key ? cs.accent : cs.text }}>{opt.label}</div>
                      <div style={{ fontSize: 11, color: cs.muted }}>{opt.desc}</div>
                    </div>
                    {dpMode === opt.key && <span style={{ marginLeft: "auto", color: cs.accent, fontSize: 16 }}>✓</span>}
                  </div>
                ))}
              </div>

              {dpMode === "dp" && (
                <div style={{ background: "#f59e0b15", border: "1px solid #f59e0b44", borderRadius: 10, padding: "12px 14px", marginTop: 12 }}>
                  <label style={{ fontSize: 11, color: cs.muted, display: "block", marginBottom: 6 }}>Jumlah DP</label>
                  <input type="number" min="0" value={dpAmount}
                    onChange={e => setDpAmount(e.target.value)}
                    placeholder="0"
                    style={{ width: "100%", background: cs.surface, border: "1px solid #f59e0b66", borderRadius: 8, padding: "10px 12px", color: "#f59e0b", fontSize: 16, fontFamily: "monospace", fontWeight: 700, boxSizing: "border-box" }} />
                  {dpVal > 0 && (
                    <div style={{ marginTop: 10, display: "grid", gap: 4, fontSize: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: cs.muted }}>DP dibayar</span>
                        <span style={{ color: "#f59e0b", fontFamily: "monospace" }}>{fmt(dpVal)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: cs.muted }}>Sisa tagihan</span>
                        <span style={{ color: sisaBayar <= 0 ? "#22c55e" : "#ef4444", fontFamily: "monospace", fontWeight: 700 }}>
                          {sisaBayar <= 0 ? "✓ Lunas" : fmt(sisaBayar)}
                        </span>
                      </div>
                      {dpMelebihi && (
                        <div style={{ background: "#ef444415", border: "1px solid #ef444444", borderRadius: 6, padding: "6px 10px", fontSize: 11, color: "#ef4444" }}>
                          ⚠️ DP melebihi total tagihan ({fmt(grandTotal)}). Periksa kembali.
                        </div>
                      )}
                      {!dpMelebihi && (
                        <div style={{ fontSize: 10, color: cs.muted, marginTop: 2 }}>
                          Status → <strong style={{ color: "#06b6d4" }}>PARTIAL PAID</strong> · Sisa ditagih setelah install + add-on dikonfirmasi
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {dpMode !== "nanti" && (
                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: 11, color: cs.muted, display: "block", marginBottom: 6 }}>Metode Pembayaran</label>
                  <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                    style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 13, boxSizing: "border-box" }}>
                    {["Transfer Bank", "BCA", "BNI", "BRI", "Mandiri", "GoPay", "OVO", "DANA", "Cash"].map(m => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Alur */}
            <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: cs.muted, marginBottom: 10 }}>ALUR SELANJUTNYA</div>
              <div style={{ display: "grid", gap: 7 }}>
                {[
                  { n: "1", txt: "Invoice dibuat — customer terima ringkasan" },
                  { n: "2", txt: dpMode === "nanti" ? "Invoice UNPAID — belum ada pembayaran" : dpMode === "dp" ? `DP ${dpVal > 0 ? fmt(dpVal) : "..."} dicatat → PARTIAL PAID` : "Bayar lunas → PAID" },
                  { n: "3", txt: "Jadwal instalasi dibuat di Planning Order" },
                  { n: "4", txt: "Teknisi install, submit laporan material aktual" },
                  ...(dpMode !== "lunas" ? [
                    { n: "5", txt: "Admin tambah add-on material ke invoice ini" },
                    { n: "6", txt: "Tagih kekurangan → customer bayar sisa → PAID" },
                  ] : [
                    { n: "5", txt: "Admin verifikasi material aktual dari laporan" },
                  ]),
                ].map(s => (
                  <div key={s.n} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{ minWidth: 22, height: 22, borderRadius: 99, background: cs.accent + "33", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: cs.accent }}>
                      {s.n}
                    </div>
                    <div style={{ fontSize: 12, color: cs.text, paddingTop: 3 }}>{s.txt}</div>
                  </div>
                ))}
              </div>
            </div>

            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Catatan (garansi unit, request customer, dll)"
              rows={2}
              style={{ width: "100%", background: cs.card, border: "1px solid " + cs.border, borderRadius: 8, padding: "9px 12px", color: cs.text, fontSize: 12, resize: "vertical", boxSizing: "border-box" }} />

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={goPrev} disabled={saving} style={{ flex: 1, padding: "11px", borderRadius: 10, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 13 }}>← Kembali</button>
              <button
                disabled={dpMelebihi || saving}
                onClick={handleBuatInvoice}
                style={{ flex: 2, padding: "11px", borderRadius: 10, background: (dpMelebihi || saving) ? cs.border : "#22c55e", border: "none", color: "#fff", fontWeight: 800, cursor: (dpMelebihi || saving) ? "not-allowed" : "pointer", fontSize: 14 }}>
                {saving ? "Menyimpan..." :
                  dpMode === "lunas" ? "✅ Buat Invoice + Lunas"
                  : dpMode === "dp" ? `🔖 Buat Invoice + DP ${dpVal > 0 ? fmt(dpVal) : ""}`
                  : "📋 Buat Invoice"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════
          MODAL EDIT PAKET & HARGA
      ══════════════════════════════════════════ */}
      {editPaketOpen && (
        <div style={{ position: "fixed", inset: 0, background: "#000b", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 580, maxHeight: "90vh", overflowY: "auto", padding: 20 }}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: cs.text }}>⚙️ Edit Paket Pemasangan</div>
                <div style={{ fontSize: 11, color: cs.muted, marginTop: 2 }}>Ubah nama, harga, dan isi item setiap paket</div>
              </div>
              <button onClick={() => { setEditPaketOpen(false); setEditingPaket(null); setEditingPaketIdx(null); }}
                style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
            </div>

            {editingPaket === null ? (
              <div style={{ display: "grid", gap: 10 }}>
                {paketList.map((p, pi) => (
                  <div key={p.key} style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                      <div style={{ flex: 1 }}>
                        <input
                          value={p.label}
                          onChange={e => setPaketList(prev => prev.map((x, xi) => xi === pi ? { ...x, label: e.target.value } : x))}
                          style={{ width: "100%", background: "transparent", border: "none", borderBottom: "1px solid " + cs.border, color: cs.text, fontSize: 13, fontWeight: 700, padding: "2px 0", marginBottom: 6, boxSizing: "border-box" }}
                        />
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 11, color: cs.muted }}>Harga Paket:</span>
                          <div style={{ display: "flex", alignItems: "center", background: cs.accent + "15", border: "1px solid " + cs.accent + "44", borderRadius: 7, padding: "4px 10px", gap: 4 }}>
                            <span style={{ fontSize: 11, color: cs.muted }}>Rp</span>
                            <input
                              type="number" min="0" step="50000"
                              value={p.harga}
                              onChange={e => setPaketList(prev => prev.map((x, xi) => xi === pi ? { ...x, harga: parseInt(e.target.value) || 0 } : x))}
                              style={{ background: "transparent", border: "none", color: cs.accent, fontSize: 15, fontFamily: "monospace", fontWeight: 800, width: 110, textAlign: "right" }}
                            />
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, marginLeft: 10, flexShrink: 0 }}>
                        <button onClick={() => { setEditingPaket(JSON.parse(JSON.stringify(p))); setEditingPaketIdx(pi); }}
                          style={{ fontSize: 11, background: cs.accent + "20", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 7, padding: "5px 10px", cursor: "pointer", fontWeight: 700 }}>
                          ✏️ Edit Item
                        </button>
                        {paketList.length > 1 && (
                          <button onClick={() => {
                            if (!window.confirm(`Hapus paket "${p.label}"?`)) return;
                            const updated = paketList.filter((_, xi) => xi !== pi);
                            setPaketList(updated);
                            if (selectedPaket?.key === p.key) setSelectedPaket(null);
                          }}
                            style={{ fontSize: 11, background: "#ef444415", border: "1px solid #ef444444", color: "#ef4444", borderRadius: 7, padding: "5px 10px", cursor: "pointer" }}>
                            🗑
                          </button>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {p.include.map((item, ii) => (
                        <span key={ii} style={{ fontSize: 10, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 99, padding: "2px 8px", color: cs.muted }}>
                          {item.nama} ({item.qty} {item.satuan})
                        </span>
                      ))}
                    </div>
                  </div>
                ))}

                <button onClick={() => {
                  const newP = {
                    key: "paket_custom_" + Date.now(),
                    label: "Paket Baru",
                    harga: 0,
                    include: [{ nama: "Jasa Pemasangan Unit", satuan: "Unit", qty: 1 }],
                  };
                  setPaketList(prev => [...prev, newP]);
                }}
                  style={{ padding: "11px", borderRadius: 10, background: "#f59e0b15", border: "1px dashed #f59e0b88", color: "#f59e0b", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
                  + Tambah Paket Baru
                </button>

                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setEditPaketOpen(false); setEditingPaket(null); setEditingPaketIdx(null); }}
                    style={{ flex: 1, padding: "11px", borderRadius: 10, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 13 }}>
                    Batal
                  </button>
                  <button onClick={handleSavePaket} disabled={savingPaket}
                    style={{ flex: 2, padding: "11px", borderRadius: 10, background: savingPaket ? cs.border : "#22c55e", border: "none", color: "#fff", fontWeight: 700, cursor: savingPaket ? "not-allowed" : "pointer", fontSize: 13 }}>
                    {savingPaket ? "Menyimpan..." : "✅ Simpan Perubahan"}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button onClick={() => { setEditingPaket(null); setEditingPaketIdx(null); }}
                    style={{ background: cs.card, border: "1px solid " + cs.border, color: cs.muted, borderRadius: 7, padding: "5px 12px", cursor: "pointer", fontSize: 12 }}>
                    ← Kembali
                  </button>
                  <div style={{ fontSize: 13, fontWeight: 700, color: cs.text }}>{editingPaket.label}</div>
                </div>

                <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>Item yang Include dalam Paket</div>
                    <button onClick={() => setEditingPaket(prev => ({ ...prev, include: [...prev.include, { nama: "", satuan: "Unit", qty: 1 }] }))}
                      style={{ fontSize: 11, background: cs.accent + "20", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>
                      + Tambah Item
                    </button>
                  </div>

                  {editingPaket.include.map((item, ii) => (
                    <div key={ii} style={{ display: "grid", gridTemplateColumns: "1fr 55px 70px 28px", gap: 6, alignItems: "center", marginBottom: 7, padding: "8px 10px", background: cs.surface, borderRadius: 8 }}>
                      <input value={item.nama}
                        onChange={e => setEditingPaket(prev => ({ ...prev, include: prev.include.map((x, xi) => xi === ii ? { ...x, nama: e.target.value } : x) }))}
                        placeholder="Nama item..."
                        style={{ background: "transparent", border: "none", borderBottom: "1px solid " + cs.border, color: cs.text, fontSize: 12, padding: "2px 4px" }} />
                      <input type="number" min="0" step="0.5" value={item.qty}
                        onChange={e => setEditingPaket(prev => ({ ...prev, include: prev.include.map((x, xi) => xi === ii ? { ...x, qty: parseFloat(e.target.value) || 1 } : x) }))}
                        style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 5, padding: "4px 5px", color: cs.text, fontSize: 11, textAlign: "center" }} />
                      <input value={item.satuan}
                        onChange={e => setEditingPaket(prev => ({ ...prev, include: prev.include.map((x, xi) => xi === ii ? { ...x, satuan: e.target.value } : x) }))}
                        placeholder="satuan"
                        style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 5, padding: "4px 5px", color: cs.muted, fontSize: 11 }} />
                      <button onClick={() => setEditingPaket(prev => ({ ...prev, include: prev.include.filter((_, xi) => xi !== ii) }))}
                        style={{ background: "#ef444415", border: "none", color: "#ef4444", borderRadius: 5, padding: "4px 6px", cursor: "pointer", fontSize: 12 }}>×</button>
                    </div>
                  ))}

                  {editingPaket.include.length === 0 && (
                    <div style={{ textAlign: "center", color: cs.muted, fontSize: 11, padding: 12 }}>Belum ada item — klik "+ Tambah Item"</div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => { setEditingPaket(null); setEditingPaketIdx(null); }}
                    style={{ flex: 1, padding: "11px", borderRadius: 10, background: cs.card, border: "1px solid " + cs.border, color: cs.muted, cursor: "pointer", fontSize: 13 }}>
                    Batal
                  </button>
                  <button onClick={() => {
                    setPaketList(prev => prev.map((x, xi) => xi === editingPaketIdx ? { ...editingPaket } : x));
                    if (selectedPaket?.key === editingPaket.key) setSelectedPaket({ ...editingPaket });
                    setEditingPaket(null); setEditingPaketIdx(null);
                  }}
                    style={{ flex: 2, padding: "11px", borderRadius: 10, background: cs.accent, border: "none", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>
                    ✓ Terapkan ke Paket
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
