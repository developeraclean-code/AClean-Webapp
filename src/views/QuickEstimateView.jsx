import { createElement, useMemo, useRef, useState } from "react";
import { cs } from "../theme/cs.js";
import {
  calculateInstallEstimate,
  installTier,
  calculatePipeReplacementEstimate,
  calculateManualEstimate,
  manualEstimateItemError,
  PIPE_REPLACEMENT_ITEMS,
  QUICK_ESTIMATE_PRICES,
  QUICK_ESTIMATE_TERMS,
} from "../lib/quickEstimate.js";

const money = value => `Rp ${Number(value || 0).toLocaleString("id-ID")}`;
const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jakarta" });
const initialGroup = () => ({ pk: "1", qty: 1, pipeMeters: 4, cableMeters: 5, cableAuto: true, usePipe: true, useCable: true, vacuum: true, bracket: true, ductTape: true, freon: "" });
const initialPipeItems = () => ({
  pipe1: { enabled: true, qty: 4 }, cable15: { enabled: true, qty: 4 }, ductGlue: { enabled: true, qty: 1 },
});

function Button({ children, onClick, active, disabled }) {
  return <button type="button" onClick={onClick} disabled={disabled} style={{ border: `1px solid ${active ? cs.accent : cs.border}`, background: active ? `${cs.accent}20` : cs.card, color: active ? cs.accent : cs.text, borderRadius: 9, padding: "8px 12px", fontWeight: active ? 800 : 600, cursor: disabled ? "wait" : "pointer", opacity: disabled ? 0.6 : 1 }}>{children}</button>;
}

function ManualEstimateItems({ items, onChange, inputStyle, labelStyle, title = "Item Manual", description = "Tambahkan material atau jasa lainnya. Subtotal = jumlah × harga satuan, tanpa dikalikan jumlah unit AC.", placeholder = "Contoh: Jasa bobok tembok", addLabel = "＋ Tambah Item Manual" }) {
  const updateManualItem = (id, field, value) => onChange(rows => rows.map(item => item.id === id ? { ...item, [field]: value } : item));
  return (
        <section aria-label={title} style={{ display: "grid", gap: 10, borderTop: `1px solid ${cs.border}`, paddingTop: 12 }}>
          <strong style={{ color: cs.text, fontSize: 12 }}>{title}</strong>
          <div style={{ color: cs.muted, fontSize: 11 }}>{description}</div>
          {items.map((item, index) => {
            const error = manualEstimateItemError(item);
            return <div key={item.id} style={{ border: `1px solid ${cs.border}`, borderRadius: 9, padding: 10, display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 8 }}>
                <label style={labelStyle}>Nama item {index + 1}<input style={inputStyle} value={item.label} onChange={e => updateManualItem(item.id, "label", e.target.value)} placeholder={placeholder} maxLength={200} /></label>
                <label style={labelStyle}>Jumlah<input type="number" min="0" step="any" style={inputStyle} value={item.qty} onChange={e => updateManualItem(item.id, "qty", e.target.value)} /></label>
                <label style={labelStyle}>Satuan<input style={inputStyle} value={item.unit} onChange={e => updateManualItem(item.id, "unit", e.target.value)} placeholder="pcs / m / titik / paket" maxLength={30} /></label>
                <label style={labelStyle}>Harga satuan (Rp)<input type="number" min="0" step="any" style={inputStyle} value={item.unitPrice} onChange={e => updateManualItem(item.id, "unitPrice", e.target.value)} placeholder="0" /></label>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                <span style={{ color: cs.text, fontSize: 12 }}>Subtotal: <b>{error ? "—" : money(Number(item.qty) * Number(item.unitPrice))}</b></span>
                <Button onClick={() => onChange(items => items.filter(row => row.id !== item.id))}>Hapus item {index + 1}</Button>
              </div>
              {error && <div style={{ color: cs.muted, fontSize: 11 }}>{error} Item belum masuk total. Lengkapi atau hapus sebelum mengunduh.</div>}
            </div>;
          })}
          <div><Button onClick={() => onChange(items => [...items, { id: crypto.randomUUID(), label: "", qty: 1, unit: "pcs", unitPrice: "" }])}>{addLabel}</Button></div>
        </section>
  );
}

