import { useEffect, useState, useRef } from "react";
import {
  activatePreparedEmergencyVault, appendEmergencyRecord, closeEmergencyIncident,
  emergencyCsv, exportEncryptedEmergencyVault, getEmergencyVaultMeta,
  prepareEmergencyVault, reconcileEmergencyRecord, unlockEmergencyVault, updateEmergencyVault,
} from "../lib/emergencyVault.js";
import { createEmergencyAssignment, ensureEmergencyAssignment, openEmergencyReportPackage, reportFieldsFromPackage } from "../lib/emergencyHandoff.js";

const BG = "#08111f";
const CARD = "#101e32";
const BORDER = "#29425f";
const INPUT = { width: "100%", padding: 11, borderRadius: 9, background: BG, border: `1px solid ${BORDER}`, color: "#e9f3ff", fontSize: 15 };
const BUTTON = { padding: "10px 14px", borderRadius: 9, border: `1px solid ${BORDER}`, background: "#17314e", color: "#e9f3ff", fontWeight: 700, cursor: "pointer" };
const FIELDS = {
  order: [["customer", "Nama customer *"], ["phone", "Telepon"], ["address", "Alamat/lokasi"], ["date", "Tanggal kerja *", "date"], ["time", "Jam"], ["service", "Layanan *"], ["team", "Tim/teknisi *"], ["plannedUnits", "Unit rencana"], ["notes", "Catatan"]],
  report: [["team", "Tim pelapor *"], ["actualUnits", "Unit aktual *", "number"], ["work", "Pekerjaan aktual *"], ["materials", "Material terpakai (teks)"], ["photoRefs", "Nama file foto / referensi manual"], ["notes", "Catatan"]],
  payment: [["amount", "Nominal diterima (Rp) *", "number"], ["bankRef", "Bank / nomor referensi"], ["proofRef", "Lokasi bukti bayar / nama file"], ["notes", "Catatan pembayaran"]],
  material: [["material", "Nama material *"], ["quantity", "Jumlah *", "number"], ["unit", "Satuan"], ["movement", "Diambil / dipakai / dikembalikan"], ["technician", "Teknisi"], ["notes", "Catatan"]],
};
const LABELS = { order: "Order", report: "Laporan tim", payment: "Uang diterima", material: "Material" };

