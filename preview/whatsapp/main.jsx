import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import WorkspaceFixture from "../../e2e/fixtures/wa-workspace-app.jsx";
import { getLocalDate, shiftDateStr } from "../../src/lib/dateTime.js";
import "./preview.css";

function Preview() {
  const schedulePreview = new URLSearchParams(location.search).get("view") === "jadwal";
  const catalogPreview = new URLSearchParams(location.search).has("catalog");
  const [action, setAction] = useState(null);
  const [notice, setNotice] = useState("");
  const [failSend, setFailSend] = useState(false);
  const actionBox = useRef(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => { if (action) actionBox.current?.focus(); }, [action]);
  const closeAction = () => { action?.returnToChat(); setAction(null); };
  return <>
    <header className="demo-bar">
      <div><b>AClean · Testing {catalogPreview ? 'Katalog WA' : schedulePreview ? 'Jadwal' : 'WhatsApp'}</b><span>Data simulasi · Tidak terhubung ke WhatsApp asli</span></div>
      <button onClick={() => location.reload()}>Reset demo</button>
    </header>
    <main className="demo-home">
      <span className="demo-label">PREVIEW LOKAL</span>
      <h1>{catalogPreview ? "Kelola Katalog WA" : schedulePreview ? "Jadwal Team AClean" : "Coba alur WhatsApp Workspace"}</h1>
      <p><a href="/">WhatsApp Workspace</a> · <a href="/?catalog">Katalog WA</a> · <a href="/?view=jadwal">Jadwal</a></p>
      {!schedulePreview && !catalogPreview && <p>Klik Andi, pilih lokasi Rumah atau Kantor, lalu Jadwalkan/Reorder untuk membuka pop-up rencana. Pilih tanggal, Team opsional, dan jam; setelah disimpan klik Lihat di Jadwal.</p>}
      {!catalogPreview && <p>Tombol Jadwal Tim menampilkan Team 01–08 dari preset, anggota yang berbeda setiap hari, dan contoh teknisi absen. Klik kartu untuk reschedule; klik hari untuk timeline per jam. Semua data simulasi dan kembali ke awal saat halaman dimuat ulang.</p>}
      {catalogPreview && <p>Tambah atau ubah item, unggah foto, tautkan harga, lalu periksa Balasan Cepat di WhatsApp Workspace. Data contoh kembali ke awal saat halaman dimuat ulang.</p>}
      {schedulePreview && <p>Contoh area BSD dan Graha Raya tampil di kartu dan grid jam. Klik tanggal {shiftDateStr(getLocalDate(),1)} atau {shiftDateStr(getLocalDate(),2)}, lalu seret blok pekerjaan ke jam atau Team lain. Perubahan baru tersimpan setelah konfirmasi di pop-up Planning; tombol Planning Order menampilkan job yang sama.</p>}
      {!schedulePreview && !catalogPreview && <label className="demo-switch"><input type="checkbox" checked={failSend} onChange={e => { setFailSend(e.target.checked); window.waTest.sendResult = !e.target.checked; }} /> Simulasikan pengiriman gagal</label>}
      <WorkspaceFixture planningMode initialView={schedulePreview ? "schedule" : "whatsapp"} onNotice={setNotice} onAction={(event, returnToChat) => setAction({ ...event, returnToChat })} />
    </main>
    {action && <section className="demo-action" role="dialog" aria-modal="true" aria-labelledby="demo-action-title" ref={actionBox} tabIndex={-1} onKeyDown={e => { if (e.key === "Escape") closeAction(); }}>
      <span className="demo-label">SIMULASI AKSI</span>
      <h2 id="demo-action-title">{action.type === "order" ? "Draf jadwal / reorder" : action.type === "invoice" ? "Buka invoice pelanggan" : "Buka jadwal pelanggan"}</h2>
      <p>{action.type === "order" ? "Data berikut diteruskan panel WhatsApp ke formulir order AClean. Pada aplikasi utama, tanggal dan teknisi dipilih melalui formulir tersebut." : "Pada aplikasi utama, tombol ini membuka halaman terkait. Preview lokal menampilkan tujuan aksinya."}</p>
      {action.draft ? <dl>{[
        ["Pelanggan", action.draft.customer], ["Nomor WhatsApp", action.draft.phone],
        ["Alamat", action.draft.address || "Belum diisi"], ["Layanan", action.draft.service],
        ["Jumlah unit", action.draft.units], ["Tanggal", action.draft.date ? `${action.draft.date} ${action.draft.time} WIB` : "Dipilih di formulir order"],
        ["Teknisi", action.draft.teknisi || "Dipilih di formulir order"], ["Catatan", action.draft.notes],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : <div className="demo-destination">{action.type === "invoice" ? `Invoice → cari: ${action.query}` : "Jadwal → daftar pekerjaan pelanggan"}</div>}
      <button onClick={closeAction}>Kembali ke WhatsApp</button>
    </section>}
    {notice && <div className="demo-notice" role="status"><b>Simulasi</b> · {notice}</div>}
  </>;
}
createRoot(document.getElementById("root")).render(<Preview />);