export default function QuickEstimateView({ showNotif }) {
  const [mode, setMode] = useState("install");
  const [workType, setWorkType] = useState("new");
  const [groups, setGroups] = useState([initialGroup()]);
  const [pipeUnits, setPipeUnits] = useState(1);
  const [pipeItems, setPipeItems] = useState(initialPipeItems);
  const [manualItems, setManualItems] = useState([]);
  const [sparepartItems, setSparepartItems] = useState([]);
  const [sparepartNotes, setSparepartNotes] = useState("");
  const [otherServiceItems, setOtherServiceItems] = useState([]);
  const [otherServiceNotes, setOtherServiceNotes] = useState("");
  const [customer, setCustomer] = useState("");
  const [address, setAddress] = useState("");
  const [date, setDate] = useState(today());
  const [exporting, setExporting] = useState(false);
  const cardRef = useRef(null);
  const isManualOffer = mode === "sparepart" || mode === "otherService";
  const estimate = useMemo(() => mode === "install"
    ? calculateInstallEstimate({ groups, workType })
    : mode === "sparepart" ? calculateManualEstimate(sparepartItems)
      : mode === "otherService" ? calculateManualEstimate(otherServiceItems)
        : calculatePipeReplacementEstimate({ units: pipeUnits, selected: pipeItems, manualItems }), [mode, groups, workType, pipeUnits, pipeItems, manualItems, sparepartItems, otherServiceItems]);
  const activeManualItems = mode === "sparepart" ? sparepartItems : mode === "otherService" ? otherServiceItems : mode === "pipe" ? manualItems : [];
  const hasInvalidManualItems = activeManualItems.some(item => manualEstimateItemError(item));
  const workLabel = mode === "sparepart" ? "Sparepart" : mode === "otherService" ? "Jasa Lain" : mode === "pipe" ? "Pergantian Instalasi Pipa" : workType === "new" ? "Pasang AC Baru" : "Bongkar Pasang AC";

  const documentTitle = isManualOffer ? `Penawaran ${workLabel}` : `Estimasi ${workLabel}`;
  const notes = mode === "sparepart" ? sparepartNotes : otherServiceNotes;
  const terms = isManualOffer ? notes.split("\n").map(line => line.trim()).filter(Boolean) : QUICK_ESTIMATE_TERMS;
  const footer = isManualOffer ? "Penawaran awal sesuai rincian item di atas, di luar quotation resmi AClean." : "Estimasi awal — harga final setelah survei teknisi dan persetujuan customer.";
  const updateGroup = (index, key, value) => setGroups(rows => rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const setPipeItem = (key, field, value) => setPipeItems(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  const makePdf = async () => {
    if (hasInvalidManualItems) { showNotif?.("Lengkapi atau hapus item manual yang belum valid sebelum mengunduh."); return; }
    if (!estimate.rows.length) { showNotif?.("Tambahkan jumlah atau material terlebih dahulu."); return; }
    setExporting(true);
    try {
      const [{ pdf }, { default: PDF }] = await Promise.all([
        import("@react-pdf/renderer"), import("../components/QuickEstimatePDF.jsx"),
      ]);
      const blob = await pdf(createElement(PDF, { estimate, customer, address, date, workLabel, documentTitle, terms, footer, isManualOffer })).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `Estimasi_AClean_${(customer || "Pelanggan").trim().replace(/[^\p{L}\p{N}-]+/gu, "_")}.pdf`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { showNotif?.(`Gagal membuat PDF: ${error.message}`); }
    finally { setExporting(false); }
  };
  const makeJpeg = async () => {
    if (hasInvalidManualItems) { showNotif?.("Lengkapi atau hapus item manual yang belum valid sebelum mengunduh."); return; }
    if (!estimate.rows.length) { showNotif?.("Tambahkan item terlebih dahulu."); return; }
    if (!cardRef.current) return;
    setExporting(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(cardRef.current, { scale: 2, backgroundColor: "#ffffff", useCORS: true, windowWidth: 1100, onclone: (_document, element) => { element.style.width = "900px"; element.style.maxWidth = "none"; element.style.boxSizing = "border-box"; } });
      const link = document.createElement("a");
      link.download = `Estimasi_AClean_${(customer || "Pelanggan").trim().replace(/[^\p{L}\p{N}-]+/gu, "_")}.jpg`;
      link.href = canvas.toDataURL("image/jpeg", 0.94); link.click();
    } catch (error) { showNotif?.(`Gagal membuat JPEG: ${error.message}`); }
    finally { setExporting(false); }
  };

  const inputStyle = { width: "100%", boxSizing: "border-box", background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 8, color: cs.text, padding: "9px 10px", fontSize: 13 };
  const labelStyle = { display: "grid", gap: 5, color: cs.muted, fontSize: 11, fontWeight: 700 };
  const panelStyle = { background: cs.card, border: `1px solid ${cs.border}`, borderRadius: 12, padding: 14 };
  const Check = ({ checked, onChange, children }) => <label style={{ display: "flex", alignItems: "center", gap: 8, color: cs.text, fontSize: 12, cursor: "pointer" }}><input type="checkbox" checked={checked} onChange={onChange} />{children}</label>;

  return <div style={{ display: "grid", gap: 14 }}>
    <div style={{ ...panelStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div><div style={{ fontWeight: 800, color: cs.text, fontSize: 16 }}>⚡ Estimasi Cepat</div><div style={{ color: cs.muted, fontSize: 12, marginTop: 3 }}>Hitung jasa dan material untuk penawaran awal tanpa membuat quotation resmi.</div></div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <Button active={mode === "install"} onClick={() => setMode("install")}>Pasang & Bongkar Pasang</Button>
        <Button active={mode === "pipe"} onClick={() => setMode("pipe")}>Ganti Instalasi Pipa</Button>
        <Button active={mode === "sparepart"} onClick={() => setMode("sparepart")}>Sparepart</Button>
        <Button active={mode === "otherService"} onClick={() => setMode("otherService")}>Jasa Lain</Button>
      </div>
    </div>

    <div style={{ ...panelStyle, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 10 }}>
      <label style={labelStyle}>Nama customer<input style={inputStyle} value={customer} onChange={e => setCustomer(e.target.value)} placeholder="Nama customer" /></label>
      <label style={labelStyle}>Tanggal<input style={inputStyle} type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
      <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Alamat / lokasi<input style={inputStyle} value={address} onChange={e => setAddress(e.target.value)} placeholder="Alamat lokasi pekerjaan (opsional)" /></label>
    </div>

    {mode === "install" ? <>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <Button active={workType === "new"} onClick={() => setWorkType("new")}>Pasang AC Baru</Button>
        <Button active={workType === "move"} onClick={() => setWorkType("move")}>Bongkar Pasang AC</Button>
      </div>
      {groups.map((group, index) => <section key={index} style={{ ...panelStyle, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><strong style={{ color: cs.text }}>Tipe AC #{index + 1}</strong>{groups.length > 1 && <Button onClick={() => setGroups(rows => rows.filter((_, i) => i !== index))}>Hapus tipe</Button>}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
          <label style={labelStyle}>Ukuran AC (PK)<select value={group.pk} style={inputStyle} onChange={e => updateGroup(index, "pk", e.target.value)}>{["0.5", "0.75", "1", "1.5", "2", "2.5"].map(pk => <option key={pk} value={pk}>{pk} PK</option>)}</select></label>
          <label style={labelStyle}>Jumlah unit<input type="number" min="1" step="1" value={group.qty} style={inputStyle} onChange={e => updateGroup(index, "qty", e.target.value)} /></label>
          <label style={labelStyle}>Panjang pipa / unit (m)<input type="number" min="0" value={group.pipeMeters} style={inputStyle} onChange={e => setGroups(rows => rows.map((row, i) => i === index ? { ...row, pipeMeters: e.target.value, ...(row.cableAuto ? { cableMeters: Number(e.target.value || 0) + 1 } : {}) } : row))} /></label>
          <label style={labelStyle}>Panjang kabel / unit (m)<input type="number" min="0" value={group.cableMeters} style={inputStyle} onChange={e => setGroups(rows => rows.map((row, i) => i === index ? { ...row, cableMeters: e.target.value, cableAuto: false } : row))} /></label>
        </div>
        {<>
          <div style={{ color: cs.muted, fontSize: 11 }}>Default kabel otomatis = pipa + 1 m. {group.cableAuto ? "Panjang kabel ikut berubah." : <button type="button" onClick={() => setGroups(rows => rows.map((row, i) => i === index ? { ...row, cableMeters: Number(row.pipeMeters || 0) + 1, cableAuto: true } : row))} style={{ padding: 0, border: 0, background: "none", color: cs.accent, cursor: "pointer" }}>Atur otomatis</button>} Jika kabel/pipa lama dipakai kembali, hilangkan centang. Tarif pipa mengikuti PK: 1 PK Rp150.000/m, 2 PK Rp170.000/m, 2,5 PK Rp240.000/m, 3 PK Rp280.000/m.</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Check checked={group.usePipe} onChange={e => updateGroup(index, "usePipe", e.target.checked)}>Material pipa dihitung sesuai panjang</Check>
            <Check checked={group.useCable} onChange={e => updateGroup(index, "useCable", e.target.checked)}>Kabel listrik</Check>
            <Check checked={group.vacuum} onChange={e => updateGroup(index, "vacuum", e.target.checked)}>Jasa vacum · {money(QUICK_ESTIMATE_PRICES.vacuum)}</Check>
            <Check checked={group.bracket} onChange={e => updateGroup(index, "bracket", e.target.checked)}>Breket + dinabolt · {money(QUICK_ESTIMATE_PRICES.bracket)}</Check>
            <Check checked={group.ductTape} onChange={e => updateGroup(index, "ductTape", e.target.checked)}>Duct tape · {money(QUICK_ESTIMATE_PRICES.ductTape)}</Check>
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <Check checked={!!group.freonTopup} onChange={e => updateGroup(index, "freonTopup", e.target.checked)}>Penambahan Freon · {money(installTier(group.pk).freon)}</Check>
            <Check checked={!!group.freonFlush} onChange={e => updateGroup(index, "freonFlush", e.target.checked)}>Kuras Vacum Freon · {money(installTier(group.pk).flush)}</Check>
          </div>
        </>}
      </section>)}
      <Button onClick={() => setGroups(rows => [...rows, initialGroup()])}>＋ Tambah Tipe AC</Button>
      <div style={{ color: cs.muted, fontSize: 11 }}>Untuk tipe cassette, standing, atau split duct, harga memerlukan konsultasi/survei lokasi.</div>
    </> : mode === "pipe" ? <>
      <div style={{ ...panelStyle, display: "grid", gap: 12 }}>
        <label style={{ ...labelStyle, maxWidth: 230 }}>Jumlah unit AC<input type="number" min="1" step="1" value={pipeUnits} style={inputStyle} onChange={e => setPipeUnits(e.target.value)} /></label>
        <div style={{ color: cs.text, fontSize: 13 }}>Jasa Instalasi Pipa AC selalu termasuk · {money(QUICK_ESTIMATE_PRICES.pipeService)} / unit</div>
        {[["Pipa AC", ["pipe1", "pipe2", "pipe25", "pipe3"]], ["Kabel Listrik", ["cable15", "cable25"]], ["Duct Tape", ["ductGlue", "ductNoGlue"]], ["Material Lain", ["flexDrain", "bracket", "armaflex", "pipeInsulation"]]].map(([title, ids]) => <div key={title} style={{ display: "grid", gap: 8 }}>
          <strong style={{ color: cs.text, fontSize: 12 }}>{title}</strong>
          {ids.map(id => { const item = PIPE_REPLACEMENT_ITEMS.find(row => row.id === id); const value = pipeItems[id] || { enabled: false, qty: "" }; return <div key={id} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", alignItems: "center", gap: 8 }}>
            <Check checked={!!value.enabled} onChange={e => setPipeItem(id, "enabled", e.target.checked)}>{item.label} · {money(item.price)}/{item.unit}</Check>
            <input aria-label={`Jumlah ${item.label}`} type="number" min="0" value={value.qty} placeholder={item.unit} style={inputStyle} onChange={e => setPipeItem(id, "qty", e.target.value)} />
            <span style={{ color: cs.muted, fontSize: 11 }}>{money(Number(value.qty || 0) * (value.enabled ? item.price : 0))}</span>
          </div>; })}
        </div>)}
        <ManualEstimateItems items={manualItems} onChange={setManualItems} inputStyle={inputStyle} labelStyle={labelStyle} />
        <div style={{ display: "grid", gap: 8 }}><strong style={{ color: cs.text, fontSize: 12 }}>Freon (opsional)</strong>
          {[["smallTopup", "Penambahan Freon AC 0,5–1,5 PK", 500000], ["smallFlush", "Kuras Vacum Freon AC 0,5–1,5 PK", 650000], ["largeTopup", "Penambahan Freon AC 2–2,5 PK", 1000000], ["largeFlush", "Kuras Vacum Freon AC 2–2,5 PK", 1150000]].map(([key, label, price]) => <Check key={key} checked={(pipeItems.freon || []).includes(key)} onChange={e => setPipeItems(prev => ({ ...prev, freon: e.target.checked ? [...(prev.freon || []), key] : (prev.freon || []).filter(value => value !== key) }))}>{label} · {money(price)}</Check>)}
        </div>
      </div>
    </> : <div style={{ ...panelStyle, display: "grid", gap: 14 }}>
      <ManualEstimateItems items={mode === "sparepart" ? sparepartItems : otherServiceItems} onChange={mode === "sparepart" ? setSparepartItems : setOtherServiceItems} inputStyle={inputStyle} labelStyle={labelStyle}
        title={documentTitle} description={mode === "sparepart" ? "Ketik nama atau spesifikasi sparepart, jumlah, satuan, dan harga satuan. Total mengikuti item yang Anda masukkan." : "Ketik ducting atau pekerjaan lain, jumlah, satuan, dan harga satuan. Total mengikuti item yang Anda masukkan tanpa tarif otomatis."}
        placeholder={mode === "sparepart" ? "Contoh: Kapasitor 35 µF merek ..." : "Contoh: Pembuatan ducting galvanis"} addLabel={mode === "sparepart" ? "＋ Tambah Sparepart" : "＋ Tambah Jasa Lain"} />
      <label style={labelStyle}>Ketentuan & catatan (opsional)
        <textarea rows={4} style={{ ...inputStyle, resize: "vertical" }} value={notes} onChange={e => (mode === "sparepart" ? setSparepartNotes : setOtherServiceNotes)(e.target.value)}
          placeholder="Ketik ketentuan penawaran, garansi, atau keterangan lain. Satu poin per baris; ikut tercetak di PDF/JPEG." />
      </label>
    </div>}

    <section ref={cardRef} style={{ background: "#fff", color: "#172033", border: "1px solid #dbe2ea", borderRadius: 14, padding: 18, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", borderBottom: "2px solid #087f8c", paddingBottom: 12 }}><div><div style={{ color: "#087f8c", fontWeight: 900, fontSize: 20 }}>AClean Service</div><div style={{ color: "#64748b", fontSize: 11 }}>Estimasi biaya · 0812-8989-8937 · aclean.id</div></div><div style={{ textAlign: "right", color: "#64748b", fontSize: 11 }}>{isManualOffer ? documentTitle.toLocaleUpperCase("id-ID") : "ESTIMASI CEPAT"}<br />{date}</div></div>
      <div><div style={{ fontSize: 16, fontWeight: 800 }}>{documentTitle}</div><div style={{ marginTop: 5, fontSize: 12 }}>Customer: <b>{customer || "—"}</b>{address && <> · Lokasi: {address}</>}</div></div>
      <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 640, tableLayout: "fixed", overflowWrap: "anywhere", borderCollapse: "collapse", fontSize: 11 }}><thead><tr style={{ background: "#e8f6f7", textAlign: "left" }}>{["Rincian pekerjaan", "Jumlah", "Harga satuan", "Subtotal"].map(label => <th key={label} style={{ padding: 8, width: label === "Rincian pekerjaan" ? "44%" : label === "Jumlah" ? "14%" : "21%", borderBottom: "1px solid #b7dce0" }}>{label}</th>)}</tr></thead><tbody>{estimate.rows.map((row, i) => <tr key={`${row.label}-${i}`}><td style={{ padding: 8, borderBottom: "1px solid #e2e8f0" }}>{row.label}</td><td style={{ padding: 8, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{row.qty} {row.unit}</td><td style={{ padding: 8, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{money(row.unitPrice)}</td><td style={{ padding: 8, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{money(row.total)}</td></tr>)}</tbody></table></div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: 9, padding: "12px 14px", background: "#e8f6f7", color: "#087f8c", fontWeight: 900, fontSize: 16 }}><span>{isManualOffer ? "TOTAL PENAWARAN" : "PERKIRAAN TOTAL"}</span><span>{money(estimate.total)}</span></div>
      {terms.length > 0 && <div style={{ borderTop: "1px solid #dbe2ea", paddingTop: 8 }}><strong style={{ fontSize: 11 }}>Ketentuan & catatan</strong><ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 10, lineHeight: 1.5, color: "#334155" }}>{terms.map((term, i) => <li key={i} style={{ marginBottom: 3 }}>{term}</li>)}</ul></div>}
      <div style={{ textAlign: "center", color: "#64748b", borderTop: "1px solid #dbe2ea", paddingTop: 8, fontSize: 10 }}>{footer}</div>
    </section>
    {hasInvalidManualItems && <div role="status" style={{ color: cs.muted, fontSize: 12 }}>Lengkapi atau hapus item manual yang belum valid agar PDF/JPEG dapat diunduh.</div>}
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Button disabled={exporting || hasInvalidManualItems || !estimate.rows.length} onClick={makePdf}>{exporting ? "Menyiapkan…" : "⬇ Unduh PDF"}</Button><Button disabled={exporting || hasInvalidManualItems || !estimate.rows.length} onClick={makeJpeg}>{exporting ? "Menyiapkan…" : "⬇ Unduh JPEG"}</Button><Button onClick={() => { setMode("install"); setWorkType("new"); setGroups([initialGroup()]); setPipeUnits(1); setPipeItems(initialPipeItems()); setManualItems([]); setSparepartItems([]); setSparepartNotes(""); setOtherServiceItems([]); setOtherServiceNotes(""); setCustomer(""); setAddress(""); setDate(today()); }}>Reset estimasi</Button></div>
    {!isManualOffer && <details style={{ ...panelStyle, color: cs.muted, fontSize: 11 }}><summary style={{ cursor: "pointer", color: cs.text, fontWeight: 700 }}>Rumus harga dan asumsi estimator</summary><ul style={{ lineHeight: 1.6 }}>{QUICK_ESTIMATE_TERMS.map((term, i) => <li key={i}>{term}</li>)}</ul><p>Contoh referensi website untuk 1 unit pasang baru: jasa Rp400.000 + pipa 4 m × Rp150.000 + kabel 5 m × Rp35.000 + vacum Rp50.000 + breket Rp150.000 + duct tape Rp20.000 = Rp1.395.000.</p><p>Contoh pergantian pipa: jasa 1 unit Rp200.000 + pipa Hoda 1 PK 4 m Rp600.000 + kabel 3×1,5 4 m Rp140.000 + duct tape lem 1 pcs Rp20.000 = Rp960.000.</p></details>}
  </div>;
}
