import { useEffect, useState } from "react";
import { buildEmergencyReportPackage, validateEmergencyAssignment } from "../lib/emergencyHandoff.js";
import { compressEmergencyPhoto, loadEmergencyFieldDraft, saveEmergencyFieldDraft } from "../lib/emergencyFieldDraft.js";

const inputStyle = { width: "100%", boxSizing: "border-box", padding: 12, borderRadius: 9, border: "1px solid #355477", background: "#071321", color: "#eef6ff", fontSize: 16 };
const cardStyle = { background: "#102139", border: "1px solid #284763", padding: 16, borderRadius: 14, marginBottom: 15 };
const buttonStyle = { border: "1px solid #355477", background: "#145f83", color: "white", padding: "11px 15px", borderRadius: 9, fontWeight: 750, cursor: "pointer" };

function download(content, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(content)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function FieldEmergencyReportView() {
  const [assignment, setAssignment] = useState(null);
  const [draft, setDraft] = useState({});
  const [photos, setPhotos] = useState([]);
  const [packageId, setPackageId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!assignment) return undefined;
    const timer = setTimeout(() => {
      saveEmergencyFieldDraft(assignment, draft, photos, packageId)
        .then(() => setMessage("Draft tersimpan di perangkat ini"))
        .catch(e => setError(`Draft gagal disimpan: ${e.message}`));
    }, 600);
    return () => clearTimeout(timer);
  }, [assignment, draft, photos, packageId]);

  async function importAssignment(file) {
    if (!file) return;
    setError(""); setMessage(""); setBusy(true);
    try {
      if (file.size > 100_000) throw new Error("File tugas terlalu besar");
      const data = validateEmergencyAssignment(JSON.parse(await file.text()));
      const saved = await loadEmergencyFieldDraft(data);
      if (saved && saved.assignment?.token !== data.token) throw new Error("Tugas dengan ID sama memiliki kunci berbeda; jangan timpa draft lama");
      const nextDraft = saved?.draft || { team: data.order.team, technician: "", helper: "", actualUnits: "", work: "", materials: "", notes: "", completedAt: "" };
      const nextPhotos = saved?.photos || [];
      const nextId = saved?.packageId || crypto.randomUUID();
      await saveEmergencyFieldDraft(data, nextDraft, nextPhotos, nextId);
      setDraft(nextDraft); setPhotos(nextPhotos); setPackageId(nextId); setAssignment(data);
      setMessage(saved ? "Draft lama dipulihkan" : "Tugas diterima dan draft lokal dibuat");
    } catch (e) { setError(e?.message || "Gagal membuka paket tugas"); }
    finally { setBusy(false); }
  }

  async function addPhotos(files) {
    if (!files?.length) return;
    setError(""); setBusy(true);
    try {
      if (photos.length + files.length > 8) throw new Error("Maksimal 8 foto per laporan");
      const next = [];
      for (const file of files) next.push(await compressEmergencyPhoto(file));
      const all = [...photos, ...next];
      await saveEmergencyFieldDraft(assignment, draft, all, packageId);
      setPhotos(all); setMessage(`${all.length} foto tersimpan lokal`);
    } catch (e) { setError(e?.message || "Foto gagal disimpan"); }
    finally { setBusy(false); }
  }

  async function exportReport() {
    setError(""); setBusy(true);
    try {
      await saveEmergencyFieldDraft(assignment, draft, photos, packageId);
      const reportPackage = await buildEmergencyReportPackage(assignment, draft, photos, packageId);
      download(reportPackage, `${assignment.orderId}-laporan-${packageId.slice(0, 8)}.json`);
      setMessage("Paket laporan terenkripsi diunduh. Kirim file ini ke Owner; simpan draft dan foto di perangkat sampai Owner mengonfirmasi penerimaan.");
    } catch (e) { setError(e?.message || "Paket laporan gagal dibuat"); }
    finally { setBusy(false); }
  }

  const field = (key, label, type = "text") => <label key={key} style={{ display: "grid", gap: 5, color: "#b6cbe0", fontSize: 13 }}>
    {label}<input type={type} value={draft[key] || ""} onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))} style={inputStyle} />
  </label>;

  return <main style={{ minHeight: "100vh", background: "#071321", color: "#eef6ff", fontFamily: "system-ui,sans-serif", padding: "20px 14px 60px" }}>
    <div style={{ maxWidth: 680, margin: "auto" }}>
      <h1 style={{ color: "#38bdf8", marginBottom: 4 }}>🧰 Laporan Tim Darurat</h1>
      <p style={{ color: "#b6cbe0", marginTop: 0 }}>Formulir ini bekerja tanpa Supabase. Data dan foto tersimpan hanya di perangkat ini sampai paket dikirim ke Owner.</p>
      <div style={{ ...cardStyle, background: "#3a2a11", borderColor: "#ad7d2c" }}>
        Identitas teknisi belum dapat diverifikasi server saat offline. Gunakan hanya paket tugas yang diberikan Owner. File laporan akan dicocokkan Owner secara manual; tidak membuat invoice atau mengubah stok.
      </div>
      {error && <div role="alert" style={{ ...cardStyle, background: "#4a1d24", borderColor: "#a33" }}>{error}</div>}
      {message && <div role="status" style={{ ...cardStyle, background: "#113b32", borderColor: "#207e64" }}>{message}</div>}

      {!assignment ? <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>1. Buka paket tugas dari Owner</h2>
        <p style={{ color: "#b6cbe0" }}>Terima file <code>.json</code> melalui jalur komunikasi yang Anda sepakati. Simpan file di ponsel lalu pilih di sini.</p>
        <input aria-label="Paket tugas darurat" type="file" accept=".json,application/json" disabled={busy} onChange={e => importAssignment(e.target.files?.[0])} style={inputStyle} />
      </section> : <>
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Tugas {assignment.orderId}</h2>
          <div><strong>{assignment.order.customer}</strong> · {assignment.order.service} · {assignment.order.date} {assignment.order.time}</div>
          {assignment.order.phone && <div style={{ color: "#b6cbe0", marginTop: 6 }}>Telepon: {assignment.order.phone}</div>}
          <div style={{ color: "#b6cbe0", marginTop: 6 }}>{assignment.order.address || "Lokasi belum dicatat"}</div>
          <div style={{ color: "#b6cbe0", marginTop: 5 }}>Rencana: {assignment.order.plannedUnits || "—"} unit · Tim: {assignment.order.team || "—"}</div>
          {assignment.order.notes && <div style={{ color: "#b6cbe0", marginTop: 5 }}>Catatan order: {assignment.order.notes}</div>}
        </section>
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>2. Isi pekerjaan aktual</h2>
          <div style={{ display: "grid", gap: 12 }}>
            {field("technician", "Nama teknisi *")}{field("helper", "Nama helper")}{field("team", "Tim pelapor *")}
            {field("actualUnits", "Jumlah unit aktual *", "number")}{field("completedAt", "Waktu selesai", "datetime-local")}
            <label style={{ display: "grid", gap: 5, color: "#b6cbe0", fontSize: 13 }}>Pekerjaan aktual *<textarea value={draft.work || ""} onChange={e => setDraft(prev => ({ ...prev, work: e.target.value }))} rows={3} style={inputStyle} /></label>
            <label style={{ display: "grid", gap: 5, color: "#b6cbe0", fontSize: 13 }}>Material terpakai (nama dan jumlah)<textarea value={draft.materials || ""} onChange={e => setDraft(prev => ({ ...prev, materials: e.target.value }))} rows={2} style={inputStyle} /></label>
            <label style={{ display: "grid", gap: 5, color: "#b6cbe0", fontSize: 13 }}>Catatan/temuan<textarea value={draft.notes || ""} onChange={e => setDraft(prev => ({ ...prev, notes: e.target.value }))} rows={2} style={inputStyle} /></label>
          </div>
        </section>
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>3. Foto pekerjaan ({photos.length}/8)</h2>
          <input aria-label="Foto pekerjaan" type="file" accept="image/*" multiple disabled={busy || photos.length >= 8} onChange={e => { addPhotos(Array.from(e.target.files || [])); e.target.value = ""; }} style={inputStyle} />
          <p style={{ color: "#b6cbe0", fontSize: 12 }}>Foto dikompresi dan disimpan di ponsel. Maksimal 8 foto; paket total maksimal 12 MB.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{photos.map((photo, index) => <div key={`${photo.name}-${index}`} style={{ width: 100 }}>
            <img src={photo.dataUrl} alt={photo.name} style={{ width: 100, height: 80, objectFit: "cover", borderRadius: 6 }} />
            <button onClick={() => setPhotos(prev => prev.filter((_, idx) => idx !== index))} style={{ ...buttonStyle, padding: 5, width: "100%", background: "#68323c", fontSize: 11 }}>Hapus foto</button>
          </div>)}</div>
        </section>
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>4. Kirim ke Owner</h2>
          <button disabled={busy} onClick={exportReport} style={{ ...buttonStyle, width: "100%" }}>Unduh paket laporan terenkripsi</button>
          <p style={{ color: "#b6cbe0", fontSize: 12 }}>Kirim file unduhan ke Owner via WA/file transfer. Mengunduh saja belum berarti laporan diterima. Jika diunduh ulang, ID paket tetap sama sehingga impor berulang ditolak sebagai duplikat.</p>
        </section>
      </>}
    </div>
  </main>;
}
