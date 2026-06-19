import { useState, useEffect } from "react";
import { cs } from "../theme/cs.js";
import { summarize, checkInvoiceConsistency, describeInconsistency, normalizeLines, categoryOf, LINE_CATEGORY, computePph23 } from "../lib/invoicing.js";

export default function EditInvoiceModal({
  open, onClose,
  editInvoiceData, editInvoiceForm, setEditInvoiceForm,
  editInvoiceItems, setEditInvoiceItems,
  editJasaItems, setEditJasaItems,
  priceListData, inventoryData, customersData,
  lookupHargaGlobal, parseMD, fmt,
  appSettings, currentUser, supabase,
  showNotif, addAgentLog,
  updateInvoice, setInvoicesData,
  auditUserName, _apiHeaders,
}) {
  const [editAddType, setEditAddType] = useState("");
  const [editAddSearch, setEditAddSearch] = useState("");
  const [voucherCheckCode, setVoucherCheckCode] = useState("");
  const [voucherCheckResult, setVoucherCheckResult] = useState(null);
  const [voucherCheckLoading, setVoucherCheckLoading] = useState(false);
  const [voucherApplied, setVoucherApplied] = useState(null);

  useEffect(() => {
    if (open) {
      setEditAddType(""); setEditAddSearch("");
      setVoucherCheckCode(""); setVoucherCheckResult(null);
      setVoucherCheckLoading(false); setVoucherApplied(null);
    }
  }, [open]);

  if (!open || !editInvoiceData) return null;

  const jasaLookup = priceListData
    .filter(r => r.service !== "Material" && (r.price || 0) > 0)
    .map(r => ({ label: r.service + " / " + r.type, harga: r.price || 0, satuan: r.unit || "Unit" }));

  const matLookup = (() => {
    const seen = new Set();
    const items = [];
    inventoryData.forEach(r => {
      const harga = lookupHargaGlobal(r.name, r.unit);
      items.push({ label: r.name, harga, satuan: r.unit || "pcs" });
      seen.add(r.name);
    });
    priceListData.filter(r => r.service === "Material" || r.service === "Install")
      .forEach(r => {
        if (r.type && !seen.has(r.type)) {
          items.push({ label: r.type, harga: r.price || 0, satuan: r.unit || "pcs" });
          seen.add(r.type);
        }
      });
    return items;
  })();

  const filteredJasa = jasaLookup.filter(x => x.label.toLowerCase().includes(editAddSearch.toLowerCase()));
  const filteredMat = matLookup.filter(x => x.label.toLowerCase().includes(editAddSearch.toLowerCase()));

  const jasaTotal = editJasaItems.reduce((s, m) => s + (m.subtotal || 0), 0);
  const matTotal = editInvoiceItems.reduce((s, m) => s + (m.subtotal || 0), 0);
  const editDiscount = parseInt(editInvoiceForm.discount || 0) || 0;
  const editTradeIn = !!editInvoiceForm.trade_in;
  const editTradeInAmt = editTradeIn ? (parseInt(editInvoiceForm.trade_in_amount) || 0) : 0;
  const newTotal = jasaTotal + matTotal - editDiscount - editTradeInAmt;

  const handleClose = () => {
    setEditAddType(""); setEditAddSearch("");
    onClose();
  };

  const handleSave = async () => {
    const discountFinal = parseInt(editInvoiceForm.discount || 0) || 0;
    const tradeInFinal = !!editInvoiceForm.trade_in;
    const tradeInAmtFinal = tradeInFinal ? (parseInt(editInvoiceForm.trade_in_amount) || 0) : 0;
    const jasaRows = editJasaItems.filter(m => m.nama && (m.jumlah || 0) > 0)
      .map(({ category, ...rest }) => ({ ...rest, keterangan: "jasa" }));
    const matRows = editInvoiceItems.filter(m => m.nama && (m.jumlah || 0) > 0)
      .map(({ category, ...rest }) => {
        const ket = String(rest.keterangan || "").toLowerCase();
        return { ...rest, keterangan: ["barang", "freon", "diskon"].includes(ket) ? rest.keterangan : "barang" };
      });
    const newMD = normalizeLines([...jasaRows, ...matRows]);
    const _s = summarize(newMD, { discount: discountFinal, tradeIn: tradeInAmtFinal });
    const labor = _s.labor;
    const material = _s.material;
    const newTotalFinal = _s.total;
    if (newTotalFinal <= 0 && !tradeInFinal && discountFinal === 0) { showNotif("⚠️ Total tidak boleh 0"); return; }
    const pph23On = !!editInvoiceForm.pph23;
    const pph23Amt = pph23On ? computePph23(newTotalFinal, parseFloat(appSettings?.pph23_rate) || 0.025).amount : 0;
    const billingName = (editInvoiceForm.billing_name ?? editInvoiceData.customer) || editInvoiceData.customer;
    const billingAddress = editInvoiceForm.billing_address ?? (editInvoiceData.address || "");
    setInvoicesData(prev => prev.map(i => i.id === editInvoiceData.id
      ? { ...i, labor, material, discount: discountFinal, trade_in: tradeInFinal, trade_in_amount: tradeInAmtFinal, total: newTotalFinal, pph23: pph23On, pph23_amount: pph23Amt, materials_detail: newMD, customer: billingName, address: billingAddress } : i));
    {
      const _chk = checkInvoiceConsistency({ ...editInvoiceData, lines: newMD, labor, material, discount: discountFinal, trade_in_amount: tradeInAmtFinal, total: newTotalFinal });
      if (!_chk.ok) addAgentLog("INVOICE_INVARIANT", describeInconsistency(_chk, editInvoiceData.id) + " (edit nilai)", "WARNING");
    }
    let saved = false;
    {
      const { error: e1 } = await updateInvoice(supabase, editInvoiceData.id, {
        labor, material, discount: discountFinal, trade_in: tradeInFinal, trade_in_amount: tradeInAmtFinal, total: newTotalFinal,
        pph23: pph23On, pph23_amount: pph23Amt,
        materials_detail: JSON.stringify(newMD), customer: billingName, address: billingAddress
      }, auditUserName()); if (!e1) saved = true; else console.warn("editInv e1:", e1.message);
    }
    if (!saved) {
      const { error: e2 } = await updateInvoice(supabase, editInvoiceData.id, { labor, material, discount: discountFinal, trade_in: tradeInFinal, trade_in_amount: tradeInAmtFinal, total: newTotalFinal }, auditUserName());
      if (!e2) saved = true;
    }
    if (!saved) await updateInvoice(supabase, editInvoiceData.id, { total: newTotalFinal }, auditUserName());
    addAgentLog("INVOICE_EDITED", `Invoice ${editInvoiceData.id} diedit → ${fmt(newTotalFinal)}` + (editInvoiceForm.notes ? ` (${editInvoiceForm.notes})` : "") + " by Owner", "SUCCESS");
    showNotif(`✅ Invoice ${editInvoiceData.id} diupdate → ${fmt(newTotalFinal)}`);
    onClose();
  };

  const samePhoneCusts = customersData.filter(c => c.phone === editInvoiceData.phone && c.name !== editInvoiceData.customer);

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000d", zIndex: 450, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 20, width: "100%", maxWidth: 560, maxHeight: "90vh", overflowY: "auto", padding: 20 }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, color: cs.text }}>✏️ Edit Invoice</div>
            <div style={{ fontSize: 12, color: cs.muted, marginTop: 2 }}>{editInvoiceData.id} · {editInvoiceData.customer}</div>
          </div>
          <button onClick={handleClose} style={{ background: "none", border: "none", color: cs.muted, fontSize: 22, cursor: "pointer" }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 14 }}>

          {/* Atas Nama Invoice */}
          <div style={{ background: cs.card, border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: "12px 14px", display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>🏢 Atas Nama Invoice</div>
            <div>
              <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Nama / Perusahaan *</div>
              <input value={editInvoiceForm.billing_name ?? editInvoiceData.customer}
                onChange={e => setEditInvoiceForm(f => ({ ...f, billing_name: e.target.value }))}
                list="billing-name-opts"
                placeholder={editInvoiceData.customer}
                style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
              {samePhoneCusts.length > 0 && (
                <datalist id="billing-name-opts">
                  <option value={editInvoiceData.customer} />
                  {samePhoneCusts.map(c => <option key={c.id} value={c.name} />)}
                </datalist>
              )}
              {samePhoneCusts.length > 0 && (
                <div style={{ fontSize: 10, color: cs.muted, marginTop: 4 }}>
                  💡 Lokasi lain di nomor ini: {samePhoneCusts.map(c => c.name).join(", ")}
                </div>
              )}
            </div>
            <div>
              <div style={{ fontSize: 11, color: cs.muted, marginBottom: 4 }}>Alamat</div>
              <input value={editInvoiceForm.billing_address ?? (editInvoiceData.address || "")}
                onChange={e => setEditInvoiceForm(f => ({ ...f, billing_address: e.target.value }))}
                placeholder="Alamat lengkap untuk invoice..."
                style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
            </div>
          </div>

          {/* Jasa / Labor */}
          <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.accent }}>🔧 Jasa / Labor</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { setEditJasaItems(prev => [...prev, { nama: "", jumlah: 1, satuan: "Unit", harga_satuan: 0, subtotal: 0, _idx: Date.now() }]); setEditAddType(""); setEditAddSearch(""); }}
                  style={{ fontSize: 11, background: cs.card, border: "1px solid " + cs.accent + "66", color: cs.accent, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>+ Manual</button>
                <button onClick={() => { setEditAddType(editAddType === "jasa" ? "" : "jasa"); setEditAddSearch(""); }}
                  style={{ fontSize: 11, background: cs.accent + "20", border: "1px solid " + cs.accent + "44", color: cs.accent, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>
                  {editAddType === "jasa" ? "✕ Tutup" : "+ Dari List"}
                </button>
              </div>
            </div>
            {editAddType === "jasa" && (
              <div style={{ marginBottom: 10 }}>
                <input autoFocus value={editAddSearch} onChange={e => setEditAddSearch(e.target.value)}
                  placeholder="Cari jasa... (Cleaning, Install, Repair...)"
                  style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12, marginBottom: 6 }} />
                <div style={{ maxHeight: 180, overflowY: "auto", background: cs.surface, borderRadius: 8, border: "1px solid " + cs.border }}>
                  {filteredJasa.slice(0, 25).map((item, idx) => (
                    <div key={idx} onClick={() => { setEditJasaItems(prev => [...prev, { nama: item.label, jumlah: 1, satuan: item.satuan || "Unit", harga_satuan: item.harga, subtotal: item.harga, _idx: Date.now() + idx }]); setEditAddType(""); setEditAddSearch(""); }}
                      style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, color: cs.text, borderBottom: "1px solid " + cs.border + "44", display: "flex", justifyContent: "space-between" }}
                      onMouseEnter={e => e.currentTarget.style.background = cs.accent + "15"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <span>{item.label}</span>
                      <span style={{ fontFamily: "monospace", color: cs.accent, fontWeight: 700 }}>{fmt(item.harga)}</span>
                    </div>
                  ))}
                  {filteredJasa.length === 0 && <div style={{ padding: "10px 12px", color: cs.muted, fontSize: 12 }}>Tidak ada hasil</div>}
                </div>
              </div>
            )}
            {editJasaItems.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {editJasaItems.map((m, mi) => (
                  <div key={m._idx || mi} style={{ display: "grid", gridTemplateColumns: "1fr 55px 30px 100px 28px", gap: 5, alignItems: "center", marginBottom: 6, padding: "6px 8px", background: cs.surface, borderRadius: 8 }}>
                    <input value={m.nama || ""} onChange={e => setEditJasaItems(prev => prev.map((x, xi) => xi === mi ? { ...x, nama: e.target.value } : x))}
                      style={{ background: "transparent", border: "none", borderBottom: "1px solid " + cs.border, color: cs.text, fontSize: 12, padding: "2px 4px" }} />
                    <input type="number" min="0" step="0.1" value={m.jumlah || 1}
                      onChange={e => setEditJasaItems(prev => prev.map((x, xi) => xi === mi ? { ...x, jumlah: parseFloat(e.target.value) || 0, subtotal: (parseFloat(e.target.value) || 0) * (x.harga_satuan || 0) } : x))}
                      style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "4px 5px", color: cs.text, fontSize: 11, textAlign: "center" }} />
                    <span style={{ fontSize: 10, color: cs.muted, textAlign: "center" }}>{m.satuan}</span>
                    <input type="number" min="0" value={m.harga_satuan || 0}
                      onChange={e => setEditJasaItems(prev => prev.map((x, xi) => xi === mi ? { ...x, harga_satuan: parseInt(e.target.value) || 0, subtotal: (parseInt(e.target.value) || 0) * (x.jumlah || 0) } : x))}
                      style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "4px 5px", color: cs.text, fontSize: 11, fontFamily: "monospace", textAlign: "right" }} />
                    <button onClick={() => setEditJasaItems(prev => prev.filter((_x, xi) => xi !== mi))}
                      style={{ background: "#ef444420", border: "none", color: "#ef4444", borderRadius: 5, padding: "4px 6px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: cs.muted, textAlign: "right" }}>
              Subtotal jasa: <strong style={{ color: cs.accent, fontFamily: "monospace" }}>{fmt(jasaTotal)}</strong>
            </div>
          </div>

          {/* Material */}
          <div style={{ background: cs.card, border: "1px solid " + cs.border, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cs.green }}>📦 Material</div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => { setEditInvoiceItems(prev => [...prev, { nama: "", jumlah: 1, satuan: "Pcs", harga_satuan: 0, subtotal: 0, _idx: Date.now() }]); setEditAddType(""); setEditAddSearch(""); }}
                  style={{ fontSize: 11, background: cs.card, border: "1px solid " + cs.green + "66", color: cs.green, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>+ Manual</button>
                <button onClick={() => { setEditAddType(editAddType === "material" ? "" : "material"); setEditAddSearch(""); }}
                  style={{ fontSize: 11, background: cs.green + "20", border: "1px solid " + cs.green + "44", color: cs.green, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontWeight: 700 }}>
                  {editAddType === "material" ? "✕ Tutup" : "+ Dari List"}
                </button>
              </div>
            </div>
            {editAddType === "material" && (
              <div style={{ marginBottom: 10 }}>
                <input autoFocus value={editAddSearch} onChange={e => setEditAddSearch(e.target.value)}
                  placeholder="Cari material... (Freon, Pipa, Kabel...)"
                  style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 12, marginBottom: 6 }} />
                <div style={{ maxHeight: 160, overflowY: "auto", background: cs.surface, borderRadius: 8, border: "1px solid " + cs.border }}>
                  {filteredMat.slice(0, 20).map((item, idx) => (
                    <div key={idx} onClick={() => { setEditInvoiceItems(prev => [...prev, { nama: item.label, jumlah: 1, satuan: item.satuan, harga_satuan: item.harga, subtotal: item.harga, _idx: Date.now() + idx }]); setEditAddType(""); setEditAddSearch(""); }}
                      style={{ padding: "8px 12px", cursor: "pointer", fontSize: 12, color: cs.text, borderBottom: "1px solid " + cs.border + "44", display: "flex", justifyContent: "space-between", alignItems: "center" }}
                      onMouseEnter={e => e.currentTarget.style.background = cs.green + "10"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <span>{item.label} <span style={{ fontSize: 10, color: cs.muted }}>/ {item.satuan}</span></span>
                      <span style={{ fontFamily: "monospace", color: cs.green, fontWeight: 700 }}>{fmt(item.harga)}</span>
                    </div>
                  ))}
                  {filteredMat.length === 0 && <div style={{ padding: "10px 12px", color: cs.muted, fontSize: 12 }}>Tidak ada hasil</div>}
                </div>
              </div>
            )}
            {editInvoiceItems.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {editInvoiceItems.map((m, mi) => (
                  <div key={m._idx || mi} style={{ display: "grid", gridTemplateColumns: "1fr 60px 30px 100px 28px", gap: 5, alignItems: "center", marginBottom: 6, padding: "6px 8px", background: cs.surface, borderRadius: 8 }}>
                    <input value={m.nama || ""} onChange={e => setEditInvoiceItems(prev => prev.map((x, xi) => xi === mi ? { ...x, nama: e.target.value } : x))}
                      style={{ background: "transparent", border: "none", borderBottom: "1px solid " + cs.border, color: cs.text, fontSize: 12, padding: "2px 4px" }} />
                    <input type="number" min="0" step="0.1" value={m.jumlah || 1}
                      onChange={e => setEditInvoiceItems(prev => prev.map((x, xi) => xi === mi ? { ...x, jumlah: parseFloat(e.target.value) || 0, subtotal: (parseFloat(e.target.value) || 0) * (x.harga_satuan || 0) } : x))}
                      style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "4px 5px", color: cs.text, fontSize: 11, textAlign: "center" }} />
                    <span style={{ fontSize: 10, color: cs.muted, textAlign: "center" }}>{m.satuan}</span>
                    <input type="number" min="0" value={m.harga_satuan || 0}
                      onChange={e => setEditInvoiceItems(prev => prev.map((x, xi) => xi === mi ? { ...x, harga_satuan: parseInt(e.target.value) || 0, subtotal: (parseInt(e.target.value) || 0) * (x.jumlah || 0) } : x))}
                      style={{ background: cs.surface, border: "1px solid " + cs.border, borderRadius: 5, padding: "4px 5px", color: cs.text, fontSize: 11, fontFamily: "monospace", textAlign: "right" }} />
                    <button onClick={() => setEditInvoiceItems(prev => prev.filter((_, xi) => xi !== mi))}
                      style={{ background: "#ef444420", border: "none", color: "#ef4444", borderRadius: 5, padding: "4px 6px", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: cs.muted, textAlign: "right" }}>
              Subtotal material: <strong style={{ color: cs.green, fontFamily: "monospace" }}>{fmt(matTotal)}</strong>
            </div>
          </div>

          {/* Potongan: Discount, Voucher, Trade-In, PPh23 */}
          <div style={{ background: cs.card, border: "1px solid #be123c33", borderRadius: 10, padding: "12px 14px", display: "grid", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#f43f5e" }}>🏷️ Potongan Harga</div>

            {/* Discount */}
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: cs.text }}>
                <input type="checkbox" checked={!!(editInvoiceForm.discount > 0)}
                  onChange={e => setEditInvoiceForm(f => ({ ...f, discount: e.target.checked ? (f._discountVal || 0) : 0, _discountVal: e.target.checked ? (f._discountVal || 0) : f.discount }))}
                  style={{ width: 16, height: 16, accentColor: "#f43f5e" }} />
                Discount
              </label>
              <input type="number" min="0" step="10000" value={editInvoiceForm.discount || ""}
                onChange={e => setEditInvoiceForm(f => ({ ...f, discount: parseInt(e.target.value) || 0, _discountVal: parseInt(e.target.value) || 0 }))}
                placeholder="Rp 0"
                style={{ flex: 1, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "6px 10px", color: "#f43f5e", fontSize: 13, fontFamily: "monospace", fontWeight: 700 }} />
            </div>

            {/* Voucher Loyalty */}
            <div style={{ borderTop: "1px dashed #be123c33", paddingTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f43f5e", marginBottom: 6 }}>🎁 Voucher Loyalty</div>
              {voucherApplied ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "8px 10px" }}>
                  <span style={{ fontSize: 14 }}>✅</span>
                  <div style={{ flex: 1, fontSize: 12 }}>
                    <strong style={{ color: "#15803d" }}>{voucherApplied.code}</strong>
                    <span style={{ color: "#16a34a", marginLeft: 6 }}>{voucherApplied.type_label}</span>
                  </div>
                  <button onClick={() => { setVoucherApplied(null); setVoucherCheckResult(null); setVoucherCheckCode(""); setEditInvoiceForm(f => ({ ...f, discount: 0 })); }}
                    style={{ fontSize: 11, color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}>Hapus</button>
                </div>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={voucherCheckCode}
                    onChange={e => { setVoucherCheckCode(e.target.value.toUpperCase()); setVoucherCheckResult(null); }}
                    placeholder="Kode voucher (cth: ACL-K3M9P2)"
                    style={{ flex: 1, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 7, padding: "6px 10px", color: cs.text, fontSize: 12, fontFamily: "monospace" }} />
                  <button disabled={voucherCheckLoading || !voucherCheckCode.trim()}
                    onClick={async () => {
                      if (!voucherCheckCode.trim() || !editInvoiceData?.phone) return;
                      setVoucherCheckLoading(true); setVoucherCheckResult(null);
                      try {
                        const hdrs = await _apiHeaders();
                        const r = await fetch("/api/validate-voucher", { method: "POST", headers: hdrs, body: JSON.stringify({ code: voucherCheckCode.trim(), phone: editInvoiceData.phone, invoice_id: editInvoiceData.id }) });
                        const d = await r.json();
                        if (r.ok && d.valid) setVoucherCheckResult({ valid: true, voucher: d.voucher });
                        else setVoucherCheckResult({ error: d.error || "Voucher tidak valid" });
                      } catch { setVoucherCheckResult({ error: "Gagal cek voucher" }); }
                      finally { setVoucherCheckLoading(false); }
                    }}
                    style={{ padding: "6px 14px", borderRadius: 7, border: "none", background: voucherCheckLoading ? cs.border : "#f43f5e", color: "#fff", cursor: voucherCheckLoading ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
                    {voucherCheckLoading ? "..." : "Cek"}
                  </button>
                </div>
              )}
              {voucherCheckResult?.error && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#f87171", padding: "6px 10px", background: "#fef2f2", borderRadius: 6 }}>❌ {voucherCheckResult.error}</div>
              )}
              {voucherCheckResult?.valid && !voucherApplied && (
                <div style={{ marginTop: 6, background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, padding: "8px 12px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#15803d", marginBottom: 4 }}>✅ Voucher Valid — {voucherCheckResult.voucher.type_label}</div>
                  <div style={{ fontSize: 11, color: "#16a34a" }}>{voucherCheckResult.voucher.customer_name} · {voucherCheckResult.voucher.description}</div>
                  <button onClick={async () => {
                    const v = voucherCheckResult.voucher;
                    let discountAmt = 0;
                    if (v.type === "discount_pct") discountAmt = Math.round((newTotal * v.value) / 100);
                    setEditInvoiceForm(f => ({ ...f, discount: discountAmt }));
                    setVoucherApplied(v);
                    setVoucherCheckResult(null);
                    try {
                      const hdrs = await _apiHeaders();
                      await fetch("/api/claim-voucher", { method: "POST", headers: hdrs, body: JSON.stringify({ code: v.code, invoice_id: editInvoiceData.id }) });
                    } catch { /* silent */ }
                  }}
                    style={{ marginTop: 8, padding: "7px 0", width: "100%", borderRadius: 8, border: "none", background: "#16a34a", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                    Terapkan Voucher
                  </button>
                </div>
              )}
            </div>

            {/* Trade-In */}
            <div style={{ background: editInvoiceForm.trade_in ? "#be123c12" : cs.surface, border: "1px solid " + (editInvoiceForm.trade_in ? "#be123c44" : cs.border), borderRadius: 8, padding: "8px 10px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: cs.text }}>
                <input type="checkbox" checked={!!editInvoiceForm.trade_in}
                  onChange={e => setEditInvoiceForm(f => ({ ...f, trade_in: e.target.checked, trade_in_amount: e.target.checked ? (parseInt(f.trade_in_amount) || 250000) : f.trade_in_amount }))}
                  style={{ width: 16, height: 16, accentColor: "#f43f5e" }} />
                <div style={{ fontWeight: 700 }}>Trade-In AC Lama</div>
              </label>
              {editInvoiceForm.trade_in && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: "#f43f5e", fontWeight: 700 }}>- Rp</span>
                  <input type="number" min="0" value={editInvoiceForm.trade_in_amount ?? ""}
                    onChange={e => setEditInvoiceForm(f => ({ ...f, trade_in_amount: e.target.value }))}
                    placeholder="250000"
                    style={{ flex: 1, background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "8px 10px", color: cs.text, fontSize: 13, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }} />
                </div>
              )}
            </div>

            {/* PPh 23 */}
            {(() => {
              const rate = parseFloat(appSettings?.pph23_rate) || 0.025;
              const pph = computePph23(newTotal, rate);
              return (
                <div style={{ background: editInvoiceForm.pph23 ? "#0ea5e912" : cs.surface, border: "1px solid " + (editInvoiceForm.pph23 ? "#0ea5e944" : cs.border), borderRadius: 8, padding: "8px 10px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: cs.text }}>
                    <input type="checkbox" checked={!!editInvoiceForm.pph23}
                      onChange={e => setEditInvoiceForm(f => ({ ...f, pph23: e.target.checked }))}
                      style={{ width: 16, height: 16, accentColor: "#0ea5e9" }} />
                    <div style={{ fontWeight: 700 }}>Customer potong PPh 23 ({(rate * 100).toLocaleString("id-ID")}%)</div>
                  </label>
                  {editInvoiceForm.pph23 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: cs.muted, display: "grid", gap: 3 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span>Nilai Jasa (DPP)</span><b style={{ color: cs.text, fontFamily: "monospace" }}>{fmt(pph.dpp)}</b></div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}><span>PPh 23 dipotong</span><b style={{ color: "#0ea5e9", fontFamily: "monospace" }}>- {fmt(pph.amount)}</b></div>
                      <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid " + cs.border, paddingTop: 3 }}><span>Diterima AClean</span><b style={{ color: cs.green, fontFamily: "monospace" }}>{fmt(newTotal)}</b></div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Total preview */}
          <div style={{ background: cs.accent + "12", border: "1px solid " + cs.accent + "33", borderRadius: 10, padding: 14 }}>
            <div style={{ fontSize: 12, color: cs.muted, marginBottom: 4 }}>Total Invoice Baru</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: cs.accent, fontFamily: "monospace" }}>{fmt(newTotal)}</div>
            {(editDiscount > 0 || editTradeIn) && (
              <div style={{ fontSize: 11, color: "#f43f5e", marginTop: 4 }}>
                Potongan: {editDiscount > 0 ? `Discount ${fmt(editDiscount)}` : ""}{editDiscount > 0 && editTradeIn ? " + " : ""}{editTradeIn ? `Trade-In ${fmt(editTradeInAmt)}` : ""}
              </div>
            )}
            {newTotal !== editInvoiceData.total && (
              <div style={{ fontSize: 11, color: cs.yellow, marginTop: 4 }}>
                Perubahan: {fmt(newTotal - editInvoiceData.total)} dari sebelumnya {fmt(editInvoiceData.total)}
              </div>
            )}
          </div>

          {/* Catatan */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cs.muted, marginBottom: 5 }}>Catatan Perubahan</div>
            <input value={editInvoiceForm.notes || ""} onChange={e => setEditInvoiceForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Alasan perubahan nilai..."
              style={{ width: "100%", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 8, padding: "10px 12px", color: cs.text, fontSize: 13 }} />
          </div>

          {/* Buttons */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 10 }}>
            <button onClick={handleClose}
              style={{ padding: "11px", background: cs.surface, border: "1px solid " + cs.border, borderRadius: 10, color: cs.text, cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
              Batal
            </button>
            <button onClick={handleSave}
              style={{ padding: "11px", background: "linear-gradient(135deg," + cs.accent + ",#3b82f6)", border: "none", borderRadius: 10, color: "#fff", cursor: "pointer", fontWeight: 700, fontSize: 13 }}>
              💾 Simpan Perubahan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
