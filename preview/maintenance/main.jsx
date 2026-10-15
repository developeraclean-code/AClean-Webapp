import React, { useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import MaintUnitPickerStep from "../../src/views/MaintUnitPickerStep.jsx";
import { UnitFormModal, PriceTab } from "../../src/views/MaintenanceView.jsx";
import { mkUnit, maintUnitToHist } from "../../src/lib/laporanConstants.js";
import { clientCleaningUnitPrice } from "../../src/lib/maintClientPrice.js";
import { unpricedVrvUnits } from "../../src/lib/vrvBilling.js";
import { dupoinPreviewUnits, dupoinPreviewPrices } from "./dupoin-fixture.js";

const client = { id: "preview-dupoin", name: "PT. DUPOIN FUTURES INDONESIA" };
const noop = () => {};
const button = { background: "#17374a", border: "1px solid #245774", padding: "10px 15px", borderRadius: 8, color: "#e8eef5", cursor: "pointer" };
function Demo() {
  const [registry, setRegistry] = useState(dupoinPreviewUnits);
  const [picked, setPicked] = useState(() => [mkUnit(1, maintUnitToHist(dupoinPreviewUnits[0])), mkUnit(2, maintUnitToHist(dupoinPreviewUnits[6]))]);
  const [edit, setEdit] = useState(null);
  const [prices, setPrices] = useState(dupoinPreviewPrices);
  const pricesRef = useRef(dupoinPreviewPrices);
  const [page, setPage] = useState("report");
  const [message, setMessage] = useState("");
  const missing = unpricedVrvUnits({ service: "Cleaning", units: picked, clientPrices: prices });
  const total = picked.reduce((sum, u) => sum + (clientCleaningUnitPrice(prices, u) || 0), 0);
  const fakeApi = async () => { throw new Error("Preview tidak mengakses API. Tambah/edit unit lewat tombol Edit contoh unit."); };
  const priceCall = async (action, data) => {
    if (action === "list-prices") return { prices: pricesRef.current };
    if (action === "save-price") {
      const row = { ...data, id: data.id || `demo-${Date.now()}`, unit_price: Number(data.unit_price), capacity_pk: data.capacity_pk === "" ? null : Number(data.capacity_pk) };
      pricesRef.current = [...pricesRef.current.filter(p => p.id !== row.id), row];
      setPrices(pricesRef.current);
      return { price: row };
    }
    if (action === "delete-price") { pricesRef.current = pricesRef.current.filter(p => p.id !== data.id); setPrices(pricesRef.current); return { ok: true }; }
    throw new Error("Aksi tidak tersedia pada preview");
  };
  return <main>
    <header><h1>Maintenance VRV · Preview lokal</h1><p>Data contoh Dupoin · 52 aset (40 indoor + 12 outdoor) · lantai 27 · zona A–H</p></header>
    <div className="notice">Tidak terhubung ke Supabase/WA dan tidak menyimpan ke produksi. Tarif mengikuti penawaran 832/09/10/2026/INV: 24 indoor × Rp450.000 + 16 indoor × Rp300.000 + 12 outdoor Rp0 = Rp15.600.000. Outdoor tidak ditagih terpisah. Interval PM belum ditentukan.</div>
    <nav>
      <button style={button} onClick={() => setPage("report")}>1. Pilih unit laporan</button>
      <button style={button} onClick={() => setPage("prices")}>2. Atur tarif simulasi</button>
      <button style={button} onClick={() => setEdit(registry[0])}>3. Edit contoh unit</button>
      <button style={button} onClick={() => { pricesRef.current = dupoinPreviewPrices; setPrices(dupoinPreviewPrices); setMessage("Tarif penawaran Dupoin dimuat ulang di preview saja."); }}>Muat tarif penawaran</button>
      <button style={button} onClick={() => { pricesRef.current = []; setPrices([]); setRegistry(dupoinPreviewUnits); setPicked([]); setPage("report"); setMessage("Demo direset; semua perubahan hanya di memori browser."); }}>Reset demo</button>
    </nav>
    {message && <div role="status" className="notice">{message}</div>}
    <section>
      {page === "prices" ? <PriceTab sel={client} call={priceCall} showNotif={setMessage} showConfirm={async () => true} isOwner /> : <MaintUnitPickerStep
        laporanModal={{ id: "JOB-PREVIEW-ONLY", customer: client.name, maintenance_client_id: client.id, units: 2 }}
        laporanUnits={picked} setLaporanUnits={setPicked} setLaporanStep={() => setMessage("Simulasi: lanjut laporan kondisi/foto. Tidak mengirim laporan atau membuat invoice.")}
        maintUnitPool={registry} maintLogsPool={[]} setActiveUnitIdx={noop} setLaporanFotos={noop} setLaporanCleaningInRepair={noop}
        setLaporanJasaItems={noop} setLaporanBarangItems={noop} currentUser={{ name: "Teknisi demo", role: "Teknisi" }}
        _apiFetch={fakeApi} showNotif={setMessage} onNewUnitProposed={noop} />}
    </section>
    <section aria-label="Simulasi invoice"><h2>Pemeriksaan tarif unit terpilih</h2>
      <p>{picked.length} aset dipilih · maksimal 30 aset per laporan, sehingga 52 aset perlu dibagi dalam beberapa laporan/tim.</p>
      {missing.length ? <p role="alert" className="warning">Invoice ditahan: {missing.length} unit belum punya kapasitas/tarif VRV yang valid. Isi Harga Khusus Indoor/Outdoor di tab simulasi.</p> : <p className="good">{picked.length ? `Tarif lengkap. Total unit terpilih: ${total.toLocaleString("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })}. Belum ada invoice dibuat.` : "Pilih unit yang benar-benar dikerjakan."}</p>}
      <ul>{picked.map(u => <li key={u.maint_unit_id}>{u.label} · {u.tipe} · {u.pk} · {clientCleaningUnitPrice(prices, u)?.toLocaleString("id-ID") || "tarif belum diisi"}</li>)}</ul>
    </section>
    {edit && <UnitFormModal unit={edit} onClose={() => setEdit(null)} onSave={unit => {
      const updated = { ...edit, ...unit };
      setRegistry(prev => prev.map(u => u.id === updated.id ? updated : u));
      setPicked(prev => prev.map(u => u.maint_unit_id === updated.id ? mkUnit(u.unit_no, maintUnitToHist(updated)) : u));
      setEdit(null); setMessage("Perubahan contoh unit tersimpan lokal di memori saja. Refresh akan mereset demo.");
    }} />}
  </main>;
}
createRoot(document.getElementById("root")).render(<Demo />);
