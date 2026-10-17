import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { PaymentInboxHealthView } from "../../src/components/PaymentInboxHealthPanel.jsx";
import { paymentHealthFixture } from "./fixture.js";

function Demo() {
  const [mode, setMode] = useState("idle");
  const [health, setHealth] = useState(() => paymentHealthFixture());
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  return <main>
    <h1>Status retry bukti WA · Preview lokal</h1>
    <p className="notice">Data simulasi · Tidak terhubung ke Supabase, Fonnte atau AI. Tidak mengubah invoice, pembayaran, maupun antrean produksi.</p>
    <nav aria-label="Skenario simulasi">
      {[["idle", "Antrean kosong"], ["waiting", "Retry aktif"], ["failed", "Pemeriksaan gagal"], ["unavailable", "Hasil belum terbaca"], ["disabled", "Deteksi nonaktif"], ["ingress-review", "Penerimaan perlu diperiksa"], ["ingress-unavailable", "Monitor penerimaan belum tersedia"]].map(([key, label]) => <button key={key} aria-pressed={mode === key && !error} onClick={() => { setMode(key); setHealth(paymentHealthFixture(key)); setError(""); setNotice(""); }}>{label}</button>)}
      <button onClick={() => setError("Koneksi status terputus (simulasi)")}>Simulasi koneksi gagal</button>
    </nav>
    <PaymentInboxHealthView health={health} error={error} onRefresh={() => { setHealth(paymentHealthFixture(mode)); setError(""); setNotice("Status simulasi diperbarui · tidak ada AI atau pembayaran yang dijalankan"); }} onOpenPending={() => setNotice("Buka Pending AI untuk tinjauan manual · tidak ada pembayaran diubah")} />
    {notice && <p role="status">{notice}</p>}
  </main>;
}

createRoot(document.getElementById("root")).render(<Demo />);