function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function EmergencyModeView({ currentUser = null, initialAccess = null, onInitialAccessConsumed, onBack, onActivated, onClosed }) {
  const [meta, setMeta] = useState(() => getEmergencyVaultMeta());
  const [vault, setVault] = useState(() => initialAccess?.result.state || null);
  const [revision, setRevision] = useState(() => initialAccess?.result.revision || null);
  const passphraseRef = useRef(initialAccess?.passphrase || "");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPhrase, setConfirmPhrase] = useState("");
  const [reason, setReason] = useState("Supabase tidak tersedia; operasional harus berlanjut");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("order");
  const [fields, setFields] = useState({});
  const [reconcile, setReconcile] = useState({});
  const [archiveDownloaded, setArchiveDownloaded] = useState(false);
  const [incomingReport, setIncomingReport] = useState(null);
  const [incomingFileName, setIncomingFileName] = useState("");

  useEffect(() => { if (initialAccess) onInitialAccessConsumed?.(); }, [initialAccess, onInitialAccessConsumed]);

  const ownerOnline = currentUser?.role === "Owner" && Boolean(currentUser?.id);
  const prepared = meta && !meta.active && !meta.incidentId;
  const active = Boolean(meta?.active);
  const orders = vault?.records.filter(row => row.type === "order") || [];
  const pending = vault?.records.filter(row => row.reconciliation.status === "pending") || [];

  async function run(action) {
    setError(""); setBusy(true);
    try { await action(); }
    catch (e) { setError(e?.message || String(e)); }
    finally { setBusy(false); }
  }
  function setUnlocked(result) {
    setVault(result.state); setRevision(result.revision); setMeta(getEmergencyVaultMeta());
    passphraseRef.current = passphrase; setPassphrase(""); setConfirmPhrase("");
  }
  async function mutate(fn) {
    const result = await updateEmergencyVault(passphraseRef.current, revision, fn);
    setVault(result.state); setRevision(result.revision); setMeta(getEmergencyVaultMeta());
    return result;
  }
  async function downloadAssignment(orderId) {
    const result = await mutate(state => ensureEmergencyAssignment(state, orderId));
    download(JSON.stringify(createEmergencyAssignment(result.state, orderId), null, 2), `${orderId}-tugas-teknisi.json`, "application/json");
  }
  async function importTechnicianReport(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) throw new Error("File laporan terlalu besar");
    const packageData = JSON.parse(await file.text());
    const payload = await openEmergencyReportPackage(vault, packageData, { allowDuplicate: true });
    setIncomingReport(payload); setIncomingFileName(file.name);
  }
  const field = (name, label, inputType = "text") => (
    <label key={name} style={{ display: "grid", gap: 5, fontSize: 13, color: "#a9bfd5" }}>{label}
      <input type={inputType} value={fields[name] || ""} onChange={e => setFields(prev => ({ ...prev, [name]: e.target.value }))} style={INPUT} />
    </label>
  );

  return <div style={{ minHeight: "100vh", padding: "22px 16px 60px", background: BG, color: "#e9f3ff", fontFamily: "system-ui, sans-serif" }}>
    <div style={{ maxWidth: 980, margin: "auto" }}>
      <h1 style={{ margin: "0 0 5px", color: "#fbbf24" }}>🚨 Mode Darurat AClean</h1>
      <p style={{ marginTop: 0, color: "#a9bfd5" }}>Pencatatan lokal untuk gangguan Supabase. Ini bukan database pengganti dan tidak tersinkron otomatis.</p>
      <div style={{ background: "#492d12", border: "1px solid #a76a1c", padding: 13, borderRadius: 10, marginBottom: 18, lineHeight: 1.5 }}>
        Hanya perangkat ini yang menyimpan data. Tidak membuat invoice, mengubah stok, menandai PAID, atau mengirim WA. Foto asli simpan di folder perangkat terpisah dan catat nama filenya. Bagikan nomor ID darurat ke tim melalui jalur komunikasi manual.
      </div>
      {error && <div role="alert" style={{ background: "#491a22", color: "#ffb7c0", padding: 12, borderRadius: 9, marginBottom: 16 }}>{error}</div>}

      {!vault && <section style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 20, maxWidth: 600 }}>
        {meta?.corrupt ? <>
          <h2>Arsip darurat lokal tidak dapat dibaca</h2>
          <p>Jangan hapus storage browser atau lanjut ke aplikasi utama. Pulihkan dari salinan arsip terenkripsi yang disimpan sebelumnya, atau hubungi pengelola teknis.</p>
        </> : active ? <>
          <h2>Insiden aktif: {meta.incidentId}</h2>
          <p style={{ color: "#a9bfd5" }}>Buka arsip dengan frasa sandi Owner yang disiapkan pada perangkat ini. Layar utama tetap terkunci meskipun koneksi Supabase pulih.</p>
          <label style={{ display: "grid", gap: 7 }}>Frasa sandi perangkat<input type="password" autoComplete="off" value={passphrase} onChange={e => setPassphrase(e.target.value)} style={INPUT} /></label>
          <button disabled={busy} onClick={() => run(async () => setUnlocked(await unlockEmergencyVault(passphrase, { ownerId: ownerOnline ? currentUser.id : null })))} style={{ ...BUTTON, marginTop: 14 }}>Buka catatan</button>
        </> : prepared ? <>
          <h2>Perangkat siap, belum aktif</h2>
          <p style={{ color: "#a9bfd5" }}>Hanya Owner pemegang frasa sandi pada perangkat yang telah disiapkan dapat mengaktifkannya. Tanpa Supabase, identitas Owner tidak bisa diverifikasi ulang di server.</p>
          <label style={{ display: "grid", gap: 7 }}>Alasan aktivasi<input value={reason} onChange={e => setReason(e.target.value)} style={INPUT} /></label>
          <label style={{ display: "grid", gap: 7, marginTop: 12 }}>Frasa sandi perangkat<input type="password" autoComplete="off" value={passphrase} onChange={e => setPassphrase(e.target.value)} style={INPUT} /></label>
          <label style={{ display: "flex", gap: 8, marginTop: 15, alignItems: "start" }}><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />Saya Owner; saya paham aktivasi hanya lokal dan akan rekonsiliasi manual.</label>
          <button disabled={busy || !ack} onClick={() => run(async () => { const result = await activatePreparedEmergencyVault(passphrase, reason); if (onActivated) onActivated({ result, passphrase }); else setUnlocked(result); })} style={{ ...BUTTON, marginTop: 14, background: "#a64b1c" }}>Aktifkan mode darurat</button>
        </> : meta?.incidentId && !meta.active ? <>
          <h2>Insiden lama sudah ditutup</h2>
          <p style={{ color: "#a9bfd5" }}>Arsip tetap tersimpan di perangkat ini dan tidak akan ditimpa. Unduh salinan terenkripsi; pembuatan insiden berikutnya memerlukan prosedur rotasi arsip.</p>
          <button onClick={() => run(async () => download(exportEncryptedEmergencyVault(), `${meta.incidentId}-arsip-terenkripsi.json`, "application/json"))} style={BUTTON}>Unduh arsip terenkripsi</button>
        </> : !meta && ownerOnline ? <>
          <h2>Siapkan perangkat Owner</h2>
          <p style={{ color: "#a9bfd5" }}>Lakukan saat login Owner masih terverifikasi. Catat frasa sandi di tempat aman; tidak ada reset sandi saat Supabase mati.</p>
          <label style={{ display: "grid", gap: 7 }}>Frasa sandi (minimal 12 karakter)<input type="password" autoComplete="new-password" value={passphrase} onChange={e => setPassphrase(e.target.value)} style={INPUT} /></label>
          <label style={{ display: "grid", gap: 7, marginTop: 12 }}>Ulangi frasa sandi<input type="password" autoComplete="new-password" value={confirmPhrase} onChange={e => setConfirmPhrase(e.target.value)} style={INPUT} /></label>
          <button disabled={busy || passphrase !== confirmPhrase || passphrase.length < 12} onClick={() => run(async () => { await prepareEmergencyVault({ owner: currentUser, passphrase }); setMeta(getEmergencyVaultMeta()); setPassphrase(""); setConfirmPhrase(""); })} style={{ ...BUTTON, marginTop: 14 }}>Siapkan perangkat</button>
        </> : <><h2>Mode darurat belum disiapkan</h2><p>Masuk sebagai Owner saat Supabase pulih untuk menyiapkan perangkat. Tidak aman membuka akses darurat dari sesi yang belum terverifikasi.</p></>}
        {!active && onBack && <button onClick={onBack} style={{ ...BUTTON, marginLeft: 8, background: "transparent" }}>Kembali</button>}
      </section>}

      {vault && <>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
          <strong>{vault.incidentId}</strong><span>{vault.records.length} catatan · {pending.length} perlu rekonsiliasi</span>
          <button onClick={() => { setVault(null); passphraseRef.current = ""; }} style={BUTTON}>Kunci layar</button>
          <button onClick={() => run(async () => { download(exportEncryptedEmergencyVault(), `${vault.incidentId}-arsip-terenkripsi.json`, "application/json"); setArchiveDownloaded(true); })} style={BUTTON}>Unduh arsip terenkripsi</button>
          <button onClick={() => run(async () => download(emergencyCsv(vault), `${vault.incidentId}-rekonsiliasi.csv`, "text/csv;charset=utf-8"))} style={BUTTON}>Unduh CSV (data terbuka)</button>
        </div>
        <p style={{ color: "#fbbf24", fontSize: 13 }}>Ekspor CSV berisi data customer dan pembayaran tanpa enkripsi. Simpan privat; arsip terenkripsi diperlukan sebagai cadangan utama. Jangan hapus data browser sebelum semua catatan dicocokkan.</p>
        <section style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18, marginBottom: 18 }}>
          <h2 style={{ marginTop: 0 }}>Catat pekerjaan saat offline</h2>
          <p style={{ color: "#a9bfd5", fontSize: 13 }}>Setelah order disimpan, unduh paket tugas pada baris order di bawah dan kirim langsung ke teknisi (jangan ke grup umum: file memuat data customer dan kunci akses). Teknisi membuka <a href="/field-emergency" target="_blank" rel="noopener noreferrer" style={{ color: "#38bdf8" }}>/field-emergency</a> di ponselnya.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 15 }}>{Object.entries(LABELS).map(([key, label]) => <button key={key} onClick={() => { setTab(key); setFields({}); }} style={{ ...BUTTON, background: tab === key ? "#175f85" : BUTTON.background }}>{label}</button>)}</div>
          {tab !== "order" && <label style={{ display: "grid", gap: 5, marginBottom: 13 }}>Order darurat terkait *<select value={fields.orderRef || ""} onChange={e => setFields(prev => ({ ...prev, orderRef: e.target.value }))} style={INPUT}><option value="">Pilih order</option>{orders.map(row => <option value={row.id} key={row.id}>{row.id} — {row.fields.customer}</option>)}</select></label>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>{FIELDS[tab].map(([name, label, kind]) => field(name, label, kind))}</div>
          <button disabled={busy || (tab !== "order" && !orders.length)} onClick={() => run(async () => { await mutate(state => appendEmergencyRecord(state, tab, fields)); setFields({}); })} style={{ ...BUTTON, marginTop: 17, background: "#12654f" }}>Simpan catatan lokal</button>
        </section>
        <section style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18, marginBottom: 18 }}>
          <h2 style={{ marginTop: 0 }}>Terima laporan teknisi</h2>
          <p style={{ color: "#a9bfd5" }}>Pilih file laporan terenkripsi yang dikirim teknisi. File hanya bisa dibuka jika cocok dengan paket tugas dari insiden ini. Foto berada di file laporan—simpan file asli secara privat; arsip vault hanya mencatat nama dan jumlah fotonya.</p>
          <input aria-label="Impor laporan teknisi" type="file" accept=".json,application/json" disabled={busy} onChange={e => { run(() => importTechnicianReport(e.target.files?.[0])); e.target.value = ""; }} style={{ color: "#e9f3ff" }} />
          {incomingReport && <div style={{ marginTop: 15, borderTop: `1px solid ${BORDER}`, paddingTop: 12 }}>
            <strong>Periksa sebelum diterima: {incomingFileName}</strong>
            <p style={{ color: "#a9bfd5", margin: "7px 0" }}>Order {incomingReport.orderId} · {incomingReport.report.technician} / {incomingReport.report.team} · aktual {incomingReport.report.actualUnits} unit</p>
            <p style={{ margin: "7px 0" }}>{incomingReport.report.work}</p>
            {incomingReport.report.materials && <p style={{ margin: "7px 0" }}>Material: {incomingReport.report.materials}</p>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0" }}>{incomingReport.photos.map((photo, index) => <div key={`${photo.name}-${index}`} style={{ width: 110 }}><img src={photo.dataUrl} alt={photo.name} style={{ width: 110, height: 85, objectFit: "cover", borderRadius: 6 }} /><div style={{ fontSize: 10, overflowWrap: "anywhere" }}>{photo.name}</div></div>)}</div>
            {vault.records.some(row => row.type === "report" && row.fields.sourcePackageId === incomingReport.packageId)
              ? <p role="status" style={{ color: "#fbbf24" }}>Paket ini sudah pernah diimpor; tidak akan dicatat ulang.</p>
              : <button disabled={busy} onClick={() => run(async () => { await mutate(state => appendEmergencyRecord(state, "report", reportFieldsFromPackage(incomingReport))); setIncomingReport(null); })} style={{ ...BUTTON, background: "#12654f" }}>Terima laporan ke antrean</button>}
            <button onClick={() => setIncomingReport(null)} style={{ ...BUTTON, marginLeft: 8 }}>Tutup pratinjau</button>
          </div>}
        </section>
        <section style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: 18 }}>
          <h2 style={{ marginTop: 0 }}>Antrean rekonsiliasi</h2>
          <p style={{ color: "#a9bfd5" }}>Setelah Supabase pulih, buat/cocokkan entri permanen secara manual dan isi ID-nya di sini. Untuk pembayaran, cocokkan transaksi dan bukti dahulu—jangan otomatis tandai invoice lunas.</p>
          {vault.records.length === 0 && <p>Belum ada catatan.</p>}
          {vault.records.map(row => <div key={row.id} style={{ borderTop: `1px solid ${BORDER}`, padding: "13px 0", overflowWrap: "anywhere" }}>
            <strong>{row.id}</strong> · {LABELS[row.type]} · {row.reconciliation.status === "pending" ? "⏳ Belum dicocokkan" : `✅ ${row.reconciliation.targetId}`}
            <div style={{ fontSize: 12, color: "#a9bfd5", marginTop: 5 }}>{Object.entries(row.fields).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(" · ")}</div>
            {row.type === "order" && <button disabled={busy} onClick={() => run(() => downloadAssignment(row.id))} style={{ ...BUTTON, marginTop: 9 }}>Unduh paket tugas teknisi</button>}
            {row.reconciliation.status === "pending" && <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap" }}>
              <input aria-label={`ID permanen ${row.id}`} placeholder="ID data permanen" value={reconcile[row.id]?.targetId || ""} onChange={e => setReconcile(prev => ({ ...prev, [row.id]: { ...prev[row.id], targetId: e.target.value } }))} style={{ ...INPUT, flex: "1 1 180px" }} />
              <input aria-label={`Catatan rekonsiliasi ${row.id}`} placeholder="Catatan pemeriksaan" value={reconcile[row.id]?.note || ""} onChange={e => setReconcile(prev => ({ ...prev, [row.id]: { ...prev[row.id], note: e.target.value } }))} style={{ ...INPUT, flex: "1 1 180px" }} />
              <button disabled={busy} onClick={() => run(async () => mutate(state => reconcileEmergencyRecord(state, row.id, reconcile[row.id]?.targetId, reconcile[row.id]?.note)))} style={BUTTON}>Tandai cocok</button>
            </div>}
          </div>)}
        </section>
        <button disabled={busy || pending.length > 0 || !archiveDownloaded} onClick={() => run(async () => { if (!window.confirm("Pastikan arsip terenkripsi sudah tersimpan dan semua catatan telah dicocokkan. Tutup insiden?")) return; await mutate(closeEmergencyIncident); passphraseRef.current = ""; setVault(null); onClosed?.(); })} style={{ ...BUTTON, marginTop: 18, background: "#533532" }}>Tutup insiden setelah rekonsiliasi & ekspor</button>
      </>}
    </div>
  </div>;
}
