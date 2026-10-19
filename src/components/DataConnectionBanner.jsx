import { useEffect, useState } from "react";
import { cs } from "../theme/cs.js";

export default function DataConnectionBanner({ health, warning = "", loading, onRefresh }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (health.state === "healthy") return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000); // UI only; no network request.
    return () => clearInterval(timer);
  }, [health.state, health.retryAt]);
  if (health.state === "healthy" && !warning) return null;
  const waiting = health.state === "checking" || (health.state === "paused" && now < health.retryAt);
  return <section role="status" aria-label="Status koneksi data" style={{ border: "1px solid #f59e0b88", background: "#f59e0b12", borderRadius: 10, padding: "12px 14px", marginBottom: 16, color: cs.text, fontSize: 13 }}>
    <div style={{ fontWeight: 800, color: "#fbbf24", marginBottom: 5 }}>
      {health.state === "checking" ? "Memeriksa pemulihan koneksi…" : "Pembaruan data sedang terkendala"}
    </div>
    <div>{warning || "Data terakhir tetap ditampilkan. Pembacaan otomatis diberi jeda agar permintaan tidak menumpuk."}</div>
    <div style={{ marginTop: 5, color: cs.muted, fontSize: 12 }}>Jangan mengulang pembayaran atau aksi simpan sebelum memeriksa hasilnya. Mode darurat tetap diaktifkan manual oleh Owner.</div>
    <button disabled={loading || waiting} onClick={onRefresh} style={{ marginTop: 10, border: "1px solid " + cs.border, background: cs.surface, color: cs.accent, borderRadius: 7, padding: "7px 10px", cursor: loading || waiting ? "wait" : "pointer" }}>
      {waiting ? "Menunggu jeda percobaan koneksi" : loading ? "Memperbarui…" : "Coba muat data kembali"}
    </button>
  </section>;
}
